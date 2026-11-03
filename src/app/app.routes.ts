import { Routes } from '@angular/router';
import { requireAccess } from '@identity/application';
import { identityPublicRoutes } from '@identity/ui/identity.routes';
import { Shell } from '@shell/index';

/**
 * One lazy route group per bounded context. Everything inside the shell needs a signed-in,
 * allowlisted account (`requireAccess` → `/auth?next=…` otherwise).
 */
export const routes: Routes = [
  ...identityPublicRoutes,
  {
    path: '',
    component: Shell,
    canActivate: [requireAccess],
    children: [
      { path: 'watch', loadChildren: () => import('@playback/ui/playback.routes') },
      { path: 'library', loadChildren: () => import('@library/ui/library.routes') },
      { path: 'releases', loadChildren: () => import('@releases/ui/releases.routes') },
      {
        path: 'settings',
        loadChildren: () => import('@identity/ui/identity.routes').then((m) => m.identityShellRoutes),
      },
      { path: '', loadChildren: () => import('@catalog/ui/catalog.routes') },
    ],
  },
  { path: '**', redirectTo: '' },
];
