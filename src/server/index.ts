/**
 * Server entry point.
 *
 * Mount `handle` under your auth base path and the browser never sees a token:
 * it holds one HttpOnly session cookie, and learns who it is from `/session`.
 */

export { createAuthHandlers } from './handlers';
export type { AuthHandlers } from './handlers';

export type {
  AuthConfig,
  AuthResult,
  CookieOptions,
  Credentials,
  CsrfOptions,
  JwtOptions,
  SealedSession,
  Session,
  SessionOptions,
  SessionStore,
} from '../core/types';
