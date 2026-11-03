/**
 * Step 2.1/2.4 — write the episode MP4 (copy or encode) and verify it before upload.
 */
import fs from 'node:fs/promises';
import type { Decision } from './decide.ts';
import { probe } from './ffmpeg.ts';
import { runFfmpeg } from './ffmpeg.ts';
import type { Source } from './probe.ts';

export async function writeVideo(src: Source, d: Decision, dest: string, label: string): Promise<void> {
  if (!src.audio) throw new Error('no Japanese audio track');
  await runFfmpeg(
    [
      '-i', src.file,
      '-map', `0:${src.video.index}`, '-map', `0:${src.audio.index}`,
      '-map_metadata', '-1', '-map_chapters', '-1', '-sn', '-dn',
      ...(d.filters.length ? ['-vf', d.filters.join(',')] : []),
      ...d.videoArgs,
      ...d.audioArgs,
      '-metadata:s:a:0', 'language=jpn',
      '-movflags', '+faststart',
      dest,
    ],
    { duration: src.duration, label },
  );
}

/** Duration the output should have: the video stream's own length when the container knows it. */
export function expectedDuration(src: Source): number {
  const tag = src.video.tags?.['DURATION'] ?? src.video.tags?.['DURATION-eng'];
  const m = tag ? /^(\d+):(\d+):([\d.]+)$/.exec(tag) : null;
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  const v = Number(src.video.duration);
  return Number.isFinite(v) && v > 0 ? v : src.duration;
}

export interface VerifiedVideo {
  durationSec: number;
  sizeBytes: number;
  width: number;
  height: number;
  bitrate: number;
  channels: number;
}

/** ffprobe the output: one video stream of the planned codec/size, one AAC track, duration ±1 s, faststart. */
export async function verifyVideo(src: Source, d: Decision, file: string): Promise<VerifiedVideo> {
  const p = await probe(file);
  const sizeBytes = (await fs.stat(file)).size;
  const videos = p.streams.filter((s) => s.codec_type === 'video');
  const audios = p.streams.filter((s) => s.codec_type === 'audio');
  const problems: string[] = [];
  const v = videos[0];
  const a = audios[0];
  if (videos.length !== 1 || !v) problems.push(`${videos.length} video streams`);
  else {
    if (v.codec_name !== d.codec) problems.push(`video codec ${v.codec_name}, expected ${d.codec}`);
    if (v.width !== d.outWidth || v.height !== d.outHeight) problems.push(`video ${v.width}×${v.height}, expected ${d.outWidth}×${d.outHeight}`);
  }
  if (audios.length !== 1 || !a) problems.push(`${audios.length} audio streams`);
  else if (a.codec_name !== 'aac') problems.push(`audio codec ${a.codec_name}`);
  const durationSec = Number(p.format.duration ?? 0);
  const want = expectedDuration(src);
  if (!(Math.abs(durationSec - want) <= 1)) problems.push(`duration ${durationSec.toFixed(2)} s, source ${want.toFixed(2)} s`);
  if (!(await isFaststart(file))) problems.push('moov atom is not at the start (+faststart missing)');
  if (problems.length) throw new Error(`verify failed: ${problems.join('; ')}`);
  return {
    durationSec: Math.round(durationSec * 1000) / 1000,
    sizeBytes,
    width: v!.width!,
    height: v!.height!,
    bitrate: Math.round((sizeBytes * 8) / durationSec),
    channels: a!.channels ?? 2,
  };
}

/** True when the `moov` box comes before `mdat` (progressive playback without a second request). */
async function isFaststart(file: string): Promise<boolean> {
  const fd = await fs.open(file, 'r');
  try {
    let pos = 0;
    const head = Buffer.alloc(16);
    for (let i = 0; i < 64; i++) {
      const { bytesRead } = await fd.read(head, 0, 16, pos);
      if (bytesRead < 8) return false;
      let size = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (size === 1) size = Number(head.readBigUInt64BE(8));
      if (size < 8) return false;
      pos += size;
    }
    return false;
  } finally {
    await fd.close();
  }
}
