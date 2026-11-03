/**
 * Step 2 — the importer (PLAN.md, encode plan Phases 1a+, 1b, 1c).
 *
 *   npm run dry-run -w @ani/import                 scan + probe + decide + AniList, change nothing
 *   npm run import  -w @ani/import                 encode/copy → verify → Drive → Firestore
 *   npm run import  -w @ani/import -- "C:\…\Aoashi" --only aoashi --limit 3
 *   npm run import  -w @ani/import -- --out tmp/import-test     local folder instead of Drive + Firestore
 *
 * One episode at a time: probe → decide → write MP4 → extract subs/fonts/thumbnail → verify →
 * resumable upload → Firestore (`episodes`, `seasons`, `series`, `importState`) → clean the
 * work copy. Re-runnable: `importState/{sourceHash}` (file name + size, so it survives moving
 * the files or another PC) marks finished sources. Originals are only ever read.
 * Stops cleanly on Drive's daily upload limit (or Ctrl+C) and resumes on the next run.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  toEpisodeId, toSeasonId, toSeriesId,
  type Chapter, type EpisodeDoc, type ImportStateDoc, type OverrideDoc, type SeasonDoc, type SeasonId,
  type SeriesDoc, type SeriesId, type SubtitleTrack,
} from '@ani/contracts';
import {
  cleanSynopsis, describeMedia, getMedia, matchSeries, seasonMedia, type Media,
} from './anilist.ts';
import { DAILY_UPLOAD_LIMIT, DEFAULTS, ENCODE, VIDEO_EXTENSIONS } from './config.ts';
import { FirestoreCatalog, LocalCatalog, NoCatalog, type Catalog } from './catalog.ts';
import { decide, type Decision, type EncoderKind } from './decide.ts';
import { DriveStopError, DriveStore, LocalStore, type Store } from './drive.ts';
import {
  extractFonts, extractSubtitles, extractThumbnail, mapChapters, planFonts, planSubtitles, subFileName,
  type ExtractedFont, type SubPlan,
} from './extract.ts';
import { FFMPEG, listEncoders } from './ffmpeg.ts';
import { parseEpisodeName, type ParsedName } from './parse-name.ts';
import { inspect, type Source } from './probe.ts';
import { Report, UploadBudget, type FileEntry } from './report.ts';
import { verifyVideo, writeVideo, type VerifiedVideo } from './transcode.ts';

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

interface Options {
  dryRun: boolean;
  inputs: string[];
  out?: string;
  limit?: number;
  only?: string;
  force: boolean;
  forceEncode: boolean;
  replace: boolean;
  encoder: EncoderKind;
  keepWork: boolean;
  dailyLimit: number;
  anilist: boolean;
  refreshMeta: boolean;
  measure: boolean;
}

function parseSize(s: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/i.exec(s.trim());
  if (!m) throw new Error(`expected a size like 740G, got "${s}"`);
  const mul = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12 }[m[2]!.toLowerCase() as '' | 'k' | 'm' | 'g' | 't'];
  return Number(m[1]) * mul;
}

function options(argv: string[], dryRun: boolean): Options {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      src: { type: 'string' },
      out: { type: 'string' },
      limit: { type: 'string' },
      only: { type: 'string' },
      force: { type: 'boolean', default: false },
      'force-encode': { type: 'boolean', default: false },
      replace: { type: 'boolean', default: false },
      encoder: { type: 'string', default: 'nvenc' },
      'keep-work': { type: 'boolean', default: false },
      'daily-limit': { type: 'string' },
      'no-anilist': { type: 'boolean', default: false },
      'refresh-meta': { type: 'boolean', default: false },
      fast: { type: 'boolean', default: false },
    },
  });
  if (values.encoder !== 'nvenc' && values.encoder !== 'x265') throw new Error('--encoder must be nvenc or x265');
  const inputs = positionals.length ? positionals : [values.src ?? DEFAULTS.animeDir];
  return {
    dryRun,
    inputs: inputs.map((p) => path.resolve(DEFAULTS.animeDir, p)),
    out: values.out ? path.resolve(values.out) : undefined,
    limit: values.limit ? Number(values.limit) : undefined,
    only: values.only?.toLowerCase(),
    force: values.force,
    forceEncode: values['force-encode'],
    replace: values.replace,
    encoder: values.encoder,
    keepWork: values['keep-work'],
    dailyLimit: values['daily-limit'] ? parseSize(values['daily-limit']) : DAILY_UPLOAD_LIMIT,
    anilist: !values['no-anilist'],
    refreshMeta: values['refresh-meta'],
    measure: !(dryRun && values.fast),
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const gb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);
const mbps = (b: number) => `${(b / 1e6).toFixed(2)} Mb/s`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pad2 = (n: number) => String(n).padStart(2, '0');

async function scan(inputs: string[], skipDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(p: string) {
    const st = await fs.stat(p).catch(() => null);
    if (!st) throw new Error(`not found: ${p}`);
    if (st.isFile()) {
      if (VIDEO_EXTENSIONS.has(path.extname(p).toLowerCase())) out.push(p);
      return;
    }
    if (path.resolve(p) === path.resolve(skipDir)) return;
    for (const e of await fs.readdir(p, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(p, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(full);
    }
  }
  for (const i of inputs) await walk(i);
  return [...new Set(out)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** `importState` id: file name + size, so the same source is recognised after a move or on another PC. */
