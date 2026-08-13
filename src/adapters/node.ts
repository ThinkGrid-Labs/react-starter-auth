import { SealedSession, Session } from '../core/types';
import { AuthHandlers } from '../server/handlers';

/**
 * Node HTTP adapter — Express, Fastify, Connect, or bare `http`.
 *
 * The core speaks web-standard `Request`/`Response`; Node servers speak streams
 * and mutable response objects. This is the bridge, duck-typed so no `@types/node`
 * reference leaks into the published declarations.
 */

export interface NodeRequestLike {
  method?: string;
  url?: string;
  /** Express sets this to the pre-mount path; preferred when present. */
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Set by a body parser, if one ran before this middleware. */
  body?: unknown;
}

export interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string | string[]): void;
  end(chunk?: string): void;
}

export interface ToWebRequestOptions {
  /** Origin to resolve the URL against. Inferred from the Host header if omitted. */
  origin?: string;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(', ') : value;
}

function inferOrigin(req: NodeRequestLike, override?: string): string {
  if (override) return override;
  const host = headerValue(req.headers.host) ?? 'localhost';
  // Behind a proxy the original scheme only survives in the forwarded header;
  // getting this wrong would mark Secure cookies as insecure.
  const forwarded = headerValue(req.headers['x-forwarded-proto']);
  const protocol = forwarded?.split(',')[0].trim() ?? 'http';
  return `${protocol}://${host}`;
}

async function readBody(req: NodeRequestLike): Promise<string | undefined> {
  // A body parser may already have consumed the stream.
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string') return req.body;
    if (req.body instanceof Uint8Array) return new TextDecoder().decode(req.body);
    return JSON.stringify(req.body);
  }

  const iterable = req as unknown as AsyncIterable<Uint8Array | string>;
  if (typeof (iterable as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function') {
    return undefined;
  }

  const decoder = new TextDecoder();
  let body = '';
  for await (const chunk of iterable) {
    body += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
  }
  body += decoder.decode();
  return body === '' ? undefined : body;
}

/** Convert a Node request into a standard `Request`. */
export async function toWebRequest(
  req: NodeRequestLike,
  options: ToWebRequestOptions = {},
): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();
  const path = req.originalUrl ?? req.url ?? '/';
  const url = new URL(path, inferOrigin(req, options.origin));

  const headers = new Headers();
  for (const [name, raw] of Object.entries(req.headers)) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      for (const item of raw) headers.append(name, item);
    } else {
      headers.set(name, raw);
    }
  }

  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
  return new Request(url, { method, headers, body });
}

/** Write a standard `Response` out through a Node response object. */
export async function sendWebResponse(
  res: NodeResponseLike,
  response: Response,
): Promise<void> {
  res.statusCode = response.status;

  for (const [name, value] of response.headers) {
    // Iterating Headers folds multiple Set-Cookie values into one string, which
    // browsers reject. They are set separately below.
    if (name.toLowerCase() === 'set-cookie') continue;
    res.setHeader(name, value);
  }

  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);

  res.end(await response.text());
}

export interface NodeMiddlewareOptions extends ToWebRequestOptions {
  /** Defaults to the handlers' own `basePath`. */
  basePath?: string;
}

export interface NodeAdapter<TUser> {
  /**
   * Connect/Express-style middleware serving the auth routes.
   *
   * Mount it so the full path survives — `app.all('/api/auth/*splat', mw)` —
   * or via `app.use`, which the adapter handles by reading `originalUrl`.
   */
  middleware: (
    req: NodeRequestLike,
    res: NodeResponseLike,
    next?: () => void,
  ) => Promise<void>;
  getSession(req: NodeRequestLike): Promise<Session<TUser> | null>;
  getSealedSession(req: NodeRequestLike): Promise<SealedSession<TUser> | null>;
}

export function createNodeAdapter<TUser = Record<string, unknown>>(
  auth: AuthHandlers<TUser>,
  options: NodeMiddlewareOptions = {},
): NodeAdapter<TUser> {
  const basePath = (options.basePath ?? auth.basePath).replace(/\/$/, '');

  return {
    async middleware(req, res, next) {
      const path = req.originalUrl ?? req.url ?? '/';
      const pathname = path.split('?')[0];

      if (!pathname.startsWith(basePath)) {
        if (next) return next();
        res.statusCode = 404;
        return res.end();
      }

      const request = await toWebRequest(req, options);
      await sendWebResponse(res, await auth.handle(request));
    },

    getSession(req) {
      return auth.getSessionFromCookieHeader(headerValue(req.headers.cookie));
    },

    getSealedSession(req) {
      return auth.getSealedSessionFromCookieHeader(headerValue(req.headers.cookie));
    },
  };
}
