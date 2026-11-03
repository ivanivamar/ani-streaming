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
}

/** Our encodes are MP4 (HEVC 10-bit or H.264, AAC). */
export const EPISODE_MIME = 'video/mp4';

/** Can this browser decode the episode's codec? (HEVC needs hardware support on Chrome/Edge.) */
export function codecString(codec: 'hevc' | 'h264', bitDepth: 8 | 10): string {
  if (codec === 'hevc') return bitDepth === 10 ? 'video/mp4; codecs="hvc1.2.4.L120.B0"' : 'video/mp4; codecs="hvc1.1.6.L120.B0"';
  return 'video/mp4; codecs="avc1.640028"';
}
