/**
 * @jest-environment node
 */
import { SignJWT } from 'jose';

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
