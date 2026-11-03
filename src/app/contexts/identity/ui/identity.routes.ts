import { Routes } from '@angular/router';

const placeholder = () => import('@shared/ui/placeholder-page').then((m) => m.PlaceholderPage);

/** Full-screen routes rendered outside the shell (no sidebar / bottom nav). */
export const identityPublicRoutes: Routes = [
  { path: 'auth', loadComponent: placeholder, data: { heading: 'Sign in' }, title: 'Sign in · ani.stream' },
  { path: 'welcome', loadComponent: placeholder, data: { heading: 'Welcome' }, title: 'Welcome · ani.stream' },
];

/** Routes rendered inside the shell. */
export const identityShellRoutes: Routes = [
  { path: '', loadComponent: placeholder, data: { heading: 'Settings' }, title: 'Settings · ani.stream' },
];
