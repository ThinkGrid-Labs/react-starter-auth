import { SealedSession, Session } from '../core/types';
import { AuthHandlers } from '../server/handlers';

/**
 * React Router 7 and Remix adapter.
 *
 * Loaders and actions already receive a standard `Request`, so most of this is
 * one line. The value it adds is `requireSession`, which follows the framework
 * idiom of *throwing* a redirect `Response` — that way a loader reads as
 * straight-line code with no early-return plumbing.
 */

export interface RequireSessionOptions {
  redirectTo?: string;
  /** Query parameter carrying the original path. Pass `null` to omit. */
  returnToParam?: string | null;
}

export interface DataRequest {
  request: Request;
}

export interface ReactRouterAdapter<TUser> {
  /**
   * Mount as both the loader and action of a splat route, e.g.
   * `routes/api.auth.$.ts`.
   */
  loader: (args: DataRequest) => Promise<Response>;
  action: (args: DataRequest) => Promise<Response>;
  getSession(request: Request): Promise<Session<TUser> | null>;
  getSealedSession(request: Request): Promise<SealedSession<TUser> | null>;
  /**
   * Return the session, or throw a redirect for signed-out visitors.
   *
   * Throwing is the loader convention — React Router catches a thrown
   * `Response` and honours it, so callers get a non-null session back.
   */
  requireSession(request: Request, options?: RequireSessionOptions): Promise<Session<TUser>>;
  /** As above, but yields the access token for calling your resource API. */
  requireSealedSession(
    request: Request,
    options?: RequireSessionOptions,
  ): Promise<SealedSession<TUser>>;
}

function redirectTo(request: Request, options: RequireSessionOptions): Response {
  const { redirectTo: destination = '/login', returnToParam = 'next' } = options;
  const url = new URL(request.url);
  const target = new URL(destination, url.origin);
  if (returnToParam) {
    target.searchParams.set(returnToParam, url.pathname + url.search);
  }
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}

export function createReactRouterAdapter<TUser = Record<string, unknown>>(
  auth: AuthHandlers<TUser>,
): ReactRouterAdapter<TUser> {
  const handle = ({ request }: DataRequest) => auth.handle(request);

  return {
    loader: handle,
    action: handle,

    getSession: auth.getSession,
    getSealedSession: auth.getSealedSession,

    async requireSession(request, options = {}) {
      const session = await auth.getSession(request);
      if (!session) throw redirectTo(request, options);
      return session;
    },

    async requireSealedSession(request, options = {}) {
      const sealed = await auth.getSealedSession(request);
      if (!sealed || sealed.expiresAt <= Date.now()) throw redirectTo(request, options);
      return sealed;
    },
  };
}
