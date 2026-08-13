/**
 * @jest-environment node
 *
 * Server handlers driving the real client fetcher.
 *
 * The unit tests either side of this seam mock the other half, which cannot
 * catch the failure that matters most: server and client disagreeing about a
 * cookie or header name, leaving every unsafe request 403ing in production.
 *
 * The jar below models a browser honestly — `HttpOnly` cookies are sent on
 * requests but hidden from `document.cookie` — so the assertion that scripts
 * cannot see the session is a real one.
 */
import { createFetcher } from '../react/fetcher';
import { resolveClientConfig } from '../react/types';
import { createAuthHandlers } from '../server/handlers';

const APP = 'https://app.example.com';
const SECRET = 'integration-secret-at-least-32-chars';

interface User extends Record<string, unknown> {
  id: string;
}

const ADA: User = { id: '1' };

class CookieJar {
  private jar = new Map<string, { value: string; httpOnly: boolean }>();

  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';').map((part) => part.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const lowered = attrs.map((a) => a.toLowerCase());

      if (lowered.includes('max-age=0')) {
        this.jar.delete(name);
        continue;
      }
      this.jar.set(name, {
        value: decodeURIComponent(pair.slice(eq + 1)),
        httpOnly: lowered.includes('httponly'),
      });
    }
  }

  /** Everything the browser would send. */
  requestHeader(): string {
    return this.serialize(() => true);
  }

  /** Only what script can read. */
  documentCookie(): string {
    return this.serialize((entry) => !entry.httpOnly);
  }

  names(): string[] {
    return [...this.jar.keys()];
  }

  private serialize(predicate: (entry: { httpOnly: boolean }) => boolean): string {
    return [...this.jar.entries()]
      .filter(([, entry]) => predicate(entry))
      .map(([name, entry]) => `${name}=${encodeURIComponent(entry.value)}`)
      .join('; ');
  }
}

function setup({ accessTokenTtlMs = 900_000 } = {}) {
  const jar = new CookieJar();
  let issued = 0;

  const auth = createAuthHandlers<User>({
    secret: SECRET,
    authenticate: async (credentials) => {
      if (credentials.password !== 'hunter2') return null;
      issued += 1;
      return {
        user: ADA,
        accessToken: `access-${issued}`,
        refreshToken: `refresh-${issued}`,
        expiresAt: Date.now() + accessTokenTtlMs,
      };
    },
    refresh: async () => {
      issued += 1;
      return {
        user: ADA,
        accessToken: `access-${issued}`,
        refreshToken: `refresh-${issued}`,
        expiresAt: Date.now() + 900_000,
      };
    },
  });

  /** Stands in for a resource endpoint that trusts only a live session. */
  async function resourceApi(request: Request): Promise<Response> {
    const session = await auth.getSealedSession(request);
    if (!session || session.expiresAt <= Date.now()) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }
    return new Response(JSON.stringify({ seenToken: session.accessToken }), { status: 200 });
  }

  // Route the client's fetch into the handlers, carrying cookies both ways.
  const globals = globalThis as unknown as {
    fetch: unknown;
    document: unknown;
  };
  globals.document = {
    get cookie() {
      return jar.documentCookie();
    },
  };
  globals.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? new URL(input, APP) : new URL(String(input), APP);
    const headers = new Headers(init.headers);
    const cookie = jar.requestHeader();
    if (cookie) headers.set('cookie', cookie);
    headers.set('sec-fetch-site', 'same-origin');

    const request = new Request(url, { ...init, headers });
    const response = url.pathname.startsWith('/api/auth')
      ? await auth.handle(request)
      : await resourceApi(request);
    jar.absorb(response);
    return response;
  };

  const fetcher = createFetcher(resolveClientConfig({ basePath: '/api/auth' }));
  return { auth, jar, fetcher };
}

describe('client and server together', () => {
  it('completes a full session lifecycle', async () => {
    const { jar, fetcher } = setup();

    // 1. Bootstrap. The client learns nothing but gains a CSRF token.
    const anonymous = await fetcher('/api/auth/session');
    expect(anonymous.status).toBe(401);
    expect(jar.documentCookie()).toMatch(/csrf=/);

    // 2. Sign in. The fetcher reads the CSRF cookie the server just set and
    //    echoes it — this is the name agreement that unit tests cannot check.
    const login = await fetcher('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'hunter2' }),
    });
    expect(login.status).toBe(200);
    await expect(login.json()).resolves.toEqual({ user: ADA, expiresAt: expect.any(Number) });

    // 3. The session cookie exists, and script cannot see it.
    expect(jar.names()).toContain('session');
    expect(jar.documentCookie()).not.toContain('session=');
    expect(jar.requestHeader()).toContain('session=');

    // 4. A protected call now succeeds, with the token supplied server-side.
    const me = await fetcher('/api/books');
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toEqual({ seenToken: 'access-1' });

    // 5. Sign out clears the session.
    const out = await fetcher('/api/auth/logout', { method: 'POST' });
    expect(out.status).toBe(200);
    expect(jar.names()).not.toContain('session');
    expect((await fetcher('/api/books')).status).toBe(401);
  });

  it('recovers from an expired access token without the caller noticing', async () => {
    // Token already dead by the time the protected call is made.
    const { fetcher } = setup({ accessTokenTtlMs: -1_000 });

    await fetcher('/api/auth/session');
    const login = await fetcher('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'hunter2' }),
    });
    expect(login.status).toBe(200);

    // The resource API 401s, the fetcher refreshes and replays, and the caller
    // sees only the successful second attempt.
    const response = await fetcher('/api/books');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ seenToken: 'access-2' });
  });

  it('rejects an unsafe request that omits the CSRF header', async () => {
    const { jar, fetcher } = setup();
    await fetcher('/api/auth/session');

    // Bypass the fetcher, as a cross-site attacker's form post would.
    const forged = await (globalThis as unknown as { fetch: typeof fetch }).fetch(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ password: 'hunter2' }) },
    );

    expect(forged.status).toBe(403);
    expect(jar.names()).not.toContain('session');
  });
});
