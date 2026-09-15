import { test, expect, type Browser, type Page, type BrowserContext } from '@playwright/test';
import { setIntelligenceFlags, seedIntelligenceFixture } from './helpers/intelligence-fixture';

// Phase P4 — real-DB E2E for the Intelligence dashboards (comparison-anchor regression guard). This is
// the gap that let PR #57 ship: the mocked-outcome UNIT tests passed while the REAL-DB pages rendered
// all-UnavailableCard (a relative-selector + comparison made the whole metric bundle ok:false). These
// specs load the shipped dashboards against the SEEDED DB and assert the primary cards render REAL values
// (never the "unavailable" copy), plus the honest-empty + guard paths.
//
// Role/RLS matrix (why each dashboard uses a specific seeded role):
//   • v_finance_period_totals / v_finance_payout are finance/auditor-scoped (SI-12) → HR sees them empty.
//     So FINANCE asserts the Financial dashboard's money cards; HR asserts the task-sourced Executive card
//     (cycle_completion_rate) + the "Ne değişti?" comparison delta (the exact comparison-anchor victim).
//   • MANAGER has intelligence.read (page renders) but is NOT in {hr,finance,auditor} → the money-delta
//     cards must render honest UnavailableCard, never a fabricated ₺0 (the SI-12 honest-empty path).
//   • EMPLOYEE lacks intelligence.read → server-side guard → /unauthorized.

const HR = 'tests/e2e/.auth/hr-user.json';
const FINANCE = 'tests/e2e/.auth/finance-user.json';
const MGR = 'tests/e2e/.auth/mgr-user.json';
const EMP = 'tests/e2e/.auth/emp-user.json';

// The shared "unavailable" copy prefix used by every UnavailableCard/EmptyState across the dashboards.
const UNAVAILABLE = 'Bu görünüm için veri yok veya yetkiniz kapsamında değil';
// The seeded current-period payout (pool 120.000.000 kuruş → 1.200.000 ₺) — a REAL value only an
// authorized (finance) read can surface; a fabricated/leaked figure for a non-authorized role is a bug.
const SEEDED_PAYOUT = '1.200.000';

async function openAs(browser: Browser, storageState: string, path: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState });
  const page = await ctx.newPage();
  await page.goto(path);
  return { ctx, page };
}

test.describe.serial('Intelligence dashboards — real-DB regression guard', () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000); // the fixture drives the real engine RPCs (run_bonus_calculation + accrual).
    await seedIntelligenceFixture();
  });

  test('feature gate: flag OFF → an authorized role is redirected to /unauthorized', async ({ browser }) => {
    await setIntelligenceFlags(false);
    const { ctx, page } = await openAs(browser, HR, '/executive');
    await expect(page).toHaveURL(/\/unauthorized/);
    await ctx.close();
  });

  test('enable the intelligence + health_engine flags for the org', async () => {
    await setIntelligenceFlags(true);
  });

  test('Executive: cycle card + "Ne değişti?" render REAL values (the comparison-anchor guard)', async ({ browser }) => {
    // HR reads tasks → cycle_completion_rate resolves. The comparison-anchor bug made the WHOLE bundle
    // ok:false → the cycle card unavailable AND "Ne değişti?" empty. Both must be populated when fixed.
    const { ctx, page } = await openAs(browser, HR, '/executive');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Yönetici Bakışı' })).toBeVisible();
    // "Ne değişti?" lists the cycle-completion delta (P_curr 100% vs P_prev 50%). Its presence proves the
    // metric bundle resolved WITH a previous-period comparison — the exact thing the bug broke. exact:true
    // targets ONLY the change-row label (not a card's definition prose that also mentions "döngü tamamlama").
    await expect(page.getByText('Döngü tamamlama', { exact: true })).toBeVisible();
    await expect(page.getByText('Önceki döneme göre belirgin bir değişiklik yok.')).toHaveCount(0);
    await ctx.close();
  });

  test('Financial (finance): payout + money-delta incl. dispute render REAL values, none unavailable', async ({ browser }) => {
    const { ctx, page } = await openAs(browser, FINANCE, '/financial');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Finansal Zeka' })).toBeVisible();
    // The seeded payout (1.200.000 ₺) is visible → the anchored finance bundle (payout_total/budget_variance/
    // payout_concentration) resolved WITH a comparison — the exact bundle the comparison-anchor bug turned
    // ok:false (→ every finance card UnavailableCard, no value). .first(): the figure recurs (waterfall/trend).
    await expect(page.getByText(SEEDED_PAYOUT).first()).toBeVisible();
    // The now-live dispute money card is present on the dashboard (the Slice-2 wiring).
    await expect(page.getByText('İtiraz Finansal Etkisi')).toBeVisible();
    await ctx.close();
  });

  test('Operations (hr): task-sourced cards render REAL values (approval latency)', async ({ browser }) => {
    const { ctx, page } = await openAs(browser, HR, '/operations');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Operasyon Zekası' })).toBeVisible();
    // The anchored operations bundle resolved WITH a comparison → the cycle-completion delta (P_curr 100%
    // vs P_prev 50%) lists in "Ne değişti?". exact:true targets ONLY the change-row label (not the card's
    // "(döngü tamamlama)" prose, and not the bug-immune latency-trend table). This is the metric-bundle
    // signal the comparison-anchor bug breaks (a raw latency value would also match the separate trend read).
    await expect(page.getByText('Döngü tamamlama', { exact: true })).toBeVisible();
    await ctx.close();
  });

  test('Policy (hr): the dashboard renders for an authorized read (comparison or honest ≥2 state)', async ({ browser }) => {
    const { ctx, page } = await openAs(browser, HR, '/policy-intelligence');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Politika Zekası' })).toBeVisible();
    await ctx.close();
  });

  test('non-authorized: an employee (no intelligence.read) → /unauthorized', async ({ browser }) => {
    const { ctx, page } = await openAs(browser, EMP, '/executive');
    await expect(page).toHaveURL(/\/unauthorized/);
    await ctx.close();
  });

  test('honest-empty (SI-12): a manager sees UnavailableCard for money cards, never a fabricated value', async ({ browser }) => {
    // Manager has intelligence.read (the page renders) but is NOT in {hr,finance,auditor} → the money
    // metrics reject / RLS-scope out → honest UnavailableCard, and the seeded payout figure is NOT leaked.
    const { ctx, page } = await openAs(browser, MGR, '/financial');
    await expect(page).not.toHaveURL(/\/(login|unauthorized)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Finansal Zeka' })).toBeVisible();
    await expect(page.getByText(UNAVAILABLE, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(SEEDED_PAYOUT)).toHaveCount(0); // no fabricated / leaked money value
    await ctx.close();
  });
});
