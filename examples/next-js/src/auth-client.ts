'use client';

import { createAuthClient } from '@thinkgrid/react-starter-auth';

import type { User } from './auth';

/**
 * The typed client, created once.
 *
 * `User` is fixed here, so `useAuth()` returns `User | null` everywhere with no
 * per-call-site type argument to get wrong.
 */
export const { AuthProvider, useAuth, useRequireAuth, SignedIn, SignedOut, fetcher } =
  createAuthClient<User>({
    basePath: '/api/auth',
  });
