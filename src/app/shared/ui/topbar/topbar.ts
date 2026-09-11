import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Sticky topbar shared by every "chrome" screen (home, search, anime
 * detail — see README.md "Topbar (home, search, anime)"). The watch
 * screen is full-viewport and does not render this.
 *
 * On every screen except search itself, the search field is an inert
 * button that navigates to `/search` (README.md: "the topbar search field
 * *becomes* the input" only on that route). The search screen sets
 * `searchActive` and owns `query` — the actual input value lives on that
 * route (query params), this component just renders it and reports edits.
 */
@Component({
  selector: 'app-topbar',
  standalone: true,
  templateUrl: './topbar.html',
  styleUrl: './topbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Topbar {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  /** True only on the search screen itself, where it owns the live input. */
  readonly searchActive = input(false);
  /** Current search text, owned by the search screen (query param). */
  readonly query = input('');
  readonly queryChange = output<string>();

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly user = this.auth.user;
  readonly profileOpen = signal(false);

  readonly initials = computed(() => {
    const name = this.user()?.displayName?.trim();
    if (!name) return '?';
    const parts = name.split(/\s+/);
    return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name.slice(0, 2).toUpperCase();
  });

  goHome(): void {
    this.profileOpen.set(false);
    this.router.navigate(['/']);
  }

  goSearch(): void {
    this.profileOpen.set(false);
    this.router.navigate(['/search']);
  }

  onQueryInput(event: Event): void {
    this.queryChange.emit((event.target as HTMLInputElement).value);
  }

  clearQuery(): void {
    this.queryChange.emit('');
    this.searchInput()?.nativeElement.focus();
  }

  toggleProfile(): void {
    this.profileOpen.update((open) => !open);
  }

  logout(): void {
    this.profileOpen.set(false);
    this.auth.signOut();
    this.router.navigate(['/auth']);
  }

  /** Clicking outside the avatar/popover closes it. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.profileOpen() && !this.host.nativeElement.contains(event.target as Node)) {
      this.profileOpen.set(false);
    }
  }

  /** "/" focuses search from anywhere on a chrome screen (README.md "Topbar"). */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const isTyping = target && ['INPUT', 'TEXTAREA'].includes(target.tagName);
    if (event.key === '/' && !isTyping) {
      event.preventDefault();
      if (this.searchActive()) {
        this.searchInput()?.nativeElement.focus();
      } else {
        this.goSearch();
      }
    }
  }
}
