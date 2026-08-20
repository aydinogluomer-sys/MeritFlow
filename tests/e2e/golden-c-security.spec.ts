import { test, expect } from '@playwright/test';
import { adminClient, createTestTask, createTestPeriod, getTask } from './helpers/db-admin';

// ENGINEERING-17 Golden C — cross-tenant IDOR (RLS), role-boundary redirects, and the D3 block.
// These are true UI E2E: real navigation + server-side authz/RLS.

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const TEAM_ALPHA = 'a0000000-0000-0000-0000-0000000000f1';
const MGR_ID = 'a0000000-0000-0000-0000-0000000000a5';
const EMP_ALPHA_ID = 'a0000000-0000-0000-0000-0000000000a7';

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

const RUN_OFFSET_DAYS = Date.now() % 300;
const PERIOD_START = formatDate(new Date(Date.UTC(2099, 0, 1 + RUN_OFFSET_DAYS)));
const PERIOD_END = formatDate(new Date(Date.UTC(2099, 0, 30 + RUN_OFFSET_DAYS)));

let orgATaskId: string;

test.describe('Golden C — cross-tenant IDOR + role boundary', () => {
  test.beforeAll(async () => {
    orgATaskId = await createTestTask({
      organizationId: ORG_A,
      teamId: TEAM_ALPHA,
      createdBy: MGR_ID,
      assignedTo: EMP_ALPHA_ID,
      title: `E2E Golden C cross-tenant — ${Date.now()}`,
      status: 'submitted',
    });
  });

  test('C1 — Org B employee cannot read an Org A task (cross-tenant IDOR via RLS)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/emp-b-user.json' });
    const page = await ctx.newPage();
    await page.goto(`/tasks/${orgATaskId}`);
    // Org B passes the permission gate (employee has task.submit) but RLS returns no row → the
    // "not found / no access" empty state, NEVER the task content.
    await expect(page.getByText('Görev bulunamadı veya görüntüleme yetkin yok.')).toBeVisible({
      timeout: 10_000,
    });
    const title = (await getTask(orgATaskId))?.title as string;
    await expect(page.getByText(title)).toHaveCount(0);
    await ctx.close();
  });

  test('C2 — Org B employee cannot reach /payroll/exports → /unauthorized', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/emp-b-user.json' });
    const page = await ctx.newPage();
    await page.goto('/payroll/exports');
    await expect(page).toHaveURL(/\/unauthorized/);
    await ctx.close();
  });

  test('C3 — Org A employee cannot reach /payroll/exports → /unauthorized', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/emp-user.json' });
    const page = await ctx.newPage();
    await page.goto('/payroll/exports');
    await expect(page).toHaveURL(/\/unauthorized/);
    await ctx.close();
  });

  test('C4 — Org A employee cannot reach /bonus/periods → /unauthorized', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/emp-user.json' });
    const page = await ctx.newPage();
    await page.goto('/bonus/periods');
    await expect(page).toHaveURL(/\/unauthorized/);
    await ctx.close();
  });

  test('C5 — Finance cannot reach /bonus/periods/[id] (no period.manage) → /unauthorized', async ({ browser }) => {
    const periodId = await createTestPeriod({
      organizationId: ORG_A,
      startsOn: PERIOD_START,
      endsOn: PERIOD_END,
    });
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/finance-user.json' });
    const page = await ctx.newPage();
    await page.goto(`/bonus/periods/${periodId}`);
    await expect(page).toHaveURL(/\/unauthorized/);
    await ctx.close();
  });

  test('C6 — D3: approve with quality=poor is blocked server-side (no approval)', async ({ browser }) => {
    const taskId = await createTestTask({
      organizationId: ORG_A,
      teamId: TEAM_ALPHA,
      createdBy: MGR_ID,
      assignedTo: EMP_ALPHA_ID,
      title: `E2E Golden C D3 — ${Date.now()}`,
      status: 'submitted',
    });

    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/mgr-user.json' });
    const page = await ctx.newPage();
    await page.goto(`/tasks/${taskId}/review`);
    // Karar defaults to 'approve'; set Kalite='poor' → the server D3 guard must reject.
    await page.getByLabel('Kalite').selectOption('poor');
    await page.getByRole('button', { name: 'İncelemeyi kaydet' }).click();

    // The D3 message surfaces (inline hint + server ErrorState both carry "D3").
    await expect(page.getByText(/D3/).first()).toBeVisible({ timeout: 10_000 });
    // The task stays 'submitted' — no approval, no earning row.
    const task = await getTask(taskId);
    expect(task?.status).toBe('submitted');
    await ctx.close();
  });
});
