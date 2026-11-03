/**
 * Step 2.1 — copy vs encode vs encode+scale, and the ffmpeg arguments for it. Pure: no I/O.
 *
 * Copy rule (Step 1 result): video is copied only when it is H.264 8-bit 4:2:0 or HEVC
 * Main/Main 10 4:2:0, at most 1920×1080, square pixels, not rotated, not interlaced, no black
 * bars, and its average bitrate is ≤ 8 Mb/s. Anything else is encoded with the Step 1 NVENC
 * settings; when the output frame differs from the coded one (SAR correction, crop-free
 * downscale above 1920×1080) the action is `encode+scale`.
 */
import type { ImportAction } from '@ani/contracts';
import { DEFAULTS, ENCODE } from './config.ts';
import type { Source } from './probe.ts';

export type EncoderKind = 'nvenc' | 'x265';

export interface Decision {
  action: ImportAction;
  /** Why the video is encoded (empty for copy). */
  reasons: string[];
  /** Video filter chain, empty for copy. */
  filters: string[];
  outWidth: number;
  outHeight: number;
  videoArgs: string[];
  audioArgs: string[];
  /** Output codec / bit depth as stored in Firestore. */
  codec: 'hevc' | 'h264';
  bitDepth: 8 | 10;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const mbps = (b: number) => `${(b / 1e6).toFixed(2)} Mb/s`;

/** Why the source video can't simply be copied; empty array = copy is fine. */
export function copyBlockers(src: Source): string[] {
  const v = src.video;
  const out: string[] = [];
  const pix = v.pix_fmt ?? '?';
  if (v.codec_name === 'h264') {
    if (pix !== 'yuv420p' && pix !== 'yuvj420p') out.push(`H.264 ${src.bitDepth}-bit ${pix} (only 8-bit 4:2:0 H.264 plays in browsers/phones)`);
  } else if (v.codec_name === 'hevc') {
    const prof = (v.profile ?? '').toLowerCase();
    if (pix !== 'yuv420p' && pix !== 'yuv420p10le') out.push(`HEVC ${pix} (only 4:2:0 8/10-bit plays everywhere)`);
    else if (prof && prof !== 'main' && prof !== 'main 10') out.push(`HEVC profile ${v.profile}`);
  } else {
    out.push(`codec ${v.codec_name ?? 'unknown'}`);
  }
  if (src.displayWidth > ENCODE.maxWidth || src.displayHeight > ENCODE.maxHeight) out.push(`${src.displayWidth}×${src.displayHeight} is above 1920×1080`);
  if (Math.abs(src.sar - 1) > 0.01) out.push(`non-square pixels (SAR ${src.video.sample_aspect_ratio})`);
  if (src.rotation) out.push(`rotated ${src.rotation}°`);
  if (src.interlaced) out.push('interlaced');
  if (src.crop) out.push(`black bars (${src.cropNote.replace(/^black bars: /, '')})`);
  if (src.videoBitrate > ENCODE.copyMaxVideoBitrate) {
    out.push(`video bitrate ${mbps(src.videoBitrate)}${src.videoBitrateEstimated ? ' (estimated)' : ''} is above ${mbps(ENCODE.copyMaxVideoBitrate)}`);
  }
  return out;
}

/** Output frame: crop, then SAR to square pixels, then fit inside 1920×1080 (never upscale). */
export function outputSize(src: Source): { w: number; h: number } {
  const codedW = src.crop?.w ?? src.width;
  const codedH = src.crop?.h ?? src.height;
  let w = codedW * src.sar;
  let h = codedH;
  if (src.rotation === 90 || src.rotation === 270) [w, h] = [h, w];
  const k = Math.min(1, ENCODE.maxWidth / w, ENCODE.maxHeight / h);
  return { w: even(w * k), h: even(h * k) };
}

export function audioArgs(src: Source): string[] {
  const a = src.audio;
  if (a && a.codec_name === 'aac' && (a.channels ?? 2) <= 2) return ['-c:a', 'copy'];
  return ['-c:a', 'aac', '-b:a', DEFAULTS.audioBitrate, '-ac', '2'];
}

export function encoderArgs(kind: EncoderKind): string[] {
  const gop = String(DEFAULTS.gop);
  if (kind === 'x265') {
    // CPU fallback (no NVIDIA GPU): same quality target as the Step 1 reference, slow.
    return [
      '-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-tune', 'animation',
      '-pix_fmt', 'yuv420p10le', '-profile:v', 'main10',
      '-x265-params', `keyint=${gop}:vbv-maxrate=8000:vbv-bufsize=16000:log-level=error`,
      '-tag:v', 'hvc1',
    ];
  }
  return [
    '-c:v', 'hevc_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', String(ENCODE.cq),
    '-b:v', '0', '-maxrate', ENCODE.maxrate, '-bufsize', ENCODE.bufsize,
    '-b_ref_mode', 'middle', '-spatial-aq', '1', '-temporal-aq', '1', '-rc-lookahead', '32',
    '-pix_fmt', 'p010le', '-profile:v', 'main10', '-g', gop,
    '-tag:v', 'hvc1',
  ];
}

export function decide(src: Source, opts: { forceEncode?: boolean; encoder?: EncoderKind } = {}): Decision {
  const blockers = copyBlockers(src);
  if (opts.forceEncode) blockers.unshift('--force-encode');
  const aArgs = audioArgs(src);

  if (blockers.length === 0) {
    const hevc = src.video.codec_name === 'hevc';
    return {
      action: 'copy', reasons: [], filters: [],
      outWidth: src.width, outHeight: src.height,
      videoArgs: hevc ? ['-c:v', 'copy', '-tag:v', 'hvc1'] : ['-c:v', 'copy'],
      audioArgs: aArgs,
      codec: hevc ? 'hevc' : 'h264',
      bitDepth: src.bitDepth >= 10 ? 10 : 8,
    };
  }

  const filters: string[] = [];
  if (src.interlaced) filters.push('bwdif=mode=send_frame:parity=auto:deint=all');
  if (src.crop) filters.push(`crop=${src.crop.w}:${src.crop.h}:${src.crop.x}:${src.crop.y}`);
  const out = outputSize(src);
  // Size of the frame after crop + autorotate, before scaling.
  const rotated = src.rotation === 90 || src.rotation === 270;
  const preW = rotated ? (src.crop?.h ?? src.height) : (src.crop?.w ?? src.width);
  const preH = rotated ? (src.crop?.w ?? src.width) : (src.crop?.h ?? src.height);
  const scaled = out.w !== preW || out.h !== preH;
  if (scaled) filters.push(`scale=${out.w}:${out.h}:flags=lanczos`);
  filters.push('setsar=1');

  return {
    action: scaled ? 'encode+scale' : 'encode',
    reasons: blockers,
    filters,
    outWidth: out.w,
    outHeight: out.h,
    videoArgs: encoderArgs(opts.encoder ?? 'nvenc'),
    audioArgs: aArgs,
    codec: 'hevc',
    bitDepth: 10,
  };
}