export function sourceHash(file: string, size: number): string {
  return crypto.createHash('sha1').update(`${path.basename(file).toLowerCase()}|${size}`).digest('hex').slice(0, 24);
}

function episodeTitle(src: Source, parsed: ParsedName): string | null {
  let t = (src.probe.format.tags?.['title'] ?? src.probe.format.tags?.['TITLE'] ?? '').trim();
  if (!t || t.includes('[') || /\b(1080p|720p|x264|x265|hevc|web-?dl|bd(rip)?|\.mkv)\b/i.test(t)) return null;
  const esc = parsed.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s._-]+');
  t = t.replace(new RegExp(`^${esc}`, 'i'), '');
  t = t.replace(/^[\s\-–:|]*(S\d{1,2}\s*E\d{1,4}|E(p(isode)?)?\s*\d{1,4}|\d{1,4})?[\s\-–:|.]*/i, '').trim();
  return t && /\p{L}/u.test(t) && t.length <= 150 ? t : null;
}

function searchTokens(...titles: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const t of titles) {
    if (!t) continue;
    for (const w of t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 2) set.add(w);
    }
  }
  return [...set].slice(0, 60);
}

// ---------------------------------------------------------------------------------------------
// Series / season metadata
// ---------------------------------------------------------------------------------------------

interface SeriesMeta {
  seriesId: SeriesId;
  override: OverrideDoc | null;
  existing: SeriesDoc | null;
  media: Media | null;
  notes: string[];
  matchProblem: string | null;
}

class Metadata {
  private readonly series = new Map<string, Promise<SeriesMeta>>();
  private readonly seasons = new Map<string, Promise<{ media: Media | null; note: string }>>();
  /** Notes already printed (series/season notes are shown once). */
  readonly printed = new Set<string>();

  private readonly catalog: Catalog;
  private readonly opts: Options;

  constructor(catalog: Catalog, opts: Options) {
    this.catalog = catalog;
    this.opts = opts;
  }

  get(seriesId: SeriesId, parsedTitle: string): Promise<SeriesMeta> {
    let p = this.series.get(seriesId);
    if (!p) {
      p = this.load(seriesId, parsedTitle);
      this.series.set(seriesId, p);
    }
    return p;
  }

  all(): Promise<SeriesMeta[]> {
    return Promise.all(this.series.values());
  }

