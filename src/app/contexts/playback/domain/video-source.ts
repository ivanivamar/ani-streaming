/** What the player needs to stream one Drive file. */
export interface DriveVideo {
  readonly driveFileId: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
}

/**
 * Port: turns a Drive file into a URL a `<video>` element can play and seek (the service worker
 * proxy on the web; Media3 on Android, Step 8). Null when streaming isn't possible here.
 */
export abstract class VideoSourcePort {
  /** Make streaming ready (idempotent). True once it works on this page. */
  abstract init(): Promise<boolean>;
  abstract streamUrl(video: DriveVideo): Promise<string | null>;
  /** Small Drive image (episode thumbnail) as an `<img src>`; null when streaming isn't ready. */
  abstract imageUrl(driveFileId: string, mimeType?: string): string | null;
}

/** Our encodes are MP4 (HEVC 10-bit or H.264, AAC). */
export const EPISODE_MIME = 'video/mp4';
