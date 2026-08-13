# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 — 2026-08-13

First stable release, and a rewrite. The 0.1.x line kept the JWT in a
JavaScript-readable cookie, kept the user in `localStorage`, and never verified a
token signature. None of that could be fixed incrementally — the token had to
move to the server — so the API changed shape.

**See [MIGRATION.md](MIGRATION.md) for the step-by-step upgrade.**

### ⚠️ Breaking changes

- **The package scope changed** to `@thinkgrid/react-starter-auth`.
- **A server is now required.** Mount the handlers from
  `@thinkgrid/react-starter-auth/server`; there must be somewhere to hold the
  token. Apps with no server of their own have no equivalently safe option — see
  the SPA caveat in the README.
- **`createAuthClient<User>()` replaces the top-level exports.** `AuthProvider`,
  `useAuth` and `fetcher` are returned from it rather than imported directly, so
  the user type is declared once instead of asserted at every call site.
- **`signIn` takes credentials, not a token.** It posts them to your server and
  never receives one back. It throws an `AuthError` carrying the server's error
  code on failure.
- **`logOut(path)` became `signOut({ redirectTo })`**, which resolves instead of
  forcing a full page load. The `logOut(null as any)` escape hatch is gone.
- **`ProtectedRoute` and `withAuthentication` were removed**, replaced by
  `useRequireAuth()`, `<SignedIn>` and `<SignedOut>`.
- **`status` replaces the `isLoading` / `isAuthenticated` pair** as the source of
  truth. Both remain, derived, so they can no longer contradict each other.
- **`fetcher` no longer sends an `Authorization` header.** It sends the session
  cookie, attaches CSRF, and refreshes once on a `401`.
- **Removed:** `isTokenValid`, `tokenDecode`, `setAuthToken`, `getAuthToken`,
  `setStateUser`, `getStateUser`.
- **`js-cookie` is no longer a dependency.** `jose` is the only runtime one.
- **React 19 is supported**; the peer range now covers 16.8 through 19.

### Added

- **HttpOnly sessions.** The token lives server-side in an encrypted
  (`dir` + `A256GCM` JWE) `HttpOnly`, `Secure`, `SameSite=Lax` cookie, with the
  `__Host-` prefix applied automatically when the cookie qualifies for it.
- **Real JWT verification** via `jose`, against a JWKS or a shared secret, with
  an explicit algorithm allowlist. `none` is rejected at construction, closing
  the `alg: none` and RS256→HS256 downgrades.
- **CSRF protection**: double-submit token plus `Origin` / `Sec-Fetch-Site`
  validation on every unsafe request. Disabling it for a cross-site cookie
  throws at startup rather than shipping.
- **Refresh rotation**, single-flight on the client, with optional reuse
  detection when a `SessionStore` is supplied.
- **Server-rendered sessions.** `initialSession` makes the first client render
  correct — no loading flash, no hydration mismatch, no fetch on mount.
- **Framework adapters**: `/next` (route handlers, `getSession` from `cookies()`,
  a middleware `guard`), `/react-router` (loader/action plus a throwing
  `requireSession`), `/node` (Express/Fastify bridge), and `/core` for anything
  else. No adapter imports its framework — all are duck-typed, so none becomes a
  peer dependency.
- **Separate `Session` and `SealedSession` types**, so serializing a token into a
  response body is a compile error rather than a review catch.
- Cross-tab sign-out via `BroadcastChannel`, revalidation on window focus, and a
  refresh scheduled before the access token expires.
- Runs on Node, edge middleware, Workers, Deno and Bun — the server core touches
  only `Request`, `Response` and `crypto`.
- A working [Next.js App Router example](examples/next-js).
- `LICENSE` (MIT), which had been claimed in the README but never included.

### Fixed

- Cookie lifetime is derived from the access token's `exp` when no refresh
  callback is configured, instead of a hardcoded 7 days — a stale cookie can no
  longer outlive the credential inside it.
- Route guards read auth state from context rather than re-reading cookies, so
  signing out re-renders the protected subtree instead of leaving it on screen.
- Guards no longer read cookies during render, which was causing SSR hydration
  mismatches and a flash of the wrong UI.
- `signIn` no longer fabricates a `{ name: 'Anonymous' }` user when none is
  supplied, which previously reported an unauthenticated visitor as signed in.
- `AuthError` sets `name`, so it no longer stringifies as a plain `Error`.
- Redirects go through an injectable `navigate`, preserving client-side routing
  instead of forcing a full document load.

### Packaging

- Dual ESM and CJS builds with a full `exports` map across six entry points, plus
  `sideEffects: false`. `main` previously pointed at an ESM file with no `type`
  field, which threw on Node 18.
- Test declarations no longer ship in the tarball.

### Internal

- 184 unit tests and 9 Playwright end-to-end tests, with a coverage gate in CI.
  The e2e suite asserts in a real browser that `document.cookie` does not contain
  the session after signing in.
- CI ran a `lint` script that did not exist, so it had never passed. Releases
  published on every push to `main` with no dependency on tests passing; they are
  now gated on a green CI run and skip versions that are already tagged.
