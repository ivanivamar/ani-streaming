/**
 * Progress sink for long steps (ffmpeg encode, Drive upload). The CLI prints its own progress
 * line; the import agent (`agent.ts`) sets a sink to mirror progress into Firestore for the
 * app's Import page. No sink = nothing happens.
 */
export interface ProgressEvent {
  readonly kind: 'encode' | 'upload';
  readonly label: string;
  /** 0–1 */
  readonly fraction: number;
  /** uploads: average speed of this upload so far */
  readonly bytesPerSec?: number;
}

let sink: ((e: ProgressEvent) => void) | null = null;

export function setProgressSink(fn: ((e: ProgressEvent) => void) | null): void {
  sink = fn;
}

export function emitProgress(e: ProgressEvent): void {
  try {
    sink?.(e);
  } catch {
    /* progress is best effort */
  }
}
