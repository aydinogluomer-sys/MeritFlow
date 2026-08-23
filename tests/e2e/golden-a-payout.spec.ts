import { test, expect } from '@playwright/test';
import {
  adminClient,
  createTestTask,
  getTask,
  getPointLedgerEntries,
  getBonusPool,
  getLatestCalculationRun,
  getLatestSnapshot,
  getExports,
  getAuditRows,
  runReconciliation,
} from './helpers/db-admin';

// ENGINEERING-17 Golden A — full normal payout chain. HYBRID (per approved design): UI for the
// form-driven steps (submit, review, period/pool create, export, mark-paid); service-role DB for
// the steps with NO UI in the app (period/pool lock, run-calculation, snapshot approval). Each step
// verifies its effect via the service-role DB helpers; the chain ends with a clean reconciliation.

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const TEAM_ALPHA = 'a0000000-0000-0000-0000-0000000000f1';
const MGR_ID = 'a0000000-0000-0000-0000-0000000000a5';
const EMP_ALPHA_ID = 'a0000000-0000-0000-0000-0000000000a7';
const HR_ID = 'a0000000-0000-0000-0000-0000000000a3';

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// ENGINEERING-27: derive the offset from the CI run number, NOT the wall clock. This keeps period
// dates deterministic within a run (a re-run reproduces the same dates) while staying unique across
// runs (no cross-run period collision). `Date.now() % 300` was non-reproducible.
const RUN_OFFSET_DAYS = Number(process.env.GITHUB_RUN_NUMBER ?? '0') % 300;
const STARTS = formatDate(new Date(Date.UTC(2099, 0, 1 + RUN_OFFSET_DAYS)));
const ENDS = formatDate(new Date(Date.UTC(2099, 0, 31 + RUN_OFFSET_DAYS)));

let taskId: string;
let periodId: string;

