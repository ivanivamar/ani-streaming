import { Component, computed, inject, resource, signal } from '@angular/core';
import { Router } from '@angular/router';
import { CatalogStore, type Series } from '@catalog/application';
import { LIBRARY_STATUSES, LibraryStore, STATUS_LABEL, type LibraryEntry, type LibraryStatus } from '@library/application';
import { formatAgo } from '@shared/kernel';
import {
  ContextMenu,
  Dropdown,
  Icon,
  Pill,
  posterBackground,
  PosterCard,
  Stagger,
  Viewport,
  type DropdownOption,
  type MenuItem,
} from '@shared/ui';

type Filter = 'all' | LibraryStatus;
type Sort = 'recent' | 'title' | 'progress';
type View = 'grid' | 'list';

const STATUS_COLOR: Record<LibraryStatus, string> = {
  watching: 'oklch(0.84 0.14 155)',
  planned: 'oklch(0.78 0.11 235)',
  completed: '#b9b9c0',
  paused: 'oklch(0.7 0.12 75)',
  dropped: 'oklch(0.72 0.14 25)',
};

const STATUS_SUB: Record<LibraryStatus, string> = {
  watching: 'Currently following',
  planned: 'Saved for later',
  completed: 'All episodes watched',
  paused: 'On hold',
  dropped: 'Stopped watching',
};

const VIEW_KEY = 'ani.library.view';

interface Row {
  readonly entry: LibraryEntry;
  readonly series: Series;
  readonly fraction: number;
  readonly lastAt: number;
  readonly done: string;
  readonly color: string;
}

/**
 * Library (v3): status tabs with counts (one scrolling row), sort dropdown, grid / list toggle.
 * Rows come from `users/{uid}/library` joined to the catalogue.
 */
@Component({
  selector: 'app-library-page',
  imports: [Dropdown, Icon, Pill, PosterCard, Stagger],
  templateUrl: './library.page.html',
  styleUrl: './library.page.css',
})
export class LibraryPage {
  protected readonly library = inject(LibraryStore);
  private readonly catalog = inject(CatalogStore);
  private readonly menus = inject(ContextMenu);
  private readonly router = inject(Router);
  protected readonly vp = inject(Viewport);

  protected readonly all = resource({ loader: () => this.catalog.allSeries() });
  protected readonly filter = signal<Filter>('all');
  protected readonly sort = signal<Sort>('recent');
  protected readonly view = signal<View>(readView());
  protected readonly label = STATUS_LABEL;

  protected readonly sortOptions: readonly DropdownOption<Sort>[] = [
    { value: 'recent', label: 'Recently watched' },
    { value: 'title', label: 'Title A–Z' },
    { value: 'progress', label: 'Progress' },
  ];

  protected readonly rows = computed<Row[]>(() => {
    const byId = this.catalog.byId();
    const last = new Map(this.library.latestPerSeries().map((p) => [p.seriesId as string, p.updatedAt]));
    const out: Row[] = [];
    for (const entry of this.library.entries().values()) {
      const series = byId.get(entry.seriesId);
      if (!series) continue;
      const total = series.episodeCount || 0;
      out.push({
        entry,
        series,
        fraction: total ? Math.min(1, entry.watched / total) : 0,
        lastAt: last.get(entry.seriesId) ?? 0,
        done: `${entry.watched} / ${total}`,
        color: STATUS_COLOR[entry.status],
      });
    }
    return out;
  });

  protected readonly tabs = computed(() => {
    const rows = this.rows();
    return [
      { value: 'all' as Filter, name: 'All', count: rows.length },
      ...LIBRARY_STATUSES.map((s) => ({ value: s as Filter, name: STATUS_LABEL[s], count: rows.filter((r) => r.entry.status === s).length })),
    ];
  });

  protected readonly items = computed(() => {
    const f = this.filter();
    const list = this.rows().filter((r) => f === 'all' || r.entry.status === f);
    const sort = this.sort();
    return list.sort((a, b) =>
      sort === 'title'
        ? a.series.title.localeCompare(b.series.title)
        : sort === 'progress'
          ? b.fraction - a.fraction || a.series.title.localeCompare(b.series.title)
          : Math.max(b.lastAt, b.entry.updatedAt) - Math.max(a.lastAt, a.entry.updatedAt),
    );
  });

  protected readonly filterName = computed(() => (this.filter() === 'all' ? 'your library' : `“${STATUS_LABEL[this.filter() as LibraryStatus]}”`));

  protected setView(v: View): void {
    this.view.set(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered */
    }
  }

  protected ago(r: Row): string {
    return r.lastAt ? `Watched ${formatAgo(r.lastAt)}` : STATUS_SUB[r.entry.status];
  }

  protected listMeta(r: Row): string {
    return [r.series.year, `${r.series.episodeCount} episodes`].filter(Boolean).join(' · ');
  }

  protected thumb(r: Row): string {
    return posterBackground(r.series.posterUrl, r.series.id);
  }

  protected open(r: Row): void {
    void this.router.navigate(['/anime', r.series.id]);
  }

  protected menu(e: MouseEvent, r: Row): void {
    const sid = r.series.id;
    const playLabel = r.entry.status === 'completed' ? 'Watch again' : r.entry.watched > 0 || r.lastAt ? 'Continue' : 'Play';
    const items: MenuItem[] = [
      { label: playLabel, icon: 'play', run: () => void this.play(r) },
      { label: 'Go to anime', icon: 'go', run: () => this.open(r) },
      ...LIBRARY_STATUSES.filter((s) => s !== r.entry.status).map(
        (s, i): MenuItem => ({ label: `Move to ${STATUS_LABEL[s]}`, icon: 'status', separator: i === 0, run: () => this.library.setStatus(sid, s) }),
      ),
      { label: 'Remove from library', icon: 'remove', danger: true, separator: true, run: () => this.library.removeEntry(sid) },
    ];
    this.menus.open(e, r.series.title, items);
  }

  private async play(r: Row): Promise<void> {
    const d = await this.catalog.seriesDetail(r.series.id).catch(() => null);
    const target = d ? this.library.resume(r.series.id, d.episodes) : null;
    if (!target) return this.open(r);
    await this.router.navigate(['/watch', r.series.id, target.episode.id], target.finished ? { queryParams: { t: 0 } } : {});
  }
}

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}
