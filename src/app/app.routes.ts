import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadComponent: () => import('./features/auth/auth-page').then((m) => m.AuthPage),
    canActivate: [guestGuard],
    title: 'Sign in · ani.stream',
  },
  {
    path: '',
    loadComponent: () => import('./features/home/home-page').then((m) => m.HomePage),
    canActivate: [authGuard],
    title: 'Favourites · ani.stream',
  },
  {
    path: 'search',
    loadComponent: () => import('./features/search/search-page').then((m) => m.SearchPage),
    canActivate: [authGuard],
    title: 'Search · ani.stream',
  },
  {
    path: 'anime/:entryId',
    loadComponent: () => import('./features/anime-detail/anime-detail-page').then((m) => m.AnimeDetailPage),
    canActivate: [authGuard],
    title: 'ani.stream',
  },
  {
    path: 'watch/:entryId/:ep',
    loadComponent: () => import('./features/watch/watch-page').then((m) => m.WatchPage),
    canActivate: [authGuard],
    title: 'ani.stream',
  },
  { path: '**', redirectTo: '' },
];