test.describe.serial('Golden A — full normal payout', () => {
  test.beforeAll(async () => {
    // Pre-create the task in 'in_progress' (the detail page shows the submit form only for an
    // in_progress task viewed by its assignee).
    taskId = await createTestTask({
      organizationId: ORG_A,
      teamId: TEAM_ALPHA,
      createdBy: MGR_ID,
      assignedTo: EMP_ALPHA_ID,
      title: `E2E Golden A — ${Date.now()}`,
      status: 'in_progress',
    });
  });

  test('A1 — employee submits the task (UI)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/emp-user.json' });
    const page = await ctx.newPage();
    await page.goto(`/tasks/${taskId}`);
    await page.getByRole('button', { name: 'İncelemeye gönder' }).click();
    await expect(async () => {
      const task = await getTask(taskId);
      expect(task?.status).toBe('submitted');
    }).toPass({ timeout: 15_000, intervals: [1_000] });
    await ctx.close();
  });

  test('A2 — manager reviews + approves (UI)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/mgr-user.json' });
    const page = await ctx.newPage();
    await page.goto(`/tasks/${taskId}/review`);
    // Native <select>s (labels Karar/Kalite/Zamanlama); Karar defaults to 'approve'.
    await page.getByLabel('Kalite').selectOption('good');
    await page.getByLabel('Zamanlama').selectOption('on_time');
    await page.getByRole('button', { name: 'İncelemeyi kaydet' }).click();

    await expect(async () => {
      const task = await getTask(taskId);
      expect(task?.status).toBe('approved');
      expect(Number(task?.final_points)).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000, intervals: [1_000] });

    // point_ledger has a task_approved earning row for this task (event_type is the marker).
    const ledger = await getPointLedgerEntries(taskId);
    expect(ledger.length).toBeGreaterThanOrEqual(1);
    expect(ledger.some((e) => e.event_type === 'task_approved')).toBe(true);
    await ctx.close();
  });

  test('A3 — HR creates bonus period (UI)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/hr-user.json' });
    const page = await ctx.newPage();
    await page.goto('/bonus/periods');
    await page.getByLabel('Başlangıç').fill(STARTS);
    await page.getByLabel('Bitiş').fill(ENDS);
    await page.getByRole('button', { name: 'Dönem oluştur' }).click();

    await expect(async () => {
      const { data } = await adminClient()
        .from('bonus_periods')
        .select('id')
        .eq('organization_id', ORG_A)
        .eq('starts_on', STARTS)
        .eq('ends_on', ENDS)
        .maybeSingle();
      expect(data?.id).toBeTruthy();
      periodId = data!.id as string;
    }).toPass({ timeout: 15_000, intervals: [1_000] });
    await ctx.close();
  });

  test('A4 — Finance creates bonus pool (UI)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/finance-user.json' });
    const page = await ctx.newPage();
    await page.goto('/bonus/periods');
    // Pool form: select the period by value (id), amount in TL (major units).
    await page.getByLabel('Dönem').selectOption(periodId);
    await page.getByLabel('Tutar (TL)').fill('1000');
    await page.getByRole('button', { name: 'Havuz oluştur' }).click();

    await expect(async () => {
      const pool = await getBonusPool(periodId);
      expect(pool?.status).toBe('draft');
    }).toPass({ timeout: 15_000, intervals: [1_000] });
    await ctx.close();
  });

  test('A5 — lock period + pool and run calculation (service-role: no lock/calc UI)', async () => {
    const admin = adminClient();
    // Pool draft→locked (t_org set), then period open→locked (mirrors the seed state-machine path).
    await admin
      .from('bonus_pools')
      .update({ status: 'locked', t_org: 1, locked_at: new Date().toISOString(), locked_by: HR_ID })
      .eq('bonus_period_id', periodId)
      .eq('status', 'draft');
    await admin
      .from('bonus_periods')
      .update({ status: 'locked', locked_at: new Date().toISOString(), locked_by: HR_ID })
      .eq('id', periodId)
      .eq('status', 'open');

    const pool = await getBonusPool(periodId);
    const { error } = await admin.rpc('run_bonus_calculation', {
      p_organization_id: ORG_A,
      p_bonus_period_id: periodId,
      p_bonus_pool_id: pool!.id as string,
      p_idempotency_key: `golden-a-${periodId}`,
      p_triggered_by: HR_ID,
    });
    expect(error).toBeNull();

    await expect(async () => {
      const run = await getLatestCalculationRun(periodId);
      expect(run?.status).toBe('completed');
    }).toPass({ timeout: 30_000, intervals: [2_000] });
  });

  test('A6 — approve snapshot + period (service-role: no approval UI)', async () => {
    const admin = adminClient();
    const snapshot = await getLatestSnapshot(periodId);
    await admin
      .from('bonus_allocation_snapshots')
      .update({ approved_at: new Date().toISOString(), approved_by: HR_ID })
      .eq('id', snapshot!.id as string);
    await admin.from('bonus_periods').update({ status: 'approved' }).eq('id', periodId);

    const approved = await getLatestSnapshot(periodId);
    expect(approved?.approved_at).not.toBeNull();
    const period = await admin.from('bonus_periods').select('status').eq('id', periodId).single();
    expect(period.data?.status).toBe('approved');
  });

  test('A7 — Finance exports payout (UI)', async ({ browser }) => {
    const before = (await getExports(periodId)).length;
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/finance-user.json' });
    const page = await ctx.newPage();
    await page.goto('/payroll/exports');
    const snapshot = await getLatestSnapshot(periodId);
    await page.getByLabel('Prim dönemi (onaylı)').selectOption(periodId);
    await page.getByLabel('Onaylı anlık görüntü').selectOption(snapshot!.id as string);
    await page.getByLabel('Biçim').selectOption('csv');
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Dışa aktarım üret' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Dışa aktarım üret' }).click();
    }

    await expect(async () => {
      const exports = await getExports(periodId);
      expect(exports.length).toBeGreaterThanOrEqual(before + 1);
      expect(exports.length - before).toBeLessThanOrEqual(1);
    }).toPass({ timeout: 15_000, intervals: [1_000] });
    await ctx.close();
  });

  test('A7-dup — exported period is no longer offered for new exports (UI)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/finance-user.json' });
    const page = await ctx.newPage();
    await page.goto('/payroll/exports');
    await expect(page.locator(`#export-period option[value="${periodId}"]`)).toHaveCount(0);
    await ctx.close();
  });

  test('A8 — Finance marks paid; refresh preserves state (UI)', async ({ browser }) => {
    const exportId = (await getExports(periodId))[0]!.id as string;
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/finance-user.json' });
    const page = await ctx.newPage();
    await page.goto(`/payroll/exports/${exportId}`);
    await page.getByRole('button', { name: 'Ödendi olarak işaretle' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Ödendi olarak işaretle' }).click();

    // The period transitions exported→closed (mark_payout_paid). Verify via DB, then reload.
    await expect(async () => {
      const period = await adminClient()
        .from('bonus_periods')
        .select('status')
        .eq('id', periodId)
        .single();
      expect(period.data?.status).toBe('closed');
    }).toPass({ timeout: 15_000, intervals: [1_000] });
    await page.reload();
    await expect(page.getByRole('heading')).toBeVisible();
    await ctx.close();
  });

  test('A9 — audit log has rows for the approved task + the export', async () => {
    const taskAudit = await getAuditRows(taskId);
    expect(taskAudit.length).toBeGreaterThanOrEqual(1);
    const exportId = (await getExports(periodId))[0]!.id as string;
    const exportAudit = await getAuditRows(exportId);
    expect(exportAudit.length).toBeGreaterThanOrEqual(1);
  });

  test('A10 — reconciliation clean after the full payout chain', async () => {
    const result = await runReconciliation(ORG_A);
    expect(result.criticalFindings).toHaveLength(0);
  });
});
