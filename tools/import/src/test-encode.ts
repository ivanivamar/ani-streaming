/**
 * Step 1 — test encodes (PLAN.md, encode plan Phase 1a).
 *
 * Encodes each sample episode with every variant below, then prints and saves size, encode time,
 * average bitrate and (optionally) VMAF so Ivan can pick codec, settings and bitrate ceiling.
 * Never touches the originals; outputs go to tmp/test-encodes/<slug>/ (gitignored).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import os from 'node:os';
import { DEFAULTS } from './config.ts';
import {
  bitDepth, FFMPEG, listEncoders, listFilters, probe, runFfmpeg, runFfmpegCapture, streamBitrate,
  type ProbeResult, type ProbeStream,
} from './ffmpeg.ts';

// ---------------------------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------------------------

interface Variant {
  id: string;
  label: string;
  /** ffmpeg encoder that must exist; null for stream copy. */
  encoder: string | null;
  videoArgs: string[];
}

interface Settings {
  cq: number[];
  crf: number;
  maxrate?: string;
}

function rateCap(maxrate: string | undefined): string[] {
  if (!maxrate) return [];
  const m = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(maxrate);
  if (!m) throw new Error(`--maxrate: expected e.g. 6M or 6000k, got "${maxrate}"`);
  const n = Number(m[1]) * (m[2]?.toLowerCase() === 'm' ? 1000 : 1); // kbit/s
  return ['-maxrate', `${n}k`, '-bufsize', `${n * 2}k`];
}

function variants(s: Settings): Variant[] {
  const cap = rateCap(s.maxrate);
  const nvenc = s.cq.map<Variant>((cq) => ({
    id: `nvenc-cq${cq}`,
    label: `hevc_nvenc p7 hq vbr cq ${cq}`,
    encoder: 'hevc_nvenc',
    videoArgs: [
      '-c:v', 'hevc_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', String(cq),
      // -b:v 0 = no target bitrate, so the CQ value alone decides quality (ffmpeg's NVENC
      // wrapper otherwise targets 2 Mb/s and caps quality). A ceiling comes from --maxrate.
      '-b:v', '0', ...cap,
      '-b_ref_mode', 'middle', '-spatial-aq', '1', '-temporal-aq', '1', '-rc-lookahead', '32',
      '-pix_fmt', 'p010le', '-profile:v', 'main10', '-g', String(DEFAULTS.gop),
      '-tag:v', 'hvc1',
    ],
  }));
  const x265: Variant = {
    id: `x265-crf${s.crf}`,
    label: `libx265 slow crf ${s.crf} tune animation (reference)`,
    encoder: 'libx265',
    videoArgs: [
      '-c:v', 'libx265', '-preset', 'slow', '-crf', String(s.crf), '-tune', 'animation', ...cap,
      '-pix_fmt', 'yuv420p10le', '-profile:v', 'main10',
      '-x265-params', `keyint=${DEFAULTS.gop}:log-level=error`,
      '-tag:v', 'hvc1',
    ],
  };
  return [...nvenc, x265];
}

