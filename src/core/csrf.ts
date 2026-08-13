/**
 * CSRF protection for a cookie-borne session.
 *
 * Once the credential rides in a cookie the browser attaches it to
 * cross-site requests automatically, so `SameSite` alone is not a plan —
 * `Strict` breaks OAuth callbacks and email links, and `Lax` still permits
 * top-level cross-site POSTs in older browsers.
 *
 * Two independent checks run on every unsafe request. Either one alone would
 * usually do; both together mean a single browser quirk isn't fatal.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

/** 32 bytes of CSPRNG output, hex encoded. */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Constant-time string comparison.
 *
 * Length is compared up front because it leaks anyway through the string's
 * own length; the loop then runs over every character regardless of where the
 * first mismatch is, so timing doesn't reveal a prefix.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface CsrfCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Check 1 — the request came from somewhere we trust.
 *
 * `Sec-Fetch-Site` is preferred where the browser sends it because it cannot
 * be forged by script. `Origin` is the fallback. A request carrying neither is
 * refused: every browser that can perform a cross-site POST sends at least one.
 */
export function verifyOrigin(request: Request, trustedOrigins: string[] = []): CsrfCheckResult {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) {
    if (fetchSite === 'same-origin' || fetchSite === 'none') return { ok: true };
    // cross-site / same-site both mean a different origin initiated this.
    const origin = request.headers.get('origin');
    if (origin && trustedOrigins.includes(origin)) return { ok: true };
    return { ok: false, reason: `blocked by Sec-Fetch-Site: ${fetchSite}` };
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    return { ok: false, reason: 'missing Origin and Sec-Fetch-Site headers' };
  }

  const allowed = new Set([new URL(request.url).origin, ...trustedOrigins]);
  if (!allowed.has(origin)) {
    return { ok: false, reason: `origin ${origin} is not trusted` };
  }
  return { ok: true };
}

/**
 * Check 2 — double-submit.
 *
 * The token lives in a readable cookie and must be echoed in a header. A
 * cross-site attacker can cause the cookie to be sent but cannot read it to
 * populate the header, and cannot set the header cross-origin without a
 * preflight the server will refuse.
 */
export function verifyDoubleSubmit(
  request: Request,
  cookieToken: string | undefined,
  headerName: string,
): CsrfCheckResult {
  if (!cookieToken) {
    return { ok: false, reason: 'missing CSRF cookie' };
  }
  const headerToken = request.headers.get(headerName);
  if (!headerToken) {
    return { ok: false, reason: `missing ${headerName} header` };
  }
  if (!safeEqual(cookieToken, headerToken)) {
    return { ok: false, reason: 'CSRF token mismatch' };
  }
  return { ok: true };
}
