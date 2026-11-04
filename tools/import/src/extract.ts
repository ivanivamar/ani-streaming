/**
 * Step 2.2 — what comes out of a source besides the video:
 * subtitles (ASS as-is, SRT/WebVTT → ASS, PGS/VobSub reported; sidecar files win),
 * fonts (attachments), chapters (OP/ED tagged) and the thumbnail.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Chapter, ChapterKind, SubtitleKind } from '@ani/contracts';
import { SIDECAR_EXTENSIONS } from './config.ts';
import { runFfmpeg, runFfmpegCapture, type ProbeStream } from './ffmpeg.ts';
import { langOf, type Source } from './probe.ts';

// ---------------------------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------------------------

const TEXT_SUBS = new Set(['ass', 'ssa', 'subrip', 'srt', 'webvtt', 'mov_text', 'text']);
const IMAGE_SUBS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub']);

const LANG2: Record<string, string> = {
  eng: 'en', spa: 'es', por: 'pt', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', rus: 'ru',
  ara: 'ar', jpn: 'ja', chi: 'zh', zho: 'zh', kor: 'ko', pol: 'pl', tur: 'tr', ind: 'id', tha: 'th',
  vie: 'vi', may: 'ms', msa: 'ms', dut: 'nl', nld: 'nl', swe: 'sv', fin: 'fi', nor: 'no', dan: 'da',
  cze: 'cs', ces: 'cs', hun: 'hu', rum: 'ro', ron: 'ro', gre: 'el', ell: 'el', heb: 'he', hin: 'hi',
  ukr: 'uk', und: 'und',
};

export function normLang(raw: string | undefined): string {
  const l = (raw ?? '').toLowerCase().trim();
  if (!l) return 'und';
  const base = l.split(/[-_]/)[0]!;
  if (base.length === 2) return base;
  return LANG2[base] ?? 'und';
}

export function subKind(title: string | undefined, forced: boolean): SubtitleKind {
  const t = (title ?? '').toLowerCase();
  if (/\bsigns?\b|forced/.test(t)) return 'signs';
  if (/\bsongs?\b|karaoke|lyrics/.test(t)) return 'songs';
  return forced ? 'signs' : 'full';
}

export interface SubPlan {
  lang: string;
  kind: SubtitleKind;
  /** Drive name, e.g. `e01.en.ass`, `e01.en.signs.ass`. Filled in by `subFileName`. */
  from: { type: 'stream'; index: number; codec: string } | { type: 'sidecar'; file: string; ext: string };
  label: string;
}

export interface SubReport {
  keep: SubPlan[];
  notes: string[];
}

