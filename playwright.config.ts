import { defineConfig, devices } from '@playwright/test';

// E2E (ENGINEERING-11): unauthenticated route-guards + authenticated read-path smoke.
// The `setup` project signs in the seeded test users and writes storageState; the
// authenticated-* projects consume it. Runs against `next dev` with a booted, seeded
// Supabase stack + local keys in the env (CI: the e2e job exports them into GITHUB_ENV).
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // retries: 2 is INFRA-stability tolerance only (Supabase start, Next.js 180s webServer boot, and
  // other transient CI startup hiccups). Logic/assertion flakes MUST NOT be masked with retries —
  // fix the root cause. The stability script (scripts/test-stability.sh) runs golden x10 with
  // --retries=0 to surface true flakes. (ENGINEERING-27)
  retries: process.env.CI ? 2 : 0,
  // In CI also emit the `github` reporter: failed tests become ::error:: annotations that are
  // readable via the public Checks API (job logs require repo-admin auth), so a failure's exact
  // assertion message is diagnosable without log access.
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    navigationTimeout: 45_000,
  },
  projects: [
    // Signs in the seeded users and persists storageState (auth-token cookies).
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    // Unauthenticated guards (smoke + route-guards) — no storageState.
    {
      name: 'chromium',
      testMatch: /(smoke|route-guards)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Authenticated read-path smoke, one project per seeded role/fixture.
    {
      name: 'authenticated-hr',
      testMatch: /authenticated-hr\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/hr-user.json' },
    },
    {
      name: 'authenticated-emp',
      testMatch: /authenticated-emp\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/emp-user.json' },
    },
    // ENGINEERING-17 — golden-path fixtures.
    {
      name: 'authenticated-mgr',
      testMatch: /authenticated-mgr\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/mgr-user.json' },
    },
    {
      name: 'authenticated-finance',
      testMatch: /authenticated-finance\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/finance-user.json' },
    },
    // Golden multi-actor chains: no default storageState — each test opens its own contexts with
    // the right role's storageState directly. trace kept on failure for CI diagnosis.
    {
      name: 'golden',
      testMatch: /golden-(a|b|c)-.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], trace: 'retain-on-failure' },
    },
  ],
  // CI runs the PRODUCTION server (routes pre-compiled by an earlier `next build` step) so
  // navigations are fast and deterministic — `next dev` cold-compiles each route on first hit,
  // which blows past the navigation timeout under parallel CI load. Locally we keep `next dev`
  // for convenience (reuseExistingServer picks up an already-running dev server).
  webServer: {
    command: process.env.CI
      ? 'npm run start -- --hostname 127.0.0.1 --port 3000'
      : 'npm run dev -- --hostname 127.0.0.1 --port 3000',
    // Probe the health route, not `/`: this app has no root page (`/` → 404), and Playwright
    // only treats a server as ready on 2xx/3xx/40x — a 404 root would hang until timeout.
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
