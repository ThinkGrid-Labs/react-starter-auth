# Next.js App Router example

A working sign-in flow with the token held server-side in an `HttpOnly` cookie.

## Run it

The example depends on the library by path (`file:../..`), so build the library first.

```bash
# from the repository root
pnpm install
pnpm build

cd examples/next-js
cp .env.example .env.local     # then set AUTH_SECRET
pnpm install
pnpm dev
```

Open http://localhost:3000 and sign in with `ada@example.com` / `password`.

## What to look at

| File | Shows |
|---|---|
| [`src/auth.ts`](src/auth.ts) | Server config — `authenticate`, `refresh`, and the Next adapter |
| [`src/auth-client.ts`](src/auth-client.ts) | `createAuthClient<User>()`, typed once |
| [`src/app/api/auth/[...auth]/route.ts`](src/app/api/auth/[...auth]/route.ts) | All five routes in one line |
| [`src/app/layout.tsx`](src/app/layout.tsx) | Server-resolved `initialSession` — no loading flash |
| [`src/middleware.ts`](src/middleware.ts) | **The real access control** |
| [`src/app/dashboard/page.tsx`](src/app/dashboard/page.tsx) | Server component reading the access token |
| [`src/app/login/page.tsx`](src/app/login/page.tsx) | `signIn({ email, password })` — credentials, not a token |

## The thing worth verifying

Sign in, then open devtools and run:

```js
document.cookie;
```

You will see `csrf=…` and **not** the session cookie. The credential is `HttpOnly`, so no script on the page — yours or a compromised dependency's — can read or exfiltrate it.

Compare the two halves of the dashboard: the server component prints the access token because it can, while the browser only ever received `user` and `expiresAt`.

## Two Next.js gotchas this example encodes

Both were caught by the e2e suite, and both fail *silently* — the app still redirects, just from the page instead of the server, so nothing looks broken:

1. **`middleware.ts` must live in `src/`** when the project uses a `src/` directory. At the project root it is never compiled, and the middleware simply does not run.
2. **`matcher: ['/dashboard/:path*']` does not match `/dashboard` itself** — only its children. Both entries are needed.

## Notes

`src/auth.ts` fakes an identity provider so the example runs with no external services. Replace `authenticate` and `refresh` with real calls; nothing else changes.

Middleware is the enforcement point. `useRequireAuth`, `SignedIn` and `SignedOut` keep the UI coherent but run in the browser after render — they are not access control.
