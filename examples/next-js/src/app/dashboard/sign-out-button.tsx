'use client';

import { useAuth } from '@/auth-client';

export function SignOutButton() {
  const { signOut } = useAuth();

  // `signOut` resolves rather than navigating, so the caller decides where to
  // go — `redirectTo` routes through the client's `navigate`.
  return (
    <button className="secondary" onClick={() => void signOut({ redirectTo: '/' })}>
      Sign out
    </button>
  );
}
