import { Routes } from '@angular/router';

export const playbackRoutes: Routes = [
  {
    path: ':seriesId/:episodeId',
    loadComponent: () => import('./watch.page').then((m) => m.WatchPage),
    title: 'Watch · ani.stream',
  },
];

export default playbackRoutes;
