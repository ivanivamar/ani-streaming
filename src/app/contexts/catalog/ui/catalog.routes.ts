import { Routes } from '@angular/router';

const placeholder = () => import('@shared/ui/placeholder-page').then((m) => m.PlaceholderPage);

export const catalogRoutes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./home.page').then((m) => m.HomePage), title: 'ani.stream' },
  { path: 'search', loadComponent: placeholder, data: { heading: 'Search' }, title: 'Search · ani.stream' },
  {
    path: 'anime/:seriesId',
    loadComponent: () => import('./anime-detail.page').then((m) => m.AnimeDetailPage),
    title: 'ani.stream',
  },
];

export default catalogRoutes;
