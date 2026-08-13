import { resolveConfig } from '../core/config';
import { appendCookie, hostPrefixed, parseCookies, serializeCookie } from '../core/cookies';
import {
  generateCsrfToken,
  isSafeMethod,
  verifyDoubleSubmit,
  verifyOrigin,
} from '../core/csrf';
import { TokenVerifier, createTokenVerifier, readExpiry } from '../core/jwt';
import { sealReference, sealSession, unsealReference, unsealSession } from '../core/seal';
import {
  AuthConfig,
  AuthResult,
  ResolvedAuthConfig,
  SealedSession,
  Session,
} from '../core/types';

export interface AuthHandlers<TUser> {
  /** Route any request under `basePath` to the right handler. */
  handle(request: Request): Promise<Response>;
  /**
   * Public session for SSR — user and expiry, never a token. Pass the result
   * straight into `<AuthProvider initialSession={...}>`.
   */
  getSession(request: Request): Promise<Session<TUser> | null>;
  /**
   * Server-only session including the access token, for calling your resource
   * API from a loader, server component or route handler. Never serialize this
   * into a response body.
   */
  getSealedSession(request: Request): Promise<SealedSession<TUser> | null>;
  /**
   * Same as `getSession`, from a raw `Cookie` header.
   *
   * Server components and Node middleware often have cookies without a
   * `Request` to hang them on — this is what the framework adapters build on,
   * so none of them has to fabricate a `Request`.
   */
  getSessionFromCookieHeader(header: string | null | undefined): Promise<Session<TUser> | null>;
  getSealedSessionFromCookieHeader(
    header: string | null | undefined,
  ): Promise<SealedSession<TUser> | null>;
  /** Cookie names in use, after any `__Host-` prefixing. */
  cookieNames: { session: string; csrf: string };
  /** Where these handlers expect to be mounted. Adapters route against it. */
  basePath: string;
}

function json(body: unknown, status = 200, headers?: Headers): Response {
  const merged = headers ?? new Headers();
  merged.set('Content-Type', 'application/json');
  // Session state must never be cached by a proxy or the browser.
  merged.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: merged });
}

/** Public projection. The single place a session becomes client-visible. */
function toPublicSession<TUser>(session: SealedSession<TUser>): Session<TUser> {
  return { user: session.user, expiresAt: session.expiresAt };
}

