import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * End-to-end tests against the Next.js example.
 *
 * These exist for the assertions unit tests structurally cannot make: that a
 * real browser refuses to expose the session cookie to script, and that the
 * middleware turns away a real navigation.
 *
 * Requires the library to be built first — the example depends on it by path.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : [['list']],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // `dev` rather than `start`: a production build sets Secure cookies, and
    // relying on the browser's localhost exemption would make this test a worse
    // model of how the library behaves over plain HTTP.
    command: `pnpm --dir examples/next-js dev --port ${PORT}`,
    url: BASE_URL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      AUTH_SECRET: 'e2e-test-secret-at-least-32-characters!!',
    },
  },
});
