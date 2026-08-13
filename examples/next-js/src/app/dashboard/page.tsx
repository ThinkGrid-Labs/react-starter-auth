import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { nextAuth } from '@/auth';

import { SignOutButton } from './sign-out-button';

/**
 * A server-protected page.
 *
 * Middleware already turned away signed-out visitors, and this checks again —
 * defence in depth, and it is what makes the access token available for calling
 * a resource API without that token ever touching the browser.
 */
export default async function DashboardPage() {
  const store = await cookies();
  const sealed = await nextAuth.getSealedSession(store);

  if (!sealed) redirect('/login');

  // In a real app this is where you would call your API:
  //
  //   await fetch('https://api.example.com/me', {
  //     headers: { Authorization: `Bearer ${sealed.accessToken}` },
  //   });
  //
  // The token is readable here, on the server, and nowhere else.
  const tokenPreview = `${sealed.accessToken.slice(0, 12)}…`;

  return (
    <>
      <h1>Dashboard</h1>
      <p>Rendered on the server, for {sealed.user.name}.</p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>What the server can see</h2>
        <pre>
          {JSON.stringify(
            {
              user: sealed.user,
              expiresAt: new Date(sealed.expiresAt).toISOString(),
              accessToken: tokenPreview,
            },
            null,
            2,
          )}
        </pre>
        <p style={{ marginBottom: 0 }}>
          The browser received only <code>user</code> and <code>expiresAt</code>. The token above
          never left the server.
        </p>
      </div>

      <SignOutButton />
    </>
  );
}
