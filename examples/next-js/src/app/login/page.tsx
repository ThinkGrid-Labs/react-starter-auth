'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { useAuth } from '@/auth-client';

export default function LoginPage() {
  const { signIn, status } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('ada@example.com');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // Credentials go to the server, which sets the HttpOnly cookie.
      // Nothing token-shaped comes back to this component.
      await signIn({ email, password });
      router.push('/dashboard');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Sign in</h1>
      <p>
        Demo credentials are pre-filled: <code>ada@example.com</code> / <code>password</code>.
      </p>

      <form className="card" onSubmit={onSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="username"
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />

        <button type="submit" disabled={busy || status === 'loading'}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {error ? (
          <p className="error" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            {error === 'invalid_credentials' ? 'Wrong email or password.' : error}
          </p>
        ) : null}
      </form>
    </>
  );
}
