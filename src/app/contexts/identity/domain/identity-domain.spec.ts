import {
  initialStatus,
  isAllowed,
  isLive,
  needsRenewal,
  hasScope,
  RENEW_EARLY_MS,
  safeNext,
  SKEW_MS,
  timerDelay,
  type StoredSession,
} from './index';

const now = 1_800_000_000_000;
const account = { email: 'ivan@example.com', name: 'Ivan' };
const session = (over: Partial<StoredSession> = {}): StoredSession => ({
  token: 't',
  expiresAt: now + 3_600_000,
  account,
  ...over,
});

describe('token policy', () => {
  it('treats a token as dead one minute before it expires', () => {
    expect(isLive(session({ expiresAt: now + SKEW_MS + 1 }), now)).toBe(true);
    expect(isLive(session({ expiresAt: now + SKEW_MS }), now)).toBe(false);
    expect(isLive(session({ token: '' }), now)).toBe(false);
  });

  it('boots stale renewable sessions as signed in, stale hourly ones as expired', () => {
    expect(initialStatus(null, now)).toBe('signed-out');
    expect(initialStatus(session(), now)).toBe('signed-in');
    expect(initialStatus(session({ expiresAt: now - 1 }), now)).toBe('expired');
    expect(initialStatus(session({ expiresAt: now - 1, renew: 'server' }), now)).toBe('signed-in');
    expect(initialStatus(session({ expiresAt: now - 1, renew: 'server', account: null }), now)).toBe('expired');
  });

  it('renews early only when the session can', () => {
    const s = session({ expiresAt: now + SKEW_MS + RENEW_EARLY_MS + 10_000 });
    expect(timerDelay(s, now)).toBe(RENEW_EARLY_MS + 10_000);
    expect(timerDelay({ ...s, renew: 'server' }, now)).toBe(10_000);
    expect(timerDelay(session({ token: '' }), now)).toBeNull();
    expect(needsRenewal(s, now)).toBe(false);
    expect(needsRenewal(session({ expiresAt: now + SKEW_MS + 1000 }), now)).toBe(true);
  });

  it('checks granted scopes exactly', () => {
    const granted = 'openid https://www.googleapis.com/auth/drive.readonly';
    expect(hasScope(granted, 'https://www.googleapis.com/auth/drive.readonly')).toBe(true);
    expect(hasScope(granted, 'https://www.googleapis.com/auth/drive')).toBe(false);
  });

  it('only redirects to in-app paths after sign-in', () => {
    expect(safeNext('/watch/aoashi/s01e01')).toBe('/watch/aoashi/s01e01');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/auth')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
  });
});

describe('access policy', () => {
  it('allows only listed uids', () => {
    expect(isAllowed('g1', ['g1', 'g2'])).toBe(true);
    expect(isAllowed('g3', ['g1'])).toBe(false);
    expect(isAllowed('', [''])).toBe(false);
    expect(isAllowed('g1', undefined)).toBe(false);
  });
});
