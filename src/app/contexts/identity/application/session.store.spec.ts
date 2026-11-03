import { TestBed } from '@angular/core/testing';
import { DRIVE_READONLY_SCOPE, RENEW_EARLY_MS, SKEW_MS, type StoredSession } from '../domain';
import {
  AccessPort,
  AuthHelperError,
  AuthHelperPort,
  FirebaseSessionPort,
  GoogleIdentityPort,
  GoogleProfilePort,
  SessionPersistencePort,
  type GoogleTokens,
} from './ports';
import { SessionStore } from './session.store';

const ivan = { email: 'ivan@example.com', name: 'Ivan' };
const tokens = (accessToken: string, scope = DRIVE_READONLY_SCOPE): GoogleTokens => ({
  accessToken,
  expiresInSec: 3600,
  scope,
});

class FakeGoogle extends GoogleIdentityPort {
  preload = vi.fn();
  requestCode = vi.fn(async () => 'code');
  requestToken = vi.fn(async () => tokens('popup-token'));
  revoke = vi.fn();
}
class FakeHelper extends AuthHelperPort {
  isAvailable = true;
  available = vi.fn(async () => this.isAvailable);
  hasSession = vi.fn(async () => false);
  exchange = vi.fn(async () => ({ ...tokens('helper-token'), refresh: true }));
  refresh = vi.fn(async () => tokens('renewed-token'));
  logout = vi.fn(async () => undefined);
}
class FakeProfile extends GoogleProfilePort {
  fetchAccount = vi.fn(async () => ivan);
}
class MemoryPersistence extends SessionPersistencePort {
  value: StoredSession | null = null;
  read = () => this.value;
  write = (s: StoredSession | null) => {
    this.value = s;
  };
}
class FakeFirebase extends FirebaseSessionPort {
  connect = vi.fn(async (_email: string, token: () => Promise<string | null>) => {
    if (!(await token())) throw new Error('no token');
    return 'g123';
  });
  disconnect = vi.fn(async () => undefined);
}
class FakeAccess extends AccessPort {
  allowed = true;
  isAllowed = vi.fn(async () => this.allowed);
}

function setup(stored: StoredSession | null = null) {
  const fakes = {
    google: new FakeGoogle(),
    helper: new FakeHelper(),
    profile: new FakeProfile(),
    persistence: new MemoryPersistence(),
    firebase: new FakeFirebase(),
    access: new FakeAccess(),
  };
  fakes.persistence.value = stored;
  TestBed.configureTestingModule({
    providers: [
      { provide: GoogleIdentityPort, useValue: fakes.google },
      { provide: AuthHelperPort, useValue: fakes.helper },
      { provide: GoogleProfilePort, useValue: fakes.profile },
      { provide: SessionPersistencePort, useValue: fakes.persistence },
      { provide: FirebaseSessionPort, useValue: fakes.firebase },
      { provide: AccessPort, useValue: fakes.access },
    ],
  });
  return { ...fakes, create: () => TestBed.inject(SessionStore) };
}

