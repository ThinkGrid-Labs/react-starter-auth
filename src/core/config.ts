import { AuthConfig, ResolvedAuthConfig } from './types';
import { AuthError } from '../errors';

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;
const MIN_SECRET_LENGTH = 32;

/**
 * Read NODE_ENV without depending on Node's ambient types.
 *
 * This module has to compile and run on the edge, where `process` may not
 * exist, so it is looked up off `globalThis` rather than assumed.
 */
function readNodeEnv(): string | undefined {
  const global = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return global.process?.env?.NODE_ENV;
}

function isProductionLike(): boolean {
  const env = readNodeEnv();
  return env !== 'development' && env !== 'test';
}

/**
 * Apply defaults and reject configurations that are unsafe on their face.
 *
 * The checks here are the ones worth failing loudly at boot rather than
 * discovering in production: a short secret, or a cross-site cookie that has
 * had its CSRF protection switched off.
 */
export function resolveConfig<TUser>(config: AuthConfig<TUser>): ResolvedAuthConfig<TUser> {
  if (!config.secret || config.secret.length < MIN_SECRET_LENGTH) {
    throw new AuthError(
      `config.secret must be at least ${MIN_SECRET_LENGTH} characters. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }

  if (typeof config.authenticate !== 'function') {
    throw new AuthError('config.authenticate must be a function.');
  }

  const secure = config.cookie?.secure ?? isProductionLike();
  const sameSite = config.cookie?.sameSite ?? 'lax';
  const csrfEnabled = config.csrf?.enabled ?? true;

  if (sameSite === 'none' && !secure) {
    throw new AuthError('cookie.sameSite "none" requires cookie.secure. Serve over HTTPS.');
  }

  if (sameSite === 'none' && !csrfEnabled) {
    throw new AuthError(
      'cookie.sameSite "none" with csrf.enabled false leaves the session open to CSRF. ' +
        'Keep CSRF enabled for cross-site cookies.',
    );
  }

  const store = config.session?.store;
  // Supplying a store does not by itself move the session server-side: the
  // useful pairing is the storeless cookie plus a store used only to track
  // spent refresh tokens. Opting into 'store' has to be explicit.
  const strategy = config.session?.strategy ?? 'jwe';

  if (strategy === 'store' && !store) {
    throw new AuthError('session.strategy "store" requires session.store.');
  }

  return {
    secret: config.secret,
    cookie: {
      name: config.cookie?.name ?? 'session',
      path: config.cookie?.path ?? '/',
      domain: config.cookie?.domain,
      sameSite,
      secure,
      maxAge: config.cookie?.maxAge ?? SEVEN_DAYS_SECONDS,
    },
    csrf: {
      enabled: csrfEnabled,
      cookieName: config.csrf?.cookieName ?? 'csrf',
      headerName: config.csrf?.headerName ?? 'x-csrf-token',
      trustedOrigins: config.csrf?.trustedOrigins ?? [],
    },
    jwt: config.jwt,
    session: { strategy, store },
    basePath: (config.basePath ?? '/api/auth').replace(/\/$/, ''),
    authenticate: config.authenticate,
    refresh: config.refresh,
  };
}
