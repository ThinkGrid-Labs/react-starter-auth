import { isSafeMethod } from '../core/csrf';
import { ResolvedClientConfig } from './types';

/**
 * Read the CSRF token from the cookie.
 *
 * The server may or may not have applied a `__Host-` prefix depending on
 * whether the deployment qualifies, so both names are tried. This is the only
 * cookie the client reads — the session cookie is HttpOnly and invisible here,
 * which is the point.
 */
export function readCsrfToken(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const candidate of [`__Host-${name}`, name]) {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`),
    );
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

export interface FetcherHooks {
  /** Called when a refresh attempt fails, so the provider can drop to signed-out. */
  onSessionLost?(): void;
}

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * A `fetch` that carries the session cookie and recovers from one expiry.
 *
 * Three things the 0.1.x fetcher did not do: send credentials at all, attach a
 * CSRF header, and react to a 401. The refresh is single-flight, so ten
 * concurrent requests that all 401 trigger one refresh rather than ten.
 */
export function createFetcher(config: ResolvedClientConfig, hooks: FetcherHooks = {}): Fetcher {
  let inFlightRefresh: Promise<boolean> | null = null;

  async function performRefresh(): Promise<boolean> {
    try {
      const response = await fetch(`${config.basePath}/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders('POST'),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  function refreshOnce(): Promise<boolean> {
    if (!inFlightRefresh) {
      inFlightRefresh = performRefresh().finally(() => {
        inFlightRefresh = null;
      });
    }
    return inFlightRefresh;
  }

  function csrfHeaders(method: string, existing?: HeadersInit): Headers {
    const headers = new Headers(existing);
    if (!isSafeMethod(method) && !headers.has(config.csrfHeaderName)) {
      const token = readCsrfToken(config.csrfCookieName);
      if (token) headers.set(config.csrfHeaderName, token);
    }
    return headers;
  }

  /** True for the auth endpoints themselves — refreshing those would recurse. */
  function isAuthEndpoint(input: RequestInfo | URL): boolean {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    try {
      const path = url.startsWith('http')
        ? new URL(url).pathname
        : url.split('?')[0].split('#')[0];
      return path.startsWith(config.basePath);
    } catch {
      return false;
    }
  }

  return async function fetcher(input, init = {}) {
    const method = init.method ?? 'GET';
    const send = (): Promise<Response> =>
      fetch(input, {
        ...init,
        credentials: init.credentials ?? 'include',
        headers: csrfHeaders(method, init.headers),
      });

    const response = await send();
    if (response.status !== 401 || isAuthEndpoint(input)) return response;

    const refreshed = await refreshOnce();
    if (!refreshed) {
      hooks.onSessionLost?.();
      return response;
    }

    // Retrying replays `init`. A one-shot body (a ReadableStream) cannot be
    // replayed — pass a string, FormData or URLSearchParams if you need retry.
    return send();
  };
}