/** Sidecars: `<base>.ass`, `<base>.en.ass`, `<base>.en.signs.srt`, `<base>.signs.ass` in the source's folder. */
export async function findSidecars(sourceFile: string): Promise<SubPlan[]> {
  const dir = path.dirname(sourceFile);
  const base = path.basename(sourceFile, path.extname(sourceFile));
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: SubPlan[] = [];
  for (const n of names) {
    const ext = path.extname(n).toLowerCase();
    if (!SIDECAR_EXTENSIONS.has(ext) || !n.startsWith(base + '.')) continue;
    const middle = n.slice(base.length + 1, n.length - ext.length).split('.').filter(Boolean);
    let lang = 'und';
    let kindWord = '';
    for (const tok of middle) {
      if (/^(signs?|songs?|forced|full|karaoke)$/i.test(tok)) kindWord = tok;
      else if (normLang(tok) !== 'und' || tok.toLowerCase() === 'und') lang = normLang(tok);
    }
    out.push({
      lang,
      kind: subKind(kindWord, false),
      from: { type: 'sidecar', file: path.join(dir, n), ext },
      label: `sidecar ${n}`,
    });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export async function planSubtitles(src: Source): Promise<SubReport> {
  const notes: string[] = [];
  const sidecars = await findSidecars(src.file);
  const embedded: SubPlan[] = [];
  const subs = src.probe.streams.filter((s) => s.codec_type === 'subtitle');
  // Default track first so it wins a lang+kind tie.
  subs.sort((a, b) => (b.disposition?.['default'] ?? 0) - (a.disposition?.['default'] ?? 0));
  for (const s of subs) {
    const codec = s.codec_name ?? '?';
    const title = s.tags?.['title'];
    const desc = `#${s.index} ${codec} ${langOf(s) || 'und'}${title ? ` "${title}"` : ''}`;
    if (IMAGE_SUBS.has(codec)) {
      notes.push(`image subtitles not extracted: ${desc} (needs OCR)`);
      continue;
    }
    if (!TEXT_SUBS.has(codec)) {
      notes.push(`unknown subtitle codec, not extracted: ${desc}`);
      continue;
    }
    embedded.push({
      lang: normLang(langOf(s)),
      kind: subKind(title, !!s.disposition?.['forced']),
      from: { type: 'stream', index: s.index, codec },
      label: desc,
    });
  }

  const keep: SubPlan[] = [];
  const key = (p: SubPlan) => `${p.lang}.${p.kind}`;
  const taken = new Map<string, SubPlan>();
  for (const p of [...sidecars, ...embedded]) {
    const k = key(p);
    const prev = taken.get(k);
    if (prev) {
      notes.push(`${p.label} dropped: ${prev.label} already gives ${p.lang} ${p.kind}${prev.from.type === 'sidecar' && p.from.type === 'stream' ? ' (sidecar wins)' : ''}`);
      continue;
    }
    taken.set(k, p);
    keep.push(p);
  }
  if (src.crop && keep.length) notes.push('video is cropped: positioned ASS signs may sit slightly off — check one episode');
  return { keep, notes };
}

export function subFileName(epBase: string, p: SubPlan): string {
  return p.kind === 'full' ? `${epBase}.${p.lang}.ass` : `${epBase}.${p.lang}.${p.kind}.ass`;
}

/** Writes every kept subtitle as `.ass` into `workDir`; returns local paths in the same order. */
export async function extractSubtitles(src: Source, plans: SubPlan[], epBase: string, workDir: string): Promise<string[]> {
  const out: string[] = [];
  const streamArgs: string[] = [];
  for (const p of plans) {
    const dest = path.join(workDir, subFileName(epBase, p));
    out.push(dest);
    if (p.from.type === 'sidecar') {
      if (p.from.ext === '.ass') await fs.copyFile(p.from.file, dest);
      else await runFfmpeg(['-i', p.from.file, '-c:s', 'ass', dest], { quiet: true });
    } else {
      const copy = p.from.codec === 'ass';
      streamArgs.push('-map', `0:${p.from.index}`, '-c:s', copy ? 'copy' : 'ass', dest);
    }
  }
  if (streamArgs.length) await runFfmpeg(['-i', src.file, ...streamArgs], { quiet: true });
  for (const f of out) {
    const st = await fs.stat(f).catch(() => null);
    if (!st || st.size === 0) throw new Error(`subtitle extraction produced no file: ${path.basename(f)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------------------------

const FONT_EXT = new Set(['.ttf', '.otf', '.ttc', '.woff', '.woff2']);

export interface FontPlan {
  index: number;
  fileName: string;
}

export function planFonts(src: Source): { fonts: FontPlan[]; notes: string[] } {
  const fonts: FontPlan[] = [];
  const notes: string[] = [];
  for (const s of src.probe.streams.filter((x: ProbeStream) => x.codec_type === 'attachment')) {
    const name = s.tags?.['filename'] ?? '';
    const mime = (s.tags?.['mimetype'] ?? '').toLowerCase();
    const isFont = FONT_EXT.has(path.extname(name).toLowerCase()) || /font|truetype|opentype|sfnt/.test(mime);
    if (!isFont) {
      notes.push(`attachment ignored: ${name || `#${s.index}`} (${mime || 'no mimetype'})`);
      continue;
    }
    const safe = path.basename(name || `font-${s.index}.ttf`).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    fonts.push({ index: s.index, fileName: safe });
  }
  return { fonts, notes };
}

export interface ExtractedFont {
  file: string;
  name: string;
  md5: string;
}

/** Dumps the font attachments into `workDir/fonts`, deduplicated by content. */
export async function extractFonts(src: Source, fonts: FontPlan[], workDir: string): Promise<ExtractedFont[]> {
  if (!fonts.length) return [];
  const dir = path.join(workDir, 'fonts');
  await fs.mkdir(dir, { recursive: true });
  const used = new Set<string>();
  const args: string[] = [];
  const targets: Array<{ file: string; name: string }> = [];
  for (const f of fonts) {
    let name = f.fileName;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${path.parse(f.fileName).name}-${i}${path.extname(f.fileName)}`;
    used.add(name.toLowerCase());
    const file = path.join(dir, name);
    args.push(`-dump_attachment:${f.index}`, file);
    targets.push({ file, name });
  }
  // ffmpeg dumps attachments while opening the input; the null output only satisfies the CLI.
  await runFfmpegCapture([...args, '-i', src.file, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-']).catch(() => '');
  const out: ExtractedFont[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    const buf = await fs.readFile(t.file).catch(() => null);
    if (!buf?.length) throw new Error(`font attachment not extracted: ${t.name}`);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    if (seen.has(md5)) continue;
    seen.add(md5);
    out.push({ file: t.file, name: t.name, md5 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------------------------

/** Strong names win over weak ones ("Intro" is often a cold open, or the whole episode on WEB releases). */
const OP_STRONG = /^(op|opening|oped)(\s*\d+)?\b|\bopening\b|\bop(\s*\d+)?$/i;
const OP_WEAK = /^intro\b/i;
const ED_STRONG = /^(ed|ending)(\s*\d+)?\b|\bending\b|\bed(\s*\d+)?$/i;
const ED_WEAK = /^(outro|credits)\b|\bcredits\b/i;
const NOT_SONG = /preview|next ep|avant|prologue|cold open|recap|eyecatch/i;
const GENERIC_RE = /^(chapter|part|cap[ií]tulo|kapitel|chapitre)?\s*\d*$/i;
/** OP/ED songs: TV versions run ~1:30; allow short/long cuts, never a whole episode part. */
const SONG_MIN = 45;
const SONG_MAX = 150;

/**
 * Chapters → Firestore shape. At most one OP (first half) and one ED (second half):
 * a chapter of song length (45–150 s) named OP/Opening (strong) or Intro (weak), resp.
 * ED/Ending or Outro/Credits; ties go to the stronger name, then to the length closest to 90 s.
 * Without a named match, an untitled/"Chapter N" chapter of 80–95 s near the start/end is used.
 */
export function mapChapters(src: Source): Chapter[] {
  const raw = src.probe.chapters ?? [];
  const chapters: Chapter[] = raw.map((c) => ({
    title: (c.tags?.['title'] ?? '').trim(),
    startSec: Math.round(Number(c.start_time) * 1000) / 1000,
    endSec: Math.round(Number(c.end_time) * 1000) / 1000,
    kind: 'other' as ChapterKind,
  }));

  const dur = src.duration;
  const len = (c: Chapter) => c.endSec - c.startSec;
  const songLength = (c: Chapter) => len(c) >= SONG_MIN && len(c) <= SONG_MAX;
  const firstHalf = (c: Chapter) => c.startSec < dur * 0.5;
  const secondHalf = (c: Chapter) => c.endSec > dur * 0.5;
  const pick = (cs: Array<{ c: Chapter; rank: number }>) =>
    cs.sort((a, b) => a.rank - b.rank || Math.abs(len(a.c) - 90) - Math.abs(len(b.c) - 90))[0]?.c;
  const named = (strong: RegExp, weak: RegExp, where: (c: Chapter) => boolean) =>
    chapters
      .filter((c) => c.kind === 'other' && !NOT_SONG.test(c.title) && songLength(c) && where(c))
      .map((c) => ({ c, rank: strong.test(c.title) ? 0 : weak.test(c.title) ? 1 : -1 }))
      .filter((x) => x.rank >= 0);

  const op = pick(named(OP_STRONG, OP_WEAK, firstHalf));
  if (op) op.kind = 'op';
  const ed = pick(named(ED_STRONG, ED_WEAK, secondHalf));
  if (ed) ed.kind = 'ed';

  const songLike = (c: Chapter) => c.kind === 'other' && GENERIC_RE.test(c.title) && len(c) >= 80 && len(c) <= 95;
  if (!op) {
    const g = pick(chapters.filter((c) => songLike(c) && c.startSec < dur * 0.4).map((c) => ({ c, rank: 0 })));
    if (g) g.kind = 'op';
  }
  if (!ed) {
    const g = pick(chapters.filter((c) => songLike(c) && c.endSec > dur * 0.7).map((c) => ({ c, rank: 0 })));
    if (g) g.kind = 'ed';
  }
  return chapters.map((c) => ({ ...c, title: c.title || (c.kind === 'op' ? 'Opening' : c.kind === 'ed' ? 'Ending' : '') }));
}

// ---------------------------------------------------------------------------------------------
// Thumbnail
// ---------------------------------------------------------------------------------------------

/** One WebP frame at 25 % of the episode, 640 px wide, with the same deinterlace/crop as the video. */
export async function extractThumbnail(src: Source, videoFilters: string[], dest: string): Promise<void> {
  const pre = videoFilters.filter((f) => f.startsWith('bwdif') || f.startsWith('crop'));
  const sarFix = Math.abs(src.sar - 1) > 0.01 ? ['scale=iw*sar:ih', 'setsar=1'] : [];
  const vf = [...pre, ...sarFix, 'scale=640:-2:flags=lanczos'].join(',');
  await runFfmpeg([
    '-ss', String(Math.floor(src.duration * 0.25)), '-i', src.file,
    '-map', '0:v:0', '-frames:v', '1', '-vf', vf, '-c:v', 'libwebp', '-quality', '78', dest,
  ], { quiet: true });
}
