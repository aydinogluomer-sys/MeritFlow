import { test, expect } from '@playwright/test';

// ENGINEERING-11 — TEMPORARY DIAGNOSTIC (will be replaced by the real HR read-path suite).
// Runtime showed the HR session resolving to a permission set that contradicts the seed
// (reaches /admin/members, denied /disputes). Job logs need repo-admin auth, so this dumps
// the session identity + per-route outcome into the failing-test message, which the `github`
// reporter surfaces as a Checks-API annotation (readable without logs).

test('DIAGNOSTIC — hr session identity + per-route outcomes', async ({ page }) => {
  const routes = [
    '/dashboard',
    '/tasks',
    '/bonus/periods',
    '/audit',
    '/disputes',
    '/leaderboard',
    '/points',
    '/payroll/exports',
    '/admin/members',
  ];
  const lines: string[] = [];
  await page.goto('/dashboard');
  const welcome = await page
    .getByText('Hoş geldin', { exact: false })
    .first()
    .innerText()
    .catch(() => '(no welcome text)');
  lines.push(`WELCOME=${welcome.replace(/\s+/g, ' ').trim()}`);
  for (const route of routes) {
    await page.goto(route);
    const pathname = new URL(page.url()).pathname;
    const h1 = await page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => '(no h1)');
    lines.push(`${route} -> ${pathname} | h1="${h1.replace(/\s+/g, ' ').trim()}"`);
  }
  const dump = '\n' + lines.join('\n');
  expect(dump, dump).toBe('__SHOW_DIAGNOSTIC__');
});
