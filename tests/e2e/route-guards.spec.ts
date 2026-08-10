import { test, expect } from '@playwright/test';

// Unauthenticated route-guard smoke (Phase 9-D). NOT wired into CI yet
// (Decision E — deferred to Phase 9). Run locally with a booted Supabase
// stack + env: `npm run test:e2e`.
//
// Asserts the (app) shell guard: `app/(app)/layout.tsx` redirects any request
// without a session to /login (`if (!user) redirect('/login')`; middleware also
// guards, this is defense-in-depth). No seeded auth is required — we only cover
// the unauthenticated → /login path. The authenticated-but-unpermitted →
// /unauthorized path needs seeded users and is out of smoke scope.
//
// Dynamic routes (e.g. /tasks/[id], /bonus/periods/[id]) are intentionally
// omitted: the guard runs in the shared layout before any param-specific code,
// so a static route per protected segment fully exercises the redirect.

const PROTECTED_ROUTES = [
  '/tasks',
  '/bonus/periods',
  '/disputes',
  '/payroll/exports',
  '/points',
  '/points/override',
  '/leaderboard',
  '/audit',
  '/anti-gaming',
  '/dashboard',
] as const;

for (const route of PROTECTED_ROUTES) {
  test(`unauthenticated ${route} → /login`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login/);
  });
}
