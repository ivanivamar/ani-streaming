import { Routes } from '@angular/router';

export const libraryRoutes: Routes = [
  { path: '', loadComponent: () => import('./library.page').then((m) => m.LibraryPage), title: 'Library · ani.stream' },
];

export default libraryRoutes;