export function createAuthHandlers<TUser = Record<string, unknown>>(
  config: AuthConfig<TUser>,
): AuthHandlers<TUser> {
  const resolved: ResolvedAuthConfig<TUser> = resolveConfig(config);
  const { cookie, csrf, session: sessionOpts } = resolved;

  const sessionCookieName = hostPrefixed(cookie.name, cookie);
  const csrfCookieName = hostPrefixed(csrf.cookieName, cookie);

  // Built once so a bad jwt config throws at startup, not on first request.
  let verifyAccessToken: TokenVerifier | undefined;
  if (resolved.jwt) {
    verifyAccessToken = createTokenVerifier(resolved.jwt);
  }

  const baseCookieOptions = {
    path: cookie.path,
    domain: cookie.domain,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
  };

  function setSessionCookie(headers: Headers, value: string, maxAge: number): void {
    appendCookie(
      headers,
      serializeCookie(sessionCookieName, value, {
        ...baseCookieOptions,
        httpOnly: true,
        maxAge,
      }),
    );
  }

  function setCsrfCookie(headers: Headers, token: string): void {
    appendCookie(
      headers,
      serializeCookie(csrfCookieName, token, {
        ...baseCookieOptions,
        // Readable by design: the client has to echo it back in a header.
        httpOnly: false,
        maxAge: cookie.maxAge,
      }),
    );
  }

  function clearCookies(headers: Headers): void {
    for (const name of [sessionCookieName, csrfCookieName]) {
      appendCookie(
        headers,
        serializeCookie(name, '', {
          ...baseCookieOptions,
          httpOnly: name === sessionCookieName,
          maxAge: 0,
        }),
      );
    }
  }

  /**
   * How long the session cookie should live.
   *
   * With refresh configured the cookie spans the whole refresh window. Without
   * it, the cookie dies exactly when the access token does — so a stale cookie
   * can never outlive the credential inside it.
   */
  function sessionTtlSeconds(expiresAt: number): number {
    if (resolved.refresh) return cookie.maxAge;
    const untilExpiry = Math.floor((expiresAt - Date.now()) / 1000);
    return Math.max(1, Math.min(cookie.maxAge, untilExpiry));
  }

  function resolveExpiry(result: AuthResult<TUser>): number {
    return result.expiresAt ?? readExpiry(result.accessToken) ?? Date.now() + cookie.maxAge * 1000;
  }

  /**
   * `existingSid` keeps the session id stable across a refresh. Only the tokens
   * rotate — the session itself continues, which is what makes refresh-token
   * reuse detectable and what lets a "your active sessions" UI stay coherent.
   */
  async function persist(
    result: AuthResult<TUser>,
    headers: Headers,
    existingSid?: string,
  ): Promise<Session<TUser>> {
    const expiresAt = resolveExpiry(result);
    const sealed: SealedSession<TUser> = {
      user: result.user,
      expiresAt,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
    const ttl = sessionTtlSeconds(expiresAt);

    if (sessionOpts.strategy === 'store' && sessionOpts.store) {
      const sid = existingSid ?? crypto.randomUUID();
      await sessionOpts.store.set(sid, sealed, ttl);
      setSessionCookie(headers, await sealReference(sid, resolved.secret, ttl), ttl);
    } else {
      setSessionCookie(headers, await sealSession(sealed, resolved.secret, ttl), ttl);
    }

    return toPublicSession(sealed);
  }

  async function readSealedFromCookieHeader(
    header: string | null | undefined,
  ): Promise<SealedSession<TUser> | null> {
    const cookies = parseCookies(header);
    const raw = cookies[sessionCookieName];
    if (!raw) return null;

    if (sessionOpts.strategy === 'store' && sessionOpts.store) {
      const sid = await unsealReference(raw, resolved.secret);
      if (!sid) return null;
      return sessionOpts.store.get(sid);
    }
    return unsealSession<TUser>(raw, resolved.secret);
  }

  function readSealed(request: Request): Promise<SealedSession<TUser> | null> {
    return readSealedFromCookieHeader(request.headers.get('cookie'));
  }

  async function destroyStoredSession(request: Request): Promise<void> {
    if (sessionOpts.strategy !== 'store' || !sessionOpts.store) return;
    const cookies = parseCookies(request.headers.get('cookie'));
    const raw = cookies[sessionCookieName];
    if (!raw) return;
    const sid = await unsealReference(raw, resolved.secret);
    if (sid) await sessionOpts.store.destroy(sid);
  }

  /** Both CSRF checks, run together on every unsafe request. */
  function guardCsrf(request: Request): Response | null {
    if (!csrf.enabled || isSafeMethod(request.method)) return null;

    const origin = verifyOrigin(request, csrf.trustedOrigins);
    if (!origin.ok) {
      return json({ error: 'csrf_failed', detail: origin.reason }, 403);
    }

    const cookies = parseCookies(request.headers.get('cookie'));
    const doubleSubmit = verifyDoubleSubmit(request, cookies[csrfCookieName], csrf.headerName);
    if (!doubleSubmit.ok) {
      return json({ error: 'csrf_failed', detail: doubleSubmit.reason }, 403);
    }
    return null;
  }

  async function login(request: Request): Promise<Response> {
    const blocked = guardCsrf(request);
    if (blocked) return blocked;

    let credentials: Record<string, unknown>;
    try {
      credentials = (await request.json()) as Record<string, unknown>;
    } catch {
      return json({ error: 'invalid_request', detail: 'body must be JSON' }, 400);
    }

    const result = await resolved.authenticate(credentials, request);
    // One generic failure for every cause — never reveal which field was wrong.
    if (!result) return json({ error: 'invalid_credentials' }, 401);

    if (verifyAccessToken) {
      try {
        await verifyAccessToken(result.accessToken);
      } catch {
        return json({ error: 'invalid_token', detail: 'access token failed verification' }, 502);
      }
    }

    const headers = new Headers();
    const session = await persist(result, headers);
    // Rotate the CSRF token on privilege change, so a token an attacker may
    // have observed pre-login is useless afterwards.
    setCsrfCookie(headers, generateCsrfToken());
    return json(session, 200, headers);
  }

  async function readSession(request: Request): Promise<Response> {
    const cookies = parseCookies(request.headers.get('cookie'));
    const headers = new Headers();

    // Issue a CSRF token on this GET so the client always holds one before it
    // needs to POST. Clients call /session on mount, so this is the natural
    // place for it and saves them a separate round trip.
    if (csrf.enabled && !cookies[csrfCookieName]) {
      setCsrfCookie(headers, generateCsrfToken());
    }

    const sealed = await readSealed(request);
    if (!sealed) return json({ error: 'unauthenticated' }, 401, headers);

    if (sealed.expiresAt <= Date.now()) {
      return json({ error: 'session_expired' }, 401, headers);
    }

    return json(toPublicSession(sealed), 200, headers);
  }

  async function refresh(request: Request): Promise<Response> {
    const blocked = guardCsrf(request);
    if (blocked) return blocked;

    if (!resolved.refresh) {
      return json({ error: 'refresh_not_supported' }, 404);
    }

    const store = sessionOpts.store;
    const cookies = parseCookies(request.headers.get('cookie'));
    const raw = cookies[sessionCookieName];

    // Resolve the session id up front: it has to survive rotation, and it is
    // what we destroy if this turns out to be a replay.
    let sid: string | null = null;
    let sealed: SealedSession<TUser> | null = null;
    if (raw) {
      if (sessionOpts.strategy === 'store' && store) {
        sid = await unsealReference(raw, resolved.secret);
        sealed = sid ? await store.get(sid) : null;
      } else {
        sealed = await unsealSession<TUser>(raw, resolved.secret);
      }
    }

    const unauthenticated = (error: string): Response => {
      const headers = new Headers();
      clearCookies(headers);
      return json({ error }, 401, headers);
    };

    if (!sealed?.refreshToken) return unauthenticated('unauthenticated');

    /**
     * Reuse detection, when a store is configured.
     *
     * This matters most with the storeless strategy, where the refresh token
     * travels inside the cookie: an attacker who copies the cookie can replay
     * it, and a token that has already been spent proves that happened. Upstream
     * identity providers usually also detect reuse themselves — a `null` from
     * the refresh callback is handled below.
     */
    if (store?.consumeRefreshToken) {
      const unspent = await store.consumeRefreshToken(sealed.refreshToken);
      if (!unspent) {
        // Assume theft: kill the session rather than issue another pair.
        if (sid) await store.destroy(sid);
        return unauthenticated('refresh_token_reused');
      }
    }

    const result = await resolved.refresh(sealed.refreshToken, request);
    if (!result) {
      if (sid && store) await store.destroy(sid);
      return unauthenticated('refresh_failed');
    }

    if (verifyAccessToken) {
      try {
        await verifyAccessToken(result.accessToken);
      } catch {
        return json({ error: 'invalid_token', detail: 'access token failed verification' }, 502);
      }
    }

    const headers = new Headers();
    const session = await persist(result, headers, sid ?? undefined);
    return json(session, 200, headers);
  }

  async function logout(request: Request): Promise<Response> {
    const blocked = guardCsrf(request);
    if (blocked) return blocked;

    await destroyStoredSession(request);
    const headers = new Headers();
    clearCookies(headers);
    return json({ ok: true }, 200, headers);
  }

  function issueCsrf(request: Request): Response {
    const cookies = parseCookies(request.headers.get('cookie'));
    const existing = cookies[csrfCookieName];
    const token = existing ?? generateCsrfToken();
    const headers = new Headers();
    if (!existing) setCsrfCookie(headers, token);
    return json({ token }, 200, headers);
  }

  async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const route = pathname.startsWith(resolved.basePath)
      ? pathname.slice(resolved.basePath.length) || '/'
      : pathname;
    const method = request.method.toUpperCase();

    switch (route) {
      case '/login':
        return method === 'POST' ? login(request) : methodNotAllowed('POST');
      case '/logout':
        return method === 'POST' ? logout(request) : methodNotAllowed('POST');
      case '/session':
        return method === 'GET' ? readSession(request) : methodNotAllowed('GET');
      case '/refresh':
        return method === 'POST' ? refresh(request) : methodNotAllowed('POST');
      case '/csrf':
        return method === 'GET' ? issueCsrf(request) : methodNotAllowed('GET');
      default:
        return json({ error: 'not_found' }, 404);
    }
  }

  function methodNotAllowed(allowed: string): Response {
    const headers = new Headers({ Allow: allowed });
    return json({ error: 'method_not_allowed' }, 405, headers);
  }

  /** Expired sessions read as absent — callers get null, never a dead session. */
  function livePublicSession(sealed: SealedSession<TUser> | null): Session<TUser> | null {
    if (!sealed || sealed.expiresAt <= Date.now()) return null;
    return toPublicSession(sealed);
  }

  return {
    handle,
    getSealedSession: readSealed,
    getSealedSessionFromCookieHeader: readSealedFromCookieHeader,
    async getSession(request: Request) {
      return livePublicSession(await readSealed(request));
    },
    async getSessionFromCookieHeader(header) {
      return livePublicSession(await readSealedFromCookieHeader(header));
    },
    cookieNames: { session: sessionCookieName, csrf: csrfCookieName },
    basePath: resolved.basePath,
  };
}
