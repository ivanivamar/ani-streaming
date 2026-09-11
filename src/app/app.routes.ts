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
  // Anime detail and watch ship in later passes (see README.md "Screens" —
  // this app is built screen by screen). Route stubs land here as each one
  // is implemented.
  { path: '**', redirectTo: '' },
];
