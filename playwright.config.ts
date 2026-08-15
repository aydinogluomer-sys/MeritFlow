import { defineConfig, devices } from '@playwright/test';

// E2E (ENGINEERING-11): unauthenticated route-guards + authenticated read-path smoke.
// The `setup` project signs in the seeded test users and writes storageState; the
// authenticated-* projects consume it. Runs against `next dev` with a booted, seeded
// Supabase stack + local keys in the env (CI: the e2e job exports them into GITHUB_ENV).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
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
  ],
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
