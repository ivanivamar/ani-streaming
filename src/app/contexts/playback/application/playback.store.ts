import { inject, Service } from '@angular/core';
import { CatalogStore, type Episode, type Series, type SeriesDetail } from '@catalog/application';
import {
  chapterSkips,
  DecoderProbePort,
  EPISODE_MIME,
  missingSkipKinds,
  NativePlayerPort,
  seasonAnilistId,
  skipSegments,
  SkipTimesPort,
  TYPICAL_EPISODE,
  VideoSourcePort,
  type DecodeReport,
  type DecodeTarget,
  type SkipSegment,
} from '../domain';

export interface PlayableEpisode {
  readonly series: Series;
  readonly episode: Episode;
  /** the whole series (episodes popup, next episode) */
  readonly detail: SeriesDetail | null;
  /** same-origin streaming URL (Android: a `nativeSrc`), or null when the service worker isn't available */
  readonly src: string | null;
}

/** Open an episode for playback: catalogue lookup + streaming URL, skip ranges, decode check. */
@Service()
export class PlaybackStore {
  private readonly catalog = inject(CatalogStore);
  private readonly source = inject(VideoSourcePort);
  private readonly skipTimes = inject(SkipTimesPort);
  private readonly decoder = inject(DecoderProbePort);
  /** Android app: the video plays in the native player (the watch page swaps its `<video>`). */
  readonly native = inject(NativePlayerPort, { optional: true })?.available ?? false;

  /** Episode thumbnail URL (through the streaming worker), or null to show the placeholder. */
  thumbUrl(driveFileId: string | null | undefined): string | null {
    return driveFileId ? this.source.imageUrl(driveFileId) : null;
  }

  async open(seriesId: string, episodeId: string): Promise<PlayableEpisode | null> {
    const found = await this.catalog.episode(seriesId, episodeId);
    if (!found) return null;
    const [src, detail] = await Promise.all([
      this.source.streamUrl({
        driveFileId: found.episode.video.driveFileId,
        sizeBytes: found.episode.sizeBytes,
        mimeType: EPISODE_MIME,
      }),
      this.catalog.seriesDetail(seriesId).catch(() => null),
    ]);
    return { ...found, detail, src };
  }

  /**
   * OP/ED skip ranges: the chapters, plus AniSkip for whichever of OP/ED they don't mark. Never
   * rejects: if AniSkip is unreachable (or the season has no AniList id) the chapters are it.
   */
  async skips(p: PlayableEpisode): Promise<SkipSegment[]> {
    const { episode: ep, series } = p;
    if (!missingSkipKinds(ep.chapters).length) return chapterSkips(ep.chapters);
    const anilistId = seasonAnilistId(ep.season, p.detail?.seasons ?? [], series.anilistId);
    if (!anilistId) return chapterSkips(ep.chapters);
    try {
      const external = await this.skipTimes.find({ anilistId, episode: ep.number, durationSec: ep.durationSec });
      return skipSegments(ep.chapters, external, ep.durationSec);
    } catch (e) {
      console.warn('[skip] AniSkip lookup failed', e);
      return chapterSkips(ep.chapters);
    }
  }

  /** Can this browser decode the episode (default: a typical 1080p HEVC 10-bit encode) on the GPU? */
  decodeSupport(target: DecodeTarget = TYPICAL_EPISODE): Promise<DecodeReport> {
    return this.decoder.probe(target);
  }
}
