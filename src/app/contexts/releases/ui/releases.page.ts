import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject, resource, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  airingKey,
  premiereKey,
  ReleasesStore,
  type AiringItem,
  type AiringState,
  type PremiereItem,
  type ReleaseScope,
} from '@releases/application';
import { epLabel, formatCountdown } from '@shared/kernel';
import { Icon, posterBackground, Segmented, Stagger, type SegmentOption } from '@shared/ui';

const STATE_COLOR: Record<AiringState, string> = {
  upcoming: 'oklch(0.78 0.11 235)',
  out: 'oklch(0.86 0.13 155)',
  'out-missing': '#a5a5ad',
  watched: '#7a7a82',
};

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * New releases (v3, adapted): AniList's weekly airing schedule in 7 day columns (today
 * highlighted with a "now" line), scope Everything / My library, week paging with a slide, then
 * New seasons & premieres with "Notify me". "Not on allanime" → "not in your library".
 */
@Component({
  selector: 'app-releases-page',
  imports: [Icon, NgTemplateOutlet, Segmented, Stagger],
  templateUrl: './releases.page.html',
  styleUrl: './releases.page.css',
})
export class ReleasesPage {
  protected readonly store = inject(ReleasesStore);
  private readonly router = inject(Router);

  protected readonly scope = signal<ReleaseScope>('all');
  protected readonly offset = signal(0);
  /** "Everything" lists only the most popular shows until this is on */
  protected readonly showAll = signal(false);
  /** slide direction of the last week change */
  protected readonly slide = signal<'left' | 'right' | null>(null);
  protected readonly scopes: readonly SegmentOption<ReleaseScope>[] = [
    { value: 'all', label: 'Everything' },
    { value: 'mine', label: 'My library' },
  ];

  protected readonly week = resource({
    params: () => ({ offset: this.offset(), scope: this.scope(), all: this.showAll() }),
    loader: ({ params }) => this.store.week(params.offset, params.scope, params.all),
  });
  protected readonly premieres = resource({
    params: () => ({ scope: this.scope(), all: this.showAll() }),
    loader: ({ params }) => this.store.premieres(params.scope, params.all),
  });

  protected readonly summary = computed(() => {
    const w = this.week.value();
    if (!w) return this.week.isLoading() ? 'Loading the schedule…' : '';
    const n = w.total;
    const prefix = this.scope() === 'mine' ? 'from your library ' : '';
    if (w.offset > 0) return `${n} episode${n === 1 ? '' : 's'} ${prefix}${w.title.toLowerCase()}`;
    return `${n} episode${n === 1 ? '' : 's'} ${prefix}${w.title.toLowerCase()} · ${w.released} out so far`;
  });

  protected readonly range = computed(() => {
    const w = this.week.value();
    return w ? `${dateFmt.format(w.start)} – ${dateFmt.format(w.end - 1)}` : '';
  });

  constructor() {
    const t = setInterval(() => this.store.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  /** The "popular only / show all" line under the week (only for Everything). */
  protected readonly trimNote = computed(() => {
    const w = this.week.value();
    if (!w || this.scope() !== 'all') return null;
    if (this.showAll()) return { text: 'Showing every show airing this week.', action: 'Popular only' };
    if (!w.hiddenShows) return null;
    const n = w.hiddenShows;
    return { text: `The most popular shows, plus your library. ${n} less popular show${n === 1 ? '' : 's'} hidden.`, action: 'Show all' };
  });

  protected page(dir: 1 | -1): void {
    this.slide.set(dir > 0 ? 'right' : 'left');
    this.offset.update((o) => o + dir);
  }

  protected isToday(date: number): boolean {
    const d = new Date(date);
    const n = new Date(this.store.now());
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  }

  /** index in a day's list before which the "now" line goes (−1: not today) */
  protected nowIndex(date: number, items: readonly AiringItem[]): number {
    if (!this.isToday(date)) return -1;
    const now = this.store.now();
    const i = items.findIndex((it) => it.airingAt > now);
    return i === -1 ? items.length : i;
  }

  protected dayName(date: number): string {
    return this.isToday(date) ? 'Today' : dayFmt.format(date);
  }

  protected dateLabel(date: number): string {
    return dateFmt.format(date);
  }

  protected nowLabel(): string {
    return timeFmt.format(this.store.now());
  }

  protected meta(it: AiringItem): string {
    return `${epLabel(it.episode)} · ${timeFmt.format(it.airingAt)}`;
  }

  protected state(it: AiringItem): AiringState {
    this.store.nowMinute();
    return this.store.stateOf(it);
  }

  protected statusText(it: AiringItem): string {
    switch (this.state(it)) {
      case 'upcoming':
        return formatCountdown(it.airingAt, this.store.now());
      case 'watched':
        return 'Watched';
      case 'out-missing':
        return 'Out now · not in your library';
      default:
        return 'Out now';
    }
  }

  protected color(it: AiringItem): string {
    return STATE_COLOR[this.state(it)];
  }

  protected bg(src: string | null, id: number): string {
    return posterBackground(src, `al${id}`);
  }

  protected open(match: { seriesId: string } | null, anilistId: number): void {
    if (match) void this.router.navigate(['/anime', match.seriesId]);
    else window.open(`https://anilist.co/anime/${anilistId}`, '_blank', 'noopener');
  }

  protected notifiedAiring(it: AiringItem): boolean {
    return this.store.isNotified(airingKey(it));
  }

  protected notifiedPremiere(p: PremiereItem): boolean {
    return this.store.isNotified(premiereKey(p));
  }

  protected toggleAiring(e: Event, it: AiringItem): void {
    e.stopPropagation();
    this.store.toggleNotify({ kind: 'airing', item: it });
  }

  protected togglePremiere(e: Event, p: PremiereItem): void {
    e.stopPropagation();
    this.store.toggleNotify({ kind: 'premiere', item: p });
  }

  protected when(p: PremiereItem): string {
    if (!p.startsAt) return 'Date to be announced';
    return p.upcoming ? `Starts ${dateFmt.format(p.startsAt)}` : `Started ${dateFmt.format(p.startsAt)}`;
  }
}
