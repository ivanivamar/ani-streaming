import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * System ffmpeg with NVENC (Windows: `winget install Gyan.FFmpeg`).
 * `FFMPEG_PATH` / `FFPROBE_PATH` override PATH lookup; ffprobe is looked for next to FFMPEG_PATH.
 */
export const FFMPEG = process.env['FFMPEG_PATH'] || 'ffmpeg';
export const FFPROBE =
  process.env['FFPROBE_PATH'] || siblingProbe(process.env['FFMPEG_PATH']) || 'ffprobe';

function siblingProbe(ffmpegPath: string | undefined): string | undefined {
  if (!ffmpegPath) return undefined;
  const ext = path.extname(ffmpegPath);
  const candidate = path.join(path.dirname(ffmpegPath), `ffprobe${ext}`);
  return fs.existsSync(candidate) ? candidate : undefined;
}

function capture(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`could not start ${bin}: ${e.message}`)));
    p.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${err.trim().slice(-2000)}`)),
    );
  });
}

/** Names of the video/audio encoders this ffmpeg build has. */
export async function listEncoders(): Promise<Set<string>> {
  const out = await capture(FFMPEG, ['-hide_banner', '-encoders']);
  const names = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*[VAS][.A-Z]{5}\s+(\S+)/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return names;
}

/** Names of the filters this ffmpeg build has (printed on stdout). */
export async function listFilters(): Promise<Set<string>> {
  const out = await capture(FFMPEG, ['-hide_banner', '-filters']);
  const names = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*[.TSC|]{2,3}\s+(\S+)\s+\S+->\S+/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return names;
}

export interface ProbeStream {
  index: number;
  codec_type: 'video' | 'audio' | 'subtitle' | 'attachment' | 'data';
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  bit_rate?: string;
  channels?: number;
  avg_frame_rate?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

export interface ProbeResult {
  streams: ProbeStream[];
  format: { filename: string; duration?: string; size?: string; bit_rate?: string };
}

export async function probe(file: string): Promise<ProbeResult> {
  const out = await capture(FFPROBE, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  return JSON.parse(out) as ProbeResult;
}

/** Stream bitrate in bit/s; MKV muxers often only write the `BPS` statistics tag. */
export function streamBitrate(s: ProbeStream | undefined): number | undefined {
  if (!s) return undefined;
  const raw = s.bit_rate ?? s.tags?.['BPS'] ?? s.tags?.['BPS-eng'];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function bitDepth(pixFmt: string | undefined): number {
  if (!pixFmt) return 8;
  const m = /p(9|10|12|14|16)(le|be)?$/.exec(pixFmt) ?? /^p0(10|12|16)/.exec(pixFmt);
  return m?.[1] ? Number(m[1]) : 8;
}

export interface RunOptions {
  /** Total output duration in seconds, used for the progress line. */
  duration?: number;
  label?: string;
}

/**
 * Runs ffmpeg with `-progress` and prints a single updating progress line.
 * Rejects with the tail of stderr on failure.
 */
export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const full = ['-hide_banner', '-nostdin', '-v', 'error', '-stats_period', '1', '-progress', 'pipe:1', '-y', ...args];
    const p = spawn(FFMPEG, full, { windowsHide: true });
    let err = '';
    let buf = '';
    const state: Record<string, string> = {};
    const tty = process.stdout.isTTY;
    let lastPrint = 0;

    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        state[line.slice(0, eq)] = line.slice(eq + 1);
        if (line.startsWith('progress=')) {
          const now = Date.now();
          if (!tty && now - lastPrint < 15000) continue;
          lastPrint = now;
          const t = Math.max(0, Number(state['out_time_us'] ?? state['out_time_ms'] ?? 0) / 1e6);
          const pct = opts.duration ? Math.max(0, Math.min(100, (t / opts.duration) * 100)).toFixed(1) + '%' : `${t.toFixed(0)}s`;
          const msg = `  ${opts.label ?? ''} ${pct}  fps ${state['fps'] ?? '?'}  speed ${state['speed'] ?? '?'}`;
          if (tty) process.stdout.write(`\r${msg.padEnd(70)}`);
          else console.log(msg);
        }
      }
    });
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => reject(new Error(`could not start ${FFMPEG}: ${e.message}`)));
    p.on('close', (code) => {
      if (tty) process.stdout.write('\r'.padEnd(72) + '\r');
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${err.trim().split(/\r?\n/).slice(-6).join(' | ')}`));
    });
  });
}

/** Runs ffmpeg and returns stderr (for filters such as libvmaf that log their result). */
export function runFfmpegCapture(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve(err) : reject(new Error(`ffmpeg exited ${code}: ${err.trim().split(/\r?\n/).slice(-4).join(' | ')}`)),
    );
  });
}
