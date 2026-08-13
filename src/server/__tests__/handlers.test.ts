/**
 * @jest-environment node
 */
import { clearKeyCache } from '../../core/seal';
import { AuthConfig, AuthResult, SealedSession, SessionStore } from '../../core/types';
import { createAuthHandlers } from '../handlers';

const SECRET = 'test-secret-that-is-at-least-32-chars';
const APP = 'https://app.example.com';
const BASE = '/api/auth';

interface User extends Record<string, unknown> {
  id: string;
  name: string;
}

const ADA: User = { id: '1', name: 'Ada' };

function authResult(overrides: Partial<AuthResult<User>> = {}): AuthResult<User> {
  return {
    user: ADA,
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    expiresAt: Date.now() + 900_000,
    ...overrides,
  };
}

function baseConfig(overrides: Partial<AuthConfig<User>> = {}): AuthConfig<User> {
  return {
    secret: SECRET,
    authenticate: jest.fn(async (credentials: Record<string, unknown>) =>
      credentials.password === 'correct' ? authResult() : null,
    ),
    ...overrides,
  };
}

/** Read Set-Cookie headers into name -> { value, attrs }. */
function readSetCookies(response: Response): Record<string, { value: string; raw: string }> {
  const out: Record<string, { value: string; raw: string }> = {};
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    out[pair.slice(0, eq).trim()] = {
      value: decodeURIComponent(pair.slice(eq + 1).trim()),
      raw,
    };
  }
  return out;
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
}

