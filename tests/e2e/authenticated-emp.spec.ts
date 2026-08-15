import { test, expect } from '@playwright/test';

// ENGINEERING-11 — authenticated read-path smoke for the employee fixture
// (emp-alpha-a@acme.test). Seeded employee permissions: task.submit, dispute.open (nothing
// else). storageState is applied by the `authenticated-emp` project (playwright.config).
//
// Positive routes assert the page rendered with its h1; permission-gated routes assert the
// server-side authz redirect to /unauthorized (CLAUDE.md / AD1).

test.describe('authenticated employee', () => {
  test('reaches the dashboard (session is live)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Pano' })).toBeVisible();
  });

  test('can open their tasks (task.submit)', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Görevler' })).toBeVisible();
  });

  test('can open their points', async ({ page }) => {
    await page.goto('/points');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Puanlarım' })).toBeVisible();
  });

  test('can open disputes (dispute.open)', async ({ page }) => {
    await page.goto('/disputes');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'İtirazlar' })).toBeVisible();
  });

  test('can open the leaderboard', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sıralama' })).toBeVisible();
  });

  test('is denied bonus periods (no period.manage) → /unauthorized', async ({ page }) => {
    await page.goto('/bonus/periods');
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page.getByRole('heading', { name: 'Erişim yok' })).toBeVisible();
  });

  test('is denied member admin (no user.invite) → /unauthorized', async ({ page }) => {
    await page.goto('/admin/members');
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page.getByRole('heading', { name: 'Erişim yok' })).toBeVisible();
  });
});
