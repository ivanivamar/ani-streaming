/** What the renderer needs to draw one subtitle file. */
export interface SubtitleFile {
  readonly driveFileId: string;
}

/** A renderer bound to one `<video>` for one series (its fonts). */
export interface SubtitleSession {
  /** Show this track (null = hide). Resolves once it's loaded; rejects with a readable error. */
  show(track: SubtitleFile | null): Promise<void>;
  destroy(): void;
}

/**
 * Port: styled ASS rendering over the video (JASSUB/libass on the web; ExoPlayer + libass on
 * Android, Step 8). `fontFileIds` are the series' fonts on Drive (`series.fontFileIds`).
 */
export abstract class SubtitleRendererPort {
  abstract open(video: HTMLVideoElement, fontFileIds: readonly string[]): SubtitleSession;
}