/** Remux-only variant, offered when the source video is already browser/phone friendly. */
function copyVariant(video: ProbeStream): Variant | null {
  const codec = video.codec_name;
  const depth = bitDepth(video.pix_fmt);
  // Only 4:2:0 plays everywhere (Chrome/Edge, Android MediaCodec).
  if (video.pix_fmt !== 'yuv420p' && video.pix_fmt !== 'yuv420p10le') return null;
  if (codec === 'h264' && depth === 8) {
    return { id: 'copy', label: 'video copy (remux only)', encoder: null, videoArgs: ['-c:v', 'copy'] };
  }
  if (codec === 'hevc' && depth <= 10) {
    return {
      id: 'copy', label: 'video copy (remux only)', encoder: null,
      videoArgs: ['-c:v', 'copy', '-tag:v', 'hvc1'],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Source inspection
// ---------------------------------------------------------------------------------------------

interface Source {
  file: string;
  slug: string;
  probe: ProbeResult;
  video: ProbeStream;
  audio: ProbeStream;
  audioNote: string;
  duration: number;
  size: number;
}

function slugOf(file: string): string {
  const base = path.basename(file, path.extname(file))
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ');
  return base.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sample';
}

function isJapanese(s: ProbeStream): boolean {
  const lang = (s.tags?.['language'] ?? '').toLowerCase();
  return lang === 'jpn' || lang === 'ja' || lang === 'jp';
}

async function inspect(file: string): Promise<Source> {
  const p = await probe(file);
  const video = p.streams.find((s) => s.codec_type === 'video' && !s.disposition?.['attached_pic']);
  if (!video) throw new Error('no video stream');
  const audios = p.streams.filter((s) => s.codec_type === 'audio');
  if (audios.length === 0) throw new Error('no audio stream');
  const jpn = audios.find(isJapanese);
  const audio = jpn ?? audios.find((s) => s.disposition?.['default']) ?? audios[0]!;
  const audioNote = jpn
    ? `Japanese track #${audio.index}`
    : `WARNING: no track tagged Japanese, using #${audio.index} (${audio.tags?.['language'] ?? 'und'})`;
  const stat = await fs.stat(file);
  return {
    file, slug: slugOf(file), probe: p, video, audio, audioNote,
    duration: Number(p.format.duration ?? 0),
    size: stat.size,
  };
}

// ---------------------------------------------------------------------------------------------
// Encoding + measuring
// ---------------------------------------------------------------------------------------------

interface Range { start: number; duration?: number }

interface Result {
  variant: string;
  label: string;
  file: string;
  sizeBytes: number;
  durationSec: number;
  totalKbps: number;
  videoKbps?: number;
  encodeSec?: number;
  speed?: number;
  vmaf?: number;
  error?: string;
}

function audioArgs(src: Source): string[] {
  const a = src.audio;
  if (a.codec_name === 'aac' && (a.channels ?? 2) <= 2) return ['-c:a', 'copy'];
  return ['-c:a', 'aac', '-b:a', DEFAULTS.audioBitrate, '-ac', '2'];
}

function rangeInputArgs(r: Range): string[] {
  return [
    ...(r.start > 0 ? ['-ss', String(r.start)] : []),
  ];
}

function rangeOutputArgs(r: Range): string[] {
  return r.duration ? ['-t', String(r.duration)] : [];
}

async function encode(src: Source, v: Variant, out: string, range: Range, clipDur: number): Promise<number> {
  const args = [
    ...rangeInputArgs(range), '-i', src.file, ...rangeOutputArgs(range),
    '-map', `0:${src.video.index}`, '-map', `0:${src.audio.index}`,
    '-map_metadata', '0', '-map_chapters', '0', '-sn', '-dn',
    ...v.videoArgs,
    ...audioArgs(src),
    '-movflags', '+faststart',
    out,
  ];
  const t0 = performance.now();
  await runFfmpeg(args, { duration: clipDur, label: v.id });
  return (performance.now() - t0) / 1000;
}

async function measure(out: string): Promise<Pick<Result, 'sizeBytes' | 'durationSec' | 'totalKbps' | 'videoKbps'>> {
  const p = await probe(out);
  const sizeBytes = (await fs.stat(out)).size;
  const durationSec = Number(p.format.duration ?? 0);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const vb = streamBitrate(v);
  return {
    sizeBytes, durationSec,
    totalKbps: durationSec ? (sizeBytes * 8) / durationSec / 1000 : 0,
    videoKbps: vb ? vb / 1000 : undefined,
  };
}

/** VMAF of `out` against the same range of the source (needs an ffmpeg built with libvmaf). */
async function vmaf(src: Source, out: string, range: Range): Promise<number> {
  const threads = Math.max(1, os.cpus().length - 1);
  const w = src.video.width ?? 1920;
  const h = src.video.height ?? 1080;
  const prep = `scale=${w}:${h}:flags=bicubic,format=yuv420p10le,setpts=PTS-STARTPTS`;
  const log = await runFfmpegCapture([
    '-i', out,
    ...rangeInputArgs(range), ...rangeOutputArgs(range), '-i', src.file,
    '-lavfi', `[0:v]${prep}[d];[1:v]${prep}[r];[d][r]libvmaf=n_threads=${threads}:n_subsample=2`,
    '-f', 'null', '-',
  ]);
  const m = /VMAF score[:=]\s*([\d.]+)/.exec(log);
  if (!m?.[1]) throw new Error('no VMAF score in ffmpeg output');
  return Number(m[1]);
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const mb = (b: number) => {
  const v = b / 1024 / 1024;
  return v.toFixed(v < 100 ? 1 : 0);
};
const mbps = (k?: number) => (k === undefined ? '—' : (k / 1000).toFixed(2));
const clock = (s?: number) => {
  if (s === undefined) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};

function describeSource(src: Source, clipDur: number): string[] {
  const v = src.video;
  const vb = streamBitrate(v);
  const total = src.duration ? (src.size * 8) / src.duration / 1000 : 0;
  return [
    `Source: ${path.basename(src.file)}`,
    `  video ${v.codec_name} ${v.profile ?? ''} ${bitDepth(v.pix_fmt)}-bit ${v.width}×${v.height} ` +
      `(${v.pix_fmt}), ${vb ? mbps(vb / 1000) + ' Mb/s video' : 'video bitrate unknown'}, ${mbps(total)} Mb/s total`,
    `  audio ${src.audio.codec_name} ${src.audio.channels ?? '?'}ch — ${src.audioNote}`,
    `  ${mb(src.size)} MB, ${clock(src.duration)}` +
      (clipDur < src.duration - 1 ? `; test range ${clock(clipDur)} ≈ ${mb((src.size * clipDur) / src.duration)} MB of source` : ''),
  ];
}

function shortError(msg: string): string {
  if (/libcuda|No capable devices|nvenc.*driver|minimum required Nvidia driver/i.test(msg)) {
    return 'NVENC unavailable (GPU/driver)';
  }
  return msg.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 80);
}

function table(src: Source, results: Result[], clipDur: number): string[] {
  const srcClip = (src.size * clipDur) / (src.duration || clipDur);
  const head = ['variant', 'size MB', '% src', 'total Mb/s', 'video Mb/s', 'encode', 'speed', 'VMAF'];
  const rows = results.map((r) =>
    r.error
      ? [r.variant, 'FAILED', '', '', '', '', '', shortError(r.error)]
      : [
          r.variant, mb(r.sizeBytes), `${((r.sizeBytes / srcClip) * 100).toFixed(0)}%`,
          mbps(r.totalKbps), mbps(r.videoKbps), clock(r.encodeSec),
          r.speed === undefined ? '—' : `${r.speed.toFixed(2)}×`,
          r.vmaf === undefined ? '—' : r.vmaf.toFixed(2),
        ],
  );
  const md = [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ];
  return md;
}

function compareHtml(sections: { src: Source; results: Result[] }[]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const body = sections.map(({ src, results }) => `
<h2>${esc(path.basename(src.file))}</h2>
<div class="grid">${results.filter((r) => !r.error).map((r) => `
  <figure>
    <video controls preload="metadata" src="${esc(src.slug + '/' + path.basename(r.file))}"></video>
    <figcaption><b>${esc(r.variant)}</b> · ${mb(r.sizeBytes)} MB · ${mbps(r.totalKbps)} Mb/s${r.vmaf !== undefined ? ` · VMAF ${r.vmaf.toFixed(1)}` : ''}<br><small>${esc(r.label)}</small></figcaption>
  </figure>`).join('')}
</div>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test encodes</title>
<style>body{font:14px system-ui;background:#111;color:#eee;margin:16px}video{width:100%;background:#000}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}figure{margin:0}
small{color:#aaa}</style>
<h1>Test encodes</h1><p>If a video stays black, this browser can't decode that codec.</p>${body}`;
}

// ---------------------------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------------------------

const USAGE = `
test-encode [files...] [options]

Encodes each file with every variant and reports size, encode time, bitrate (and VMAF).
Files can be absolute or relative to ${DEFAULTS.animeDir}. Without files, the Step 1 samples are used.

Options
  --out <dir>        output folder (default: tmp/test-encodes in the repo)
  --only <ids>       comma list of variants, e.g. nvenc-cq24,copy
  --cq <list>        NVENC quality levels (default 22,24,26)
  --crf <n>          x265 reference CRF (default 20)
  --maxrate <rate>   bitrate ceiling for all encodes, e.g. 6M (default: none)
  --start <time>     start offset, seconds or hh:mm:ss (default 0)
  --duration <time>  encode only this much (default: whole episode)
  --vmaf             also score each encode with VMAF (slow; needs ffmpeg with libvmaf)
  --skip-existing    don't re-encode outputs that already exist
  -h, --help
`;

function parseTime(s: string | undefined, name: string): number | undefined {
  if (s === undefined) return undefined;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) throw new Error(`--${name}: bad time "${s}"`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export async function testEncode(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      only: { type: 'string' },
      cq: { type: 'string' },
      crf: { type: 'string' },
      maxrate: { type: 'string' },
      start: { type: 'string' },
      duration: { type: 'string' },
      vmaf: { type: 'boolean', default: false },
      'skip-existing': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const settings: Settings = {
    cq: (values.cq ?? '22,24,26').split(',').map((n) => Number(n.trim())),
    crf: Number(values.crf ?? 20),
    maxrate: values.maxrate,
  };
  if (settings.cq.some((n) => !Number.isInteger(n) || n < 0 || n > 51)) throw new Error('--cq: integers 0–51');
  if (!Number.isFinite(settings.crf)) throw new Error('--crf: number expected');
  const range: Range = {
    start: parseTime(values.start, 'start') ?? 0,
    duration: parseTime(values.duration, 'duration'),
  };
  const only = values.only ? new Set(values.only.split(',').map((s) => s.trim())) : null;
  const outDir = path.resolve(values.out ?? DEFAULTS.testEncodeDir);

  const inputs = (positionals.length ? positionals : DEFAULTS.samples).map((f) =>
    path.isAbsolute(f) ? f : path.join(DEFAULTS.animeDir, f),
  );

  // ffmpeg + encoders check
  let encoders: Set<string>;
  try {
    encoders = await listEncoders();
  } catch (e) {
    throw new Error(
      `${(e as Error).message}\nInstall a full ffmpeg build (winget install Gyan.FFmpeg) or set FFMPEG_PATH.`,
    );
  }
  console.log(`ffmpeg: ${FFMPEG}`);
  for (const enc of ['hevc_nvenc', 'libx265', 'aac']) {
    console.log(`  ${encoders.has(enc) ? 'ok     ' : 'MISSING'} ${enc}`);
  }
  if (values.vmaf) {
    const filters = await listFilters();
    if (!filters.has('libvmaf')) {
      throw new Error('--vmaf: this ffmpeg has no libvmaf filter (the Gyan "full" build has it, "essentials" does not)');
    }
  }

  await fs.mkdir(outDir, { recursive: true });
  const sections: { src: Source; results: Result[] }[] = [];
  const report: string[] = [
    `# Test encodes — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    '',
    `Settings: NVENC cq ${settings.cq.join('/')}, x265 crf ${settings.crf}, ` +
      `maxrate ${settings.maxrate ?? 'none'}, GOP ${DEFAULTS.gop}, audio AAC ${DEFAULTS.audioBitrate} stereo` +
      (range.start || range.duration ? `, range ${clock(range.start)} + ${range.duration ? clock(range.duration) : 'rest'}` : ''),
    '',
  ];

  for (const file of inputs) {
    console.log('');
    let src: Source;
    try {
      src = await inspect(file);
    } catch (e) {
      console.error(`SKIP ${file}: ${(e as Error).message}`);
      report.push(`## ${path.basename(file)}`, '', `Skipped: ${(e as Error).message}`, '');
      continue;
    }
    const clipDur = Math.max(0, Math.min(range.duration ?? Infinity, src.duration - range.start));
    const info = describeSource(src, clipDur);
    info.forEach((l) => console.log(l));

    const list = [...variants(settings)];
    const cv = copyVariant(src.video);
    if (cv) list.push(cv);
    const todo = list.filter((v) => !only || only.has(v.id));
    if (only) {
      for (const id of only) if (!list.some((v) => v.id === id)) console.warn(`  (variant "${id}" n/a for this source)`);
    }

    const dir = path.join(outDir, src.slug);
    await fs.mkdir(dir, { recursive: true });
    const results: Result[] = [];

    for (const v of todo) {
      const out = path.join(dir, `${src.slug}.${v.id}.mp4`);
      const base = { variant: v.id, label: v.label, file: out };
      if (v.encoder && !encoders.has(v.encoder)) {
        console.log(`  ${v.id}: skipped, ${v.encoder} not in this ffmpeg`);
        results.push({ ...base, sizeBytes: 0, durationSec: 0, totalKbps: 0, error: `${v.encoder} missing` });
        continue;
      }
      try {
        let encodeSec: number | undefined;
        const exists = await fs.stat(out).then(() => true, () => false);
        if (values['skip-existing'] && exists) {
          console.log(`  ${v.id}: exists, not re-encoded`);
        } else {
          console.log(`  ${v.id}: ${v.label}`);
          encodeSec = await encode(src, v, out, range, clipDur);
        }
        const m = await measure(out);
        const r: Result = {
          ...base, ...m, encodeSec,
          speed: encodeSec ? m.durationSec / encodeSec : undefined,
        };
        if (values.vmaf && v.encoder) {
          console.log(`  ${v.id}: VMAF…`);
          r.vmaf = await vmaf(src, out, range);
        }
        console.log(
          `  ${v.id}: ${mb(r.sizeBytes)} MB, ${mbps(r.totalKbps)} Mb/s, encode ${clock(encodeSec)}` +
            (r.speed ? ` (${r.speed.toFixed(2)}× realtime)` : '') +
            (r.vmaf !== undefined ? `, VMAF ${r.vmaf.toFixed(2)}` : ''),
        );
        results.push(r);
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`  ${v.id}: FAILED — ${msg}`);
        if (v.encoder === 'hevc_nvenc' && shortError(msg).startsWith('NVENC')) {
          console.error('  (update the NVIDIA driver; the Gyan ffmpeg build needs a recent one)');
        }
        await fs.rm(out, { force: true });
        results.push({ ...base, sizeBytes: 0, durationSec: 0, totalKbps: 0, error: msg });
      }
    }

    console.log('');
    const t = table(src, results, clipDur);
    t.forEach((l) => console.log(l));
    sections.push({ src, results });
    report.push(`## ${path.basename(src.file)}`, '', ...info.map((l) => l.replace(/^ {2}/, '- ')), '', ...t, '');
    await fs.writeFile(
      path.join(dir, 'results.json'),
      JSON.stringify({ source: { file: src.file, probe: src.probe }, settings, range, results }, null, 2),
    );
  }

  await fs.writeFile(path.join(outDir, 'report.md'), report.join('\n'));
  await fs.writeFile(path.join(outDir, 'compare.html'), compareHtml(sections));
  console.log(`\nReport: ${path.join(outDir, 'report.md')}`);
  console.log(`Player page (open in Chrome/Edge): ${path.join(outDir, 'compare.html')}`);
}
