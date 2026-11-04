import { inject } from '@angular/core';
import { Router, type CanMatchFn, type Routes } from '@angular/router';

/** v3: Import is desktop-only; a direct visit on a phone goes Home. */
const desktopOnly: CanMatchFn = () =>
  typeof window === 'undefined' || !window.matchMedia?.('(max-width: 759px)').matches || inject(Router).createUrlTree(['/']);

export const importingRoutes: Routes = [
  {
    path: '',
    canMatch: [desktopOnly],
    loadComponent: () => import('./import.page').then((m) => m.ImportPage),
    title: 'Import · ani.stream',
  },
];

export default importingRoutes;
