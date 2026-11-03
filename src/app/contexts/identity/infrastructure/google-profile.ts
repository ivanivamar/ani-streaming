import { Injectable } from '@angular/core';
import { GoogleProfilePort } from '../application/ports';
import type { Account } from '../domain';

/** Drive's `about` returns the user without extra (profile/email) scopes. */
@Injectable()
export class DriveAboutProfile extends GoogleProfilePort {
  async fetchAccount(accessToken: string): Promise<Account | null> {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const { user } = (await res.json()) as {
      user: { displayName?: string; emailAddress?: string; photoLink?: string };
    };
    return { email: user.emailAddress ?? '', name: user.displayName ?? '', ...(user.photoLink ? { photo: user.photoLink } : {}) };
  }
}
