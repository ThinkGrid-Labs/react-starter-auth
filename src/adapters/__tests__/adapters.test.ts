/**
 * @jest-environment node
 */
import { AuthConfig } from '../../core/types';
import { createAuthHandlers } from '../../server/handlers';
import {
  NodeRequestLike,
  NodeResponseLike,
  createNodeAdapter,
  sendWebResponse,
  toWebRequest,
} from '../node';
import { createNextAdapter, toCookieHeader } from '../next';
import { createReactRouterAdapter } from '../react-router';

const SECRET = 'adapter-secret-that-is-32-chars!!';
const APP = 'https://app.example.com';

interface User extends Record<string, unknown> {
  id: string;
}
const ADA: User = { id: '1' };

function makeAuth(overrides: Partial<AuthConfig<User>> = {}) {
  return createAuthHandlers<User>({
    secret: SECRET,
    authenticate: async (credentials) =>
      credentials.password === 'hunter2'
        ? {
            user: ADA,
            accessToken: 'access-1',
            refreshToken: 'refresh-1',
            expiresAt: Date.now() + 900_000,
          }
        : null,
    ...overrides,
  });
}

/** Sign in and return the browser's resulting cookie header. */
async function signedInCookieHeader(auth: ReturnType<typeof makeAuth>): Promise<string> {
  const bootstrap = await auth.handle(
    new Request(`${APP}/api/auth/session`, { headers: { 'sec-fetch-site': 'same-origin' } }),
  );
  const csrf = bootstrap.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('csrf='))!;
  const csrfValue = decodeURIComponent(csrf.split('=')[1]);

  const login = await auth.handle(
    new Request(`${APP}/api/auth/login`, {
      method: 'POST',
      headers: {
        'sec-fetch-site': 'same-origin',
        'x-csrf-token': csrfValue,
        cookie: csrf,
      },
      body: JSON.stringify({ password: 'hunter2' }),
    }),
  );

  const session = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('session='))!;
  return `${csrf}; ${session}`;
}

describe('Next.js adapter', () => {
  it('exposes GET and POST route handlers', async () => {
    const adapter = createNextAdapter(makeAuth());
    const response = await adapter.handlers.GET(
      new Request(`${APP}/api/auth/session`, { headers: { 'sec-fetch-site': 'same-origin' } }),
    );
    expect(response.status).toBe(401);
  });

  it('reads the session from a cookies() store', async () => {
    const auth = makeAuth();
    const header = await signedInCookieHeader(auth);
    const adapter = createNextAdapter(auth);

    // Mirrors next/headers cookies(): decoded name/value pairs.
    const store = {
      getAll: () =>
        header.split('; ').map((pair) => {
          const eq = pair.indexOf('=');
          return { name: pair.slice(0, eq), value: decodeURIComponent(pair.slice(eq + 1)) };
        }),
    };

    await expect(adapter.getSession(store)).resolves.toEqual({
      user: ADA,
      expiresAt: expect.any(Number),
    });
    // Server-side only: the token is reachable here and nowhere else.
    await expect(adapter.getSealedSession(store)).resolves.toMatchObject({
      accessToken: 'access-1',
    });
  });

  it('re-encodes values so a round trip is lossless', () => {
    const store = { getAll: () => [{ name: 'a', value: 'x y' }] };
    expect(toCookieHeader(store)).toBe('a=x%20y');
  });

  describe('guard', () => {
    /**
     * A URL, not a Response, so the caller builds the redirect with the same
     * `NextResponse` it already uses for the continue branch.
     */
    it('returns where to send signed-out visitors, preserving the destination', async () => {
      const adapter = createNextAdapter(makeAuth());
      const target = await adapter.guard(new Request(`${APP}/dashboard?tab=1`));

      expect(target).toBeInstanceOf(URL);
      expect(target!.pathname).toBe('/login');
      expect(target!.searchParams.get('next')).toBe('/dashboard?tab=1');
    });

    it('lets a signed-in request continue', async () => {
      const auth = makeAuth();
      const cookie = await signedInCookieHeader(auth);
      const adapter = createNextAdapter(auth);

      const target = await adapter.guard(new Request(`${APP}/dashboard`, { headers: { cookie } }));
      expect(target).toBeNull();
    });

    it('skips paths the protect predicate excludes', async () => {
      const adapter = createNextAdapter(makeAuth());
      const guard = (path: string) =>
        adapter.guard(new Request(`${APP}${path}`), {
          protect: (pathname) => pathname.startsWith('/admin'),
        });

      expect(await guard('/public')).toBeNull();
      expect((await guard('/admin/users'))?.pathname).toBe('/login');
    });

    it('honours a custom destination and omits the return param when asked', async () => {
      const adapter = createNextAdapter(makeAuth());
      const target = await adapter.guard(new Request(`${APP}/x`), {
        redirectTo: '/enter',
        returnToParam: null,
      });

      expect(target!.pathname).toBe('/enter');
      expect(target!.search).toBe('');
    });
  });
});

