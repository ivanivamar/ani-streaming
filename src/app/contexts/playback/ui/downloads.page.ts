import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ContextMenu, Icon, Poster, Stagger } from '@shared/ui';
import { formatBytes, formatDuration } from '@shared/kernel';
import { DownloadsStore, type DownloadGroup, type DownloadRow, type DownloadStatus } from '@playback/application';

const STATUS: Record<DownloadStatus, string> = {
  done: 'Downloaded',
  downloading: 'Downloading',
  queued: 'Queued',
  paused: 'Paused',
  failed: 'Drive refused a file',
};

/**
 * Downloads (Android app, Step 8; v3 "Downloads", phone only). Episodes picked on an anime page
 * (Download season / long-press → Download) grouped by series: progress, play, remove. The job
 * runs in the background with its own notification, Wi-Fi only unless switched off here.
 */
@Component({
  selector: 'app-downloads-page',
  imports: [RouterLink, Icon, Poster, Stagger],
  template: `
    <div class="head">
      <h1 class="h-page">Downloads</h1>
      <span class="count">{{ downloads.doneCount() }} / {{ downloads.count() }} episodes</span>
    </div>

    @if (!downloads.available) {
      <div class="empty">Downloads are in the Android app.</div>
    } @else {
      <div class="bar">
        <span class="mono usage">{{ usage() }}</span>
        <div class="tools">
          <button type="button" class="btn btn-outline btn-sm" [attr.aria-pressed]="state().wifiOnly" (click)="downloads.setWifiOnly(!state().wifiOnly)">
            {{ state().wifiOnly ? 'Wi-Fi only' : 'Wi-Fi + mobile data' }}
          </button>
          @if (downloads.count() > downloads.doneCount()) {
            <button type="button" class="btn btn-outline btn-sm" (click)="downloads.setPaused(!state().paused)">
              {{ state().paused ? 'Resume' : 'Pause' }}
            </button>
          }
        </div>
      </div>

      @if (notice(); as n) {
        <div class="notice" [class.bad]="n.bad" role="status">
          <span>{{ n.text }}</span>
          @if (n.retry) {
            <button type="button" class="btn btn-primary btn-sm" (click)="downloads.retry()">Retry</button>
          }
        </div>
      }

      @if (!downloads.groups().length) {
        <div class="empty">
          <app-icon name="download" [size]="28" />
          <p>Nothing downloaded yet. On an anime page, use <strong>Download season</strong>, or long-press an episode → Download.</p>
          <a routerLink="/" class="btn btn-primary btn-sm">Browse</a>
        </div>
      }

      <div class="groups" appStagger>
        @for (g of downloads.groups(); track g.seriesId) {
          <section class="group">
            <a class="g-head" [routerLink]="['/anime', g.seriesId]">
              <div class="g-poster"><app-poster [src]="g.posterUrl" [seed]="g.seriesId" /></div>
              <div class="g-text">
                <span class="g-title">{{ g.title }}</span>
                <span class="g-sub mono">{{ g.rows.length }} episode{{ g.rows.length === 1 ? '' : 's' }} · {{ bytes(g.bytes) }}</span>
              </div>
            </a>
            <button type="button" class="icon-btn g-more" aria-label="More" (click)="groupMenu($event, g)">
              <app-icon name="more" [size]="18" />
            </button>
            <ul class="rows">
              @for (r of g.rows; track r.key) {
                <li class="row">
                  <a class="r-main" [routerLink]="['/watch', r.entry.seriesId, r.entry.episodeId]">
                    <span class="r-label mono">{{ r.label }}</span>
                    <span class="r-title">{{ r.entry.title || 'Episode ' + r.entry.number }}</span>
                    <span class="r-sub" [class.bad]="r.progress.status === 'failed'">
                      {{ status[r.progress.status] }}
                      @if (r.progress.status === 'done') {
                        · {{ bytes(r.progress.bytes) }} · {{ duration(r.entry.durationSec) }}
                      } @else if (r.progress.total) {
                        · {{ bytes(r.progress.bytes) }} of {{ bytes(r.progress.total) }}
                      }
                    </span>
                    @if (r.progress.status !== 'done') {
                      <span class="r-prog"><i [style.width.%]="r.progress.fraction * 100"></i></span>
                    }
                  </a>
                  <button type="button" class="icon-btn" [attr.aria-label]="'Remove ' + r.label" title="Remove download" (click)="remove(r)">
                    <app-icon name="remove" [size]="17" />
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      </div>

      @if (downloads.error(); as error) {
        <div class="notice-error" role="alert">{{ error }}</div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
      padding-bottom: 32px;
    }
    .head {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 14px;
    }
    .bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 16px;
    }
    .usage {
      font-size: 12px;
      color: var(--text-4);
    }
    .tools {
      display: flex;
      gap: 8px;
    }
    .notice {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      padding: 10px 14px;
      border: 1px solid var(--line-strong);
      border-radius: 12px;
      font-size: 13px;
      color: var(--text-3);
    }
    .notice.bad {
      border-color: oklch(0.65 0.18 25 / 0.5);
      color: oklch(0.82 0.1 25);
    }
    .empty {
      display: grid;
      justify-items: center;
      gap: 10px;
      padding: 48px 16px;
      text-align: center;
      color: var(--text-4);
      font-size: 14px;
    }
    .empty p {
      max-width: 340px;
      margin: 0;
      line-height: 1.5;
    }
    .groups {
      display: grid;
      gap: 18px;
    }
    .group {
      position: relative;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.02);
    }
    .g-head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-right: 40px;
      color: inherit;
      text-decoration: none;
    }
    .g-poster {
      width: 44px;
      aspect-ratio: 2 / 3;
      border-radius: 8px;
      overflow: hidden;
      flex: none;
    }
    .g-text {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .g-title {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .g-sub {
      font-size: 11.5px;
      color: var(--text-4);
    }
    .g-more {
      position: absolute;
      top: 12px;
      right: 8px;
    }
    .rows {
      list-style: none;
      margin: 10px 0 0;
      padding: 0;
      display: grid;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      border-top: 1px solid var(--line);
    }
    .r-main {
      flex: 1;
      min-width: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 10px;
      row-gap: 3px;
      padding: 10px 0;
      color: inherit;
      text-decoration: none;
    }
    .r-label {
      font-size: 11px;
      color: var(--text-4);
      align-self: center;
    }
    .r-title {
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .r-sub {
      grid-column: 2;
      font-size: 12px;
      color: var(--text-4);
    }
    .r-sub.bad {
      color: oklch(0.78 0.12 25);
    }
    .r-prog {
      grid-column: 2;
      height: 3px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.1);
      overflow: hidden;
    }
    .r-prog i {
      display: block;
      height: 100%;
      background: var(--accent);
      transition: width 0.3s;
    }
  `,
})
export class DownloadsPage {
  protected readonly downloads = inject(DownloadsStore);
  private readonly menus = inject(ContextMenu);
  private readonly router = inject(Router);
  protected readonly status = STATUS;
  protected readonly state = this.downloads.state;
  protected readonly bytes = formatBytes;
  protected readonly duration = formatDuration;

