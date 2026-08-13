import { nextAuth } from '@/auth';

/**
 * The five auth routes: /login, /logout, /session, /refresh, /csrf.
 *
 * Everything the browser needs, and the only place the tokens exist.
 */
export const { GET, POST } = nextAuth.handlers;
