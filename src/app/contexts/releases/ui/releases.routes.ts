import { Routes } from '@angular/router';

export const releasesRoutes: Routes = [
  { path: '', loadComponent: () => import('./releases.page').then((m) => m.ReleasesPage), title: 'New releases · ani.stream' },
];

export default releasesRoutes;
