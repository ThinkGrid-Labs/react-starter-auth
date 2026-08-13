import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { nextAuth } from '@/auth';

/**
 * The real access control.
 *
 * This runs on the server before the page does, which is what makes it
 * enforcement rather than decoration. The client-side guards in the pages keep
 * the UI coherent but are not security.
 */
export async function middleware(request: NextRequest) {
  const redirectTo = await nextAuth.guard(request, { redirectTo: '/login' });
  return redirectTo ? NextResponse.redirect(redirectTo) : NextResponse.next();
}

export const config = {
  // Both entries are needed: `/dashboard/:path*` matches the children but not
  // `/dashboard` itself, which would leave the page unguarded by middleware.
  matcher: ['/dashboard', '/dashboard/:path*'],
};
