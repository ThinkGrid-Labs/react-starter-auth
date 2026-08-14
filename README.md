<h1 align="center">react-starter-auth</h1>

<div align="center">
  <img src="https://raw.githubusercontent.com/thinkgrid-labs/react-starter-auth/main/react-starter-auth.png" alt="react-starter-auth — HttpOnly JWT session authentication for React and Next.js" width="600" />
  <p>
    <strong>Secure, configurable JWT authentication for React and Next.js — the token never reaches the browser.</strong><br>
    HttpOnly server sessions, real signature verification, CSRF built in.
  </p>
</div>

<p align="center">
  <a href="https://www.npmjs.com/package/@thinkgrid/react-starter-auth"><img alt="npm version" src="https://img.shields.io/npm/v/@thinkgrid/react-starter-auth.svg"></a>
  <a href="https://www.npmjs.com/package/@thinkgrid/react-starter-auth"><img alt="npm downloads per month" src="https://img.shields.io/npm/dm/@thinkgrid/react-starter-auth.svg"></a>
  <a href="https://bundlephobia.com/package/@thinkgrid/react-starter-auth"><img alt="minified and gzipped size" src="https://img.shields.io/bundlephobia/minzip/@thinkgrid/react-starter-auth"></a>
  <a href="https://github.com/thinkgrid-labs/react-starter-auth/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/thinkgrid-labs/react-starter-auth/actions/workflows/ci.yml/badge.svg"></a>
  <a href="#license"><img alt="License: MIT" src="https://img.shields.io/npm/l/@thinkgrid/react-starter-auth.svg"></a>
  <img alt="Written in TypeScript" src="https://img.shields.io/badge/types-included-blue.svg">
  <img alt="One runtime dependency: jose" src="https://img.shields.io/badge/runtime%20deps-1-brightgreen.svg">
</p>

```bash
pnpm add @thinkgrid/react-starter-auth
```

