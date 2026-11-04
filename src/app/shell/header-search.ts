import { Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { CatalogStore, searchSeries } from '@catalog/application';
import { LibraryStore } from '@library/application';
import { Icon, posterBackground } from '@shared/ui';
import { filter, map } from 'rxjs';

const SUGGEST_LIMIT = 5;

/**
 * Header search (all chrome pages): pill bar, max 620px. Focus + empty → recent searches;
 * typing → up to 5 suggestions + "See all results". Enter → Search page (term saved to recent,
 * max 6). On the Search page itself the bar *is* the query: typing updates the results live.
 * `/` anywhere focuses it, Esc blurs, click outside closes.
 */
@Component({
  selector: 'app-header-search',
  imports: [Icon],
  host: { '(document:keydown)': 'onGlobalKey($event)' },
  template: `
    @if (open()) {
      <div class="scrim" (click)="close()" aria-hidden="true"></div>
    }
    <div class="wrap" (focusout)="onFocusOut($event)">
      <div class="bar" [class.focus]="focused()">
        <app-icon name="search" [size]="18" [stroke]="1.8" class="lead" />
        <input
          #input
          type="text"
          role="searchbox"
          enterkeyhint="search"
          placeholder="Search anime"
          aria-label="Search anime"
          autocomplete="off"
          spellcheck="false"
          [value]="query()"
          (input)="onInput($any($event.target).value)"
          (focus)="focused.set(true)"
          (keydown)="onKey($event)"
        />
        @if (query()) {
          <button type="button" class="clear" title="Clear" aria-label="Clear search" (click)="clear()">
            <app-icon name="close" [size]="13" [stroke]="2.2" />
          </button>
        } @else {
          <span class="kbd slash" aria-hidden="true">/</span>
        }
      </div>

      @if (open()) {
        <div class="drop" role="listbox">
          @if (!query()) {
            <div class="eyebrow head">Recent searches</div>
            @for (r of library.recent(); track r.id) {
              <div class="row-wrap">
                <button type="button" class="row" (click)="submit(r.term)">
                  <app-icon name="clock" [size]="16" [stroke]="1.8" class="muted" />
                  <span class="term">{{ r.term }}</span>
                </button>
                <button type="button" class="remove" title="Remove" aria-label="Remove from recent searches" (click)="library.removeRecent(r.id)">
                  <app-icon name="close" [size]="12" [stroke]="2.2" />
                </button>
              </div>
            }
          } @else {
            @for (s of suggestions(); track s.id) {
              <button type="button" class="sugg" (click)="openSeries(s.id)">
                <span class="thumb" [style.background]="bg(s.posterUrl, s.id)"></span>
                <span class="text">
                  <span class="title">{{ s.title }}</span>
                  <span class="meta">{{ s.episodeCount }} episode{{ s.episodeCount === 1 ? '' : 's' }}{{ s.year ? ' · ' + s.year : '' }}</span>
                </span>
              </button>
            } @empty {
              <div class="none">No titles matched.</div>
            }
            <div class="divider"></div>
            <button type="button" class="row all" (click)="submit(query())">
              <app-icon name="search" [size]="18" [stroke]="1.8" />
              <span class="term">See all results for “{{ query() }}”</span>
              <span class="kbd">Enter</span>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      flex: 1;
      display: flex;
      min-width: 0;
    }
    .scrim {
      position: fixed;
      inset: 0;
      z-index: 41;
    }
    .wrap {
      position: relative;
      z-index: 42;
      width: 100%;
      max-width: 620px;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 48px;
      padding: 0 8px 0 18px;
      border-radius: 999px;
      background: var(--surface-2);
      border: 1px solid rgba(255, 255, 255, 0.09);
      transition:
        background 0.15s,
        border-color 0.15s,
        box-shadow 0.15s;
    }
    .bar.focus {
      background: #1f2025;
      border-color: oklch(0.84 0.14 155 / 0.55);
      box-shadow: var(--focus-ring);
    }
    .lead {
      color: var(--text-4);
    }
    .focus .lead {
      color: var(--accent-text);
    }
    input {
      flex: 1;
      min-width: 0;
      height: 100%;
      background: none;
      border: none;
      outline: none;
      color: var(--text);
      font-size: 15px;
    }
    input::-webkit-search-cancel-button {
      display: none;
    }
    input::placeholder {
      color: var(--text-5);
    }
    .clear {
      width: 32px;
      height: 32px;
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.08);
      color: #b5b5bc;
    }
    .clear:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #fff;
    }
    .slash {
      flex: none;
      margin-right: 6px;
      min-width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      border-radius: 7px;
      padding: 0;
    }
    .drop {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      right: 0;
      padding: 8px;
      background: var(--surface-2);
      border: 1px solid var(--line-4);
      border-radius: 18px;
      box-shadow: var(--shadow-popover);
      animation: pop 0.14s ease-out;
    }
    .head {
      padding: 8px 12px 6px;
      color: var(--text-6);
    }
    .row-wrap {
      position: relative;
    }
    .row,
    .sugg {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: none;
      border-radius: 10px;
      background: transparent;
      color: var(--text-2);
      font-size: 14px;
      text-align: left;
    }
    .row-wrap .row {
      padding-right: 44px;
    }
    .row:hover,
    .sugg:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .muted {
      color: #6c6c74;
    }
    .term {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .remove {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 50%;
      background: transparent;
      color: #6c6c74;
    }
    .remove:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }
    .sugg {
      padding: 8px 10px;
      color: var(--text);
    }
    .thumb {
      width: 32px;
      height: 46px;
      flex: none;
      border-radius: 6px;
      border: 1px solid var(--line-4);
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .title {
      font-size: 14px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .meta {
      font-size: 12px;
      color: var(--text-5);
      margin-top: 2px;
    }
    .none {
      padding: 14px 12px;
      font-size: 13.5px;
      color: var(--text-5);
    }
    .divider {
      height: 1px;
      background: var(--line-3);
      margin: 6px 4px;
    }
    .all {
      color: var(--accent-text);
      font-size: 13.5px;
      font-weight: 500;
    }
  `,
})
export class HeaderSearch {
  protected readonly library = inject(LibraryStore);
  private readonly catalog = inject(CatalogStore);
  private readonly router = inject(Router);

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  protected readonly query = signal('');
  protected readonly focused = signal(false);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  private readonly onSearchPage = computed(() => this.url().startsWith('/search'));

  protected readonly open = computed(() => {
    if (!this.focused() || this.onSearchPage()) return false;
    return this.query() ? true : this.library.recent().length > 0;
  });

  protected readonly suggestions = computed(() =>
    this.query() ? searchSeries(this.catalog.series() ?? [], this.query()).slice(0, SUGGEST_LIMIT) : [],
  );

  constructor() {
    void this.catalog.allSeries().catch(() => undefined);
    // the Search page's ?q= drives the bar; leaving Search clears it
    effect(() => {
      const url = this.url();
      untracked(() => {
        if (url.startsWith('/search')) {
          this.query.set(this.router.parseUrl(url).queryParams['q'] ?? '');
        } else if (!this.focused()) {
          this.query.set('');
        }
      });
    });
  }

  protected onInput(v: string): void {
    this.query.set(v);
    if (this.onSearchPage()) {
      void this.router.navigate(['/search'], { queryParams: { q: v || null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.submit(this.query());
    } else if (e.key === 'Escape') {
      this.input().nativeElement.blur();
      this.focused.set(false);
    }
  }

  protected onGlobalKey(e: KeyboardEvent): void {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    e.preventDefault();
    this.input().nativeElement.focus();
  }

  protected submit(term: string): void {
    const t = term.trim();
    this.close();
    this.input().nativeElement.blur();
    if (!t) return;
    this.query.set(t);
    this.library.addRecent(t);
    void this.router.navigate(['/search'], { queryParams: { q: t }, queryParamsHandling: 'merge' });
  }

  protected openSeries(id: string): void {
    const t = this.query().trim();
    if (t) this.library.addRecent(t);
    this.close();
    this.input().nativeElement.blur();
    void this.router.navigate(['/anime', id]);
  }

  protected clear(): void {
    this.onInput('');
    this.input().nativeElement.focus();
  }

  protected onFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as HTMLElement).contains(next)) return;
    // a click on a dropdown row lands on a button inside .wrap; anything else closes
    if (next) this.close();
  }

  protected close(): void {
    this.focused.set(false);
  }

  protected bg(src: string | null, seed: string): string {
    return posterBackground(src, seed);
  }
}
