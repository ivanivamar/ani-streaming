import { inject, Service } from '@angular/core';
import { CatalogStore, type Episode, type Series, type SeriesDetail } from '@catalog/application';
import { EPISODE_MIME, VideoSourcePort } from '../domain';

export interface PlayableEpisode {
  readonly series: Series;
  readonly episode: Episode;
  /** the whole series (episodes popup, next episode) */
  readonly detail: SeriesDetail | null;
  /** same-origin streaming URL, or null when the service worker isn't available */
  readonly src: string | null;
}

/** Open an episode for playback: catalogue lookup + streaming URL. */
@Service()
export class PlaybackStore {
  private readonly catalog = inject(CatalogStore);
  private readonly source = inject(VideoSourcePort);

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
}
