import { createAuthHandlers } from '@thinkgrid/react-starter-auth/server';
import { createNextAdapter } from '@thinkgrid/react-starter-auth/next';

export interface User extends Record<string, unknown> {
  id: string;
  name: string;
  email: string;
}

/**
 * A stand-in for your identity provider.
 *
 * Replace `authenticate` with a real call — a database lookup, an OAuth token
 * exchange, whatever issues your tokens. The only contract is: return the user
 * plus an access token, or `null` to reject.
 */
const DEMO_USER: User = { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' };

function fakeAccessToken(): string {
  // A real deployment receives this from its identity provider. It is opaque to
  // this library unless you also configure `jwt` to verify it.
  const payload = Buffer.from(
    JSON.stringify({ sub: DEMO_USER.id, exp: Math.floor(Date.now() / 1000) + 900 }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

export const auth = createAuthHandlers<User>({
  secret: process.env.AUTH_SECRET!,

  authenticate: async ({ email, password }) => {
    if (email !== DEMO_USER.email || password !== 'password') return null;
    return {
      user: DEMO_USER,
      accessToken: fakeAccessToken(),
      refreshToken: 'demo-refresh-token',
    };
  },

  refresh: async (refreshToken) => {
    if (refreshToken !== 'demo-refresh-token') return null;
    return {
      user: DEMO_USER,
      accessToken: fakeAccessToken(),
      refreshToken: 'demo-refresh-token',
    };
  },
});

export const nextAuth = createNextAdapter(auth);