describe('React Router adapter', () => {
  it('serves the auth routes from a loader and an action', async () => {
    const adapter = createReactRouterAdapter(makeAuth());
    const response = await adapter.loader({
      request: new Request(`${APP}/api/auth/session`, {
        headers: { 'sec-fetch-site': 'same-origin' },
      }),
    });
    expect(response.status).toBe(401);
    expect(adapter.action).toBe(adapter.loader);
  });

  it('returns the session when signed in', async () => {
    const auth = makeAuth();
    const cookie = await signedInCookieHeader(auth);
    const adapter = createReactRouterAdapter(auth);

    await expect(
      adapter.requireSession(new Request(`${APP}/dashboard`, { headers: { cookie } })),
    ).resolves.toEqual({ user: ADA, expiresAt: expect.any(Number) });
  });

  it('throws a redirect Response when signed out', async () => {
    const adapter = createReactRouterAdapter(makeAuth());

    // Throwing is the loader idiom — the framework catches and honours it.
    const thrown = await adapter
      .requireSession(new Request(`${APP}/dashboard`))
      .then(() => null)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location')!).searchParams.get('next')).toBe('/dashboard');
  });

  it('requireSealedSession yields the access token', async () => {
    const auth = makeAuth();
    const cookie = await signedInCookieHeader(auth);
    const adapter = createReactRouterAdapter(auth);

    await expect(
      adapter.requireSealedSession(new Request(`${APP}/x`, { headers: { cookie } })),
    ).resolves.toMatchObject({ accessToken: 'access-1' });
  });
});

