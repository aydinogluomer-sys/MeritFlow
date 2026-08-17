import { test, expect } from '@playwright/test';

// ENGINEERING-11 — authenticated read-path smoke for the HR fixture (hr-a@acme.test).
// Seeded HR permissions: period.manage, calculation.approve, dispute.resolve, audit.read,
// comp.read (NOT payout.export, NOT user.invite). storageState is applied by the
// `authenticated-hr` project (playwright.config).
//
// Positive routes assert the page rendered (not bounced to /login or /unauthorized) with its
// h1. Negative routes assert the SERVER-SIDE authz redirect to /unauthorized — proving the
// gate is server-side + RLS, never client-trusted (CLAUDE.md / AD1). This suite also guards
// the getActiveOrg self-scoping fix (org.ts): a regression would resolve hr-a to another
// member's role and flip these expectations.

test.describe('authenticated HR', () => {
  test('reaches the dashboard (session is live)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Pano' })).toBeVisible();
  });

  test('can open bonus periods (period.manage)', async ({ page }) => {
    await page.goto('/bonus/periods');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Prim dönemleri' }),
    ).toBeVisible();
  });

  test('can open the audit log (audit.read)', async ({ page }) => {
    await page.goto('/audit');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Denetim kayıtları' }),
    ).toBeVisible();
  });

  test('can open disputes (dispute.resolve)', async ({ page }) => {
    await page.goto('/disputes');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'İtirazlar' })).toBeVisible();
  });

  test('can open the leaderboard', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sıralama' })).toBeVisible();
  });

  test('is denied payroll exports (no payout.export) → /unauthorized', async ({ page }) => {
    await page.goto('/payroll/exports');
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page.getByRole('heading', { name: 'Erişim yok' })).toBeVisible();
  });

  test('is denied member admin (no user.invite) → /unauthorized', async ({ page }) => {
    await page.goto('/admin/members');
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page.getByRole('heading', { name: 'Erişim yok' })).toBeVisible();
  });

  // ENGINEERING-12 slice C — the SLO dashboard uses the same admin gate as /admin/members
  // (user.invite). HR lacks it, so HR is redirected. This documents + guards the permission
  // boundary (an owner/admin session would render the dashboard instead; no admin fixture exists
  // in this suite, so the positive-200 path is covered by build + the server gate).
  test('is denied the SLO dashboard (no user.invite) → /unauthorized', async ({ page }) => {
    await page.goto('/admin/slo');
    await expect(page).toHaveURL(/\/unauthorized/);
    await expect(page.getByRole('heading', { name: 'Erişim yok' })).toBeVisible();
  });
});
