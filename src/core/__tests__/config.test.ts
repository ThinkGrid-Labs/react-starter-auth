/**
 * @jest-environment node
 */
import { resolveConfig } from '../config';
import { AuthConfig } from '../types';

const SECRET = 'a-secret-that-is-long-enough-32!';
const authenticate = async () => null;

function config(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return { secret: SECRET, authenticate, ...overrides };
}

describe('resolveConfig', () => {
  it('fills in safe defaults', () => {
    const resolved = resolveConfig(config());

    expect(resolved.cookie).toMatchObject({ name: 'session', path: '/', sameSite: 'lax' });
    expect(resolved.cookie.maxAge).toBe(604800);
    expect(resolved.csrf).toMatchObject({
      enabled: true,
      cookieName: 'csrf',
      headerName: 'x-csrf-token',
    });
    expect(resolved.basePath).toBe('/api/auth');
    expect(resolved.session.strategy).toBe('jwe');
  });

  it('rejects a short secret', () => {
    expect(() => resolveConfig(config({ secret: 'too-short' }))).toThrow(/at least 32 characters/);
  });

  it('requires an authenticate function', () => {
    expect(() =>
      resolveConfig({ secret: SECRET } as unknown as AuthConfig),
    ).toThrow(/authenticate must be a function/);
  });

  it('rejects SameSite=None without Secure', () => {
    expect(() =>
      resolveConfig(config({ cookie: { sameSite: 'none', secure: false } })),
    ).toThrow(/requires cookie.secure/);
  });

  it('refuses to disable CSRF on a cross-site cookie', () => {
    expect(() =>
      resolveConfig(
        config({ cookie: { sameSite: 'none', secure: true }, csrf: { enabled: false } }),
      ),
    ).toThrow(/open to CSRF/);
  });

  it('keeps the storeless strategy even when a store is supplied', () => {
    // A store is most often supplied only to track spent refresh tokens;
    // moving the whole session server-side has to be opted into explicitly.
    const store = {
      get: async () => null,
      set: async () => undefined,
      destroy: async () => undefined,
    };
    const resolved = resolveConfig(config({ session: { store } }));
    expect(resolved.session.strategy).toBe('jwe');
    expect(resolved.session.store).toBe(store);
  });

  it('rejects the store strategy with no store', () => {
    expect(() => resolveConfig(config({ session: { strategy: 'store' } }))).toThrow(
      /requires session.store/,
    );
  });

  it('normalizes a trailing slash off basePath', () => {
    expect(resolveConfig(config({ basePath: '/auth/' })).basePath).toBe('/auth');
  });

  it('defaults secure to false under NODE_ENV=test so local HTTP works', () => {
    expect(resolveConfig(config()).cookie.secure).toBe(false);
  });
});
