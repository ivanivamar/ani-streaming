import { Routes } from '@angular/router';
import { requireAccess } from '@identity/application';

/** Full-screen routes rendered outside the shell (no sidebar / bottom nav). */
export const identityPublicRoutes: Routes = [
  {
    path: 'auth',
    loadComponent: () => import('./sign-in.page').then((m) => m.SignInPage),
    data: { depth: -1 },
    title: 'Sign in · ani.stream',
  },
  {
    path: 'welcome',
    canActivate: [requireAccess],
    loadComponent: () => import('./welcome.page').then((m) => m.WelcomePage),
    data: { depth: -1 },
    title: 'Welcome · ani.stream',
  },
];

/** Routes rendered inside the shell. */
export const identityShellRoutes: Routes = [
  { path: '', loadComponent: () => import('./settings.page').then((m) => m.SettingsPage), title: 'Settings · ani.stream' },
];
