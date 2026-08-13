/**
 * @jest-environment node
 */
import {
  generateCsrfToken,
  isSafeMethod,
  safeEqual,
  verifyDoubleSubmit,
  verifyOrigin,
} from '../csrf';

const APP = 'https://app.example.com';

function request(headers: Record<string, string>, url = `${APP}/api/auth/login`): Request {
  return new Request(url, { method: 'POST', headers });
}

describe('generateCsrfToken', () => {
  it('returns 64 hex characters', () => {
    expect(generateCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateCsrfToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('safeEqual', () => {
  it('matches identical strings', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
  });

  it('rejects different values and different lengths', () => {
    expect(safeEqual('abc123', 'abc124')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });
});

describe('isSafeMethod', () => {
  it.each(['GET', 'head', 'OPTIONS'])('treats %s as safe', (method) => {
    expect(isSafeMethod(method)).toBe(true);
  });

  it.each(['POST', 'put', 'DELETE', 'PATCH'])('treats %s as unsafe', (method) => {
    expect(isSafeMethod(method)).toBe(false);
  });
});

describe('verifyOrigin', () => {
  it('allows a same-origin fetch', () => {
    expect(verifyOrigin(request({ 'sec-fetch-site': 'same-origin' })).ok).toBe(true);
  });

  it('allows a direct navigation', () => {
    expect(verifyOrigin(request({ 'sec-fetch-site': 'none' })).ok).toBe(true);
  });

  it('blocks a cross-site fetch', () => {
    const result = verifyOrigin(request({ 'sec-fetch-site': 'cross-site' }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Sec-Fetch-Site/);
  });

  it('allows a cross-site fetch from a trusted origin', () => {
    const result = verifyOrigin(
      request({ 'sec-fetch-site': 'cross-site', origin: 'https://trusted.example' }),
      ['https://trusted.example'],
    );
    expect(result.ok).toBe(true);
  });

  it('falls back to Origin when Sec-Fetch-Site is absent', () => {
    expect(verifyOrigin(request({ origin: APP })).ok).toBe(true);
    expect(verifyOrigin(request({ origin: 'https://evil.example' })).ok).toBe(false);
  });

  it('blocks a request carrying neither header', () => {
    const result = verifyOrigin(request({}));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing Origin/);
  });
});

describe('verifyDoubleSubmit', () => {
  const token = 'a'.repeat(64);

  it('accepts a matching cookie and header', () => {
    expect(verifyDoubleSubmit(request({ 'x-csrf-token': token }), token, 'x-csrf-token').ok).toBe(
      true,
    );
  });

  it('rejects a missing cookie', () => {
    const result = verifyDoubleSubmit(request({ 'x-csrf-token': token }), undefined, 'x-csrf-token');
    expect(result).toEqual({ ok: false, reason: 'missing CSRF cookie' });
  });

  it('rejects a missing header', () => {
    const result = verifyDoubleSubmit(request({}), token, 'x-csrf-token');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/missing x-csrf-token header/);
  });

  it('rejects a mismatch', () => {
    const result = verifyDoubleSubmit(
      request({ 'x-csrf-token': 'b'.repeat(64) }),
      token,
      'x-csrf-token',
    );
    expect(result).toEqual({ ok: false, reason: 'CSRF token mismatch' });
  });
});
