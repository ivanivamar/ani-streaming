import { Component, computed, effect, inject, linkedSignal, resource, signal, untracked } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { PrefsStore, SessionStore, type Prefs, type WatchedThreshold } from '@identity/application';
import { LibraryStore } from '@library/application';
import { BROWSER_NAME, PlaybackStore, type DecodeSupport } from '@playback/application';
import { Avatar, GoogleG, Segmented, Toggle, type SegmentOption } from '@shared/ui';
import { SUBTITLE_OPTIONS } from './prefs-options';

type Armed = 'clear' | 'delete' | null;

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
 * `users/{uid}.prefs` on every change. The Downloads section exists only in the Android app
 * (Step 8). Destructive buttons need a second click. "Video decoding" shows whether this browser
 * decodes HEVC 10-bit on the GPU (the check to run in both Chrome and Edge).
 */
@Component({
  selector: 'app-settings-page',
  imports: [Avatar, FormField, GoogleG, Segmented, Toggle],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.css',
})
export class SettingsPage {
  protected readonly session = inject(SessionStore);
  private readonly prefs = inject(PrefsStore);
  private readonly library = inject(LibraryStore);
  private readonly router = inject(Router);
  private readonly playback = inject(PlaybackStore);

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

  protected exportData(): void {
    const data = {
      account: { email: this.account()?.email ?? null, name: this.account()?.name ?? null },
      prefs: this.prefs.prefs(),
      ...this.library.exportData(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ani-stream-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  protected async destructive(kind: 'clear' | 'delete'): Promise<void> {
    if (this.armed() !== kind) {
      this.armed.set(kind);
      clearTimeout(this.disarmTimer);
      this.disarmTimer = setTimeout(() => this.armed.set(null), 4000);
      return;
    }
    this.armed.set(null);
    this.busy.set(kind);
    try {
      if (kind === 'clear') {
        await this.library.clearHistory();
        this.done.set('Watch history cleared.');
      } else {
        await this.prefs.deleteAccountData();
        await this.router.navigateByUrl('/auth');
      }
    } catch (e) {
      this.saveError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(null);
    }
  }
}
