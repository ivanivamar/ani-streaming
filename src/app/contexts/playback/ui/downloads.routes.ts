import { Routes } from '@angular/router';

/** `/downloads` (Android app, Step 8), inside the shell. */
export const downloadsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./downloads.page').then((m) => m.DownloadsPage),
    title: 'Downloads · ani.stream',
  },
];

export default downloadsRoutes;
