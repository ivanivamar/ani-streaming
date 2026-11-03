import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { codecString, PlaybackStore } from '@playback/application';

/**
 * Watch (Step 3 version: the plain `<video>` streaming from Drive through the service worker,
 * with a seek timer for the "plays and seeks instantly" check). The real player — JASSUB
 * subtitles, chapter skip, progress — is Step 5.
 */
@Component({
  selector: 'app-watch-page',
  imports: [RouterLink],
  template: `
    <section class="page">
      @if (playable.isLoading()) {
        <p class="muted">Loading…</p>
      } @else if (playable.error(); as error) {
        <p class="error" role="alert">Could not open this episode: {{ error.message }}</p>
      } @else if (playable.value(); as p) {
        <a class="back muted" [routerLink]="['/anime', p.series.id]">← {{ p.series.title }}</a>
        <h1>
          S{{ p.episode.season }} · E{{ p.episode.number }}
          @if (p.episode.title) {
            — {{ p.episode.title }}
          }
        </h1>
        @if (p.src) {
          <video
            controls
            autoplay
            preload="metadata"
            playsinline
            [src]="p.src"
            (seeking)="onSeeking()"
            (seeked)="onSeeked()"
            (playing)="onSeeked()"
            (error)="onError($event)"
          ></video>
          <p class="muted small">
            {{ p.episode.video.codec.toUpperCase() }} {{ p.episode.video.bitDepth }}-bit ·
            {{ p.episode.video.width }}×{{ p.episode.video.height }} · {{ mb(p.episode.sizeBytes) }} MB
            @if (!canDecode()) {
              · <span class="error">this browser reports no decoder for this codec</span>
            }
            @if (lastSeekMs() !== null) {
              · last seek {{ lastSeekMs() }} ms
            }
          </p>
          @if (videoError(); as e) {
            <p class="error" role="alert">{{ e }}</p>
          }
        } @else {
          <p class="error" role="alert">
            Streaming needs the service worker, which isn't running on this page. Use Chrome or Edge on
            https:// or localhost, and reload once.
          </p>
        }
      } @else {
        <h1>Not found</h1>
        <p class="muted">There's no episode {{ episodeId() }} of "{{ seriesId() }}".</p>
      }
    </section>
  `,
  styles: `
    .page {
      padding: 24px 32px;
      display: grid;
      gap: 12px;
    }
    h1 {
      margin: 0;
      font-weight: 600;
      font-size: 1.3em;
    }
    .back {
      color: inherit;
      text-decoration: none;
    }
    video {
      width: 100%;
      max-height: 78vh;
      background: #000;
      border-radius: 12px;
    }
    p {
      margin: 0;
    }
    .muted {
      opacity: 0.6;
    }
    .small {
      font-size: 0.85em;
    }
    .error {
      color: #ff8a80;
    }
  `,
})
export class WatchPage {
  private readonly playback = inject(PlaybackStore);

  /** `watch/:seriesId/:episodeId` (route input binding) */
  readonly seriesId = input.required<string>();
  readonly episodeId = input.required<string>();

  protected readonly playable = resource({
    params: () => ({ seriesId: this.seriesId(), episodeId: this.episodeId() }),
    loader: ({ params }) => this.playback.open(params.seriesId, params.episodeId),
  });

  protected readonly canDecode = computed(() => {
    const v = this.playable.value()?.episode.video;
    if (!v || typeof MediaSource === 'undefined') return true;
    return MediaSource.isTypeSupported(codecString(v.codec, v.bitDepth));
  });

  protected readonly lastSeekMs = signal<number | null>(null);
  protected readonly videoError = signal<string | null>(null);
  private seekStart: number | null = null;

  protected onSeeking(): void {
    this.seekStart = performance.now();
  }

  protected onSeeked(): void {
    if (this.seekStart === null) return;
    this.lastSeekMs.set(Math.round(performance.now() - this.seekStart));
    this.seekStart = null;
  }

  protected onError(e: Event): void {
    const err = (e.target as HTMLVideoElement).error;
    const why =
      err?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'The browser cannot play this file (codec not supported, or Drive refused the request — check that you are signed in).'
        : err?.code === MediaError.MEDIA_ERR_NETWORK
          ? 'Network error while streaming from Drive.'
          : err?.message || 'Playback failed.';
    this.videoError.set(why);
  }

  protected mb(bytes: number): string {
    return (bytes / 1e6).toFixed(0);
  }
}
