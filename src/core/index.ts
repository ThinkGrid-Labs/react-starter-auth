/**
 * Framework-agnostic primitives.
 *
 * Nothing here imports React or any server framework — only web standards
 * (`Request`, `Response`, `crypto`), so it runs unchanged in Node, on the edge
 * and in Workers.
 */

export { resolveConfig } from './config';
export { appendCookie, hostPrefixed, parseCookies, serializeCookie } from './cookies';
export type { SerializeOptions } from './cookies';
export {
  generateCsrfToken,
  isSafeMethod,
  safeEqual,
  verifyDoubleSubmit,
  verifyOrigin,
} from './csrf';
export type { CsrfCheckResult } from './csrf';
export { clearJwksCache, createTokenVerifier, readExpiry } from './jwt';
export type { TokenVerifier } from './jwt';
export {
  clearKeyCache,
  sealReference,
  sealSession,
  unsealReference,
  unsealSession,
} from './seal';
export type {
  AuthConfig,
  AuthResult,
  CookieOptions,
  Credentials,
  CsrfOptions,
  JwtOptions,
  ResolvedAuthConfig,
  SealedSession,
  Session,
  SessionOptions,
  SessionStore,
} from './types';
