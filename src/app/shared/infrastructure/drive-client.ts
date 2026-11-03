import { inject, Service } from '@angular/core';
import { AccessTokenSource } from './access-token-source';

/**
 * Thin Google Drive v3 client over fetch (ported from the music app's `lib/drive.ts`). Adds the
 * OAuth header, retries 429/5xx with backoff and turns 401 into an expired session (AuthError)
 * instead of a generic failure. Video never goes through here: `<video>` streams through the
 * service worker (playback context).
 */
export class AuthError extends Error {
  constructor() {
    super('Google session expired');
    this.name = 'AuthError';
  }
}

export class DriveError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

export interface DriveFile {
  readonly id: string;
  readonly name: string;
  readonly size?: string;
  readonly mimeType?: string;
  readonly modifiedTime?: string;
}

const API = 'https://www.googleapis.com/drive/v3';
const FIELDS = 'id,name,size,mimeType,modifiedTime';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Service()
export class DriveClient {
  private readonly tokens = inject(AccessTokenSource);

  async fetch(path: string, init: RequestInit = {}, tries = 4): Promise<Response> {
    let renewed = false;
    for (let i = 1; ; i++) {
      const token = await this.tokens.ensureToken();
      if (!token) throw new AuthError();
      let res: Response;
      try {
        res = await fetch(path.startsWith('http') ? path : API + path, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        // network down / CORS abort: retry, then surface
        if (i >= tries || init.signal?.aborted) throw e;
        await sleep(800 * 2 ** (i - 1));
        continue;
      }
      if (res.status === 401) {
        // a token Google no longer accepts (revoked, clock skew): renew once
        if (!renewed && (await this.tokens.refresh())) {
          renewed = true;
          i--;
          continue;
        }
        this.tokens.expire();
        throw new AuthError();
      }
      if ((res.status === 429 || res.status >= 500) && i < tries) {
        await sleep(1000 * 2 ** (i - 1) + Math.random() * 400);
        continue;
      }
      if (!res.ok) {
        let msg = `${res.status} ${res.statusText}`;
        try {
          const body = (await res.json()) as { error?: { message?: string } };
          if (body.error?.message) msg = body.error.message;
        } catch {
          /* not JSON */
        }
        throw new DriveError(res.status, msg);
      }
      return res;
    }
  }

  async getMeta(fileId: string): Promise<DriveFile> {
    const res = await this.fetch(`/files/${encodeURIComponent(fileId)}?fields=${FIELDS}`);
    return (await res.json()) as DriveFile;
  }

  /** Whole small file as text (subtitles). */
  async downloadText(fileId: string, signal?: AbortSignal): Promise<string> {
    const res = await this.fetch(`/files/${encodeURIComponent(fileId)}?alt=media`, { signal });
    return res.text();
  }

  /** Whole small file as a Blob (fonts, thumbnails). */
  async downloadBlob(fileId: string, signal?: AbortSignal): Promise<Blob> {
    const res = await this.fetch(`/files/${encodeURIComponent(fileId)}?alt=media`, { signal });
    return res.blob();
  }
}