  private async load(seriesId: SeriesId, parsedTitle: string): Promise<SeriesMeta> {
    const [override, existing] = await Promise.all([this.catalog.getOverride(seriesId), this.catalog.getSeries(seriesId)]);
    const meta: SeriesMeta = { seriesId, override, existing, media: null, notes: [], matchProblem: null };
    if (!this.opts.anilist) {
      meta.notes.push('AniList skipped (--no-anilist)');
      return meta;
    }
    try {
      if (override?.anilistId) {
        meta.media = await getMedia(override.anilistId);
        meta.notes.push(meta.media ? `AniList (override): ${describeMedia(meta.media)}` : `override anilistId ${override.anilistId} not found on AniList`);
      } else if (existing?.anilistId && !this.opts.refreshMeta) {
        meta.media = await getMedia(existing.anilistId);
        if (meta.media) meta.notes.push(`AniList: ${describeMedia(meta.media)}`);
      } else {
        const m = await matchSeries(parsedTitle);
        if (m.ok) {
          meta.media = m.media;
          meta.notes.push(m.note);
        } else {
          meta.matchProblem = `${m.reason}${m.candidates.length ? `; candidates: ${m.candidates.join(' | ')}` : ''}`;
          meta.notes.push(`AniList: ${meta.matchProblem} — set overrides/${seriesId} { anilistId } to fix`);
        }
      }
    } catch (e) {
      meta.notes.push(`AniList lookup failed: ${(e as Error).message} (metadata kept as is)`);
    }
    return meta;
  }

  season(meta: SeriesMeta, season: number): Promise<{ media: Media | null; note: string }> {
    const key = `${meta.seriesId}|${season}`;
    let p = this.seasons.get(key);
    if (!p) {
      p = (async () => {
        const sid = toSeasonId(season);
        const ov = meta.override?.seasons?.[sid]?.anilistId;
        try {
          if (ov) {
            const m = await getMedia(ov);
            return { media: m, note: m ? `AniList ${sid} (override): ${describeMedia(m)}` : `override ${sid} anilistId ${ov} not found` };
          }
          if (!meta.media) return { media: null, note: '' };
          return await seasonMedia(meta.media, season);
        } catch (e) {
          return { media: null, note: `AniList season lookup failed: ${(e as Error).message}` };
        }
      })();
      this.seasons.set(key, p);
    }
    return p;
  }
}

/** `current` is the series doc as it is now (re-read before each commit, so earlier episodes' fonts and addedAt are kept). */
function buildSeries(meta: SeriesMeta, current: SeriesDoc | null, parsedTitle: string, now: number, newFontIds: string[]): SeriesDoc {
  const m = meta.media;
  const ex = current;
  const title = meta.override?.title ?? m?.title.english ?? m?.title.romaji ?? ex?.title ?? parsedTitle;
  const titleRomaji = m?.title.romaji ?? ex?.titleRomaji ?? null;
  const titleNative = m?.title.native ?? ex?.titleNative ?? null;
  const aliasSet = new Set<string>([...(ex?.aliases ?? []), ...(m ? [m.title.english, m.title.romaji, ...m.synonyms] : []), parsedTitle]
    .filter((a): a is string => !!a && a !== title));
  const aliases = [...aliasSet];
  return {
    title,
    titleRomaji,
    titleNative,
    aliases,
    anilistId: m?.id ?? ex?.anilistId ?? null,
    synopsis: m ? cleanSynopsis(m.description) : (ex?.synopsis ?? null),
    genres: m?.genres ?? ex?.genres ?? [],
    year: m?.seasonYear ?? m?.startDate?.year ?? ex?.year ?? null,
    status: m?.status ?? ex?.status ?? null,
    format: (m?.format && m.format !== 'MUSIC' ? m.format : null) ?? ex?.format ?? null,
    posterUrl: m?.coverImage?.extraLarge ?? m?.coverImage?.large ?? ex?.posterUrl ?? null,
    bannerUrl: m?.bannerImage ?? ex?.bannerUrl ?? null,
    color: m?.coverImage?.color ?? ex?.color ?? null,
    seasonCount: ex?.seasonCount ?? 0,
    episodeCount: ex?.episodeCount ?? 0,
    addedAt: ex?.addedAt ?? now,
    updatedAt: now,
    searchTokens: searchTokens(title, titleRomaji, ...aliases),
    fontFileIds: [...new Set([...(ex?.fontFileIds ?? []), ...newFontIds])],
  };
}