  protected readonly usage = computed(() => {
    const s = this.state();
    return s.total ? `${formatBytes(s.used)} on this phone · ${formatBytes(s.free)} free` : `${formatBytes(s.used)} on this phone`;
  });

  /** Why nothing is moving, if that's the case. */
  protected readonly notice = computed<{ text: string; bad: boolean; retry: boolean } | null>(() => {
    const s = this.state();
    const left = this.downloads.count() - this.downloads.doneCount();
    if (s.error === 'storage') return { text: 'The phone is out of space. Remove some downloads, then retry.', bad: true, retry: true };
    if (s.error === 'auth') return { text: 'Google needs you to sign in again before downloads can continue.', bad: true, retry: true };
    if (s.failed.length) return { text: `Drive refused ${s.failed.length} file${s.failed.length === 1 ? '' : 's'} (moved or deleted?).`, bad: true, retry: true };
    if (!left || s.paused) return null;
    if (s.network === 'none') return { text: 'Waiting for a connection.', bad: false, retry: false };
    if (s.wifiOnly && s.network === 'cellular') return { text: 'Waiting for Wi-Fi (switch to "Wi-Fi + mobile data" to download now).', bad: false, retry: false };
    return null;
  });

  constructor() {
    void this.downloads.refresh();
  }

  protected remove(r: DownloadRow): void {
    void this.downloads.remove(r.entry.seriesId, r.entry.episodeId);
  }

  protected groupMenu(e: MouseEvent, g: DownloadGroup): void {
    this.menus.open(e, g.title, [
      { label: 'Open series', icon: 'go', run: () => void this.router.navigate(['/anime', g.seriesId]) },
      { label: 'Remove all episodes', icon: 'remove', danger: true, separator: true, run: () => void this.downloads.remove(g.seriesId) },
    ]);
  }
}
