# Migrating from 0.1.x

0.1.x kept the JWT in a JavaScript-readable cookie, kept the user in `localStorage`, and never verified a signature. None of that can be fixed incrementally — the token has to move to the server — so the client API changed shape.

The upgrade is mechanical, but it has one genuinely new obligation: **there must be a server.** That is the whole point.

---

## What changed and why

| 0.1.x | Now | Why |
|---|---|---|
| Token in a JS-readable cookie | `HttpOnly` cookie, server-side | An XSS could read and exfiltrate the old one |
| User in `localStorage` | Never persisted client-side | Same exposure, plus it outlived the session |
| `isTokenValid()` decodes only | `jose` verifies the signature | A forged token with a future `exp` passed every guard |
| `ProtectedRoute` blocked render | Middleware blocks the request | The old check was client-side, so cosmetic |
| Cookie fixed at 7 days | Derived from the token's `exp` | The cookie could outlive the credential inside it |
| No CSRF defence | Double-submit + `Origin` check | Cookie auth without CSRF is exploitable |

`js-cookie` is no longer a dependency. The only runtime dependency is `jose`.

---

## Step 1 — Add the server handlers

This is the new part. Mount them wherever your app already has a server.

```ts
// auth.ts
import { createAuthHandlers } from '@thinkgrid/react-starter-auth/server';

export const auth = createAuthHandlers({
  secret: process.env.AUTH_SECRET!,        // 32+ chars: openssl rand -base64 32
  authenticate: async ({ email, password }) => {
    // Whatever your old login endpoint did, do it here instead.
    const res = await api.login({ email, password });
    if (!res.ok) return null;
    return {
      user: { id: res.user.id, name: res.user.name },
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
    };
  },
});
```

```ts
// Next.js App Router — app/api/auth/[...auth]/route.ts
import { createNextAdapter } from '@thinkgrid/react-starter-auth/next';
import { auth } from '@/auth';

export const { GET, POST } = createNextAdapter(auth).handlers;
```

Other frameworks: `/react-router` for loaders and actions, `/node` for Express and Fastify, or `auth.handle` directly — it is a plain `(Request) => Promise<Response>`.

If your app has **no** server, see the SPA caveat in the [README](README.md#-framework-adapters). There is no configuration that makes a serverless SPA as safe as this.

---

## Step 2 — Replace the imports with one client

```diff
- import { AuthProvider, useAuth, fetcher } from '@thinkgrid/react-starter-auth';
+ import { createAuthClient } from '@thinkgrid/react-starter-auth';
+
+ export interface User { id: string; name: string }
+
+ export const { AuthProvider, useAuth, useRequireAuth, SignedIn, SignedOut, fetcher } =
+   createAuthClient<User>({ basePath: '/api/auth' });
```

Declaring `User` once here replaces `useAuth<User>()` at every call site. The old per-call type argument was an unchecked assertion — a wrong one failed silently at runtime.

---

## Step 3 — Pass the session in from the server

```diff
- <AuthProvider>{children}</AuthProvider>
+ <AuthProvider initialSession={await auth.getSession(request)}>{children}</AuthProvider>
```

This is what removes the loading flash and the hydration mismatch. Omit `initialSession` and the provider fetches on mount instead — correct, but with a brief `loading` state.

---

## Step 4 — Rewrite sign-in

```diff
- const { token, user } = await api.login(credentials);
- signIn({ token, user });
+ await signIn({ email, password });
```

`signIn` now posts credentials to your server and never receives a token. It throws an `AuthError` carrying the server's error code (`invalid_credentials`, …) instead of returning silently.

**Watch for this:** `signIn({ token })` with no user used to fabricate `{ name: 'Anonymous' }` and report you as authenticated. If you relied on that, you were relying on a bug.

---

## Step 5 — Replace state checks

```diff
- const { isLoading, isAuthenticated, user } = useAuth();
+ const { status, user } = useAuth();
+ // status: 'loading' | 'authenticated' | 'unauthenticated'
```

`isLoading` and `isAuthenticated` still exist, but they are now derived from `status` and cannot contradict it. Prefer `status` — it is the only value that distinguishes "still checking" from "signed out".

---

## Step 6 — Replace sign-out

```diff
- logOut('/goodbye');        // always a full page reload
- logOut(null as any);       // the only way to avoid navigating
+ await signOut({ redirectTo: '/goodbye' });
+ await signOut();           // stays put
```

`signOut` resolves instead of navigating, and redirects go through the client's `navigate` — pass your router's push to keep client-side routing:

```ts
createAuthClient<User>({ navigate: (path) => router.push(path) });
```

---

## Step 7 — Replace the route guards

```diff
- <ProtectedRoute component={Dashboard} redirectPath="/login" />
+ // in Dashboard:
+ const status = useRequireAuth({ redirectTo: '/login' });
+ if (status !== 'authenticated') return null;
```

```diff
- export default withAuthentication(PrivatePage);
+ // inside PrivatePage:
+ useRequireAuth();
```

Or declaratively:

```tsx
<SignedIn fallback={<Spinner />}>
  <Dashboard />
</SignedIn>
<SignedOut>
  <SignInPrompt />
</SignedOut>
```

**Then add the real check.** The guards above are UX; they run in the browser after render. Enforce on the server:

```ts
// Next.js — src/middleware.ts (must be in src/ when you use a src directory)
export async function middleware(request: NextRequest) {
  const redirectTo = await nextAuth.guard(request, { redirectTo: '/login' });
  return redirectTo ? NextResponse.redirect(redirectTo) : NextResponse.next();
}
export const config = { matcher: ['/dashboard', '/dashboard/:path*'] };
```

---

## Step 8 — Update data fetching

`fetcher` keeps its name and signature, but the mechanics changed: it sends the session cookie with `credentials: 'include'`, attaches the CSRF header on unsafe methods, and on a `401` refreshes once (single-flight) and retries. It no longer attaches an `Authorization` header, because it no longer has a token.

```ts
const res = await fetcher('/api/books');
```

To call a resource API **from the server**, take the token from the sealed session:

```ts
const sealed = await auth.getSealedSession(request);
await fetch('https://api.example.com/me', {
  headers: { Authorization: `Bearer ${sealed!.accessToken}` },
});
```

`getSession` returns public state with no token; `getSealedSession` includes it. They are separate types so serializing the wrong one into a response is a compile error.

---

## Removed exports

| Removed | Replacement |
|---|---|
| `ProtectedRoute` | `useRequireAuth()` or `<SignedIn>` |
| `withAuthentication` | `useRequireAuth()` inside the component |
| `AuthProvider` (top-level) | returned by `createAuthClient()` |
| `useAuth` (top-level) | returned by `createAuthClient()` |
| `fetcher` (top-level) | returned by `createAuthClient()`, or `createFetcher()` |
| `isTokenValid`, `tokenDecode` | server-side verification via `jwt` config |
| `setStateUser`, `getStateUser` | nothing — the user is not persisted client-side |
| `setAuthToken`, `getAuthToken` | nothing — the client never holds a token |

---

## Checklist

- [ ] `AUTH_SECRET` set, at least 32 characters, and not in version control
- [ ] Handlers mounted; `GET /api/auth/session` returns 401 when signed out
- [ ] `basePath` matches on both client and server
- [ ] `initialSession` passed from the server
- [ ] Server-side enforcement added for every protected route
- [ ] `navigate` wired to your router
- [ ] Served over HTTPS in production — the cookie is `Secure` outside development
- [ ] After signing in, `document.cookie` shows `csrf` and **not** the session
