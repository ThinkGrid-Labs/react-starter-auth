import * as React from 'react';

import { AuthError } from '../errors';
import { Credentials, Session } from '../core/types';
import { Fetcher, createFetcher, readCsrfToken } from './fetcher';
import {
  AuthContextValue,
  AuthState,
  AuthStatus,
  ClientConfig,
  ResolvedClientConfig,
  SignOutOptions,
  resolveClientConfig,
} from './types';

export interface AuthProviderProps<TUser> {
  children: React.ReactNode;
  /**
   * Session resolved on the server. Pass it and the first client render is
   * already correct — no loading flash, no hydration mismatch, no fetch on
   * mount. `null` means "server checked, nobody is signed in". Omit it
   * entirely (undefined) to fetch on mount instead.
   */
  initialSession?: Session<TUser> | null;
}

export interface RequireAuthOptions {
  redirectTo?: string;
}

export interface SignedInProps {
  children: React.ReactNode;
  /** Shown while the session is still loading, or when signed out. */
  fallback?: React.ReactNode;
}

export interface AuthClient<TUser> {
  AuthProvider: React.FC<AuthProviderProps<TUser>>;
  useAuth: () => AuthContextValue<TUser>;
  useRequireAuth: (options?: RequireAuthOptions) => AuthStatus;
  SignedIn: React.FC<SignedInProps>;
  SignedOut: React.FC<{ children: React.ReactNode }>;
  fetcher: Fetcher;
  config: ResolvedClientConfig;
}

function stateFrom<TUser>(session: Session<TUser> | null | undefined): AuthState<TUser> {
  if (session === undefined) return { status: 'loading', user: null, expiresAt: null };
  if (session === null) return { status: 'unauthenticated', user: null, expiresAt: null };
  return { status: 'authenticated', user: session.user, expiresAt: session.expiresAt };
}

/**
 * Build a typed auth client.
 *
 * A factory rather than loose exports for two reasons. Config is declared once
 * instead of threaded through props at every call site, and `TUser` is fixed
 * here — so `useAuth()` infers your user type instead of each call site
 * asserting its own, which is what made 0.1.x's `useAuth<T>()` unsound.
 */