function buildSeason(number: number, media: Media | null, existing: SeasonDoc | null): SeasonDoc {
  return {
    number,
    title: media ? (media.title.english ?? media.title.romaji) : (existing?.title ?? null),
    anilistId: media?.id ?? existing?.anilistId ?? null,
    year: media?.seasonYear ?? media?.startDate?.year ?? existing?.year ?? null,
    episodeCount: existing?.episodeCount ?? 0,
    posterUrl: media?.coverImage?.extraLarge ?? media?.coverImage?.large ?? existing?.posterUrl ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Plan printing
// ---------------------------------------------------------------------------------------------

function describePlan(r: Report, src: Source, d: Decision, subs: SubPlan[], fontCount: number, chapters: Chapter[]): void {
  const v = src.video;
  r.log(
    `   video   ${v.codec_name} ${v.profile ?? ''} ${src.bitDepth}-bit ${src.width}×${src.height}` +
      `${src.displayWidth !== src.width || src.displayHeight !== src.height ? ` (display ${src.displayWidth}×${src.displayHeight})` : ''}` +
      ` ${mbps(src.videoBitrate)}${src.videoBitrateEstimated ? '~' : ''} → ${d.action.toUpperCase()}` +
      `${d.action !== 'copy' ? ` ${d.outWidth}×${d.outHeight}` : ''}`,
  );
  if (d.reasons.length) r.log(`           because: ${d.reasons.join('; ')}`);
  r.log(`           ${src.interlaceNote}; ${src.cropNote}`);
  r.log(`   audio   ${src.audioNote} → ${d.audioArgs.includes('copy') ? 'copy (AAC)' : 'AAC 192k stereo'}`);
  r.log(`   subs    ${subs.length ? subs.map((s) => `${s.lang} ${s.kind} (${s.from.type === 'sidecar' ? 'sidecar' : s.from.codec === 'ass' ? 'ASS' : `${s.from.codec}→ASS`})`).join(', ') : 'none'}`);
  r.log(`   fonts   ${fontCount}`);
  r.log(`   chapters ${chapters.length || 'none'}`);
  for (const c of chapters) {
    r.log(`     ${c.kind === 'other' ? '  ' : c.kind.toUpperCase()} ${clock(c.startSec).padStart(5)}–${clock(c.endSec).padEnd(5)} ${c.title ? `"${c.title}"` : ''}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

export async function runImport(argv: string[], dryRun: boolean): Promise<void> {
  const opts = options(argv, dryRun);
  const report = new Report(dryRun ? 'dry-run' : 'import');
  report.log(`ani.stream ${report.command}${opts.out ? ' (local test target)' : ''}`);
  report.log(`  source: ${opts.inputs.join(', ')}`);

  // ffmpeg capabilities
  const encoders = await listEncoders().catch((e: Error) => {
    throw new Error(`${e.message}\nInstall ffmpeg with NVENC (winget install Gyan.FFmpeg) or set FFMPEG_PATH.`);
  });
  const needEncoder = opts.encoder === 'nvenc' ? 'hevc_nvenc' : 'libx265';
  if (!dryRun) {
    for (const e of [needEncoder, 'aac', 'libwebp']) {
      if (!encoders.has(e)) throw new Error(`${FFMPEG} has no ${e} encoder${e === 'hevc_nvenc' ? ' (use a full build, or --encoder x265 on a PC without NVIDIA)' : ''}`);
    }
  }

  // Targets
  let catalog: Catalog;
  let store: Store | null = null;
  if (opts.out) {
    catalog = new LocalCatalog(opts.out);
    if (!dryRun) store = await new LocalStore(opts.out).init();
  } else if (dryRun) {
    catalog = (await FirestoreCatalog.available()) ? await FirestoreCatalog.open() : new NoCatalog();
  } else {
    catalog = await FirestoreCatalog.open();
    const { getDriveAuth } = await import('./auth.ts');
    store = await new DriveStore(await getDriveAuth(), DEFAULTS.driveRoot).init();
  }
  report.log(`  catalogue: ${catalog.describe()}`);
  if (store) report.log(`  files: ${store.describe()}`);

  const budget = await new UploadBudget(DEFAULTS.uploadBudgetFile, opts.dailyLimit).load();
  if (!dryRun && !opts.out) report.log(`  uploaded in the last 24 h: ${gb(budget.used())} of ${gb(opts.dailyLimit)}`);

  let files = await scan(opts.inputs, DEFAULTS.workDir);
  report.log(`  found: ${files.length} video files\n`);

  // Parse names first so --only / --limit work on episodes, not files.
  const parsed = files.map((f) => ({ file: f, name: parseEpisodeName(path.basename(f)) }));
  let jobs = parsed;
  if (opts.only) jobs = jobs.filter((j) => !j.name.ok || j.name.value.title.toLowerCase().includes(opts.only!) || toSeriesId(j.name.value.title).includes(opts.only!));
  if (opts.only) jobs = jobs.filter((j) => j.name.ok);
  if (opts.limit) jobs = jobs.slice(0, opts.limit);
  files = jobs.map((j) => j.file);

  const metadata = new Metadata(catalog, opts);
  await fs.mkdir(DEFAULTS.workDir, { recursive: true });

  let stop: string | null = null;
  let interrupts = 0;
  const onSigint = () => {
    interrupts++;
    if (interrupts === 1) {
      stop = 'stopped by Ctrl+C';
      console.log('\n  Ctrl+C — finishing this episode, then stopping (press again to quit now; the upload resumes next run).');
    } else {
      process.exit(130);
    }
  };
  process.on('SIGINT', onSigint);

  try {
    for (let i = 0; i < jobs.length; i++) {
      const { file, name } = jobs[i]!;
      const tag = `[${i + 1}/${jobs.length}]`;
      const rel = path.basename(file);
      if (stop) {
        report.add({ file: rel, outcome: 'stopped', notes: [], detail: stop });
        continue;
      }
      if (!name.ok) {
        report.log(`${tag} ? ${rel}\n   unparseable: ${name.reason} — skipped (rename it, e.g. "Title - S01E05.mkv")`);
        report.add({ file: rel, outcome: 'unparseable', detail: name.reason, notes: [] });
        continue;
      }
      const entry = await processOne(file, name.value, tag, { opts, report, catalog, store, metadata, budget });
      if (entry.outcome === 'stopped') stop = entry.detail ?? 'stopped';
    }
  } finally {
    process.off('SIGINT', onSigint);
  }

  // Series summary
  const extra: string[] = [];
  const metas = await metadata.all();
  if (metas.length) {
    extra.push('', 'Series:');
    for (const m of metas) {
      extra.push(`  ${m.seriesId}: ${m.media ? describeMedia(m.media) : m.matchProblem ? `NO ANILIST MATCH — ${m.matchProblem}` : 'no AniList data'}`);
    }
  }
  if (stop) extra.push('', `Stopped: ${stop}. Run the same command again to continue.`);
  if (!dryRun && !opts.out) extra.push(`  uploaded in the last 24 h: ${gb(budget.used())} of ${gb(opts.dailyLimit)}`);
  if (dryRun) extra.push('', 'Dry run: nothing was encoded, uploaded or written.');
  report.summary(extra);
  const logFile = await report.save();
  console.log(`\nReport saved: ${logFile}`);
  if (report.count('failed')) process.exitCode = 1;
}

interface Ctx {
  opts: Options;
  report: Report;
  catalog: Catalog;
  store: Store | null;
  metadata: Metadata;
  budget: UploadBudget;
}

async function processOne(file: string, name: ParsedName, tag: string, ctx: Ctx): Promise<FileEntry> {
  const { opts, report, catalog } = ctx;
  const rel = path.basename(file);
  const seriesId = toSeriesId(name.title);
  const seasonId = toSeasonId(name.season);
  const episodeId = toEpisodeId({ season: name.season, episode: name.episode });
  const label = `${name.title} ${episodeId.toUpperCase()}`;
  const entry = ctx.report.add({ file: rel, outcome: 'failed', episode: `${seriesId}/${episodeId}`, notes: [] });
  const t0 = performance.now();

  const stat = await fs.stat(file);
  const stateId = sourceHash(file, stat.size);
  entry.sourceBytes = stat.size;

  report.log(`${tag} ${label}  ← ${rel} (${gb(stat.size)})`);
  if (name.seasonAssumed) entry.notes.push('no season in the name — season 1 assumed');

  // Re-run tracking
  const state = await catalog.getImportState(stateId);
  if (state?.status === 'done' && !opts.force) {
    entry.outcome = 'unchanged';
    report.log('   unchanged — already imported');
    if (!opts.dryRun && state.path !== file) await catalog.setImportState(stateId, { ...state, path: file });
    return entry;
  }
  const others = (await catalog.findImportsForEpisode(seriesId, episodeId)).filter((o) => o.id !== stateId && o.doc.status === 'done');
  if (others.length && !opts.replace) {
    entry.outcome = 'duplicate';
    entry.detail = `${episodeId} already imported from ${path.basename(others[0]!.doc.path)} (--replace to overwrite)`;
    report.log(`   duplicate — ${entry.detail}`);
    return entry;
  }

  const fail = async (msg: string, outcome: FileEntry['outcome'] = 'failed') => {
    entry.outcome = outcome;
    entry.detail = msg;
    report.log(`   ✗ ${msg}`);
    if (!opts.dryRun && catalog.writable) {
      await catalog.setImportState(stateId, {
        path: file, size: stat.size, mtime: Math.round(stat.mtimeMs),
        episodeRef: { seriesId, episodeId }, status: outcome === 'stopped' ? 'pending' : 'failed', error: msg,
      }).catch(() => {});
    }
    return entry;
  };

  // 1. Probe + decide
  let src: Source;
  try {
    src = await inspect(file, { measure: opts.measure });
  } catch (e) {
    return fail(`probe: ${(e as Error).message}`);
  }
  if (!src.audio) return fail(src.audioProblem ?? 'no Japanese audio', 'unsupported');
  if (src.audioNote.includes('assumed')) entry.notes.push(src.audioNote);
  const d = decide(src, { forceEncode: opts.forceEncode, encoder: opts.encoder });
  entry.action = d.action;

  // 2. Extraction plan
  const subPlan = await planSubtitles(src);
  const fontPlan = planFonts(src);
  const chapters = mapChapters(src);
  entry.notes.push(...subPlan.notes, ...fontPlan.notes);
  describePlan(report, src, d, subPlan.keep, fontPlan.fonts.length, chapters);

  const meta = await ctx.metadata.get(seriesId, name.title);
  const seasonMeta = await ctx.metadata.season(meta, name.season);
  for (const n of [...meta.notes, seasonMeta.note]) {
    if (n && !ctx.metadata.printed.has(n)) {
      ctx.metadata.printed.add(n);
      report.log(`   ${n}`);
    }
  }
  if (meta.matchProblem) entry.notes.push(`no AniList match: ${meta.matchProblem}`);

  if (opts.dryRun) {
    entry.outcome = 'planned';
    entry.seconds = (performance.now() - t0) / 1000;
    return entry;
  }

  // Budget check before spending time on the encode.
  const estimate = d.action === 'copy' ? stat.size : Math.min(stat.size, (src.duration * 8e6) / 8);
  if (!opts.out && ctx.budget.used() + estimate > ctx.budget.limit) {
    const at = ctx.budget.freeAt(estimate);
    return fail(`daily upload budget reached (${gb(ctx.budget.used())} in 24 h) — continue after ${at.toLocaleString()}`, 'stopped');
  }

  const store = ctx.store!;
  const work = path.join(DEFAULTS.workDir, stateId);
  await fs.mkdir(work, { recursive: true });
  const epBase = `e${pad2(name.episode)}`;
  const parts = ['series', seriesId, seasonId];
  const videoFile = path.join(work, `${epBase}.mp4`);
  const marker = path.join(work, 'video.json');
  let keepWork = opts.keepWork;

  try {
    await catalog.setImportState(stateId, {
      path: file, size: stat.size, mtime: Math.round(stat.mtimeMs), episodeRef: { seriesId, episodeId }, status: 'pending',
    });

    // 3. Video (reuse a verified work copy from an interrupted run)
    let verified: VerifiedVideo | null = null;
    try {
      const m = JSON.parse(await fs.readFile(marker, 'utf8')) as { size: number; mtime: number; action: string; verified: VerifiedVideo };
      if (m.size === stat.size && m.mtime === Math.round(stat.mtimeMs) && m.action === d.action) {
        verified = await verifyVideo(src, d, videoFile);
        report.log('   video   reusing verified work copy from the previous run');
      }
    } catch { /* none */ }
    if (!verified) {
      const te = performance.now();
      await writeVideo(src, d, videoFile, `${d.action} ${epBase}`);
      verified = await verifyVideo(src, d, videoFile);
      await fs.writeFile(marker, JSON.stringify({ size: stat.size, mtime: Math.round(stat.mtimeMs), action: d.action, verified }));
      const secs = (performance.now() - te) / 1000;
      report.log(`   ✓ ${d.action} ${gb(verified.sizeBytes)} ${mbps(verified.bitrate)} in ${clock(secs)} (${(src.duration / secs).toFixed(1)}× realtime), verified`);
    }
    entry.outputBytes = verified.sizeBytes;

    // 4. Subs, fonts, thumbnail
    const subFiles = await extractSubtitles(src, subPlan.keep, epBase, work);
    const fonts: ExtractedFont[] = await extractFonts(src, fontPlan.fonts, work);
    const thumbFile = path.join(work, `${epBase}.thumb.webp`);
    let thumbOk = true;
    try {
      await extractThumbnail(src, d.filters, thumbFile);
    } catch (e) {
      thumbOk = false;
      entry.notes.push(`thumbnail failed: ${(e as Error).message}`);
    }

    // 5. Upload (small files first; the video last)
    let sent = 0;
    const up = async (local: string, nameOnDrive: string, where: string[], mimeType: string) => {
      const r = await store.upload(local, nameOnDrive, where, {
        mimeType, label: nameOnDrive, sessionFile: path.join(work, `${nameOnDrive}.upload.json`),
      });
      sent += r.sentBytes;
      await ctx.budget.add(r.sentBytes);
      return r;
    };
    const subs: SubtitleTrack[] = [];
    for (let k = 0; k < subPlan.keep.length; k++) {
      const p = subPlan.keep[k]!;
      const r = await up(subFiles[k]!, subFileName(epBase, p), parts, 'text/x-ssa');
      subs.push({ lang: p.lang, kind: p.kind, driveFileId: r.id });
    }
    const fontIds: string[] = [];
    for (const f of fonts) {
      // Content hash in the name: two different fonts with the same file name never overwrite each other.
      const ext = path.extname(f.name);
      const r = await up(f.file, `${path.basename(f.name, ext)}.${f.md5.slice(0, 8)}${ext.toLowerCase()}`, ['series', seriesId, 'fonts'],
        ext.toLowerCase() === '.otf' ? 'font/otf' : 'font/ttf');
      fontIds.push(r.id);
    }
    const thumbId = thumbOk ? (await up(thumbFile, `${epBase}.thumb.webp`, parts, 'image/webp')).id : null;
    const video = await up(videoFile, `${epBase}.mp4`, parts, 'video/mp4');
    entry.uploadedBytes = sent;
    report.log(`   ✓ uploaded ${gb(sent)}${sent === 0 ? ' (all files already on Drive)' : ''} — ${subs.length} subs, ${fonts.length} fonts${thumbId ? ', thumbnail' : ''}`);

    // 6. Firestore
    const now = Date.now();
    const prevEpisode = await catalog.getEpisode(seriesId, episodeId);
    const prevSeason = await catalog.getSeason(seriesId, seasonId as SeasonId);
    const currentSeries = await catalog.getSeries(seriesId);
    const v = src.video;
    const episode: EpisodeDoc = {
      season: name.season,
      number: name.episode,
      title: episodeTitle(src, name) ?? prevEpisode?.title ?? null,
      durationSec: verified.durationSec,
      sizeBytes: verified.sizeBytes,
      addedAt: prevEpisode?.addedAt ?? now,
      video: {
        driveFileId: video.id, codec: d.codec, bitDepth: d.bitDepth,
        width: verified.width, height: verified.height, bitrate: verified.bitrate,
      },
      audio: [{ lang: 'ja', codec: 'aac', channels: verified.channels, default: true }],
      subs,
      chapters,
      thumbDriveFileId: thumbId,
      source: {
        width: src.width, height: src.height, codec: v.codec_name ?? 'unknown', bitDepth: src.bitDepth,
        bitrate: Math.round(src.videoBitrate),
      },
      action: d.action,
    };
    const counts = await catalog.commitEpisode({
      seriesId,
      series: buildSeries(meta, currentSeries, name.title, now, fontIds),
      seasonId,
      season: buildSeason(name.season, seasonMeta.media, prevSeason),
      episodeId,
      episode,
      stateId,
      state: { path: file, size: stat.size, mtime: Math.round(stat.mtimeMs), episodeRef: { seriesId, episodeId }, status: 'done' },
    });
    report.log(`   ✓ Firestore series/${seriesId}/episodes/${episodeId} (season ${counts.seasonEpisodes} eps, series ${counts.seriesEpisodes} eps)`);

    entry.outcome = 'imported';
    entry.seconds = (performance.now() - t0) / 1000;
    return entry;
  } catch (e) {
    if (e instanceof DriveStopError) {
      keepWork = true; // the upload resumes from here next run
      return fail(e.message, 'stopped');
    }
    return fail((e as Error).message);
  } finally {
    if (!keepWork) await fs.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/** Shown in `--help`. */
export const IMPORT_HELP = `Options:
  [paths…]            files or folders (default ${DEFAULTS.animeDir}); relative to it
  --only <text>       only series whose title contains <text>
  --limit <n>         first n episodes
  --out <dir>         write to a local folder (drive/ + firestore/ JSON) instead of Drive + Firestore
  --force             re-import sources already marked done
  --force-encode      encode even when the video could be copied
  --replace           replace an episode already imported from another file
  --encoder x265      CPU encode instead of NVENC (slow)
  --keep-work         keep tmp/import-work/<hash> after each episode
  --daily-limit 740G  upload budget per 24 h (Drive allows 750 GB)
  --no-anilist        don't look up AniList
  --refresh-meta      re-match AniList even when the series already has an id
  --fast              (dry-run) skip black-bar and interlace detection
Encode: hevc_nvenc cq ${ENCODE.cq}, max ${ENCODE.maxrate}, ≤ ${ENCODE.maxWidth}×${ENCODE.maxHeight}.`;
