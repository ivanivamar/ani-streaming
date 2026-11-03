import { Routes } from '@angular/router';

const placeholder = () => import('@shared/ui/placeholder-page').then((m) => m.PlaceholderPage);

export const libraryRoutes: Routes = [
  { path: '', loadComponent: placeholder, data: { heading: 'Library' }, title: 'Library · ani.stream' },
];

export default libraryRoutes;