**react-starter-auth** is a **React** and **Next.js authentication** library built on the
**token-handler (BFF) pattern**: your access and refresh tokens stay on the server, and the
browser holds one opaque, encrypted, **`HttpOnly` `SameSite=Lax` cookie** — no
`localStorage`, no JWT in JavaScript, nothing for an XSS to steal and replay. **JWT
signatures are actually verified** with [`jose`](https://github.com/panva/jose) against a
**JWKS** or shared secret, with an algorithm allowlist. **CSRF** protection, **refresh
token rotation** with reuse detection, and flash-free **SSR** are included. Ships adapters
for the **Next.js App Router**, **React Router 7 / Remix**, **Express / Fastify**, and
anything speaking web-standard `Request`/`Response` — **Hono**, **Deno**, **Bun**,
**Cloudflare Workers**. TypeScript throughout, one runtime dependency.

---

## Contents

- [Features](#features)
- [How it compares](#how-it-compares)
- [Installation](#installation)
- [How it works](#how-it-works)
- Quickstart — [1. server handlers](#1-mount-the-server-handlers) · [2. the client](#2-create-the-client) · [3. the provider](#3-wire-the-provider) · [4. use it](#4-use-it)
- [Reading the session on the server](#reading-the-session-on-the-server)
- [Configuration](#configuration)
- [Framework adapters](#framework-adapters)
- [Example app](#example)
- [Security model](#security-model)
- [FAQ](#faq)
- [Migrating from 0.1.x](#migrating-from-01x)
- [License](#license)

---

## Features

- **HttpOnly sessions.** The token lives on the server inside an encrypted, `HttpOnly`, `SameSite=Lax` cookie. Script cannot read it, so an XSS cannot steal it.
- **Real JWT verification.** Signatures checked with [`jose`](https://github.com/panva/jose) against a JWKS or shared secret, with an algorithm allowlist. `none` is rejected outright.
- **CSRF built in.** Double-submit token plus `Origin` / `Sec-Fetch-Site` validation on every unsafe request.
- **Refresh rotation.** Automatic, single-flight, with optional reuse detection.
- **SSR without the flash.** Resolve the session on the server and the first client render is already correct — no loading spinner, no hydration mismatch.
- **Runs anywhere.** The server core speaks only `Request`/`Response`: Node, Next.js middleware on the edge, Cloudflare Workers, Deno, Bun.
- **One typed client.** `createAuthClient<User>()` fixes your user type once; every hook and component infers it.

---

## How it compares

|  | react-starter-auth | NextAuth / Auth.js | Clerk · Auth0 · Stack | Roll your own |
|---|---|---|---|---|
| **Where the token lives** | your server, encrypted cookie | your server, encrypted cookie | the vendor | usually `localStorage` |
| **Brings its own identity provider** | no — wraps the one you have | providers included | yes, it *is* the provider | no |
| **Works with an existing API / IdP** | that's the whole design | possible, more work | you migrate users to them | yes |
| **Frameworks** | Next, React Router 7 / Remix, Express, Hono, Workers, Deno, Bun | Next first, others via Auth.js | SDK per framework | yours |
| **Signature verification** | `jose`, JWKS or secret, allowlist | yes | vendor-side | often skipped |
| **CSRF** | double-submit + `Origin` / `Sec-Fetch-Site` | yes | vendor-side | often missing |
| **Hosted cost** | none | none | per-MAU pricing | none |
| **Runtime dependencies** | 1 (`jose`) | several | vendor SDK | — |

The distinction that matters: NextAuth/Auth.js wants to *be* your authentication —
providers, adapters, a database schema. Clerk and Auth0 want to be your identity provider.
react-starter-auth assumes you already have one, whether that's your own `/login`
endpoint, Keycloak, Cognito, or an internal service, and gives you the missing half: a
place to put the tokens where a script can't read them, and React bindings that know the
difference between "loading" and "signed out".

If you're starting from nothing and want social login in an afternoon, use Auth.js or
Clerk. If you have an API that already issues JWTs and you want them out of the browser,
this is smaller.

---

## Installation

```bash
pnpm add @thinkgrid/react-starter-auth
# npm install @thinkgrid/react-starter-auth
# yarn add @thinkgrid/react-starter-auth
```

`react` and `react-dom` are peer dependencies (16.8+, including 19). The only runtime dependency is `jose`.

---

## How it works

```
Browser                    Your server (BFF)              Resource API
────────                   ─────────────────              ────────────
AuthProvider   ──cookie──▶  /login /logout                Authorization:
useAuth()      ◀──user───   /session /refresh   ──token──▶ Bearer …
fetcher()                   holds access + refresh
                            verifies with jose
__Host-session              enforces CSRF
HttpOnly · Secure · Lax
  ▲
  └── script cannot read this. No token. No localStorage.
```

The browser holds one opaque cookie and learns *who it is* from `GET /session`. It never holds a credential, so a script injected into your page can act as the user while the page is open but cannot steal anything to replay later.

---

## 1. Mount the server handlers

```ts
// auth.ts
import { createAuthHandlers } from '@thinkgrid/react-starter-auth/server';

export const auth = createAuthHandlers({
  secret: process.env.AUTH_SECRET!,          // 32+ chars: openssl rand -base64 32

  authenticate: async ({ email, password }) => {
    const res = await myIdp.login({ email, password });
    if (!res.ok) return null;                // null → 401, no detail leaked
    return {
      user: { id: res.user.id, name: res.user.name },
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
    };
  },

  refresh: async (refreshToken) => {          // omit to disable refresh
    const res = await myIdp.refresh(refreshToken);
    return res.ok
      ? { user: res.user, accessToken: res.access_token, refreshToken: res.refresh_token }
      : null;
  },

  jwt: { jwks: process.env.JWKS_URL },        // optional: verify tokens on the way in
});
```

```ts
// Next.js App Router — app/api/auth/[...auth]/route.ts
import { auth } from '@/auth';

export const GET = auth.handle;
export const POST = auth.handle;
```

That exposes five routes under `basePath` (default `/api/auth`):

| Route | Method | Purpose |
|---|---|---|
| `/login` | POST | Exchange credentials for a session cookie |
| `/logout` | POST | Clear the session |
| `/session` | GET | `{ user, expiresAt }` or 401 — also bootstraps the CSRF token |
| `/refresh` | POST | Rotate tokens |
| `/csrf` | GET | Issue a CSRF token explicitly |

---

## 2. Create the client

```ts
// auth-client.ts
import { createAuthClient } from '@thinkgrid/react-starter-auth';

export interface User {
  id: string;
  name: string;
}

export const { AuthProvider, useAuth, useRequireAuth, SignedIn, SignedOut, fetcher } =
  createAuthClient<User>({
    basePath: '/api/auth',
    // Preserve client-side routing instead of a full page load:
    // navigate: (path) => router.push(path),
  });
```

Declaring `User` once here is what makes `useAuth()` return `User | null` everywhere, with no per-call-site type argument to get wrong.

---

## 3. Wire the provider

Pass a server-resolved session and the first paint is already correct:

```tsx
// app/layout.tsx
import { auth } from '@/auth';
import { AuthProvider } from '@/auth-client';
import { cookies } from 'next/headers';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // `cookies()` is async in Next 15 — await it, or you hand a Promise to toString()
  // and every request silently looks signed out.
  const session = await auth.getSessionFromCookieHeader((await cookies()).toString());

  return (
    <html lang="en">
      <body>
        <AuthProvider initialSession={session}>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

`getSessionFromCookieHeader` exists so a server component doesn't have to fabricate a
`Request` it doesn't have. With the [Next adapter](#nextjs) it's shorter still —
`await nextAuth.getSession(await cookies())`, which is what the
[example app](#example) uses.

Omit `initialSession` entirely and the provider fetches `/session` on mount instead — correct, but with a brief `loading` state. Passing `null` means "the server checked and nobody is signed in".

---

## 4. Use it

```tsx
'use client';
import { useAuth, SignedIn, SignedOut } from '@/auth-client';

export function Account() {
  const { status, user, signIn, signOut } = useAuth();

  if (status === 'loading') return <Spinner />;

  return (
    <>
      <SignedIn>
        <p>Hello {user!.name}</p>
        <button onClick={() => signOut({ redirectTo: '/' })}>Sign out</button>
      </SignedIn>
      <SignedOut>
        <button onClick={() => signIn({ email, password })}>Sign in</button>
      </SignedOut>
    </>
  );
}
```

`status` is `'loading' | 'authenticated' | 'unauthenticated'` and is the single source of truth. `isLoading` and `isAuthenticated` are derived from it, so they can never disagree with it.

`signIn` takes **credentials, not a token** — it posts them to your server and never sees what comes back. It throws an `AuthError` carrying the server's error code on failure.

### Fetching protected data

```ts
import { fetcher } from '@/auth-client';

const res = await fetcher('/api/books');   // sends the cookie, attaches CSRF,
const books = await res.json();            // refreshes once on a 401 and retries
```

The refresh is single-flight: ten concurrent requests that all `401` trigger one refresh, not ten.

> Retrying replays your `RequestInit`. A one-shot body (a `ReadableStream`) cannot be replayed — pass a string, `FormData` or `URLSearchParams` if you need the retry.

### Redirecting signed-out visitors

```tsx
'use client';
import { useRequireAuth } from '@/auth-client';

export default function Dashboard() {
  const status = useRequireAuth({ redirectTo: '/login' });
  if (status !== 'authenticated') return null;
  return <RealDashboard />;
}
```

> ⚠️ `useRequireAuth`, `SignedIn` and `SignedOut` are **UX affordances, not access control.** They run in the browser, after render. Authorize on the server — in middleware, a loader, or a server component — for anything that matters.

---

## Reading the session on the server

```ts
// Public state — safe to send to the client. Cannot contain a token.
const session = await auth.getSession(request);

// Server-only — includes the access token, for calling your resource API.
const sealed = await auth.getSealedSession(request);
await fetch('https://api.example.com/me', {
  headers: { Authorization: `Bearer ${sealed!.accessToken}` },
});
```

`Session` and `SealedSession` are separate types on purpose: the public one has no token field at all, so leaking a credential into a response body is a compile error rather than something a review has to catch.

---

## Configuration

Server — everything optional except `secret` and `authenticate`:

```ts
createAuthHandlers({
  secret: process.env.AUTH_SECRET!,
  basePath: '/api/auth',
  cookie: {
    name: 'session',          // gains a __Host- prefix automatically when it qualifies
    sameSite: 'lax',          // 'strict' breaks OAuth callbacks and email links
    secure: true,             // defaults to false only under NODE_ENV development/test
    maxAge: 60 * 60 * 24 * 7,
  },
  csrf: { enabled: true, headerName: 'x-csrf-token', trustedOrigins: [] },
  jwt: { jwks: '…', issuer: '…', audience: '…', algorithms: ['RS256'] },
  session: { strategy: 'jwe' },  // or 'store' with a SessionStore
  authenticate,
});
```

Client:

```ts
createAuthClient<User>({
  basePath: '/api/auth',        // must match the server
  csrfCookieName: 'csrf',
  csrfHeaderName: 'x-csrf-token',
  navigate: (path) => router.push(path),
  revalidateOnFocus: true,      // re-check the session when the tab regains focus
  refreshSkewSeconds: 60,       // refresh this early, before the token dies
  syncAcrossTabs: true,         // sign out in one tab, sign out in all
});
```

The defaults encode most of the security decisions:

- **Cookie lifetime tracks the token.** With no `refresh` callback the cookie's `Max-Age` is clamped to the access token's own `exp`, so a stale cookie can never outlive the credential inside it. With `refresh` configured the cookie spans `cookie.maxAge` instead.
- **`__Host-` prefix** is applied automatically when the cookie is `Secure`, `Path=/` and has no `Domain` — browsers then refuse any cross-subdomain overwrite. Over plain HTTP in development the bare name is used.
- **CSRF cannot be disabled for a cross-site cookie.** `sameSite: 'none'` with `csrf.enabled: false` throws at startup rather than shipping.
- **Algorithms are allowlisted**, defaulting to `RS256`/`ES256` for JWKS and `HS256` for a shared secret.
- **Refresh-token reuse detection** needs state, so it only runs when you supply a `SessionStore` with `consumeRefreshToken`. It is most valuable alongside the default storeless strategy, where the refresh token rides in the cookie and a copied cookie can therefore be replayed.

---

## Framework adapters

| Framework | Import | Enforcement point |
|---|---|---|
| Next.js App Router | `/next` | `guard` in middleware |
| React Router 7 · Remix | `/react-router` | `requireSession` in a loader |
| Express · Fastify · Connect | `/node` | `middleware` + `getSession` |
| Hono · Deno · Workers | `/server` | `auth.handle` directly |
| Vite / CRA SPA | root | see the caveat below |

None of the adapters imports its framework — everything is duck-typed, so no framework becomes a peer dependency.

### Next.js

```ts
// auth.ts
import { createAuthHandlers } from '@thinkgrid/react-starter-auth/server';
import { createNextAdapter } from '@thinkgrid/react-starter-auth/next';

export const auth = createAuthHandlers({ /* … */ });
export const nextAuth = createNextAdapter(auth);
```

```ts
// app/api/auth/[...auth]/route.ts
export const { GET, POST } = nextAuth.handlers;
```

```ts
// middleware.ts — the real access control
export async function middleware(request: NextRequest) {
  const redirectTo = await nextAuth.guard(request, { redirectTo: '/login' });
  return redirectTo ? NextResponse.redirect(redirectTo) : NextResponse.next();
}
// Both entries: '/dashboard/:path*' matches the children, not '/dashboard' itself
export const config = { matcher: ['/dashboard', '/dashboard/:path*'] };
```

`guard` hands back a `URL` rather than a `Response` so middleware stays in one idiom — the continue branch already needs `NextResponse.next()` — and so headers, cookies and rewrites stay under your control.

```tsx
// app/layout.tsx — read the session from cookies(), no fake Request needed
const session = await nextAuth.getSession(await cookies());
return <AuthProvider initialSession={session}>{children}</AuthProvider>;
```

`guard` sends signed-out visitors to `redirectTo` with the original path in a `next` query parameter. Narrow it further with `protect: (pathname) => …`, or drop the parameter with `returnToParam: null`.

### React Router 7 / Remix

```ts
// routes/api.auth.$.ts
export const { loader, action } = createReactRouterAdapter(auth);
```

```ts
// any protected loader
export async function loader({ request }: LoaderFunctionArgs) {
  const session = await rrAuth.requireSession(request);   // throws a redirect if signed out
  return { user: session.user };
}
```

`requireSession` throws a redirect `Response`, which is the loader idiom — so the happy path reads as straight-line code. Use `requireSealedSession` when you need the access token to call your API.

### Express / Fastify

```ts
import { createNodeAdapter } from '@thinkgrid/react-starter-auth/node';

const nodeAuth = createNodeAdapter(auth);
app.all('/api/auth/*splat', nodeAuth.middleware);

app.get('/api/me', async (req, res) => {
  const session = await nodeAuth.getSession(req);
  if (!session) return res.status(401).json({ error: 'unauthorized' });
  res.json(session.user);
});
```

The bridge handles the parts that are easy to get wrong: multiple `Set-Cookie` headers emitted separately rather than folded into one, `x-forwarded-proto` honoured so `Secure` cookies aren't mislabelled behind a proxy, and a body read either from the stream or from whatever your body parser already consumed.

`toWebRequest` and `sendWebResponse` are exported too, if you would rather wire it yourself.

**One honest caveat for pure SPAs.** A Vite or CRA app with no server of its own *cannot* set an `HttpOnly` cookie — only a server can. Either serve the app from the same origin as your API so a normal `SameSite=Lax` cookie works, or run the small BFF above. A cross-origin SPA needs `SameSite=None; Secure` plus strict CSRF, which works but is strictly weaker. No configuration makes a serverless SPA as safe as the BFF path.

---

## Example

[`examples/next-js`](examples/next-js) is a working App Router app: sign-in form, middleware-protected route, and a server component that reads the access token. Build the library first, then:

```bash
cd examples/next-js && cp .env.example .env.local && pnpm install && pnpm dev
```

Sign in, then run `document.cookie` in devtools — you will see `csrf` and not the session.

---

## Security model

What this protects against, stated plainly:

| Threat | Outcome |
|---|---|
| XSS reads the token | **Prevented.** The cookie is `HttpOnly`; no token or user data is in `localStorage`. |
| XSS acts as the user while the page is open | **Not prevented.** No cookie-based scheme can. Keep your dependencies clean and set a CSP. |
| Forged / unsigned token | **Prevented** when `jwt` is configured — signature, issuer, audience and algorithm are all checked. |
| Cross-site request forgery | **Prevented** by double-submit plus `Origin` / `Sec-Fetch-Site`. |
| Stolen cookie replayed | **Detected** when a `SessionStore` with `consumeRefreshToken` is configured. |
| Client-side route guard bypassed | **Expected.** Guards are UX. Authorize on the server. |

---

## FAQ

### Do I need a backend for this?

Yes, and that's the point. Only a server can set an `HttpOnly` cookie, so a pure Vite or
CRA SPA with no server of its own can't hold a session a script can't read. You don't need
much of one — the five handlers are a single route file — but there has to be somewhere for
the tokens to live. See [the SPA caveat](#express--fastify).

### Is this a replacement for NextAuth / Auth.js?

Not really. Auth.js brings identity providers, adapters and a schema; it wants to *be* your
authentication. This wraps an identity provider you already have — your own `/login`, an
internal service, Keycloak, Cognito — and gives you the missing half: somewhere safe to put
the tokens plus React bindings. See [How it compares](#how-it-compares).

### Where is the JWT stored? Is `localStorage` used at all?

No. `localStorage` and `sessionStorage` are never touched, and there is no
JavaScript-readable token anywhere. Access and refresh tokens sit inside an encrypted JWE
that only your server can open, carried in one `HttpOnly` cookie. The one cookie script
*can* read is the CSRF token, which is not a credential — signing in and running
`document.cookie` in devtools shows `csrf` and nothing else.

### Does it stop XSS?

It stops an XSS from *stealing* a credential to replay later, which is the durable damage.
It cannot stop an injected script from acting as the user while the page is open — no
cookie-based scheme can, because the browser attaches the cookie to same-origin requests
whoever made them. Set a CSP and keep your dependencies clean. The
[security model](#security-model) states this plainly rather than burying it.

### Does it work with the Next.js App Router, middleware and server components?

Yes — that's the primary target. `/next` gives you `handlers` for the route file, `guard`
for middleware (the real access control), and `getSession(cookieStore)` for layouts and
server components. Middleware runs on the edge runtime, which is fine because the server
core uses only web-standard `Request`/`Response` and Web Crypto.

### Does it work outside Next.js?

Yes: React Router 7 and Remix via `/react-router`, Express / Fastify / Connect via `/node`,
and anything else through `auth.handle` directly — Hono, Deno, Bun, Cloudflare Workers. No
adapter imports its framework, so none of them becomes a peer dependency.

### Can I use my own session store instead of a cookie?

Yes. The default `'jwe'` strategy puts the sealed tokens in the cookie so you need no
infrastructure. Pass a `SessionStore` for `strategy: 'store'` and the cookie carries only
an id. Refresh-token **reuse detection** needs a store's `consumeRefreshToken` either way,
and it's most valuable *with* the storeless default — that's the mode where a copied cookie
carries a replayable refresh token.

### Are `SignedIn` and `useRequireAuth` real access control?

No, and the README says so where they're introduced. They run in the browser after render,
so they're UX affordances. Authorize on the server: middleware, a loader, or a server
component.

### What's the bundle cost?

One runtime dependency, `jose`. The React client is what ships to the browser; `/server`,
`/core` and the adapters are separate subpath exports, so they don't end up in your client
bundle. `sideEffects: false` is set, and both ESM and CJS builds are published.

### Does it support OAuth or social login?

Not directly, and it doesn't want to. Your `authenticate` callback returns a user plus
tokens — where those came from is your business, including an OAuth code exchange you
perform inside it. If you want providers configured for you, Auth.js is the better fit.

---

## Migrating from 0.1.x

0.1.x kept the JWT in a JavaScript-readable cookie and the user in `localStorage`, and never verified a signature. There is no way to make that secure incrementally, so the client API changed shape. `js-cookie` is no longer a dependency.

The mapping, old to new:

| 0.1.x | Now |
|---|---|
| `import { AuthProvider, useAuth } from '…'` | `createAuthClient<User>()` returns them |
| `signIn({ token, user })` | `signIn({ email, password })` — the server issues the cookie |
| `isLoading` + `isAuthenticated` | `status`; both remain as derived values |
| `logOut(path)` / `logOut(null as any)` | `signOut()`, or `signOut({ redirectTo })` |
| `<ProtectedRoute component={X} />` | `useRequireAuth()`, or `<SignedIn>` |
| `withAuthentication(X)` | `useRequireAuth()` inside `X` |
| `fetcher(url)` attaches a Bearer header | `fetcher(url)` sends the cookie and refreshes on 401 |
| `useAuth<T>()` per call site | `createAuthClient<T>()` once |
| — | **New:** mount `/server` handlers; this is the required half |

The one genuinely new obligation is the server: there must be somewhere to hold the token. That is the whole point.

---

## License

[MIT](LICENSE) © [ThinkGrid Labs](https://github.com/thinkgrid-labs)

---

<sub>Keywords: React authentication, Next.js authentication, HttpOnly cookie session, JWT
auth, token handler pattern, backend for frontend, BFF authentication, secure JWT storage,
no localStorage token, CSRF protection, refresh token rotation, JWKS verification, jose,
SSR session, App Router middleware, React Router 7, Remix, Express, Hono, Cloudflare
Workers, TypeScript, NextAuth alternative, Auth.js alternative.</sub>