describe('SessionStore', () => {
  afterEach(() => vi.useRealTimers());

  it('signs in through the helper, connects Firebase and checks the allowlist', async () => {
    const t = setup();
    const session = t.create();
    expect(session.status()).toBe('signed-out');

    await expect(session.signIn()).resolves.toBe('ready');

    expect(t.google.requestCode).toHaveBeenCalled();
    expect(t.helper.exchange).toHaveBeenCalledWith('code');
    expect(session.status()).toBe('signed-in');
    expect(session.account()).toEqual(ivan);
    expect(session.uid()).toBe('g123');
    expect(session.ready()).toBe(true);
    expect(t.persistence.value).toMatchObject({ token: 'helper-token', renew: 'server', account: ivan });
    expect(t.firebase.connect).toHaveBeenCalledWith('ivan@example.com', expect.any(Function));
  });

  it('falls back to the hourly token model without the helper', async () => {
    const t = setup();
    t.helper.isAvailable = false;
    const session = t.create();
    await session.signIn();
    expect(t.google.requestToken).toHaveBeenCalled();
    expect(t.persistence.value?.renew).toBeUndefined();
    expect(session.token()).toBe('popup-token');
  });

  it('refuses a grant without Drive access', async () => {
    const t = setup();
    t.helper.exchange.mockResolvedValueOnce({ ...tokens('x', 'openid'), refresh: true });
    const session = t.create();
    await session.signIn();
    expect(session.status()).toBe('signed-out');
    expect(session.error()).toMatch(/Google Drive/);
  });

  it('reports no-access for a uid missing from config/access', async () => {
    const t = setup();
    t.access.allowed = false;
    const session = t.create();
    await expect(session.signIn()).resolves.toBe('no-access');
    expect(session.ready()).toBe(false);
    expect(await session.gate()).toBe('no-access');

    t.access.allowed = true;
    await expect(session.retry()).resolves.toBe('ready');
  });

  it('renews a stale helper session silently on boot', async () => {
    const t = setup({ token: 'old', expiresAt: Date.now() - 1000, account: ivan, renew: 'server' });
    const session = t.create();
    expect(session.status()).toBe('signed-in');
    await expect(session.gate()).resolves.toBe('ready');
    expect(t.helper.refresh).toHaveBeenCalledTimes(1);
    expect(session.token()).toBe('renewed-token');
  });

  it('marks the session expired when the grant is gone', async () => {
    const t = setup({ token: 'old', expiresAt: Date.now() - 1000, account: ivan, renew: 'server' });
    t.helper.refresh.mockRejectedValue(new AuthHelperError(401, 'invalid_grant'));
    const session = t.create();
    await expect(session.gate()).resolves.toBe('expired');
    expect(session.account()).toEqual(ivan);
    expect(t.persistence.value?.renew).toBeUndefined();
  });

  it('expires an hourly token at its deadline', async () => {
    vi.useFakeTimers();
    const t = setup({ token: 'live', expiresAt: Date.now() + SKEW_MS + 10_000, account: ivan });
    const session = t.create();
    expect(session.status()).toBe('signed-in');
    vi.advanceTimersByTime(10_001);
    expect(session.status()).toBe('expired');
    expect(session.token()).toBeNull();
  });

  it('renews 5 min before a helper token runs out', async () => {
    vi.useFakeTimers();
    const t = setup({
      token: 'live',
      expiresAt: Date.now() + SKEW_MS + RENEW_EARLY_MS + 1000,
      account: ivan,
      renew: 'server',
    });
    const session = t.create();
    expect(await session.ensureToken()).toBe('live');
    expect(t.helper.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1001);
    expect(t.helper.refresh).toHaveBeenCalledTimes(1);
    expect(await session.ensureToken()).toBe('renewed-token');
  });

  it('signs out everywhere', async () => {
    const t = setup();
    const session = t.create();
    await session.signIn();
    session.signOut();
    expect(session.status()).toBe('signed-out');
    expect(session.phase()).toBe('idle');
    expect(t.google.revoke).toHaveBeenCalledWith('helper-token');
    expect(t.helper.logout).toHaveBeenCalled();
    expect(t.firebase.disconnect).toHaveBeenCalled();
    expect(t.persistence.value).toBeNull();
    expect(session.resets()).toBe(1);
    expect(await session.gate()).toBe('signed-out');
  });

  it('drops the Firebase session when another Google account signs in', async () => {
    const t = setup();
    const session = t.create();
    await session.signIn();
    t.profile.fetchAccount.mockResolvedValueOnce({ email: 'other@example.com', name: 'Other' });
    await session.signIn({ switchAccount: true });
    expect(t.firebase.disconnect).toHaveBeenCalledTimes(1);
    expect(t.firebase.connect).toHaveBeenLastCalledWith('other@example.com', expect.any(Function));
    expect(t.google.requestCode).toHaveBeenLastCalledWith({ hint: undefined, selectAccount: true });
  });
});
