/**
 * Step 2.1 — probe a source episode and measure what the decision needs:
 * display size (SAR, rotation), black bars (cropdetect), interlacing (field order / idet),
 * the Japanese audio track and the average video bitrate.
 */
import fs from 'node:fs/promises';
import { bitDepth, probe, runFfmpegCapture, streamBitrate, type ProbeResult, type ProbeStream } from './ffmpeg.ts';

export interface Crop {
  w: number;
  h: number;
  x: number;
  y: number;
}

export interface Source {
  file: string;
  size: number;
  mtimeMs: number;
  probe: ProbeResult;
  video: ProbeStream;
  /** Japanese audio track; null when none could be chosen (see `audioProblem`). */
  audio: ProbeStream | null;
  audioNote: string;
  audioProblem: string | null;
  duration: number;
  width: number;
  height: number;
  bitDepth: number;
  /** Sample aspect ratio as a number (1 = square pixels). */
  sar: number;
  rotation: number;
  /** Frame size as displayed (SAR applied, rotation applied). */
  displayWidth: number;
  displayHeight: number;
  interlaced: boolean;
  interlaceNote: string;
  /** Black bars to remove (coded pixels), or null. */
  crop: Crop | null;
  cropNote: string;
  /** Average video bitrate in bit/s and whether it was estimated from the file size. */
  videoBitrate: number;
  videoBitrateEstimated: boolean;
}

const JAPANESE = new Set(['jpn', 'ja', 'jp', 'japanese']);
export const langOf = (s: ProbeStream): string => (s.tags?.['language'] ?? s.tags?.['LANGUAGE'] ?? '').toLowerCase();

function chooseAudio(p: ProbeResult): { audio: ProbeStream | null; note: string; problem: string | null } {
  const audios = p.streams.filter((s) => s.codec_type === 'audio');
  if (audios.length === 0) return { audio: null, note: '', problem: 'no audio track' };
  const jpn = audios.filter((s) => JAPANESE.has(langOf(s)));
  if (jpn.length > 0) {
    // Several Japanese tracks (e.g. commentary): the default one, else the first.
    const pick = jpn.find((s) => s.disposition?.['default'] && !/comment/i.test(s.tags?.['title'] ?? '')) ?? jpn[0]!;
    return { audio: pick, note: `Japanese track #${pick.index} (${pick.codec_name} ${pick.channels ?? '?'}ch)`, problem: null };
  }
  const untagged = audios.filter((s) => !langOf(s) || langOf(s) === 'und');
  if (audios.length === 1 && untagged.length === 1) {
    const only = audios[0]!;
    return {
      audio: only,
      note: `only audio track #${only.index} has no language tag — assumed Japanese`,
      problem: null,
    };
  }
  const langs = audios.map((s) => `#${s.index} ${langOf(s) || 'und'}`).join(', ');
  return { audio: null, note: '', problem: `no audio track tagged Japanese (${langs})` };
}

function parseRatio(r: string | undefined): number {
  const m = /^(\d+):(\d+)$/.exec(r ?? '');
  if (!m) return 1;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 0 && b > 0 ? a / b : 1;
}

