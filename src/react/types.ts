import { Credentials, Session } from '../core/types';

/**
 * One state machine, not two booleans.
 *
 * 0.1.x exposed `isLoading` and `isAuthenticated` as independent values, which
 * could contradict each other and made "still checking" indistinguishable from
 * "signed out". A single status makes the impossible states unrepresentable;
 * `isLoading` and `isAuthenticated` survive only as derived conveniences.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface ClientConfig {
  /** Where the server handlers are mounted. Must match the server's `basePath`. */
  basePath?: string;
  /**
   * CSRF cookie name, without the `__Host-` prefix. The client looks for the
   * prefixed name first, so this matches the server's `csrf.cookieName`
   * whether or not the deployment qualifies for the prefix.
   */
  csrfCookieName?: string;
  csrfHeaderName?: string;
  /**
   * How to navigate on redirect. Defaults to a full page load; pass your
   * router's push so client-side routing is preserved.
   *
   *   navigate: (path) => router.push(path)
   */
  navigate?: (path: string) => void;
  /** Re-check the session when the tab regains focus. Defaults to true. */
  revalidateOnFocus?: boolean;
  /** Refresh this many seconds before the access token expires. Defaults to 60. */
  refreshSkewSeconds?: number;
  /** Keep sign-in and sign-out in step across tabs. Defaults to true. */
  syncAcrossTabs?: boolean;
}

export interface ResolvedClientConfig {
  basePath: string;
  csrfCookieName: string;
  csrfHeaderName: string;
  navigate: (path: string) => void;
  revalidateOnFocus: boolean;
  refreshSkewSeconds: number;
  syncAcrossTabs: boolean;
}

export interface AuthState<TUser> {
  status: AuthStatus;
  user: TUser | null;
  /** Epoch milliseconds the access token expires, or null when signed out. */
  expiresAt: number | null;
}

export interface SignOutOptions {
  /** Where to go afterwards. Omit to stay put — sign-out no longer navigates by default. */
  redirectTo?: string;
}

export interface AuthContextValue<TUser> extends AuthState<TUser> {
  /** Derived from `status`. Cannot disagree with it. */
  isAuthenticated: boolean;
  /** Derived from `status`. Cannot disagree with it. */
  isLoading: boolean;
  /** POSTs credentials to your server. Never receives or stores a token. */
  signIn(credentials: Credentials): Promise<Session<TUser>>;
  signOut(options?: SignOutOptions): Promise<void>;
  /** Rotate tokens now. Returns null if the session is gone. */
  refresh(): Promise<Session<TUser> | null>;
  /** Re-read the session from the server. */
  revalidate(): Promise<Session<TUser> | null>;
}

const DEFAULTS: ResolvedClientConfig = {
  basePath: '/api/auth',
  csrfCookieName: 'csrf',
  csrfHeaderName: 'x-csrf-token',
  navigate: (path: string) => {
    if (typeof window !== 'undefined') window.location.assign(path);
  },
  revalidateOnFocus: true,
  refreshSkewSeconds: 60,
  syncAcrossTabs: true,
};

export function resolveClientConfig(config: ClientConfig = {}): ResolvedClientConfig {
  return {
    ...DEFAULTS,
    ...config,
    basePath: (config.basePath ?? DEFAULTS.basePath).replace(/\/$/, ''),
  };
}
