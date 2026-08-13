import { createFetcher, readCsrfToken } from '../fetcher';
import { resolveClientConfig } from '../types';

const config = resolveClientConfig({ basePath: '/api/auth' });

function res(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  document.cookie = 'csrf=token-abc';
});

afterEach(() => {
  document.cookie = 'csrf=; max-age=0';
  jest.clearAllMocks();
});

describe('readCsrfToken', () => {
  /**
   * Driven through a getter spy rather than jsdom's cookie jar: jsdom refuses
   * to store a `__Host-` cookie over plain http, so assigning one would be
   * silently dropped and the test would pass for the wrong reason.
   */
  function withCookies(value: string, assertion: () => void) {
    const spy = jest.spyOn(document, 'cookie', 'get').mockReturnValue(value);
    try {
      assertion();
    } finally {
      spy.mockRestore();
    }
  }

  it('reads the plain cookie name', () => {
    withCookies('csrf=token-abc', () => {
      expect(readCsrfToken('csrf')).toBe('token-abc');
    });
  });

  it('prefers the __Host- prefixed name', () => {
    withCookies('csrf=plain-token; __Host-csrf=prefixed-token', () => {
      expect(readCsrfToken('csrf')).toBe('prefixed-token');
    });
  });

  it('finds the cookie when it is not first in the header', () => {
    withCookies('other=1; csrf=token-abc; another=2', () => {
      expect(readCsrfToken('csrf')).toBe('token-abc');
    });
  });

  it('does not match a cookie whose name merely ends with the target', () => {
    withCookies('xsrf=wrong-token', () => {
      expect(readCsrfToken('srf')).toBeNull();
    });
  });

  it('url-decodes the value', () => {
    withCookies('csrf=a%20b', () => {
      expect(readCsrfToken('csrf')).toBe('a b');
    });
  });

  it('returns null when absent', () => {
    withCookies('other=1', () => {
      expect(readCsrfToken('csrf')).toBeNull();
    });
  });
});

describe('createFetcher', () => {
  it('sends the session cookie', async () => {
    fetchMock.mockResolvedValue(res(200));
    const fetcher = createFetcher(config);
    await fetcher('/api/books');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/books',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('attaches the CSRF header to unsafe methods only', async () => {
    fetchMock.mockResolvedValue(res(200));
    const fetcher = createFetcher(config);

    await fetcher('/api/books', { method: 'POST' });
    const postHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(postHeaders.get('x-csrf-token')).toBe('token-abc');

    await fetcher('/api/books');
    const getHeaders = fetchMock.mock.calls[1][1].headers as Headers;
    expect(getHeaders.get('x-csrf-token')).toBeNull();
  });

  it('does not overwrite a caller-supplied CSRF header', async () => {
    fetchMock.mockResolvedValue(res(200));
    const fetcher = createFetcher(config);
    await fetcher('/api/books', { method: 'POST', headers: { 'x-csrf-token': 'mine' } });

    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('x-csrf-token')).toBe('mine');
  });

  it('refreshes once on a 401 and retries the request', async () => {
    let dataCalls = 0;
    fetchMock.mockImplementation(async (input: string) => {
      if (String(input).endsWith('/refresh')) return res(200);
      dataCalls += 1;
      return dataCalls === 1 ? res(401) : res(200, { ok: true });
    });

    const fetcher = createFetcher(config);
    const response = await fetcher('/api/books');

    expect(response.status).toBe(200);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual(['/api/books', '/api/auth/refresh', '/api/books']);
  });

  it('coalesces concurrent 401s into a single refresh', async () => {
    let refreshCalls = 0;
    const seen = new Map<string, number>();
    fetchMock.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.endsWith('/refresh')) {
        refreshCalls += 1;
        // Give the other callers a chance to arrive while this is in flight.
        await new Promise((resolve) => setTimeout(resolve, 10));
        return res(200);
      }
      const count = (seen.get(url) ?? 0) + 1;
      seen.set(url, count);
      return count === 1 ? res(401) : res(200);
    });

    const fetcher = createFetcher(config);
    const responses = await Promise.all([
      fetcher('/api/a'),
      fetcher('/api/b'),
      fetcher('/api/c'),
    ]);

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshCalls).toBe(1);
  });

  it('reports a lost session and returns the 401 when refresh fails', async () => {
    const onSessionLost = jest.fn();
    fetchMock.mockImplementation(async (input: string) =>
      String(input).endsWith('/refresh') ? res(401) : res(401),
    );

    const fetcher = createFetcher(config, { onSessionLost });
    const response = await fetcher('/api/books');

    expect(response.status).toBe(401);
    expect(onSessionLost).toHaveBeenCalledTimes(1);
  });

  it('does not try to refresh a failing auth endpoint', async () => {
    fetchMock.mockResolvedValue(res(401));
    const fetcher = createFetcher(config);
    await fetcher('/api/auth/session');

    // One call only — refreshing the auth routes themselves would recurse.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recognises absolute URLs as auth endpoints', async () => {
    fetchMock.mockResolvedValue(res(401));
    const fetcher = createFetcher(config);
    await fetcher('https://app.example.com/api/auth/refresh');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('survives a refresh that throws', async () => {
    fetchMock.mockImplementation(async (input: string) => {
      if (String(input).endsWith('/refresh')) throw new Error('offline');
      return res(401);
    });

    const fetcher = createFetcher(config);
    await expect(fetcher('/api/books')).resolves.toMatchObject({ status: 401 });
  });
});