function req(
  path: string,
  {
    method = 'GET',
    jar = {},
    headers = {},
    body,
  }: {
    method?: string;
    jar?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Request {
  const merged: Record<string, string> = {
    'sec-fetch-site': 'same-origin',
    ...headers,
  };
  const cookie = cookieHeader(jar);
  if (cookie) merged.cookie = cookie;

  return new Request(`${APP}${BASE}${path}`, {
    method,
    headers: merged,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Log in and return the resulting cookie jar. */
async function login(
  handlers: ReturnType<typeof createAuthHandlers<User>>,
  password = 'correct',
): Promise<{ jar: Record<string, string>; response: Response }> {
  const bootstrap = await handlers.handle(req('/session'));
  const csrf = readSetCookies(bootstrap).csrf.value;

  const response = await handlers.handle(
    req('/login', {
      method: 'POST',
      jar: { csrf },
      headers: { 'x-csrf-token': csrf },
      body: { email: 'ada@example.com', password },
    }),
  );

  const jar: Record<string, string> = { csrf };
  for (const [name, { value }] of Object.entries(readSetCookies(response))) {
    if (value) jar[name] = value;
  }
  return { jar, response };
}

afterEach(() => clearKeyCache());

describe('GET /session', () => {
  it('401s with no cookie, and bootstraps a CSRF token', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const response = await handlers.handle(req('/session'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });

    const csrf = readSetCookies(response).csrf;
    expect(csrf.value).toMatch(/^[0-9a-f]{64}$/);
    // The client has to read this one to echo it back.
    expect(csrf.raw).not.toContain('HttpOnly');
  });

  it('marks session responses uncacheable', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const response = await handlers.handle(req('/session'));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns the user once signed in', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const { jar } = await login(handlers);

    const response = await handlers.handle(req('/session', { jar }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: ADA,
      expiresAt: expect.any(Number),
    });
  });

  it('lets the cookie die with the token when refresh is not configured', async () => {
    // No refresh callback, so the cookie TTL is clamped to the access token's
    // own expiry — a stale cookie can never outlive the credential inside it.
    const handlers = createAuthHandlers(
      baseConfig({
        authenticate: async () => authResult({ expiresAt: Date.now() + 1000 }),
      }),
    );
    const { jar, response: loginResponse } = await login(handlers);
    expect(readSetCookies(loginResponse).session.raw).toContain('Max-Age=1');

    jest.useFakeTimers().setSystemTime(Date.now() + 5000);
    try {
      const response = await handlers.handle(req('/session', { jar }));
      expect(response.status).toBe(401);
      // The seal itself has expired, so there is no session left to report on.
      await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports session_expired while the cookie still spans the refresh window', async () => {
    // With refresh configured the cookie outlives the access token, so an
    // expired token is a distinct, recoverable state: call /refresh.
    const handlers = createAuthHandlers(
      baseConfig({
        authenticate: async () => authResult({ expiresAt: Date.now() + 1000 }),
        refresh: async () => authResult(),
      }),
    );
    const { jar, response: loginResponse } = await login(handlers);
    expect(readSetCookies(loginResponse).session.raw).toContain('Max-Age=604800');

    jest.useFakeTimers().setSystemTime(Date.now() + 5000);
    try {
      const response = await handlers.handle(req('/session', { jar }));
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'session_expired' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('POST /login', () => {
  it('never returns a token to the client', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const { response, jar } = await login(handlers);

    expect(response.status).toBe(200);
    const body = await response.json();

    // The whole point of the phase.
    expect(body).toEqual({ user: ADA, expiresAt: expect.any(Number) });
    expect(JSON.stringify(body)).not.toContain('access-token-1');
    expect(JSON.stringify(body)).not.toContain('refresh-token-1');

    // And the cookie that does carry them is opaque and unreadable to JS.
    expect(jar.session).not.toContain('access-token-1');
    expect(readSetCookies(response).session.raw).toContain('HttpOnly');
  });

  it('sets a SameSite=Lax cookie so external links survive', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const { response } = await login(handlers);
    expect(readSetCookies(response).session.raw).toContain('SameSite=Lax');
  });

  it('rejects bad credentials without saying which field was wrong', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const { response } = await login(handlers, 'wrong');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_credentials' });
    expect(readSetCookies(response).session).toBeUndefined();
  });

  it('rotates the CSRF token on login', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const bootstrap = await handlers.handle(req('/session'));
    const before = readSetCookies(bootstrap).csrf.value;

    const response = await handlers.handle(
      req('/login', {
        method: 'POST',
        jar: { csrf: before },
        headers: { 'x-csrf-token': before },
        body: { password: 'correct' },
      }),
    );

    expect(readSetCookies(response).csrf.value).not.toBe(before);
  });

  it('400s on a non-JSON body', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const bootstrap = await handlers.handle(req('/session'));
    const csrf = readSetCookies(bootstrap).csrf.value;

    const response = await handlers.handle(
      new Request(`${APP}${BASE}/login`, {
        method: 'POST',
        headers: {
          'sec-fetch-site': 'same-origin',
          'x-csrf-token': csrf,
          cookie: `csrf=${csrf}`,
        },
        body: 'not json',
      }),
    );
    expect(response.status).toBe(400);
  });

  it('502s when the access token fails verification', async () => {
    const handlers = createAuthHandlers(
      baseConfig({ jwt: { secret: 'a-verification-secret-long-enough' } }),
    );
    const { response } = await login(handlers);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_token' });
  });
});

describe('CSRF enforcement', () => {
  it('blocks a POST with no CSRF header', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const response = await handlers.handle(
      req('/login', { method: 'POST', jar: { csrf: 'x'.repeat(64) }, body: {} }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'csrf_failed' });
  });

  it('blocks a mismatched CSRF token', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const response = await handlers.handle(
      req('/login', {
        method: 'POST',
        jar: { csrf: 'a'.repeat(64) },
        headers: { 'x-csrf-token': 'b'.repeat(64) },
        body: {},
      }),
    );
    expect(response.status).toBe(403);
  });

  it('blocks a cross-site POST even with a valid token pair', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const token = 'a'.repeat(64);
    const response = await handlers.handle(
      req('/login', {
        method: 'POST',
        jar: { csrf: token },
        headers: { 'x-csrf-token': token, 'sec-fetch-site': 'cross-site' },
        body: {},
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      detail: expect.stringContaining('Sec-Fetch-Site'),
    });
  });

  it('can be turned off for same-origin-only deployments', async () => {
    const handlers = createAuthHandlers(baseConfig({ csrf: { enabled: false } }));
    const response = await handlers.handle(
      req('/login', { method: 'POST', body: { password: 'correct' } }),
    );
    expect(response.status).toBe(200);
  });
});

describe('POST /refresh', () => {
  it('rotates tokens and issues a new session cookie', async () => {
    const refresh = jest.fn(async () =>
      authResult({ accessToken: 'access-token-2', refreshToken: 'refresh-token-2' }),
    );
    const handlers = createAuthHandlers(baseConfig({ refresh }));
    const { jar } = await login(handlers);
    const before = jar.session;

    const response = await handlers.handle(
      req('/refresh', { method: 'POST', jar, headers: { 'x-csrf-token': jar.csrf } }),
    );

    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledWith('refresh-token-1', expect.any(Request));
    expect(readSetCookies(response).session.value).not.toBe(before);
    await expect(response.json()).resolves.toEqual({
      user: ADA,
      expiresAt: expect.any(Number),
    });
  });

  it('404s when no refresh callback is configured', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const { jar } = await login(handlers);

    const response = await handlers.handle(
      req('/refresh', { method: 'POST', jar, headers: { 'x-csrf-token': jar.csrf } }),
    );
    expect(response.status).toBe(404);
  });

  it('clears cookies when the refresh is rejected upstream', async () => {
    const handlers = createAuthHandlers(baseConfig({ refresh: async () => null }));
    const { jar } = await login(handlers);

    const response = await handlers.handle(
      req('/refresh', { method: 'POST', jar, headers: { 'x-csrf-token': jar.csrf } }),
    );

    expect(response.status).toBe(401);
    expect(readSetCookies(response).session.raw).toContain('Max-Age=0');
  });
});

describe('POST /logout', () => {
  it('clears both cookies', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const { jar } = await login(handlers);

    const response = await handlers.handle(
      req('/logout', { method: 'POST', jar, headers: { 'x-csrf-token': jar.csrf } }),
    );

    expect(response.status).toBe(200);
    const cookies = readSetCookies(response);
    expect(cookies.session.raw).toContain('Max-Age=0');
    expect(cookies.csrf.raw).toContain('Max-Age=0');
  });
});

