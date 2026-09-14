import { describe, expect, it } from 'vitest';
import {
  executeSemanticQuery,
  buildDrillQuery,
  availableDrillLevels,
  isMetricExecutable,
  type SemanticQueryOutcome,
} from '@/modules/intelligence';
import { fakeSupabase } from './fake-supabase';

// Deterministic fixture ids (valid uuids — the period selector requires uuid).
const ORG = 'a0000000-0000-4000-8000-000000000001';
const P1 = 'a0000000-0000-4000-8000-0000000000f1'; // Jan 2026
const P2 = 'a0000000-0000-4000-8000-0000000000f2'; // Feb 2026 (newer)
const EMP1 = 'a0000000-0000-4000-8000-0000000000e1';
const EMP2 = 'a0000000-0000-4000-8000-0000000000e2';
const EMP3 = 'a0000000-0000-4000-8000-0000000000e3';
const EMP4 = 'a0000000-0000-4000-8000-0000000000e4';
const VER1 = 'a0000000-0000-4000-8000-0000000000d1';
const VER2 = 'a0000000-0000-4000-8000-0000000000d2';
const TEAM1 = 'a0000000-0000-4000-8000-0000000000c1';
const TEAM2 = 'a0000000-0000-4000-8000-0000000000c2';
const FIXED = '2026-03-01T00:00:00.000Z';
const READ = ['intelligence.read'];
const READ_MANAGE = ['intelligence.read', 'intelligence.manage'];
const PERIOD_P1 = { kind: 'bonus_period', bonusPeriodId: P1 } as const;

type Tables = Record<string, Record<string, unknown>[]>;

function base(over: Tables = {}): Tables {
  return {
    feature_flags: [{ organization_id: ORG, flag_key: 'intelligence', enabled: true, stage: 'beta' }],
    bonus_periods: [
      { id: P1, organization_id: ORG, starts_on: '2026-01-01', ends_on: '2026-01-31' },
      { id: P2, organization_id: ORG, starts_on: '2026-02-01', ends_on: '2026-02-28' },
    ],
    ...over,
  };
}

function run(query: unknown, perms: string[] = READ, over: Tables = {}, role?: string): Promise<SemanticQueryOutcome> {
  return executeSemanticQuery(
    fakeSupabase(base(over)),
    { organizationId: ORG, permissions: perms, ...(role ? { role } : {}) },
    query,
    { computedAt: FIXED },
  );
}

/** Narrow to the ok branch or fail loudly (keeps each assertion readable). */
function ok(outcome: SemanticQueryOutcome) {
  if (!outcome.ok) throw new Error(`expected ok, got ${JSON.stringify(outcome)}`);
  return outcome;
}