function rotationOf(v: ProbeStream): number {
  const side = v.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation;
  const raw = side ?? Number(v.tags?.['rotate'] ?? 0);
  const r = ((Math.round(raw) % 360) + 360) % 360;
  return Number.isFinite(r) ? r : 0;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** cropdetect on short samples spread through the episode; keeps the least aggressive crop.
 *  The limit is relative (24/255) so 10-bit sources, where black is 64, work too. */
async function detectCrop(file: string, duration: number, width: number, height: number): Promise<{ crop: Crop | null; note: string }> {
  if (duration < 60) return { crop: null, note: 'too short to check for black bars' };
  const points = [0.2, 0.4, 0.6, 0.8].map((f) => Math.floor(duration * f));
  const found: Crop[] = [];
  for (const t of points) {
    const log = await runFfmpegCapture([
      '-ss', String(t), '-i', file, '-t', '3', '-map', '0:v:0', '-an', '-sn',
      '-vf', 'cropdetect=limit=0.094:round=2:reset=0', '-f', 'null', '-',
    ]).catch(() => '');
    const all = [...log.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
    const last = all.at(-1);
    if (last) found.push({ w: Number(last[1]), h: Number(last[2]), x: Number(last[3]), y: Number(last[4]) });
  }
  if (found.length < 3) return { crop: null, note: 'black-bar check inconclusive' };
  // Largest area = least crop; dark scenes make cropdetect over-crop, so never trust the smallest.
  const best = found.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  const agree = found.filter((c) => Math.abs(c.w - best.w) <= 4 && Math.abs(c.h - best.h) <= 4).length;
  const barsV = height - best.h;
  const barsH = width - best.w;
  if (barsV < 16 && barsH < 16) return { crop: null, note: 'no black bars' };
  if (agree < 3) return { crop: null, note: `black bars inconsistent between samples (${found.map((c) => `${c.w}×${c.h}`).join(', ')}) — not cropped` };
  const crop = { w: even(best.w), h: even(best.h), x: best.x, y: best.y };
  return { crop, note: `black bars: crop ${width}×${height} → ${crop.w}×${crop.h}` };
}

/** idet over ~600 frames: interlaced when TFF+BFF frames outnumber progressive ones. */
async function detectInterlace(file: string, v: ProbeStream, duration: number): Promise<{ interlaced: boolean; note: string }> {
  const fo = v.field_order ?? '';
  if (['tt', 'bb', 'tb', 'bt'].includes(fo)) return { interlaced: true, note: `interlaced (field order ${fo})` };
  if (fo === 'progressive') return { interlaced: false, note: 'progressive' };
  const log = await runFfmpegCapture([
    '-ss', String(Math.floor(duration * 0.3)), '-i', file, '-map', '0:v:0', '-an', '-sn',
    '-frames:v', '600', '-vf', 'idet', '-f', 'null', '-',
  ]).catch(() => '');
  const m = /Multi frame detection:\s*TFF:\s*(\d+)\s*BFF:\s*(\d+)\s*Progressive:\s*(\d+)/.exec(log);
  if (!m) return { interlaced: false, note: 'field order unknown, idet gave no result — treated as progressive' };
  const tff = Number(m[1]);
  const bff = Number(m[2]);
  const prog = Number(m[3]);
  if (tff + bff + prog === 0) return { interlaced: false, note: 'field order unknown, idet gave no result — treated as progressive' };
  const interlaced = tff + bff > prog;
  return { interlaced, note: `${interlaced ? 'interlaced' : 'progressive'} (idet TFF ${tff} / BFF ${bff} / progressive ${prog})` };
}

export async function inspect(file: string, opts: { measure?: boolean } = {}): Promise<Source> {
  const measure = opts.measure ?? true;
  const [p, stat] = await Promise.all([probe(file), fs.stat(file)]);
  const video = p.streams.find((s) => s.codec_type === 'video' && !s.disposition?.['attached_pic']);
  if (!video) throw new Error('no video stream');
  const duration = Number(p.format.duration ?? video.duration ?? 0);
  if (!(duration > 0)) throw new Error('unknown duration');

  const width = video.width ?? 0;
  const height = video.height ?? 0;
  const sar = parseRatio(video.sample_aspect_ratio);
  const rotation = rotationOf(video);
  let displayWidth = even(width * sar);
  let displayHeight = height;
  if (rotation === 90 || rotation === 270) [displayWidth, displayHeight] = [displayHeight, displayWidth];

  const { audio, note: audioNote, problem: audioProblem } = chooseAudio(p);

  let videoBitrate = streamBitrate(video);
  let videoBitrateEstimated = false;
  if (!videoBitrate) {
    const audioBits = p.streams
      .filter((s) => s.codec_type === 'audio')
      .reduce((sum, s) => sum + (streamBitrate(s) ?? 192_000), 0);
    videoBitrate = Math.max(0, (stat.size * 8) / duration - audioBits);
    videoBitrateEstimated = true;
  }

  const crop = measure ? await detectCrop(file, duration, width, height) : { crop: null, note: 'black bars not checked' };
  const inter = measure ? await detectInterlace(file, video, duration) : { interlaced: false, note: 'interlacing not checked' };

  return {
    file, size: stat.size, mtimeMs: Math.round(stat.mtimeMs), probe: p, video,
    audio, audioNote, audioProblem, duration, width, height,
    bitDepth: bitDepth(video.pix_fmt), sar, rotation, displayWidth, displayHeight,
    interlaced: inter.interlaced, interlaceNote: inter.note,
    crop: crop.crop, cropNote: crop.note,
    videoBitrate, videoBitrateEstimated,
  };
}
