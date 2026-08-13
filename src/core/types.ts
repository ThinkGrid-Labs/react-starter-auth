/**
 * The session contract.
 *
 * There are deliberately two session types. `Session` is what the browser is
 * allowed to see and is the only thing the `/session` endpoint ever returns —
 * it carries no credential of any kind. `SealedSession` adds the tokens and
 * exists only inside the encrypted cookie and on the server.
 *
 * Keeping them apart at the type level is what stops a token from leaking into
 * a JSON response by accident later on.
 */

/** Public session state. Safe to send to the browser. Never contains a token. */
export interface Session<TUser = Record<string, unknown>> {
  user: TUser;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
}

/** Server-side session. Lives encrypted in the cookie and never leaves the server. */
export interface SealedSession<TUser = Record<string, unknown>> extends Session<TUser> {
  accessToken: string;
  refreshToken?: string;
}

/** What your `authenticate` / `refresh` callbacks hand back. */
export interface AuthResult<TUser = Record<string, unknown>> {
  user: TUser;
  accessToken: string;
  refreshToken?: string;
  /**
   * Epoch milliseconds. Optional — when omitted it is read from the access
   * token's own `exp` claim, so cookie lifetime always tracks token lifetime.
   */
  expiresAt?: number;
}

export interface CookieOptions {
  /**
   * Base cookie name. When the cookie is `Secure` with `path: '/'` and no
   * domain, a `__Host-` prefix is added automatically — browsers then refuse
   * any cross-subdomain overwrite of it.
   */
  name?: string;
  path?: string;
  domain?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  /** Defaults to `true` unless NODE_ENV is 'development' or 'test'. */
  secure?: boolean;
  /** Session window in seconds. Defaults to 7 days. */
  maxAge?: number;
}

export interface CsrfOptions {
  enabled?: boolean;
  /** Readable by JS on purpose — the client echoes it back in a header. */
  cookieName?: string;
  headerName?: string;
  /** Extra origins allowed to submit, beyond the request's own origin. */
  trustedOrigins?: string[];
}

export interface JwtOptions {
  /** JWKS endpoint for asymmetric verification (RSA / ECDSA). */
  jwks?: string;
  /** Shared secret for symmetric (HS*) verification. */
  secret?: string;
  issuer?: string;
  audience?: string;
  /**
   * Explicit algorithm allowlist. Defaults to RS256/ES256 for JWKS and HS256
   * for a shared secret — never `none`, and never caller-controlled.
   */
  algorithms?: string[];
  clockToleranceSec?: number;
}

/**
 * Optional server-side session store. Supply one when you need revocable
 * sessions or refresh-token reuse detection; without it the session is a
 * self-contained encrypted cookie and nothing is kept server-side.
 */
export interface SessionStore<TUser = Record<string, unknown>> {
  get(id: string): Promise<SealedSession<TUser> | null>;
  set(id: string, session: SealedSession<TUser>, ttlSeconds: number): Promise<void>;
  destroy(id: string): Promise<void>;
  /**
   * Mark a refresh token as spent. Return `false` if it was already spent —
   * that is a reuse, and the caller destroys the whole session.
   *
   * Reuse detection is impossible without state, so it only runs when a store
   * is configured. It is most valuable alongside the storeless `'jwe'`
   * strategy, where the refresh token travels in the cookie and a copied
   * cookie can therefore be replayed. Rotation happens either way.
   */
  consumeRefreshToken?(token: string): Promise<boolean>;
}

export interface SessionOptions<TUser = Record<string, unknown>> {
  strategy?: 'jwe' | 'store';
  store?: SessionStore<TUser>;
}

export type Credentials = Record<string, unknown>;

export interface AuthConfig<TUser = Record<string, unknown>> {
  /**
   * Encryption key for the session cookie. Must be at least 32 characters.
   * Rotating it signs everybody out.
   */
  secret: string;
  cookie?: CookieOptions;
  csrf?: CsrfOptions;
  jwt?: JwtOptions;
  session?: SessionOptions<TUser>;
  /** Path the handlers are mounted at. Defaults to `/api/auth`. */
  basePath?: string;

  /**
   * Exchange credentials for tokens. Return `null` to reject the attempt —
   * the handler answers 401 without leaking which part was wrong.
   */
  authenticate(credentials: Credentials, request: Request): Promise<AuthResult<TUser> | null>;

  /** Exchange a refresh token for a fresh pair. Omit to disable refresh. */
  refresh?(refreshToken: string, request: Request): Promise<AuthResult<TUser> | null>;
}

/** Config after defaults are applied. Every field is present. */
export interface ResolvedAuthConfig<TUser = Record<string, unknown>> {
  secret: string;
  cookie: Required<Pick<CookieOptions, 'name' | 'path' | 'sameSite' | 'secure' | 'maxAge'>> & {
    domain?: string;
  };
  csrf: Required<Pick<CsrfOptions, 'enabled' | 'cookieName' | 'headerName'>> & {
    trustedOrigins: string[];
  };
  jwt?: JwtOptions;
  session: SessionOptions<TUser>;
  basePath: string;
  authenticate: AuthConfig<TUser>['authenticate'];
  refresh?: AuthConfig<TUser>['refresh'];
}
