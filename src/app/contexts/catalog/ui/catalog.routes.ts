import { Routes } from '@angular/router';

const placeholder = () => import('@shared/ui/placeholder-page').then((m) => m.PlaceholderPage);

export const catalogRoutes: Routes = [
  { path: '', pathMatch: 'full', loadComponent: placeholder, data: { heading: 'Home' }, title: 'ani.stream' },
  { path: 'search', loadComponent: placeholder, data: { heading: 'Search' }, title: 'Search · ani.stream' },
  {
    path: 'anime/:seriesId',
    loadComponent: placeholder,
    data: { heading: 'Anime detail' },
    title: 'ani.stream',
  },
];

export default catalogRoutes;
