import { Routes } from '@angular/router';
import { identityPublicRoutes } from '@identity/ui/identity.routes';
import { Shell } from '@shell/index';

/**
 * One lazy route group per bounded context. Guards (signed in + allowlisted) arrive with the
 * identity context in Step 3.
 */
export const routes: Routes = [
  ...identityPublicRoutes,
  {
    path: '',
    component: Shell,
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
