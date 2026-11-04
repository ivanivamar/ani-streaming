import { Component, computed, effect, inject, linkedSignal, resource, signal, untracked } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { AppReleasePort, PrefsStore, SessionStore, type Prefs, type WatchedThreshold } from '@identity/application';
import { LibraryStore } from '@library/application';
import { BROWSER_NAME, DownloadsStore, PlaybackStore, type DecodeSupport } from '@playback/application';
import { ReleasesStore } from '@releases/application';
import { formatBytes } from '@shared/kernel';
import { Avatar, GoogleG, Segmented, Toggle, type SegmentOption } from '@shared/ui';
import { SUBTITLE_OPTIONS } from './prefs-options';

type Armed = 'clear' | 'delete' | 'downloads' | null;

const DECODE_LABEL: Record<DecodeSupport, string> = {
  hardware: 'GPU',
  software: 'Software',
  unsupported: 'Not supported',
  unknown: 'Unknown',
};

const THRESHOLD_OPTIONS: readonly SegmentOption<WatchedThreshold>[] = [
  { value: 0.8, label: '80%' },
  { value: 0.9, label: '90%' },
  { value: 0.95, label: '95%' },
];

/**
 * Settings (v3 adapted): Account, Playback, Data. Playback prefs are a Signal Form saved to
 * `users/{uid}.prefs` on every change. The Downloads and App sections exist only in the Android
 * app (Step 8): Wi-Fi only, storage, remove all; installed version + update check. Destructive buttons need a second click. "Video decoding" shows whether this browser
 * decodes HEVC 10-bit on the GPU (the check to run in both Chrome and Edge).
 */
@Component({
  selector: 'app-settings-page',
  imports: [Avatar, FormField, GoogleG, RouterLink, Segmented, Toggle],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.css',
})
export class SettingsPage {
  protected readonly session = inject(SessionStore);
  private readonly prefs = inject(PrefsStore);
  private readonly library = inject(LibraryStore);
  private readonly releases = inject(ReleasesStore);
  private readonly router = inject(Router);
  private readonly playback = inject(PlaybackStore);
  /** Android app only (`available` is false in the browser) */
  protected readonly downloads = inject(DownloadsStore);
  /** bound in the app (ApkUpdate); absent in tests */
  protected readonly apk = inject(AppReleasePort, { optional: true });
  protected readonly bytes = formatBytes;
  protected readonly checking = signal(false);

  protected readonly decode = resource({ loader: () => this.playback.decodeSupport() });
  protected readonly decodeLine = computed(() => {
    if (this.decode.isLoading()) return 'Checking…';
    const r = this.decode.hasValue() ? this.decode.value() : null;
    if (!r) return "Couldn't check";
    return `${r.label} · ${DECODE_LABEL[r.support]} · ${BROWSER_NAME[r.browser]}`;
  });

  protected readonly subtitleOptions = SUBTITLE_OPTIONS;
  protected readonly thresholdOptions = THRESHOLD_OPTIONS;
  protected readonly account = this.session.account;

  /** form model follows the stored prefs; edits flow back through the effect below */
  protected readonly model = linkedSignal<Prefs>(() => this.prefs.prefs());
  protected readonly f = form(this.model);
  protected readonly armed = signal<Armed>(null);
  protected readonly busy = signal<Armed>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly done = signal<string | null>(null);
  /** Data section (export / clear / delete) failures */
  protected readonly dataError = signal<string | null>(null);
  private disarmTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const next = this.model();
      untracked(() => {
        const cur = this.prefs.prefs();
        const patch = (Object.keys(next) as (keyof Prefs)[]).filter((k) => next[k] !== cur[k]);
        if (!patch.length || !this.prefs.exists()) return;
        this.saveError.set(null);
        this.prefs.update(next).catch((e) => this.saveError.set(e instanceof Error ? e.message : String(e)));
      });
    });
  }

  protected switchAccount(): void {
    void this.session.signIn({ switchAccount: true });
  }

  protected signOut(): void {
    this.session.signOut();
    void this.router.navigateByUrl('/auth');
  }

  protected readonly exporting = signal(false);

  /**
   * Export JSON: profile + prefs, library data and notify flags, read fresh from Firestore so the
   * file has everything stored for this account (not only what this tab has loaded).
   */
  protected async exportData(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.dataError.set(null);
    try {
      const [library, notify] = await Promise.all([this.library.exportData(), this.releases.exportNotify()]);
      const data = {
        app: 'ani.stream',
        version: 1,
        exportedAt: new Date().toISOString(),
        account: { uid: this.session.uid(), email: this.account()?.email ?? null, name: this.account()?.name ?? null },
        prefs: this.prefs.prefs(),
        ...library,
        notify,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ani-stream-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      this.dataError.set(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.exporting.set(false);
    }
  }

  protected async checkUpdate(): Promise<void> {
    this.checking.set(true);
    await this.apk?.check();
    this.checking.set(false);
  }

  protected async destructive(kind: 'clear' | 'delete' | 'downloads'): Promise<void> {
    if (this.armed() !== kind) {
      this.armed.set(kind);
      clearTimeout(this.disarmTimer);
      this.disarmTimer = setTimeout(() => this.armed.set(null), 4000);
      return;
    }
    this.armed.set(null);
    this.busy.set(kind);
    this.dataError.set(null);
    try {
      if (kind === 'downloads') {
        await this.downloads.removeAll();
      } else if (kind === 'clear') {
        const n = await this.library.clearHistory();
        this.done.set(n === 1 ? 'Watch history cleared (1 episode).' : `Watch history cleared (${n} episodes).`);
      } else {
        await this.prefs.deleteAccountData();
        await this.router.navigateByUrl('/auth');
      }
    } catch (e) {
      this.dataError.set(`${kind === 'clear' ? 'Clearing history' : kind === 'downloads' ? 'Removing downloads' : 'Deleting data'} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busy.set(null);
    }
  }
}
