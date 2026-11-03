import { Routes } from '@angular/router';

const placeholder = () => import('@shared/ui/placeholder-page').then((m) => m.PlaceholderPage);

export const releasesRoutes: Routes = [
  { path: '', loadComponent: placeholder, data: { heading: 'New releases' }, title: 'New releases · ani.stream' },
];

export default releasesRoutes;
