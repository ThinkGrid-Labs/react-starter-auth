import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { nextAuth } from '@/auth';

/**
 * The real access control.
 *
 * This runs on the server before the page does, which is what makes it
 * enforcement rather than decoration. The client-side `useRequireAuth` in
 * dashboard/page.tsx is only there to keep the UI coherent.
 */
export async function middleware(request: NextRequest) {
  const redirect = await nextAuth.guard(request, { redirectTo: '/login' });
  return redirect ?? NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
