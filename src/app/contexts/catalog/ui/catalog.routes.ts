import { Routes } from '@angular/router';

export const catalogRoutes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: () => import('./home.page').then((m) => m.HomePage), title: 'ani.stream' },
  {
    path: 'search',
    loadComponent: () => import('./search.page').then((m) => m.SearchPage),
    data: { depth: 1 },
    title: 'Search · ani.stream',
  },
  {
    path: 'anime/:seriesId',
    loadComponent: () => import('./anime-detail.page').then((m) => m.AnimeDetailPage),
    data: { depth: 2, compactMotion: true },
    title: 'ani.stream',
  },
];

export default catalogRoutes;
