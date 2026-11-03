import { Routes } from '@angular/router';

const placeholder = () => import('@shared/ui/placeholder-page').then((m) => m.PlaceholderPage);

export const playbackRoutes: Routes = [
  { path: ':seriesId/:episodeId', loadComponent: placeholder, data: { heading: 'Watch' }, title: 'ani.stream' },
];

export default playbackRoutes;