export function createAuthClient<TUser = Record<string, unknown>>(
  clientConfig: ClientConfig = {},
): AuthClient<TUser> {
  const config = resolveClientConfig(clientConfig);
  const Context = React.createContext<AuthContextValue<TUser> | null>(null);
  const channelName = `react-starter-auth:${config.basePath}`;

  async function readSession(): Promise<Session<TUser> | null> {
    const response = await fetch(`${config.basePath}/session`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as Session<TUser>;
  }

  /**
   * The server issues the CSRF cookie on `GET /session`. When the app was
   * server-rendered with `initialSession` that request never happened, so the
   * token has to be fetched before the first unsafe request.
   */
  async function ensureCsrfToken(): Promise<string | null> {
    const existing = readCsrfToken(config.csrfCookieName);
    if (existing) return existing;
    try {
      await fetch(`${config.basePath}/csrf`, { method: 'GET', credentials: 'include' });
    } catch {
      return null;
    }
    return readCsrfToken(config.csrfCookieName);
  }

  const AuthProvider: React.FC<AuthProviderProps<TUser>> = ({ children, initialSession }) => {
    const [state, setState] = React.useState<AuthState<TUser>>(() => stateFrom(initialSession));

    // Held in a ref so the callbacks below never need it as a dependency, which
    // keeps the context value stable across unrelated re-renders.
    const stateRef = React.useRef(state);
    stateRef.current = state;

    const apply = React.useCallback((session: Session<TUser> | null) => {
      setState(stateFrom(session));
      return session;
    }, []);

    const revalidate = React.useCallback(async () => {
      try {
        return apply(await readSession());
      } catch {
        // A network blip should not silently sign the user out.
        return stateRef.current.status === 'authenticated'
          ? { user: stateRef.current.user as TUser, expiresAt: stateRef.current.expiresAt as number }
          : apply(null);
      }
    }, [apply]);

    const refresh = React.useCallback(async () => {
      const token = await ensureCsrfToken();
      const response = await fetch(`${config.basePath}/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: token ? { [config.csrfHeaderName]: token } : undefined,
      });
      if (!response.ok) return apply(null);
      return apply((await response.json()) as Session<TUser>);
    }, [apply]);

    const signIn = React.useCallback(
      async (credentials: Credentials) => {
        const token = await ensureCsrfToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers[config.csrfHeaderName] = token;

        const response = await fetch(`${config.basePath}/login`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(credentials),
        });

        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new AuthError(
            (detail as { error?: string }).error ?? `Sign in failed (${response.status})`,
          );
        }

        const session = (await response.json()) as Session<TUser>;
        apply(session);
        broadcast('signin');
        return session;
      },
      [apply],
    );

    const signOut = React.useCallback(
      async (options: SignOutOptions = {}) => {
        const token = await ensureCsrfToken();
        try {
          await fetch(`${config.basePath}/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: token ? { [config.csrfHeaderName]: token } : undefined,
          });
        } finally {
          // Local state drops regardless: if the request failed the cookie may
          // still be live, but continuing to render a signed-in UI is worse.
          apply(null);
          broadcast('signout');
        }
        if (options.redirectTo) config.navigate(options.redirectTo);
      },
      [apply],
    );

    // Fetch on mount only when the server did not hand us a session.
    React.useEffect(() => {
      if (initialSession === undefined) void revalidate();
      // Deliberately mount-only: `initialSession` is an initial value, and
      // re-running this on a new object identity would refetch on every render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Refresh shortly before the access token expires, so a long-lived tab
    // never sits on a dead token waiting for a request to fail.
    React.useEffect(() => {
      if (state.status !== 'authenticated' || state.expiresAt === null) return undefined;
      const delay = state.expiresAt - Date.now() - config.refreshSkewSeconds * 1000;
      const timer = setTimeout(() => void refresh(), Math.max(0, delay));
      return () => clearTimeout(timer);
    }, [state.status, state.expiresAt, refresh]);

    React.useEffect(() => {
      if (!config.revalidateOnFocus || typeof window === 'undefined') return undefined;
      const onFocus = () => {
        if (document.visibilityState === 'visible') void revalidate();
      };
      window.addEventListener('visibilitychange', onFocus);
      window.addEventListener('focus', onFocus);
      return () => {
        window.removeEventListener('visibilitychange', onFocus);
        window.removeEventListener('focus', onFocus);
      };
    }, [revalidate]);

    // Sign out in one tab, sign out in all of them.
    React.useEffect(() => {
      if (!config.syncAcrossTabs || typeof BroadcastChannel === 'undefined') return undefined;
      const channel = new BroadcastChannel(channelName);
      channel.onmessage = (event: MessageEvent<string>) => {
        if (event.data === 'signout') apply(null);
        if (event.data === 'signin') void revalidate();
      };
      return () => channel.close();
    }, [apply, revalidate]);

    const value = React.useMemo<AuthContextValue<TUser>>(
      () => ({
        ...state,
        isAuthenticated: state.status === 'authenticated',
        isLoading: state.status === 'loading',
        signIn,
        signOut,
        refresh,
        revalidate,
      }),
      [state, signIn, signOut, refresh, revalidate],
    );

    return <Context.Provider value={value}>{children}</Context.Provider>;
  };
  AuthProvider.displayName = 'AuthProvider';

  function broadcast(message: 'signin' | 'signout'): void {
    if (!config.syncAcrossTabs || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(channelName);
    channel.postMessage(message);
    channel.close();
  }

  function useAuth(): AuthContextValue<TUser> {
    const context = React.useContext(Context);
    if (context === null) {
      throw new AuthError('useAuth was called outside AuthProvider. Wrap your app in it.');
    }
    return context;
  }

  /**
   * Redirect signed-out visitors.
   *
   * A UX affordance, not access control: it runs in the browser, after render.
   * Authorize on the server for anything that matters.
   */
  function useRequireAuth(options: RequireAuthOptions = {}): AuthStatus {
    const { status } = useAuth();
    const redirectTo = options.redirectTo ?? '/login';

    React.useEffect(() => {
      if (status === 'unauthenticated') config.navigate(redirectTo);
    }, [status, redirectTo]);

    return status;
  }

  const SignedIn: React.FC<SignedInProps> = ({ children, fallback = null }) => {
    const { status } = useAuth();
    // Renders the fallback while loading, so nothing flashes before we know.
    return <>{status === 'authenticated' ? children : fallback}</>;
  };
  SignedIn.displayName = 'SignedIn';

  const SignedOut: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { status } = useAuth();
    return <>{status === 'unauthenticated' ? children : null}</>;
  };
  SignedOut.displayName = 'SignedOut';

  const fetcher = createFetcher(config, {});

  return { AuthProvider, useAuth, useRequireAuth, SignedIn, SignedOut, fetcher, config };
}
