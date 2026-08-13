'use client';

import Link from 'next/link';

import { SignedIn, SignedOut, useAuth } from '@/auth-client';

export default function Home() {
  const { status, user, signOut } = useAuth();

  return (
    <>
      <h1>react-starter-auth</h1>
      <p>
        HttpOnly cookie sessions for React. The token is held by the server — this page cannot read
        it.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Session</h2>
        <p style={{ margin: 0 }}>
          status: <code>{status}</code>
          {user ? (
            <>
              {' · '}signed in as <code>{user.email}</code>
            </>
          ) : null}
        </p>
      </div>

      <SignedIn fallback={<p>Checking your session…</p>}>
        <div className="card">
          <p>You are signed in. The dashboard is protected by middleware.</p>
          <Link href="/dashboard">
            <button>Open dashboard</button>
          </Link>{' '}
          <button className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </SignedIn>

      <SignedOut>
        <div className="card">
          <p>You are signed out.</p>
          <Link href="/login">
            <button>Sign in</button>
          </Link>
        </div>
      </SignedOut>

      <h2>Try it</h2>
      <p>
        Open devtools and run <code>document.cookie</code>. You will see the <code>csrf</code>{' '}
        cookie and <em>not</em> the session — that is the whole point.
      </p>
    </>
  );
}
