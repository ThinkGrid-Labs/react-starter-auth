/**
 * @jest-environment node
 */
import { hostPrefixed, parseCookies, serializeCookie } from '../cookies';

describe('parseCookies', () => {
  it('parses a multi-value header', () => {
    expect(parseCookies('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('returns an empty object for missing headers', () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  it('decodes percent-escapes and strips quotes', () => {
    expect(parseCookies('name=%40thinkgrid; q="quoted"')).toEqual({
      name: '@thinkgrid',
      q: 'quoted',
    });
  });

  it('survives a malformed escape rather than throwing', () => {
    expect(parseCookies('bad=%E0%A4%A')).toEqual({ bad: '%E0%A4%A' });
  });

  it('ignores segments with no "="', () => {
    expect(parseCookies('novalue; a=1')).toEqual({ a: '1' });
  });

  it('keeps "=" inside the value intact', () => {
    expect(parseCookies('jwe=aaa.bbb.ccc==')).toEqual({ jwe: 'aaa.bbb.ccc==' });
  });
});

describe('serializeCookie', () => {
  it('defaults to a locked-down cookie', () => {
    const out = serializeCookie('session', 'value');
    expect(out).toContain('HttpOnly');
    expect(out).toContain('Secure');
    expect(out).toContain('SameSite=Lax');
    expect(out).toContain('Path=/');
  });

  it('emits Max-Age and a matching Expires', () => {
    const out = serializeCookie('session', 'v', { maxAge: 3600 });
    expect(out).toContain('Max-Age=3600');
    expect(out).toContain('Expires=');
  });

  it('can opt out of HttpOnly for the CSRF cookie', () => {
    expect(serializeCookie('csrf', 'v', { httpOnly: false })).not.toContain('HttpOnly');
  });

  it('url-encodes the value', () => {
    expect(serializeCookie('k', 'a b@c')).toContain('k=a%20b%40c');
  });

  it('refuses SameSite=None without Secure', () => {
    expect(() => serializeCookie('k', 'v', { sameSite: 'none', secure: false })).toThrow(
      /SameSite=None requires Secure/,
    );
  });
});

describe('hostPrefixed', () => {
  it('adds __Host- when the cookie qualifies', () => {
    expect(hostPrefixed('session', { secure: true, path: '/' })).toBe('__Host-session');
  });

  it('leaves the name alone over plain HTTP', () => {
    expect(hostPrefixed('session', { secure: false, path: '/' })).toBe('session');
  });

  it('leaves the name alone when a Domain is set', () => {
    expect(hostPrefixed('session', { secure: true, path: '/', domain: 'example.com' })).toBe(
      'session',
    );
  });

  it('leaves the name alone when the path is narrowed', () => {
    expect(hostPrefixed('session', { secure: true, path: '/app' })).toBe('session');
  });

  it('does not double-prefix', () => {
    expect(hostPrefixed('__Host-session', { secure: true, path: '/' })).toBe('__Host-session');
  });
});
