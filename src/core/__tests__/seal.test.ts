/**
 * @jest-environment node
 */
import { clearKeyCache, sealReference, sealSession, unsealReference, unsealSession } from '../seal';
import { SealedSession } from '../types';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);

function makeSession(overrides: Partial<SealedSession> = {}): SealedSession {
  return {
    user: { id: '1', name: 'Ada' },
    expiresAt: Date.now() + 60_000,
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    ...overrides,
  };
}

describe('sealSession / unsealSession', () => {
  afterEach(() => clearKeyCache());

  it('round-trips a session', async () => {
    const session = makeSession();
    const sealed = await sealSession(session, SECRET, 60);
    const opened = await unsealSession(sealed, SECRET);

    expect(opened).toEqual(session);
  });

  it('produces an opaque JWE, not a readable token', async () => {
    const sealed = await sealSession(makeSession(), SECRET, 60);

    // Five-part JWE, and none of the secrets appear in the ciphertext.
    expect(sealed.split('.')).toHaveLength(5);
    expect(sealed).not.toContain('access-token');
    expect(sealed).not.toContain('refresh-token');
    expect(sealed).not.toContain('Ada');
  });

  it('rejects a session sealed with a different secret', async () => {
    const sealed = await sealSession(makeSession(), SECRET, 60);
    expect(await unsealSession(sealed, OTHER_SECRET)).toBeNull();
  });

  /**
   * Flip the *first* base64url character of a segment. The last character can
   * carry only padding bits, so changing it may decode to identical bytes and
   * tamper with nothing — an earlier version of this test did exactly that and
   * passed vacuously.
   */
  function tamper(jwe: string, segment: number): string {
    const parts = jwe.split('.');
    const head = parts[segment][0];
    parts[segment] = (head === 'A' ? 'B' : 'A') + parts[segment].slice(1);
    return parts.join('.');
  }

  it('rejects tampered ciphertext', async () => {
    const sealed = await sealSession(makeSession(), SECRET, 60);
    const tampered = tamper(sealed, 3);

    expect(tampered).not.toBe(sealed);
    expect(await unsealSession(tampered, SECRET)).toBeNull();
  });

  it('rejects a tampered authentication tag', async () => {
    const sealed = await sealSession(makeSession(), SECRET, 60);
    expect(await unsealSession(tamper(sealed, 4), SECRET)).toBeNull();
  });

  it('rejects a tampered initialisation vector', async () => {
    const sealed = await sealSession(makeSession(), SECRET, 60);
    expect(await unsealSession(tamper(sealed, 2), SECRET)).toBeNull();
  });

  it('rejects an expired seal', async () => {
    const sealed = await sealSession(makeSession(), SECRET, 1);
    jest.useFakeTimers().setSystemTime(Date.now() + 5_000);
    try {
      expect(await unsealSession(sealed, SECRET)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it.each([
    ['empty string', ''],
    ['garbage', 'not-a-jwe'],
    ['a plain JWT', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.'],
  ])('returns null for %s', async (_label, token) => {
    expect(await unsealSession(token, SECRET)).toBeNull();
  });

  it('rejects a payload missing required fields', async () => {
    const sealed = await sealSession(
      { user: { id: '1' } } as unknown as SealedSession,
      SECRET,
      60,
    );
    expect(await unsealSession(sealed, SECRET)).toBeNull();
  });
});

describe('sealReference / unsealReference', () => {
  afterEach(() => clearKeyCache());

  it('round-trips a session id', async () => {
    const sealed = await sealReference('sid-123', SECRET, 60);
    expect(await unsealReference(sealed, SECRET)).toBe('sid-123');
  });

  it('rejects a reference sealed with a different secret', async () => {
    const sealed = await sealReference('sid-123', SECRET, 60);
    expect(await unsealReference(sealed, OTHER_SECRET)).toBeNull();
  });

  it('does not accept a full session as a reference', async () => {
    const sealed = await sealSession(makeSession(), SECRET, 60);
    expect(await unsealReference(sealed, SECRET)).toBeNull();
  });
});
