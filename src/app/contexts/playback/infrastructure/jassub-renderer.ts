import { DOCUMENT, inject, Injectable } from '@angular/core';
import { DriveClient, nativeDriveUrl } from '@shared/infrastructure';
import type JASSUBType from 'jassub';
import { SubtitleRendererPort, type SubtitleFile, type SubtitleSession } from '../domain';

type JassubOptions = ConstructorParameters<typeof JASSUBType>[0];

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
  protected readonly doc = inject(DOCUMENT);
  private readonly base = new URL('jassub/', this.doc.baseURI).href;
  /** font bytes per Drive file id, kept for the session (episodes of a series share fonts) */
  private readonly fontCache = new Map<string, Promise<Uint8Array | null>>();

  open(video: HTMLVideoElement, fontFileIds: readonly string[]): SubtitleSession {
    let instance: JASSUBType | null = null;
    let creating: Promise<JASSUBType> | null = null;
    let destroyed = false;
    let seq = 0;
    let detach: (() => void) | null = null;

    const create = (content: string): Promise<JASSUBType> =>
      (creating ??= (async () => {
        const [{ default: JASSUB }, fonts] = await Promise.all([import('jassub'), this.fonts(fontFileIds)]);
        const common = {
          subContent: content,
          workerUrl: `${this.base}jassub-worker.js`,
          wasmUrl: `${this.base}jassub-worker.wasm`,
          modernWasmUrl: `${this.base}jassub-worker-modern.wasm`,
          fonts,
          availableFonts: { 'liberation sans': `${this.base}default.woff2` },
          // fansubs name fonts the series didn't ship; the user's own fonts are better than boxes
          queryFonts: 'local' as const,
        };
        const target = this.target(video);
        const j = new JASSUB({ ...common, ...target.options } as JassubOptions);
        await j.ready;
        detach = target.start(j);
        return j;
      })());

    return {
      show: async (track: SubtitleFile | null) => {
        const mine = ++seq;
        if (!track) {
          if (instance) await instance.renderer.freeTrack();
          return;
        }
        const content = await this.text(track.driveFileId);
        if (destroyed || mine !== seq) return;
        if (!instance) {
          instance = await create(content);
          if (destroyed) {
            detach?.();
            void instance.destroy();
          }
          return;
        }
        await instance.renderer.setTrack(content);
      },
      destroy: () => {
        destroyed = true;
        seq++;
        detach?.();
        void instance?.destroy();
        if (!instance) void creating?.then((j) => j.destroy(), () => undefined);
      },
    };
  }

  /**
   * How JASSUB is attached. Browser: to the `<video>` (it follows the video's frames itself).
   * Overridden for the Android app, where the video is a native surface.
   */
  protected target(video: HTMLVideoElement): { options: Partial<JassubOptions>; start: (j: JASSUBType) => () => void } {
    return { options: { video }, start: () => () => undefined };
  }

  /** Subtitle file text. */
  protected text(fileId: string): Promise<string> {
    return this.drive.downloadText(fileId);
  }

  /** Font bytes. */
  protected async bytes(fileId: string): Promise<Uint8Array> {
    const b = await this.drive.downloadBlob(fileId);
    return new Uint8Array(await b.arrayBuffer());
  }

  private async fonts(ids: readonly string[]): Promise<Uint8Array[]> {
    const all = await Promise.all(ids.map((id) => this.font(id)));
    return all.filter((f): f is Uint8Array => !!f);
  }

  private font(id: string): Promise<Uint8Array | null> {
    let p = this.fontCache.get(id);
    if (!p) {
      p = this.bytes(id).catch((e) => {
        console.warn('[subs] font download failed', id, e);
        this.fontCache.delete(id);
        return null;
      });
      this.fontCache.set(id, p);
    }
    return p;
  }
}

/**
 * Android app: the video is a native Media3 surface under the WebView and `video` is the watch
 * page's NativeVideo element (same API as a `<video>`, no frames). JASSUB draws into its own canvas,
 * sized to the letterboxed picture, and gets the playback time every animation frame
 * (`manualRender`). The .ass and fonts load from `/__drive/`, so downloaded episodes keep their
 * subtitles offline.
 */
@Injectable()
export class NativeJassubRenderer extends JassubRenderer {
  protected override target(video: HTMLVideoElement): { options: Partial<JassubOptions>; start: (j: JASSUBType) => () => void } {
    const canvas = this.doc.createElement('canvas');
    canvas.className = 'JASSUB';
    Object.assign(canvas.style, { position: 'absolute', pointerEvents: 'none', left: '0', top: '0', width: '100%', height: '100%' });
    video.appendChild(canvas);
    const place = () => {
      const w = video.clientWidth;
      const h = video.clientHeight;
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const scale = Math.min(w / vw, h / vh) || 1;
      const cw = Math.round(vw * scale);
      const ch = Math.round(vh * scale);
      Object.assign(canvas.style, { width: `${cw}px`, height: `${ch}px`, left: `${Math.round((w - cw) / 2)}px`, top: `${Math.round((h - ch) / 2)}px` });
    };
    place();
    return {
      options: { canvas },
      start: (j) => {
        const win = this.doc.defaultView!;
        let raf = 0;
        let lastW = 0;
        let lastH = 0;
        const frame = (repaint = false) => {
          const width = video.videoWidth || 1920;
          const height = video.videoHeight || 1080;
          if (width !== lastW || height !== lastH) {
            lastW = width;
            lastH = height;
            place();
          }
          void j.manualRender({ mediaTime: video.currentTime, width, height, expectedDisplayTime: win.performance.now() }, repaint);
        };
        const loop = () => {
          frame();
          raf = win.requestAnimationFrame(loop);
        };
        const start = () => {
          win.cancelAnimationFrame(raf);
          raf = win.requestAnimationFrame(loop);
        };
        const still = () => {
          win.cancelAnimationFrame(raf);
          raf = 0;
          frame(true);
        };
        const ro = new ResizeObserver(() => {
          place();
          frame(true);
        });
        ro.observe(video);
        video.addEventListener('play', start);
        video.addEventListener('pause', still);
        video.addEventListener('seeked', still);
        video.addEventListener('loadedmetadata', still);
        if (video.paused) still();
        else start();
        return () => {
          win.cancelAnimationFrame(raf);
          ro.disconnect();
          video.removeEventListener('play', start);
          video.removeEventListener('pause', still);
          video.removeEventListener('seeked', still);
          video.removeEventListener('loadedmetadata', still);
          canvas.remove();
        };
      },
    };
  }

  protected override async text(fileId: string): Promise<string> {
    const r = await fetch(nativeDriveUrl(fileId, 'text/x-ssa'));
    if (!r.ok) throw new Error(`Subtitles answered ${r.status}`);
    return r.text();
  }

  protected override async bytes(fileId: string): Promise<Uint8Array> {
    const r = await fetch(nativeDriveUrl(fileId, 'application/octet-stream'));
    if (!r.ok) throw new Error(`Font answered ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
}
