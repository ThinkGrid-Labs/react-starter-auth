import { SealedSession, Session } from '../core/types';
import { AuthHandlers } from '../server/handlers';

/**
 * Next.js adapter.
 *
 * Deliberately imports nothing from `next`. Everything it needs is duck-typed,
 * so Next never becomes a peer dependency and the adapter keeps working across
 * major versions that reshuffle their own exports.
 */

/** The shape of `cookies()` from `next/headers`, and of `request.cookies`. */
export interface CookieStoreLike {
  getAll(): Array<{ name: string; value: string }>;
}

export interface GuardOptions {
  /** Where to send signed-out visitors. Defaults to `/login`. */
  redirectTo?: string;
  /**
   * Which paths to protect. Defaults to protecting everything the middleware
   * is invoked for, which is usually what the `matcher` in your middleware
   * config already narrowed.
   */
  protect?: (pathname: string) => boolean;
  /**
   * Query parameter carrying the original path, so you can send them back
   * after sign-in. Pass `null` to omit it.
   */
  returnToParam?: string | null;
}

export interface NextAdapter<TUser> {
  /** Mount in `app/api/auth/[...auth]/route.ts`: `export const { GET, POST } = handlers`. */
  handlers: {
    GET: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
  };
  /** Read the session in a server component, server action or route handler. */
  getSession(store: CookieStoreLike): Promise<Session<TUser> | null>;
  /** Server-only: includes the access token, for calling your resource API. */
  getSealedSession(store: CookieStoreLike): Promise<SealedSession<TUser> | null>;
  /**
   * Middleware guard. Returns where to send a signed-out visitor, or `null` to
   * let the request continue. This is the real enforcement point — the
   * client-side guards are UX.
   *
   * A `URL` rather than a `Response` so the caller stays in one idiom: the
   * continue branch already needs `NextResponse.next()`, so building the
   * redirect the same way keeps middleware readable and leaves headers,
   * cookies and rewrites under the caller's control.
   *
   *   const to = await nextAuth.guard(request);
   *   return to ? NextResponse.redirect(to) : NextResponse.next();
   */
  guard(request: Request, options?: GuardOptions): Promise<URL | null>;
}

/**
 * Serialize a Next cookie store back into a `Cookie` header.
 *
 * Next hands back decoded values, and `parseCookies` decodes what it is given,
 * so the values are re-encoded to keep the round trip lossless.
 */
export function toCookieHeader(store: CookieStoreLike): string {
  return store
    .getAll()
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

export function createNextAdapter<TUser = Record<string, unknown>>(
  auth: AuthHandlers<TUser>,
): NextAdapter<TUser> {
  return {
    handlers: { GET: auth.handle, POST: auth.handle },

    getSession(store) {
      return auth.getSessionFromCookieHeader(toCookieHeader(store));
    },

    getSealedSession(store) {
      return auth.getSealedSessionFromCookieHeader(toCookieHeader(store));
    },

    async guard(request, options = {}) {
      const { redirectTo = '/login', protect, returnToParam = 'next' } = options;
      const url = new URL(request.url);

      if (protect && !protect(url.pathname)) return null;

      const session = await auth.getSession(request);
      if (session) return null;

      const target = new URL(redirectTo, url.origin);
      if (returnToParam) {
        target.searchParams.set(returnToParam, url.pathname + url.search);
      }
      return target;
    },
  };
}
