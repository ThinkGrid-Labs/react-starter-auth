import { cookies } from 'next/headers';
import type { Metadata } from 'next';

import { nextAuth } from '@/auth';
import { AuthProvider } from '@/auth-client';

import './globals.css';

export const metadata: Metadata = {
  title: 'react-starter-auth · Next.js example',
  description: 'HttpOnly cookie sessions with React and Next.js',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolved on the server, so the first client render is already correct:
  // no loading flash, no hydration mismatch, no fetch waterfall on mount.
  const session = await nextAuth.getSession(await cookies());

  return (
    <html lang="en">
      <body>
        <AuthProvider initialSession={session}>
          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
