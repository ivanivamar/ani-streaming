import { Routes } from '@angular/router';
import { requireAccess, requireProfile } from '@identity/application';
import { identityPublicRoutes } from '@identity/ui/identity.routes';

/**
 * One lazy route group per bounded context. Everything but sign-in needs a signed-in,
 * allowlisted account (`requireAccess` → `/auth?next=…` otherwise). The player is full-screen,
 * outside the shell. `data.depth` drives the page-motion direction (see shared/ui Motion).
 */
export const routes: Routes = [
  ...identityPublicRoutes,
  {
    path: 'watch',
    canActivate: [requireAccess, requireProfile],
    data: { depth: 3 },
    loadChildren: () => import('@playback/ui/playback.routes'),
  },
  {
    path: '',
    loadComponent: () => import('@shell/index').then((m) => m.Shell),
    canActivate: [requireAccess, requireProfile],
    children: [
      { path: 'library', loadChildren: () => import('@library/ui/library.routes') },
      { path: 'releases', loadChildren: () => import('@releases/ui/releases.routes') },
      { path: 'import', loadChildren: () => import('@importing/ui/importing.routes') },
      {
        path: 'settings',
        loadChildren: () => import('@identity/ui/identity.routes').then((m) => m.identityShellRoutes),
      },
      { path: '', loadChildren: () => import('@catalog/ui/catalog.routes') },
    ],
  },
  { path: '**', redirectTo: '' },
];
