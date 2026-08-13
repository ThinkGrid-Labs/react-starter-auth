import { expect, test } from '@playwright/test';

/**
 * The assertions that only a real browser can make.
 *
 * Everything else in the suite talks to `Request`/`Response` objects or a jsdom
 * approximation. These tests check the two claims the whole design rests on:
 * script cannot read the session cookie, and the server turns away a real
 * navigation before the page renders.
 */

const EMAIL = 'ada@example.com';
const PASSWORD = 'password';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
}

test.describe('session lifecycle', () => {
  test('signs in, reaches the dashboard, and keeps the cookie away from script', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(page.getByText('You are signed out.')).toBeVisible();

    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Rendered on the server, for Ada Lovelace.')).toBeVisible();

    // ── The headline assertion ────────────────────────────────────────────
    const scriptVisible = await page.evaluate(() => document.cookie);
    expect(scriptVisible).not.toContain('session');

    // The cookie does exist — the browser has it and will send it.
    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name.includes('session'));
    expect(session, 'a session cookie should have been set').toBeTruthy();
    expect(session!.httpOnly).toBe(true);
    expect(session!.sameSite).toBe('Lax');

    // And it is opaque: the access token is not sitting in it.
    expect(session!.value).not.toContain('header.');

    // The CSRF cookie is readable on purpose — the client echoes it back.
    expect(scriptVisible).toContain('csrf');
  });

  test('never exposes a token to the page', async ({ page }) => {
    await signIn(page);

    // The dashboard prints a truncated token server-side, but nothing
    // token-shaped should be reachable from client storage.
    const storage = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
      cookie: document.cookie,
    }));

    expect(storage.local).toBe('{}');
    expect(storage.session).toBe('{}');
    expect(storage.cookie).not.toContain('header.');
  });

  test('survives a reload without a flash of signed-out UI', async ({ page }) => {
    await signIn(page);
    await page.goto('/');

    // `initialSession` comes from the server, so the signed-in branch is in the
    // very first HTML rather than appearing after a client fetch.
    const html = await page.content();
    expect(html).toContain('You are signed in');
    await expect(page.getByText('You are signed out.')).toBeHidden();
  });

  test('signs out and drops the cookie', async ({ page, context }) => {
    await signIn(page);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/dashboard'));

    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name.includes('session'))).toBeFalsy();
  });
});

test.describe('server-side enforcement', () => {
  test('middleware redirects an unauthenticated navigation', async ({ page }) => {
    await page.goto('/dashboard');

    // Not a client-side redirect — the server refused before rendering.
    await expect(page).toHaveURL(/\/login/);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard');
  });

  test('middleware still redirects after signing out', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/dashboard'));

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('rejects a login without a CSRF token', async ({ request }) => {
    // A bare API call, as a cross-site form post would be.
    const response = await request.post('/api/auth/login', {
      data: { email: EMAIL, password: PASSWORD },
    });

    expect(response.status()).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'csrf_failed' });
  });

  test('rejects wrong credentials without revealing which field was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Wrong email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('the session endpoint is not cacheable', async ({ page }) => {
    await page.goto('/');
    const response = await page.request.get('/api/auth/session');
    expect(response.headers()['cache-control']).toBe('no-store');
  });
});
