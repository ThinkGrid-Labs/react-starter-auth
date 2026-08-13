/**
 * React client.
 *
 * The browser never holds a token here. `createAuthClient` talks to the
 * handlers from `@thinkgrid/react-starter-auth/server`, which keep the
 * credential in an HttpOnly cookie this code cannot read.
 */

export { createAuthClient } from './react/create-client';
export type {
  AuthClient,
  AuthProviderProps,
  RequireAuthOptions,
  SignedInProps,
} from './react/create-client';

export { createFetcher, readCsrfToken } from './react/fetcher';
export type { Fetcher, FetcherHooks } from './react/fetcher';

export { resolveClientConfig } from './react/types';
export type {
  AuthContextValue,
  AuthState,
  AuthStatus,
  ClientConfig,
  ResolvedClientConfig,
  SignOutOptions,
} from './react/types';

export { AuthError } from './errors';

// Re-exported so a client component can type a prop or a server-rendered
// `initialSession` without reaching into the /core subpath.
export type { Credentials, Session } from './core/types';
