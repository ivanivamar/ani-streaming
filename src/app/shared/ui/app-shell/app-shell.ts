import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Topbar } from '../topbar/topbar';

/**
 * Shared chrome for every non-auth, non-watch screen: sticky topbar +
 * the centered `max-width:1360px` main column (README.md "Topbar (home,
 * search, anime)" / page gutter rules). Projects the screen's content.
 * `query`/`queryChange` are pass-throughs to the topbar's live search
 * field, used only by the search screen (`searchActive` true elsewhere).
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [Topbar],
  template: `
    <app-topbar [searchActive]="searchActive()" [query]="query()" (queryChange)="queryChange.emit($event)" />
    <main class="shell-main"><ng-content /></main>
  `,
  styleUrl: './app-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  readonly searchActive = input(false);
  readonly query = input('');
  readonly queryChange = output<string>();
}
