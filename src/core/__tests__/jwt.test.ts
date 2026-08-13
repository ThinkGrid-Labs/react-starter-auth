/**
 * @jest-environment node
 */
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createServer } from 'node:http';
import type { Server } from 'node:http';

import { clearJwksCache, createTokenVerifier, readExpiry } from '../jwt';

const SECRET = 'shared-secret-that-is-long-enough-for-hs256';
const key = new TextEncoder().encode(SECRET);

async function signToken(
  claims: Record<string, unknown> = {},
  { expiresIn = '1h', alg = 'HS256' } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

describe('createTokenVerifier', () => {
  afterEach(() => clearJwksCache());

  it('accepts a correctly signed token', async () => {
    const verify = createTokenVerifier({ secret: SECRET });
    const payload = await verify(await signToken({ sub: 'user-1' }));
    expect(payload.sub).toBe('user-1');
  });

  it('rejects a token signed with the wrong key', async () => {
    const verify = createTokenVerifier({ secret: SECRET });
    const foreign = await new SignJWT({ sub: 'attacker' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-completely-different-secret-value'));

    await expect(verify(foreign)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const verify = createTokenVerifier({ secret: SECRET });
    const expired = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key);

    await expect(verify(expired)).rejects.toThrow();
  });

  it('rejects the alg:none downgrade', async () => {
    const verify = createTokenVerifier({ secret: SECRET });
    // header {"alg":"none"}, payload {"sub":"admin"}, empty signature
    const unsigned = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.';
    await expect(verify(unsigned)).rejects.toThrow();
  });

  it('rejects an algorithm outside the allowlist', async () => {
    const verify = createTokenVerifier({ secret: SECRET, algorithms: ['HS512'] });
    await expect(verify(await signToken({ sub: 'user-1' }))).rejects.toThrow();
  });

  it('enforces issuer and audience when configured', async () => {
    const verify = createTokenVerifier({
      secret: SECRET,
      issuer: 'https://issuer.example',
      audience: 'my-api',
    });

    const good = await new SignJWT({ sub: 'u' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://issuer.example')
      .setAudience('my-api')
      .setExpirationTime('1h')
      .sign(key);
    await expect(verify(good)).resolves.toMatchObject({ sub: 'u' });

    const wrongIssuer = await new SignJWT({ sub: 'u' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('https://evil.example')
      .setAudience('my-api')
      .setExpirationTime('1h')
      .sign(key);
    await expect(verify(wrongIssuer)).rejects.toThrow();
  });

  it('refuses to build a verifier that would accept "none"', () => {
    expect(() => createTokenVerifier({ secret: SECRET, algorithms: ['none'] })).toThrow(
      /must not include "none"/,
    );
  });

  it('requires exactly one of jwks or secret', () => {
    expect(() => createTokenVerifier({})).toThrow(/either `jwks` or `secret`/);
    expect(() =>
      createTokenVerifier({ secret: SECRET, jwks: 'https://example.com/jwks.json' }),
    ).toThrow(/not both/);
  });
});

/**
 * The JWKS path is the recommended production setup — asymmetric keys fetched
 * from the identity provider — so it is exercised against a real generated
 * keypair rather than left to integration testing.
 */
describe('createTokenVerifier with JWKS', () => {
  /**
   * Served from a real loopback server rather than a mocked `fetch`: jose's
   * `createRemoteJWKSet` uses its own internal Node fetch, so a `globalThis.fetch`
   * stub never intercepts it. This runs fully offline and exercises the actual
   * remote-key-set path.
   */
  let server: Server;
  let jwksUrl: string;
  let requests = 0;

  let signingKey: CryptoKey;
  let otherKey: CryptoKey;
  let jwksBody: string;

  beforeAll(async () => {
    const trusted = await generateKeyPair('RS256');
    const foreign = await generateKeyPair('RS256');
    signingKey = trusted.privateKey as CryptoKey;
    otherKey = foreign.privateKey as CryptoKey;

    const jwk = await exportJWK(trusted.publicKey);
    jwksBody = JSON.stringify({ keys: [{ ...jwk, kid: 'trusted-key', alg: 'RS256' }] });

    server = createServer((_req, res) => {
      requests += 1;
      res.setHeader('content-type', 'application/json');
      res.end(jwksBody);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    jwksUrl = `http://127.0.0.1:${port}/.well-known/jwks.json`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    clearJwksCache();
    requests = 0;
  });

  afterEach(() => clearJwksCache());

  function sign(key: CryptoKey, kid = 'trusted-key') {
    return new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
  }

  it('verifies a token against the published key', async () => {
    const verify = createTokenVerifier({ jwks: jwksUrl });
    await expect(verify(await sign(signingKey))).resolves.toMatchObject({ sub: 'user-1' });
    expect(requests).toBeGreaterThan(0);
  });

  it('rejects a token signed by a key that is not published', async () => {
    const verify = createTokenVerifier({ jwks: jwksUrl });
    await expect(verify(await sign(otherKey))).rejects.toThrow();
  });

  it('rejects an HS256 token when the allowlist is asymmetric', async () => {
    // The RS256-to-HS256 downgrade: sign with the public key as an HMAC secret.
    const verify = createTokenVerifier({ jwks: jwksUrl });
    const forged = await new SignJWT({ sub: 'admin' })
      .setProtectedHeader({ alg: 'HS256', kid: 'trusted-key' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(jwksBody));

    await expect(verify(forged)).rejects.toThrow();
  });

  it('reuses one key set across verifiers for the same URL', async () => {
    const first = createTokenVerifier({ jwks: jwksUrl });
    const second = createTokenVerifier({ jwks: jwksUrl });

    await first(await sign(signingKey));
    await second(await sign(signingKey));

    // jose caches internally; the point is that the second verifier did not
    // build a second remote key set and refetch.
    expect(requests).toBe(1);
  });

  it('enforces issuer alongside the signature', async () => {
    const verify = createTokenVerifier({ jwks: jwksUrl, issuer: 'https://issuer.example' });
    const wrongIssuer = await new SignJWT({ sub: 'u' })
      .setProtectedHeader({ alg: 'RS256', kid: 'trusted-key' })
      .setIssuer('https://evil.example')
      .setExpirationTime('1h')
      .sign(signingKey);

    await expect(verify(wrongIssuer)).rejects.toThrow();
  });
});

describe('readExpiry', () => {
  it('reads exp as epoch milliseconds', async () => {
    const token = await signToken({ sub: 'u' });
    const expiry = readExpiry(token);
    expect(expiry).toBeGreaterThan(Date.now());
    expect(expiry).toBeLessThan(Date.now() + 3_700_000);
  });

  it('returns null for a token with no exp', async () => {
    const token = await new SignJWT({ sub: 'u' }).setProtectedHeader({ alg: 'HS256' }).sign(key);
    expect(readExpiry(token)).toBeNull();
  });

  it('returns null for garbage rather than throwing', () => {
    expect(readExpiry('not-a-jwt')).toBeNull();
  });
});
