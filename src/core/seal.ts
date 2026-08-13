import { EncryptJWT, jwtDecrypt } from 'jose';

import { SealedSession } from './types';

/**
 * Encrypted session cookies.
 *
 * The cookie is a JWE (`dir` + `A256GCM`), not a signed JWT: the payload holds
 * the access and refresh tokens, so it has to be unreadable to anyone who
 * obtains the cookie, not merely tamper-evident. AES-GCM also authenticates,
 * so a modified cookie fails to decrypt rather than decoding to garbage.
 */

const KEY_CACHE = new Map<string, Uint8Array>();

async function deriveKey(secret: string): Promise<Uint8Array> {
  const cached = KEY_CACHE.get(secret);
  if (cached) return cached;

  // A256GCM needs exactly 32 bytes; SHA-256 of the secret gives that for any
  // secret length without forcing the caller to supply raw key material.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = new Uint8Array(digest);
  KEY_CACHE.set(secret, key);
  return key;
}

async function seal(
  data: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const key = await deriveKey(secret);
  const nowSeconds = Math.floor(Date.now() / 1000);

  return new EncryptJWT({ data })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + Math.max(1, Math.floor(ttlSeconds)))
    .encrypt(key);
}

/**
 * Returns `null` for anything that isn't valid and unexpired — wrong key,
 * tampered ciphertext, expired `exp`, unexpected shape. Callers treat `null`
 * as "signed out" rather than distinguishing the cases, so a probing attacker
 * learns nothing from the difference.
 */
async function unseal<T>(token: string, secret: string): Promise<T | null> {
  if (!token) return null;

  try {
    const key = await deriveKey(secret);
    const { payload } = await jwtDecrypt(token, key, {
      contentEncryptionAlgorithms: ['A256GCM'],
      keyManagementAlgorithms: ['dir'],
    });

    const data = payload.data;
    if (!data || typeof data !== 'object') return null;
    return data as T;
  } catch {
    return null;
  }
}

/** Encrypt a full session into the cookie (the default, storeless strategy). */
export function sealSession<TUser>(
  session: SealedSession<TUser>,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return seal(session as unknown as Record<string, unknown>, secret, ttlSeconds);
}

export async function unsealSession<TUser>(
  token: string,
  secret: string,
): Promise<SealedSession<TUser> | null> {
  const session = await unseal<SealedSession<TUser>>(token, secret);
  if (!session) return null;
  if (typeof session.accessToken !== 'string' || !session.accessToken) return null;
  if (typeof session.expiresAt !== 'number') return null;
  return session;
}

/** Encrypt a session-store reference. Used when `session.strategy` is 'store'. */
export function sealReference(
  sessionId: string,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return seal({ sid: sessionId }, secret, ttlSeconds);
}

export async function unsealReference(token: string, secret: string): Promise<string | null> {
  const ref = await unseal<{ sid?: unknown }>(token, secret);
  if (!ref || typeof ref.sid !== 'string' || !ref.sid) return null;
  return ref.sid;
}

/** Test seam — the key cache is keyed by secret and never invalidated otherwise. */
export function clearKeyCache(): void {
  KEY_CACHE.clear();
}