describe('session store strategy', () => {
  function makeStore(): SessionStore<User> & { data: Map<string, SealedSession<User>> } {
    const data = new Map<string, SealedSession<User>>();
    const spent = new Set<string>();
    return {
      data,
      async get(id) {
        return data.get(id) ?? null;
      },
      async set(id, session) {
        data.set(id, session);
      },
      async destroy(id) {
        data.delete(id);
      },
      async consumeRefreshToken(token) {
        if (spent.has(token)) return false;
        spent.add(token);
        return true;
      },
    };
  }

  it('keeps tokens in the store, not the cookie', async () => {
    const store = makeStore();
    const handlers = createAuthHandlers(baseConfig({ session: { strategy: 'store', store } }));
    const { jar } = await login(handlers);

    expect(store.data.size).toBe(1);
    expect([...store.data.values()][0].accessToken).toBe('access-token-1');

    const response = await handlers.handle(req('/session', { jar }));
    await expect(response.json()).resolves.toEqual({
      user: ADA,
      expiresAt: expect.any(Number),
    });
  });

  it('keeps the session id stable across a refresh', async () => {
    const store = makeStore();
    const handlers = createAuthHandlers(
      baseConfig({
        session: { strategy: 'store', store },
        refresh: async () =>
          authResult({ accessToken: 'access-token-2', refreshToken: 'refresh-token-2' }),
      }),
    );
    const { jar } = await login(handlers);
    const sidBefore = [...store.data.keys()][0];

    const response = await handlers.handle(
      req('/refresh', { method: 'POST', jar, headers: { 'x-csrf-token': jar.csrf } }),
    );

    expect(response.status).toBe(200);
    // Only the tokens rotate — the session continues under the same id.
    expect([...store.data.keys()]).toEqual([sidBefore]);
    expect(store.data.get(sidBefore)?.accessToken).toBe('access-token-2');
  });

  it('destroys the stored session on logout', async () => {
    const store = makeStore();
    const handlers = createAuthHandlers(baseConfig({ session: { strategy: 'store', store } }));
    const { jar } = await login(handlers);
    expect(store.data.size).toBe(1);

    await handlers.handle(
      req('/logout', { method: 'POST', jar, headers: { 'x-csrf-token': jar.csrf } }),
    );
    expect(store.data.size).toBe(0);
  });
});

describe('refresh token reuse detection', () => {
  function makeSpentTracker() {
    const spent = new Set<string>();
    return {
      spent,
      store: {
        get: async () => null,
        set: async () => undefined,
        destroy: async () => undefined,
        async consumeRefreshToken(token: string) {
          if (spent.has(token)) return false;
          spent.add(token);
          return true;
        },
      } satisfies SessionStore<User>,
    };
  }

  /**
   * The storeless strategy carries the refresh token inside the cookie, so a
   * copied cookie can be replayed. A store supplied purely to track spent
   * tokens is what turns that replay into a detectable event.
   */
  it('rejects a replayed cookie and clears the session', async () => {
    const { store, spent } = makeSpentTracker();
    const handlers = createAuthHandlers(
      baseConfig({
        session: { strategy: 'jwe', store },
        refresh: async () =>
          authResult({ accessToken: 'access-token-2', refreshToken: 'refresh-token-2' }),
      }),
    );

    const { jar } = await login(handlers);

    const first = await handlers.handle(
      req('/refresh', { method: 'POST', jar, headers: { 'x-csrf-token': jar.csrf } }),
    );
    expect(first.status).toBe(200);
    expect(spent.has('refresh-token-1')).toBe(true);

    // Replay the original cookie, whose refresh token is now spent.
    const replay = await handlers.handle(
      req('/refresh', { method: 'POST', jar, headers: { 'x-csrf-token': jar.csrf } }),
    );

    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toEqual({ error: 'refresh_token_reused' });
    expect(readSetCookies(replay).session.raw).toContain('Max-Age=0');
  });
});

describe('routing and server helpers', () => {
  it('405s on the wrong method', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const response = await handlers.handle(req('/login'));
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('404s on an unknown route', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const response = await handlers.handle(req('/nope'));
    expect(response.status).toBe(404);
  });

  it('getSession returns public state only', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const { jar } = await login(handlers);

    const session = await handlers.getSession(req('/session', { jar }));
    expect(session).toEqual({ user: ADA, expiresAt: expect.any(Number) });
    expect(session).not.toHaveProperty('accessToken');
  });

  it('getSealedSession exposes the token for server-side API calls', async () => {
    const handlers = createAuthHandlers(baseConfig());
    const { jar } = await login(handlers);

    const sealed = await handlers.getSealedSession(req('/session', { jar }));
    expect(sealed?.accessToken).toBe('access-token-1');
  });

  it('applies the __Host- prefix when cookies qualify', () => {
    const handlers = createAuthHandlers(baseConfig({ cookie: { secure: true } }));
    expect(handlers.cookieNames).toEqual({ session: '__Host-session', csrf: '__Host-csrf' });
  });
});
