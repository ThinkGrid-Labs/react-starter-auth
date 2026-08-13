import { JWTPayload, createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

import { AuthError } from '../errors';
import { JwtOptions } from './types';

/**
 * Access-token verification.
 *
 * This is the piece the 0.1.x client never had. `isTokenValid` used to
 * base64-decode the payload and compare `exp`, which any forged token passes.
 * Here the signature is checked against a JWKS or a shared secret, with an
 * explicit algorithm allowlist so a token cannot nominate its own — the
 * `alg: none` and RS256-downgraded-to-HS256 attacks both die on that line.
 */

export type TokenVerifier = (token: string) => Promise<JWTPayload>;

type RemoteKeySet = ReturnType<typeof createRemoteJWKSet>;

const JWKS_CACHE = new Map<string, RemoteKeySet>();

function getKeySet(url: string): RemoteKeySet {
  let set = JWKS_CACHE.get(url);
  if (!set) {
    // jose caches and re-fetches on unknown `kid`, so this is built once.
    set = createRemoteJWKSet(new URL(url));
    JWKS_CACHE.set(url, set);
  }
  return set;
}

export function createTokenVerifier(options: JwtOptions): TokenVerifier {
  const { jwks, secret, issuer, audience, clockToleranceSec = 5 } = options;

  if (!jwks && !secret) {
    throw new AuthError('jwt options require either `jwks` or `secret` to verify tokens.');
  }
  if (jwks && secret) {
    throw new AuthError('jwt options accept `jwks` or `secret`, not both.');
  }

  const algorithms = options.algorithms ?? (jwks ? ['RS256', 'ES256'] : ['HS256']);
  if (algorithms.some((alg) => alg.toLowerCase() === 'none')) {
    throw new AuthError('jwt.algorithms must not include "none".');
  }

  const verifyOptions = {
    algorithms,
    clockTolerance: clockToleranceSec,
    ...(issuer ? { issuer } : {}),
    ...(audience ? { audience } : {}),
  };

  if (jwks) {
    const keySet = getKeySet(jwks);
    return async (token: string) => {
      const { payload } = await jwtVerify(token, keySet, verifyOptions);
      return payload;
    };
  }

  const key = new TextEncoder().encode(secret);
  return async (token: string) => {
    const { payload } = await jwtVerify(token, key, verifyOptions);
    return payload;
  };
}

/**
 * Read `exp` from an access token without verifying it.
 *
 * Only used to decide how long the session cookie should live. It is never an
 * authorization decision — that is `createTokenVerifier`'s job — so an
 * unverified read is safe here: the worst a bad value causes is a cookie with
 * an unhelpful lifetime.
 */
export function readExpiry(token: string): number | null {
  try {
    const { exp } = decodeJwt(token);
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Test seam. */
export function clearJwksCache(): void {
  JWKS_CACHE.clear();
}
