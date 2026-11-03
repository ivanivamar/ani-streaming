import { inject, Service } from '@angular/core';
import { CatalogStore, type Episode, type Series } from '@catalog/application';
import { EPISODE_MIME, VideoSourcePort } from '../domain';

export interface PlayableEpisode {
  readonly series: Series;
  readonly episode: Episode;
  /** same-origin streaming URL, or null when the service worker isn't available */
  readonly src: string | null;
}

/** Open an episode for playback: catalogue lookup + streaming URL. */
@Service()
export class PlaybackStore {
  private readonly catalog = inject(CatalogStore);
  private readonly source = inject(VideoSourcePort);

  async open(seriesId: string, episodeId: string): Promise<PlayableEpisode | null> {
    const found = await this.catalog.episode(seriesId, episodeId);
    if (!found) return null;
    const src = await this.source.streamUrl({
      driveFileId: found.episode.video.driveFileId,
      sizeBytes: found.episode.sizeBytes,
      mimeType: EPISODE_MIME,
    });
    return { ...found, src };
  }
}
