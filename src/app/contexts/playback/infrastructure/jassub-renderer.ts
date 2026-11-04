import { DOCUMENT, inject, Injectable } from '@angular/core';
import { DriveClient } from '@shared/infrastructure';
import type JASSUBType from 'jassub';
import { SubtitleRendererPort, type SubtitleFile, type SubtitleSession } from '../domain';

/**
 * JASSUB (libass in WASM) over the `<video>`: full ASS styling, positioning, karaoke and the
 * fansub's own fonts. Loaded only when a track is shown (`import('jassub')`, ~5 kB + a 2 MB WASM
 * worker from `/jassub/`, built by scripts/build-jassub.mjs).
 *
 * The subtitle file and fonts are downloaded here on the page with the Drive token
 * (`DriveClient`), not inside the worker: the worker can't answer the streaming service
 * worker's token request.
 */
@Injectable()
export class JassubRenderer extends SubtitleRendererPort {
  private readonly drive = inject(DriveClient);
  private readonly base = new URL('jassub/', inject(DOCUMENT).baseURI).href;
  /** font bytes per Drive file id, kept for the session (episodes of a series share fonts) */
  private readonly fontCache = new Map<string, Promise<Uint8Array | null>>();

  open(video: HTMLVideoElement, fontFileIds: readonly string[]): SubtitleSession {
    let instance: JASSUBType | null = null;
    let creating: Promise<JASSUBType> | null = null;
    let destroyed = false;
    let seq = 0;

    const create = (content: string): Promise<JASSUBType> =>
      (creating ??= (async () => {
        const [{ default: JASSUB }, fonts] = await Promise.all([import('jassub'), this.fonts(fontFileIds)]);
        const j = new JASSUB({
          video,
          subContent: content,
          workerUrl: `${this.base}jassub-worker.js`,
          wasmUrl: `${this.base}jassub-worker.wasm`,
          modernWasmUrl: `${this.base}jassub-worker-modern.wasm`,
          fonts,
          availableFonts: { 'liberation sans': `${this.base}default.woff2` },
          // fansubs name fonts the series didn't ship; the user's own fonts are better than boxes
          queryFonts: 'local',
        });
        await j.ready;
        return j;
      })());

    return {
      show: async (track: SubtitleFile | null) => {
        const mine = ++seq;
        if (!track) {
          if (instance) await instance.renderer.freeTrack();
          return;
        }
        const content = await this.drive.downloadText(track.driveFileId);
        if (destroyed || mine !== seq) return;
        if (!instance) {
          instance = await create(content);
          if (destroyed) instance.destroy();
          return;
        }
        await instance.renderer.setTrack(content);
      },
      destroy: () => {
        destroyed = true;
        seq++;
        void instance?.destroy();
        if (!instance) void creating?.then((j) => j.destroy(), () => undefined);
      },
    };
  }

  private async fonts(ids: readonly string[]): Promise<Uint8Array[]> {
    const all = await Promise.all(ids.map((id) => this.font(id)));
    return all.filter((f): f is Uint8Array => !!f);
  }

  private font(id: string): Promise<Uint8Array | null> {
    let p = this.fontCache.get(id);
    if (!p) {
      p = this.drive
        .downloadBlob(id)
        .then(async (b) => new Uint8Array(await b.arrayBuffer()))
        .catch((e) => {
          console.warn('[subs] font download failed', id, e);
          this.fontCache.delete(id);
          return null;
        });
      this.fontCache.set(id, p);
    }
    return p;
  }
}