describe('Node adapter', () => {
  function nodeResponse(): NodeResponseLike & {
    headers: Record<string, string | string[]>;
    body?: string;
  } {
    return {
      statusCode: 0,
      headers: {},
      setHeader(name: string, value: string | string[]) {
        this.headers[name.toLowerCase()] = value;
      },
      end(chunk?: string) {
        this.body = chunk;
      },
    };
  }

  describe('toWebRequest', () => {
    it('builds a URL from the Host header', async () => {
      const request = await toWebRequest({
        method: 'GET',
        url: '/api/auth/session',
        headers: { host: 'app.example.com' },
      });
      expect(request.url).toBe('http://app.example.com/api/auth/session');
    });

    it('respects x-forwarded-proto behind a proxy', async () => {
      const request = await toWebRequest({
        method: 'GET',
        url: '/x',
        headers: { host: 'app.example.com', 'x-forwarded-proto': 'https,http' },
      });
      // Getting this wrong would mark Secure cookies as insecure.
      expect(new URL(request.url).protocol).toBe('https:');
    });

    it('prefers originalUrl so app.use mounting still routes', async () => {
      const request = await toWebRequest({
        method: 'GET',
        url: '/session',
        originalUrl: '/api/auth/session',
        headers: { host: 'app.example.com' },
      });
      expect(new URL(request.url).pathname).toBe('/api/auth/session');
    });

    it('serializes a body already parsed by body-parser', async () => {
      const request = await toWebRequest({
        method: 'POST',
        url: '/api/auth/login',
        headers: { host: 'app.example.com', 'content-type': 'application/json' },
        body: { password: 'hunter2' },
      });
      await expect(request.json()).resolves.toEqual({ password: 'hunter2' });
    });

    it('reads an unparsed body from the stream', async () => {
      const req = {
        method: 'POST',
        url: '/api/auth/login',
        headers: { host: 'app.example.com' },
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('{"password":');
          yield new TextEncoder().encode('"hunter2"}');
        },
      } as unknown as NodeRequestLike;

      const request = await toWebRequest(req);
      await expect(request.json()).resolves.toEqual({ password: 'hunter2' });
    });
  });

  describe('sendWebResponse', () => {
    it('emits multiple Set-Cookie headers separately', async () => {
      const res = nodeResponse();
      const headers = new Headers();
      headers.append('Set-Cookie', 'a=1; HttpOnly');
      headers.append('Set-Cookie', 'b=2');
      headers.set('Content-Type', 'application/json');

      await sendWebResponse(res, new Response('{"ok":true}', { status: 201, headers }));

      expect(res.statusCode).toBe(201);
      // Folded into one string, browsers would reject them.
      expect(res.headers['set-cookie']).toEqual(['a=1; HttpOnly', 'b=2']);
      expect(res.headers['content-type']).toBe('application/json');
      expect(res.body).toBe('{"ok":true}');
    });
  });

  describe('middleware', () => {
    it('serves an auth route end to end', async () => {
      const adapter = createNodeAdapter(makeAuth());
      const res = nodeResponse();

      await adapter.middleware(
        {
          method: 'GET',
          url: '/api/auth/session',
          headers: { host: 'app.example.com', 'sec-fetch-site': 'same-origin' },
        },
        res,
      );

      expect(res.statusCode).toBe(401);
      expect(String(res.headers['set-cookie'])).toMatch(/csrf=/);
    });

    it('calls next for paths outside basePath', async () => {
      const adapter = createNodeAdapter(makeAuth());
      const next = jest.fn();
      const res = nodeResponse();

      await adapter.middleware(
        { method: 'GET', url: '/api/books', headers: { host: 'app.example.com' } },
        res,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(0);
    });

    it('404s outside basePath when there is no next', async () => {
      const adapter = createNodeAdapter(makeAuth());
      const res = nodeResponse();

      await adapter.middleware(
        { method: 'GET', url: '/api/books', headers: { host: 'app.example.com' } },
        res,
      );

      expect(res.statusCode).toBe(404);
    });

    it('reads the session from a Node request', async () => {
      const auth = makeAuth();
      const cookie = await signedInCookieHeader(auth);
      const adapter = createNodeAdapter(auth);

      await expect(
        adapter.getSession({ headers: { host: 'app.example.com', cookie } }),
      ).resolves.toEqual({ user: ADA, expiresAt: expect.any(Number) });
    });

    it('completes a login through the Node bridge', async () => {
      const auth = makeAuth();
      const adapter = createNodeAdapter(auth);

      // Bootstrap to obtain a CSRF token, exactly as a browser would.
      const bootstrap = nodeResponse();
      await adapter.middleware(
        {
          method: 'GET',
          url: '/api/auth/session',
          headers: { host: 'app.example.com', 'sec-fetch-site': 'same-origin' },
        },
        bootstrap,
      );
      const csrfCookie = (bootstrap.headers['set-cookie'] as string[])
        .map((c) => c.split(';')[0])
        .find((c) => c.startsWith('csrf='))!;
      const csrfValue = decodeURIComponent(csrfCookie.split('=')[1]);

      const login = nodeResponse();
      await adapter.middleware(
        {
          method: 'POST',
          url: '/api/auth/login',
          headers: {
            host: 'app.example.com',
            'sec-fetch-site': 'same-origin',
            'content-type': 'application/json',
            'x-csrf-token': csrfValue,
            cookie: csrfCookie,
          },
          body: { password: 'hunter2' },
        },
        login,
      );

      expect(login.statusCode).toBe(200);
      expect(JSON.parse(login.body!)).toEqual({ user: ADA, expiresAt: expect.any(Number) });
      expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly/);
    });
  });
});
