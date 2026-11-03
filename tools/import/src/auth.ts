/**
 * Drive sign-in for the importer (ported from the music importer's `auth.js`).
 * First run opens the browser; the refresh token is cached in `secrets/token.json`.
 */
import fs from 'node:fs/promises';
import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { CLIENT_FILE, DRIVE_SCOPES, TOKEN_FILE } from './config.ts';

export type OAuthClient = InstanceType<typeof google.auth.OAuth2>;

interface ClientFile {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

export async function getDriveAuth(): Promise<OAuthClient> {
  let keys: ClientFile;
  try {
    keys = await readJson<ClientFile>(CLIENT_FILE);
  } catch {
    throw new Error(
      `Missing ${CLIENT_FILE}\nCreate a Desktop OAuth client in the myanime-streaming Google Cloud project ` +
        '(APIs & Services → Credentials), download its JSON and save it there.',
    );
  }
  const k = keys.installed ?? keys.web;
  if (!k) throw new Error(`${CLIENT_FILE} is not an OAuth client file`);

  try {
    const saved = await readJson<Record<string, unknown>>(TOKEN_FILE);
    const client = new google.auth.OAuth2(k.client_id, k.client_secret);
    client.setCredentials(saved);
    await client.getAccessToken(); // throws when the refresh token was revoked/expired
    persistRefreshes(client, saved);
    return client;
  } catch {
    /* fall through to interactive sign-in */
  }

  console.log('Opening the browser for Google sign-in (Drive)…');
  const client = (await authenticate({ keyfilePath: CLIENT_FILE, scopes: DRIVE_SCOPES })) as unknown as OAuthClient;
  await fs.writeFile(TOKEN_FILE, JSON.stringify(client.credentials, null, 2));
  persistRefreshes(client, client.credentials as Record<string, unknown>);
  return client;
}

function persistRefreshes(client: OAuthClient, base: Record<string, unknown>): void {
  client.on('tokens', (tokens) => {
    const merged = { ...base, ...tokens };
    fs.writeFile(TOKEN_FILE, JSON.stringify(merged, null, 2)).catch(() => {});
  });
}
