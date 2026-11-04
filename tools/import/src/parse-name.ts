/**
 * Episode file names → series title, season, episode.
 *
 * Same rules as `parseVid` in the v3 design (`design_handoff_anime_streaming`), in the same order:
 *   1. `[Group] Title - S01E05 (tags) [CRC].mkv`, `Title.S02E01.1080p.WEB.mkv`   (SxxEyy)
 *   2. `[SubsPlease] Title - 05 (1080p) [CRC].mkv`, `… - 05v2 …`                  (" - NN")
 *   3. `Title E05`, `Title Ep 5`, `Title Episode 05`                              (E / Ep / Episode)
 *   then, when no season was found: `Title S2 - 05`, `Title Season 2 - 05`.
 *
 * A name without an episode number or without a title is **unparseable**: the importer reports
 * it and skips the file. Nothing is guessed — the only default is season 1 when the name has
 * an episode number but no season (reported as `seasonAssumed`).
 */

export interface ParsedName {
  title: string;
  season: number;
  episode: number;
  /** True when the name had no season and season 1 was used. */
  seasonAssumed: boolean;
  /** `1080p`, `720p`, … or `''`. */
  quality: string;
  /** Release group from a leading `[Group]`, or `''`. */
  group: string;
}

export type ParseResult = { ok: true; value: ParsedName } | { ok: false; reason: string };

export function parseEpisodeName(fileName: string): ParseResult {
  let n = fileName.replace(/\.[^.]+$/, '');
  const group = /^\[([^\]]+)\]/.exec(n)?.[1]?.trim() ?? '';
  const quality = (/(2160|1080|720|480)p/i.exec(n)?.[0] ?? '').toLowerCase();
  n = n.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[._]/g, ' ');

  let season: number | null = null;
  let episode: number | null = null;
  let m: RegExpExecArray | null;
  if ((m = /\bS(\d{1,2})\s*E(\d{1,4})(?:v\d)?\b/i.exec(n))) {
    season = Number(m[1]);
    episode = Number(m[2]);
    n = n.slice(0, m.index);
  } else if ((m = /\s-\s*(\d{1,4})(?:v\d)?\b/.exec(n))) {
    episode = Number(m[1]);
    n = n.slice(0, m.index);
  } else if ((m = /\b(?:E|Ep|Episode)\s*(\d{1,4})\b/i.exec(n))) {
    episode = Number(m[1]);
    n = n.slice(0, m.index);
  }
  if (season === null && (m = /\b(?:S|Season\s*)(\d{1,2})\b/i.exec(n))) {
    season = Number(m[1]);
    n = n.slice(0, m.index);
  }

  const title = n.replace(/\s+/g, ' ').replace(/[\s-]+$/, '').trim();
  if (episode === null) return { ok: false, reason: 'no episode number in the name' };
  if (!title) return { ok: false, reason: 'no series title in the name' };
  if (!/[a-z]/i.test(title) && !/\p{L}/u.test(title)) return { ok: false, reason: `title "${title}" has no letters` };

  return {
    ok: true,
    value: { title, season: season ?? 1, episode, seasonAssumed: season === null, quality, group },
  };
}
