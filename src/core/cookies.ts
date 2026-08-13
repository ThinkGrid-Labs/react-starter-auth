/**
 * Cookie serialization for the server side.
 *
 * Deliberately hand-rolled and dependency-free: this module has to run
 * unchanged in Node, in Next.js middleware on the edge, and in Workers, so it
 * touches nothing but standard string APIs.
 */

export interface SerializeOptions {
  path?: string;
  domain?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  httpOnly?: boolean;
  /** Seconds. `0` expires the cookie immediately. */
  maxAge?: number;
}

/** Parse a `Cookie` request header into a plain object. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // A malformed percent-escape shouldn't take down the whole header.
      out[name] = value;
    }
  }
  return out;
}

/** Build a `Set-Cookie` value. */
export function serializeCookie(
  name: string,
  value: string,
  options: SerializeOptions = {},
): string {
  const {
    path = '/',
    domain,
    sameSite = 'lax',
    secure = true,
    httpOnly = true,
    maxAge,
  } = options;

  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${path}`);
  if (domain) parts.push(`Domain=${domain}`);
  if (maxAge !== undefined) {
    const seconds = Math.max(0, Math.floor(maxAge));
    parts.push(`Max-Age=${seconds}`);
    parts.push(`Expires=${new Date(Date.now() + seconds * 1000).toUTCString()}`);
  }
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);

  // SameSite=None is meaningless — and rejected by browsers — without Secure.
  if (sameSite === 'none' && !secure) {
    throw new Error('SameSite=None requires Secure. Serve over HTTPS or use SameSite=Lax.');
  }

  return parts.join('; ');
}

/**
 * Apply the `__Host-` prefix when the cookie qualifies for it.
 *
 * Browsers only accept a `__Host-` cookie that is Secure, `Path=/` and has no
 * Domain, and in exchange they refuse to let a sibling subdomain overwrite it.
 * Over plain HTTP in development nothing qualifies, so the bare name is used.
 */
export function hostPrefixed(
  name: string,
  options: Pick<SerializeOptions, 'secure' | 'path' | 'domain'>,
): string {
  if (name.startsWith('__Host-')) return name;
  const qualifies = options.secure === true && (options.path ?? '/') === '/' && !options.domain;
  return qualifies ? `__Host-${name}` : name;
}

/** Append a `Set-Cookie` to a Headers object without clobbering earlier ones. */
export function appendCookie(headers: Headers, cookie: string): void {
  headers.append('Set-Cookie', cookie);
}
