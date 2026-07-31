import { test, expect } from '@playwright/test';

// Minimal E2E smoke scaffold. NOT wired into CI yet (Decision E — deferred to Phase 9).
// Run locally with a booted Supabase stack + env: `npm run test:e2e`.

test('health endpoint responds ok', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe('ok');
});

test('protected route redirects unauthenticated users to /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
