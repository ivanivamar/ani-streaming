import { InjectionToken } from '@angular/core';

/**
 * Public configuration of this deployment (OAuth client id, Firebase web config). None of these
 * values are secrets: they identify the app. Filled in `src/app/app.env.ts` and provided by
 * `app.config.ts`.
 */
export interface AppEnv {
  /** "ani.stream Web" OAuth client (Google Cloud → APIs & Services → Credentials). */
  readonly googleClientId: string;
  /** Firebase console → Project settings → General → Your apps → Web app → config. */
  readonly firebase: {
    readonly apiKey: string;
    readonly appId: string;
    readonly projectId: string;
    readonly authDomain: string;
    readonly messagingSenderId?: string;
  };
  /** Origin + path of the `api` function (`/api/**`). `/` on Hosting and on `ng serve` (proxied). */
  readonly apiBase: string;
}

export const APP_ENV = new InjectionToken<AppEnv>('APP_ENV');

/** What is still missing from `app.env.ts`, for a readable error instead of a Google/Firebase one. */
export function missingEnv(env: AppEnv): string[] {
  const missing: string[] = [];
  if (!env.googleClientId.endsWith('.apps.googleusercontent.com')) missing.push('googleClientId');
  if (!env.firebase.apiKey) missing.push('firebase.apiKey');
  if (!env.firebase.appId) missing.push('firebase.appId');
  return missing;
}