describe('semantic query service — feature gate + validation + executability (§10.11/§26)', () => {
  it('rejects when the intelligence feature flag is off (fail-closed)', async () => {
    const out = await run({ metrics: ['payout_total'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
      feature_flags: [], // no row → disabled
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.executionErrors?.[0]?.code).toBe('feature_disabled');
  });

  it('rejects a dimension not allowed for the metric (P0 validator)', async () => {
    const out = await run({ metrics: ['opportunity_index'], dimensions: ['dispute_type'], filters: [], period: PERIOD_P1 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.validationErrors?.some((e) => e.code === 'dimension_not_allowed_for_metric')).toBe(true);
  });

  it('rejects a sensitive (employee) dimension without intelligence.manage — no person-level leak', async () => {
    const out = await run({ metrics: ['opportunity_index'], dimensions: ['employee'], filters: [], period: PERIOD_P1 }, READ);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.validationErrors?.some((e) => e.code === 'sensitive_dimension_permission_denied')).toBe(true);
  });

  it('rejects a registry-allowed but non-servable dimension (budget_variance by team)', async () => {
    const out = await run({ metrics: ['budget_variance'], dimensions: ['team'], filters: [], period: PERIOD_P1 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.executionErrors?.some((e) => e.code === 'dimension_not_executable')).toBe(true);
  });

  it('rejects an unsupported filter operator (only eq/in are executable)', async () => {
    const out = await run({
      metrics: ['budget_variance'],
      dimensions: [],
      filters: [{ dimension: 'bonus_period', operator: 'gt', value: P1 }],
      period: PERIOD_P1,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.executionErrors?.some((e) => e.code === 'filter_not_executable')).toBe(true);
  });

  it('rejects more than one group-by dimension in 8-A1', async () => {
    const out = await run(
      { metrics: ['approval_latency'], dimensions: ['team', 'task_type'], filters: [], period: PERIOD_P1 },
      READ,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.executionErrors?.some((e) => e.code === 'dimension_not_executable')).toBe(true);
  });
});

describe('metric executors — exact deterministic formulas', () => {
  it('opportunity_index = mean of NON-NULL indices (suppressed NULL excluded)', async () => {
    const out = ok(
      await run({ metrics: ['opportunity_index'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
        opportunity_snapshots: [
          { organization_id: ORG, bonus_period_id: P1, employee_id: EMP1, opportunity_index: 60 },
          { organization_id: ORG, bonus_period_id: P1, employee_id: EMP2, opportunity_index: 80 },
          { organization_id: ORG, bonus_period_id: P1, employee_id: EMP3, opportunity_index: null },
        ],
      }),
    );
    expect(out.metrics[0]!.results).toHaveLength(1);
    expect(out.metrics[0]!.results[0]).toMatchObject({ value: 70, unit: 'score', dimensions: {}, sourceVersion: 'metrics-v1' });
  });

  it('opportunity_index groups by employee (sensitive → requires intelligence.manage)', async () => {
    const out = ok(
      await run({ metrics: ['opportunity_index'], dimensions: ['employee'], filters: [], period: PERIOD_P1 }, READ_MANAGE, {
        opportunity_snapshots: [
          { organization_id: ORG, bonus_period_id: P1, employee_id: EMP1, opportunity_index: 60 },
          { organization_id: ORG, bonus_period_id: P1, employee_id: EMP2, opportunity_index: 80 },
        ],
      }),
    );
    const byEmp = Object.fromEntries(out.metrics[0]!.results.map((r) => [r.dimensions.employee, r.value]));
    expect(byEmp).toEqual({ [EMP1]: 60, [EMP2]: 80 });
  });

  it('policy_complexity = latest total_score per version; org-level = mean of latest', async () => {
    const evals = {
      policy_complexity_evaluations: [
        { organization_id: ORG, policy_version_id: VER1, total_score: 30, evaluated_at: '2026-01-01T00:00:00.000Z' },
        { organization_id: ORG, policy_version_id: VER1, total_score: 32, evaluated_at: '2026-02-01T00:00:00.000Z' },
        { organization_id: ORG, policy_version_id: VER2, total_score: 10, evaluated_at: '2026-01-15T00:00:00.000Z' },
      ],
    };
    const grouped = ok(
      await run({ metrics: ['policy_complexity'], dimensions: ['policy_version'], filters: [], period: PERIOD_P1 }, READ, evals),
    );
    const byVer = Object.fromEntries(grouped.metrics[0]!.results.map((r) => [r.dimensions.policy_version, r.value]));
    expect(byVer).toEqual({ [VER1]: 32, [VER2]: 10 }); // latest per version

    const org = ok(await run({ metrics: ['policy_complexity'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, evals));
    expect(org.metrics[0]!.results[0]!.value).toBe(21); // mean(32,10)
  });

  it('payout_total = Σ final_amount_minor (via v_finance_payout); empty read is OMITTED (SI-12 honesty)', async () => {
    const summed = ok(
      await run({ metrics: ['payout_total'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
        v_finance_payout: [
          { bonus_period_id: P1, employee_id: EMP1, final_amount_minor: 1000 },
          { bonus_period_id: P1, employee_id: EMP2, final_amount_minor: 2500 },
        ],
      }),
    );
    expect(summed.metrics[0]!.results[0]).toMatchObject({ value: 3500, unit: 'minor_currency' });

    // An empty read (RLS-denied for a non-finance role) is OMITTED — the caller renders an honest
    // "unavailable", NOT a fabricated ₺0 (§23 / SI-12).
    const empty = ok(await run({ metrics: ['payout_total'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, { v_finance_payout: [] }));
    expect(empty.metrics[0]!.results).toHaveLength(0);
  });

  it('payout_concentration = HHI over the payout distribution', async () => {
    const out = ok(
      await run({ metrics: ['payout_concentration'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
        v_finance_payout: [
          { bonus_period_id: P1, employee_id: EMP1, final_amount_minor: 1000 },
          { bonus_period_id: P1, employee_id: EMP2, final_amount_minor: 1000 },
        ],
      }),
    );
    expect(out.metrics[0]!.results[0]).toMatchObject({ value: 0.5, unit: 'score' }); // 0.5² + 0.5²
  });

  it('budget_variance = (accrued − pool)/pool·100; period with no pool omitted', async () => {
    const out = ok(
      await run({ metrics: ['budget_variance'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
        v_finance_period_totals: [{ bonus_period_id: P1, pool_amount: 1000, total_accrued: 1200 }],
      }),
    );
    expect(out.metrics[0]!.results[0]).toMatchObject({ value: 20, unit: 'percent' });

    const noPool = ok(
      await run({ metrics: ['budget_variance'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
        v_finance_period_totals: [{ bonus_period_id: P1, pool_amount: 0, total_accrued: 500 }],
      }),
    );
    expect(noPool.metrics[0]!.results).toHaveLength(0);
  });

  it('cycle_completion_rate = approved / terminal (windowed by completed_at); groups by team', async () => {
    const tasks = {
      tasks: [
        { organization_id: ORG, status: 'approved', team_id: TEAM1, completed_at: '2026-01-10' },
        { organization_id: ORG, status: 'approved', team_id: TEAM1, completed_at: '2026-01-11' },
        { organization_id: ORG, status: 'approved', team_id: TEAM2, completed_at: '2026-01-12' },
        { organization_id: ORG, status: 'rejected', team_id: TEAM2, completed_at: '2026-01-13' },
        { organization_id: ORG, status: 'approved', team_id: TEAM1, completed_at: '2026-03-05' }, // OUT of window
      ],
    };
    const org = ok(await run({ metrics: ['cycle_completion_rate'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, tasks));
    expect(org.metrics[0]!.results[0]).toMatchObject({ value: 75, unit: 'percent' }); // 3 of 4 in-window

    const byTeam = ok(await run({ metrics: ['cycle_completion_rate'], dimensions: ['team'], filters: [], period: PERIOD_P1 }, READ, tasks));
    const rates = Object.fromEntries(byTeam.metrics[0]!.results.map((r) => [r.dimensions.team, r.value]));
    expect(rates).toEqual({ [TEAM1]: 100, [TEAM2]: 50 });
  });

  it('approval_latency = median(approved_at − submitted_at) in ms', async () => {
    const out = ok(
      await run({ metrics: ['approval_latency'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
        tasks: [
          { organization_id: ORG, status: 'approved', team_id: TEAM1, task_type: 'bug', submitted_at: '2026-01-10T00:00:00.000Z', approved_at: '2026-01-10T00:00:01.000Z' },
          { organization_id: ORG, status: 'approved', team_id: TEAM1, task_type: 'bug', submitted_at: '2026-01-11T00:00:00.000Z', approved_at: '2026-01-11T00:00:03.000Z' },
          { organization_id: ORG, status: 'approved', team_id: TEAM2, task_type: 'feat', submitted_at: '2026-01-12T00:00:00.000Z', approved_at: '2026-01-12T00:00:02.000Z' },
        ],
      }),
    );
    expect(out.metrics[0]!.results[0]).toMatchObject({ value: 2000, unit: 'duration_ms' }); // median(1000,3000,2000)
  });

  it('manual_override_rate = manual / (task_approved + manual) in the window', async () => {
    const rows = [
      { organization_id: ORG, event_type: 'manual_adjustment', created_at: '2026-01-05T00:00:00.000Z' },
      { organization_id: ORG, event_type: 'manual_adjustment', created_at: '2026-01-06T00:00:00.000Z' },
    ];
    for (let i = 0; i < 6; i++) rows.push({ organization_id: ORG, event_type: 'task_approved', created_at: `2026-01-1${i}T00:00:00.000Z` });
    const out = ok(await run({ metrics: ['manual_override_rate'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, { point_ledger: rows }));
    expect(out.metrics[0]!.results[0]).toMatchObject({ value: 25, unit: 'percent' }); // 2 of 8
  });

  it('gaming_flag_rate = distinct CONFIRMED-flag employees / scored population', async () => {
    const out = ok(
      await run({ metrics: ['gaming_flag_rate'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
        point_ledger: [EMP1, EMP2, EMP3, EMP4].map((e) => ({
          organization_id: ORG,
          employee_id: e,
          event_type: 'task_approved',
          created_at: '2026-01-15T00:00:00.000Z',
        })),
        anti_gaming_flags: [
          { organization_id: ORG, status: 'confirmed', subject_employee_id: EMP1, bonus_period_id: P1 },
          { organization_id: ORG, status: 'dismissed', subject_employee_id: EMP2, bonus_period_id: P1 }, // dismissed excluded
        ],
      }),
    );
    expect(out.metrics[0]!.results[0]).toMatchObject({ value: 25, unit: 'percent' }); // 1 of 4
  });
});

describe('SI-12 finance routing + comparison', () => {
  it('payout_total reads ONLY the finance view (never raw bonus_allocations / point_ledger)', async () => {
    const reads: string[] = [];
    const inner = fakeSupabase(base({ v_finance_payout: [{ bonus_period_id: P1, employee_id: EMP1, final_amount_minor: 100 }] }));
    const spy = { from: (t: string) => (reads.push(t), (inner as { from: (x: string) => unknown }).from(t)) } as never;
    const out = await executeSemanticQuery(spy, { organizationId: ORG, permissions: READ }, { metrics: ['payout_total'], dimensions: [], filters: [], period: PERIOD_P1 }, { computedAt: FIXED });
    expect(out.ok).toBe(true);
    expect(reads).toContain('v_finance_payout');
    expect(reads).not.toContain('bonus_allocations');
    expect(reads).not.toContain('point_ledger');
  });

  it('a bonus_period filter narrows a multi-period range to the filtered period only', async () => {
    // period = range spanning P1(Jan) + P2(Feb); filter narrows to P1 → only P1's payout is summed.
    const out = ok(
      await run(
        {
          metrics: ['payout_total'],
          dimensions: [],
          filters: [{ dimension: 'bonus_period', operator: 'eq', value: P1 }],
          period: { kind: 'range', start: '2026-01-01', end: '2026-02-28' },
        },
        READ,
        {
          v_finance_payout: [
            { bonus_period_id: P1, employee_id: EMP1, final_amount_minor: 1000 },
            { bonus_period_id: P2, employee_id: EMP1, final_amount_minor: 5000 },
          ],
        },
      ),
    );
    expect(out.metrics[0]!.results[0]!.value).toBe(1000); // P2 excluded by the bonus_period filter
  });

  it('comparison (previous_period) returns the prior-period value and the delta', async () => {
    const out = ok(
      await run(
        { metrics: ['payout_total'], dimensions: [], filters: [], period: { kind: 'bonus_period', bonusPeriodId: P2 }, comparison: { basis: 'previous_period' } },
        READ,
        {
          v_finance_payout: [
            { bonus_period_id: P2, employee_id: EMP1, final_amount_minor: 2000 },
            { bonus_period_id: P2, employee_id: EMP2, final_amount_minor: 1000 },
            { bonus_period_id: P1, employee_id: EMP1, final_amount_minor: 1000 },
          ],
        },
      ),
    );
    const m = out.metrics[0]!;
    expect(m.results[0]!.value).toBe(3000); // P2 sum
    expect(m.comparison?.basis).toBe('previous_period');
    expect(m.comparison?.results[0]!.value).toBe(1000); // P1 sum
    expect(m.comparison?.deltas[0]!.delta).toBe(2000); // 3000 − 1000
  });
});

describe('drill scaffolding (§10.10)', () => {
  it('exposes only servable levels per metric', () => {
    expect(availableDrillLevels('payout_total')).toEqual(['company', 'employee']); // team not in the finance view
    expect(availableDrillLevels('cycle_completion_rate')).toEqual(['company', 'team']);
    expect(availableDrillLevels('cap_hit_rate')).toEqual(['company', 'team']); // 8-A2: bonus_allocations team
  });

  it('builds a drill query for a servable level and rejects an unservable one', () => {
    const okDrill = buildDrillQuery({ metric: 'payout_total', level: 'employee', period: PERIOD_P1 });
    expect(okDrill.ok).toBe(true);
    if (okDrill.ok) expect(okDrill.query.dimensions).toEqual(['employee']);

    const badDim = buildDrillQuery({ metric: 'budget_variance', level: 'team', period: PERIOD_P1 });
    expect(badDim.ok).toBe(false);
    if (!badDim.ok) expect(badDim.error.code).toBe('dimension_not_executable');

    const capEmployee = buildDrillQuery({ metric: 'cap_hit_rate', level: 'employee', period: PERIOD_P1 });
    expect(capEmployee.ok).toBe(false); // employee not servable for cap_hit_rate
    if (!capEmployee.ok) expect(capEmployee.error.code).toBe('dimension_not_executable');
  });

  it('isMetricExecutable is now true for all 11 metrics (8-A2 completes the layer)', () => {
    expect(isMetricExecutable('opportunity_index')).toBe(true);
    expect(isMetricExecutable('cap_hit_rate')).toBe(true);
    expect(isMetricExecutable('dispute_rate')).toBe(true);
  });
});

describe('8-A2 executors — cap_hit_rate (role-gated) + dispute_rate (trimmed dims)', () => {
  const T = TEAM1;
  it('cap_hit_rate = count(cap_applied=yes)/count(*) for an allocation-reader (hr)', async () => {
    const out = ok(
      await run({ metrics: ['cap_hit_rate'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
        bonus_allocations: [
          { organization_id: ORG, bonus_period_id: P1, cap_applied: 'yes', primary_team_id: T, employee_id: EMP1 },
          { organization_id: ORG, bonus_period_id: P1, cap_applied: 'yes', primary_team_id: T, employee_id: EMP2 },
          { organization_id: ORG, bonus_period_id: P1, cap_applied: 'no', primary_team_id: TEAM2, employee_id: EMP3 },
        ],
      }, 'hr'),
    );
    expect(out.metrics[0]!.results[0]).toMatchObject({ value: 66.67, unit: 'percent' }); // 2 of 3
  });

  it('cap_hit_rate REJECTS a source-excluded role (finance) with metric_not_available_for_role', async () => {
    const out = await run({ metrics: ['cap_hit_rate'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {}, 'finance');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.executionErrors?.some((e) => e.code === 'metric_not_available_for_role')).toBe(true);
  });

  it('cap_hit_rate REJECTS a missing role (fail-closed)', async () => {
    const out = await run({ metrics: ['cap_hit_rate'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.executionErrors?.some((e) => e.code === 'metric_not_available_for_role')).toBe(true);
  });

  it('cap_hit_rate groups by role via a memberships join (hr/auditor can read the roster)', async () => {
    const out = ok(
      await run({ metrics: ['cap_hit_rate'], dimensions: ['role'], filters: [], period: PERIOD_P1 }, READ, {
        bonus_allocations: [
          { organization_id: ORG, bonus_period_id: P1, cap_applied: 'yes', primary_team_id: T, employee_id: EMP1 },
          { organization_id: ORG, bonus_period_id: P1, cap_applied: 'no', primary_team_id: T, employee_id: EMP2 },
        ],
        memberships: [
          { organization_id: ORG, profile_id: EMP1, primary_role: 'employee' },
          { organization_id: ORG, profile_id: EMP2, primary_role: 'manager' },
        ],
      }, 'auditor'),
    );
    const byRole = Object.fromEntries(out.metrics[0]!.results.map((r) => [r.dimensions.role, r.value]));
    expect(byRole).toEqual({ employee: 100, manager: 0 });
  });

  it('dispute_rate = disputes-in-window / scored population; groups by dispute_type', async () => {
    const tables = {
      disputes: [
        { organization_id: ORG, dispute_type: 'unfair_rejection', opened_at: '2026-01-10T00:00:00.000Z' },
        { organization_id: ORG, dispute_type: 'system_error', opened_at: '2026-01-12T00:00:00.000Z' },
        { organization_id: ORG, dispute_type: 'unfair_rejection', opened_at: '2026-03-10T00:00:00.000Z' }, // OUT of window
      ],
      point_ledger: [EMP1, EMP2, EMP3, EMP4].map((e) => ({
        organization_id: ORG,
        employee_id: e,
        event_type: 'task_approved',
        created_at: '2026-01-15T00:00:00.000Z',
      })),
    };
    const org = ok(await run({ metrics: ['dispute_rate'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, tables));
    expect(org.metrics[0]!.results[0]).toMatchObject({ value: 50, unit: 'percent' }); // 2 in-window / 4

    const byType = ok(await run({ metrics: ['dispute_rate'], dimensions: ['dispute_type'], filters: [], period: PERIOD_P1 }, READ, tables));
    const rates = Object.fromEntries(byType.metrics[0]!.results.map((r) => [r.dimensions.dispute_type, r.value]));
    expect(rates).toEqual({ unfair_rejection: 25, system_error: 25 }); // 1 each of 4
  });

  it('dispute_rate omits when the scored population is 0 (no fabricated value)', async () => {
    const out = ok(
      await run({ metrics: ['dispute_rate'], dimensions: [], filters: [], period: PERIOD_P1 }, READ, {
        disputes: [{ organization_id: ORG, dispute_type: 'system_error', opened_at: '2026-01-10T00:00:00.000Z' }],
        point_ledger: [], // no scored population
      }),
    );
    expect(out.metrics[0]!.results).toHaveLength(0);
  });

  it('dispute_rate now rejects the trimmed dims (bonus_period/team/policy_version) via the P0 validator', async () => {
    for (const dim of ['bonus_period', 'team', 'policy_version']) {
      const out = await run({ metrics: ['dispute_rate'], dimensions: [dim], filters: [], period: PERIOD_P1 });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.validationErrors?.some((e) => e.code === 'dimension_not_allowed_for_metric')).toBe(true);
    }
  });
});
