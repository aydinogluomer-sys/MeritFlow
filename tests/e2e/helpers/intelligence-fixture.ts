import { adminClient, createTestTask } from './db-admin';

// Phase P4 — test-only fixture for the Intelligence dashboards real-DB E2E (comparison-anchor regression
// guard). SERVICE-ROLE only (bypasses RLS); NEVER used by app code. Enables the 'intelligence' feature
// flag and seeds a DETERMINISTIC, fully-populated CURRENT bonus period for Org A so the dashboards render
// REAL metric values (the exact state the mocked-outcome unit tests could not exercise — PR #57).
//
// Why the real engine RPCs (run_bonus_calculation + post_bonus_accrual, the golden-A-proven path) rather
// than hand-inserting allocations/ledger: the completed-run allocation-freeze + double-entry balance +
// AD10 triggers make direct inserts invalid/blocked, and the engine guarantees SI-13 so golden-A's
// reconciliation stays clean. Task timestamps are pushed into the FUTURE period window via a
// status-preserving UPDATE (validate_task_transition returns early when status is unchanged), so the
// windowed metrics (cycle_completion_rate / approval_latency) resolve for the seeded period.

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const HR_A = 'a0000000-0000-0000-0000-0000000000a3';
const MGR_A = 'a0000000-0000-0000-0000-0000000000a5';
const EMP_A = 'a0000000-0000-0000-0000-0000000000a7'; // emp-alpha-a, primary team f1
const TEAM_A = 'a0000000-0000-0000-0000-0000000000f1';
const POLICY_VERSION_A = 'a0000000-0000-0000-0000-0000000000d2'; // published (seed)

// A window PAST golden-A's periods (2099-01 + up to ~300 days) so this is unambiguously the NEWEST Org-A
// period → the dashboards' "current period" anchors here. Two adjacent months give a previous-period
// comparison (a non-zero cycle_completion_rate delta → the "Ne değişti?" section is populated).
const PREV_START = '2100-05-01';
const PREV_END = '2100-05-31';
const CURR_START = '2100-06-01';
const CURR_END = '2100-06-30';

/** Enable (or disable) the 'intelligence' + 'health_engine' flags for Org A (feature_flags upsert). */
export async function setIntelligenceFlags(enabled: boolean): Promise<void> {
  const admin = adminClient();
  for (const flag_key of ['intelligence', 'health_engine']) {
    const { error } = await admin
      .from('feature_flags')
      .update({ enabled, stage: enabled ? 'beta' : 'off' })
      .eq('organization_id', ORG_A)
      .eq('flag_key', flag_key);
    if (error) throw new Error(`setIntelligenceFlags(${flag_key}): ${error.message}`);
  }
}

/** Create an approved task for EMP_A on TEAM_A and stamp its timestamps into [submitted, approved] (a
 * status-PRESERVING update, which validate_task_transition passes through without re-stamping now()). */
async function seedApprovedTask(title: string, submittedAt: string, approvedAt: string): Promise<string> {
  const id = await createTestTask({
    organizationId: ORG_A, teamId: TEAM_A, createdBy: MGR_A, assignedTo: EMP_A, title, status: 'approved',
  });
  const { error } = await adminClient()
    .from('tasks')
    .update({ submitted_at: submittedAt, approved_at: approvedAt, completed_at: approvedAt })
    .eq('id', id);
  if (error) throw new Error(`seedApprovedTask(stamp): ${error.message}`);
  return id;
}

/** Create a rejected task completed in the given window (for a < 100% cycle_completion_rate). */
async function seedRejectedTask(title: string, completedAt: string): Promise<string> {
  const id = await createTestTask({
    organizationId: ORG_A, teamId: TEAM_A, createdBy: MGR_A, assignedTo: EMP_A, title, status: 'rejected',
  });
  const { error } = await adminClient().from('tasks').update({ completed_at: completedAt }).eq('id', id);
  if (error) throw new Error(`seedRejectedTask(stamp): ${error.message}`);
  return id;
}

/**
 * Idempotently seed a fully-populated CURRENT Org-A period (+ a previous period for the comparison delta)
 * so the four Intelligence dashboards render REAL values. Safe to call repeatedly (a Playwright serial
 * retry re-runs beforeAll): if the CURR period already exists it returns immediately. Does NOT change the
 * feature flag (the spec toggles that explicitly to also assert the flag-off guard).
 */
export async function seedIntelligenceFixture(): Promise<void> {
  const admin = adminClient();

  // Idempotency: bail if the CURR period is already seeded.
  const { data: existing } = await admin
    .from('bonus_periods')
    .select('id')
    .eq('organization_id', ORG_A)
    .eq('starts_on', CURR_START)
    .maybeSingle();
  if (existing) return;

  // ── Previous period (comparison anchor): tasks only → cycle_completion_rate = 50% (1 approved / 1 rejected).
  // Guarded independently of CURR: a mid-fixture retry (failure between the PREV and CURR inserts) must not
  // re-insert PREV and trip bonus_periods_unique_range — only seed PREV when it does not already exist.
  const { data: prevExisting } = await admin
    .from('bonus_periods')
    .select('id')
    .eq('organization_id', ORG_A)
    .eq('starts_on', PREV_START)
    .maybeSingle();
  if (!prevExisting) {
    const { data: prevPeriod, error: prevErr } = await admin
      .from('bonus_periods')
      .insert({ organization_id: ORG_A, period_type: 'monthly', starts_on: PREV_START, ends_on: PREV_END, status: 'open', created_by: HR_A })
      .select('id')
      .single();
    if (prevErr) throw new Error(`seed prev period: ${prevErr.message}`);
    await seedApprovedTask(`intel-e2e prev approved ${prevPeriod!.id}`, '2100-05-14T00:00:00Z', '2100-05-15T00:00:00Z');
    await seedRejectedTask(`intel-e2e prev rejected ${prevPeriod!.id}`, '2100-05-16T00:00:00Z');
  }

  // ── Current period: full engine chain → real v_finance_* rows. cycle_completion_rate = 100% (differs
  //    from prev's 50% → a non-zero comparison delta → "Ne değişti?" populated).
  const { data: currPeriod, error: currErr } = await admin
    .from('bonus_periods')
    .insert({ organization_id: ORG_A, period_type: 'monthly', starts_on: CURR_START, ends_on: CURR_END, status: 'open', created_by: HR_A })
    .select('id')
    .single();
  if (currErr) throw new Error(`seed curr period: ${currErr.message}`);
  const periodId = currPeriod!.id as string;

  const { data: pool, error: poolErr } = await admin
    .from('bonus_pools')
    .insert({ organization_id: ORG_A, bonus_period_id: periodId, amount_minor: 120_000_000, currency: 'TRY', status: 'draft', t_org: 1, top_up_approved: false, created_by: HR_A })
    .select('id')
    .single();
  if (poolErr) throw new Error(`seed pool: ${poolErr.message}`);
  const poolId = pool!.id as string;

  // Eligibility (D10: eligible ⇒ days_active ≥ 15) + a task_approved earning row in the CURR window.
  const { error: eligErr } = await admin.from('bonus_pool_eligibility').insert({
    organization_id: ORG_A, bonus_pool_id: poolId, employee_id: EMP_A, eligible: true, days_active: 30,
    eligibility_factor: 1, proration_factor: 1, primary_team_id: TEAM_A, created_by: HR_A,
  });
  if (eligErr) throw new Error(`seed eligibility: ${eligErr.message}`);

  // Active comp with a large cap_basis (so the cap does not bind → clean 'calculated' allocation, no
  // pending_missing_cap_basis). Only when EMP_A has no active comp already (avoid a duplicate active row).
  const { data: comp } = await admin
    .from('compensation_records')
    .select('id')
    .eq('organization_id', ORG_A).eq('employee_id', EMP_A).eq('status', 'active').is('effective_to', null)
    .maybeSingle();
  if (!comp) {
    const { error: compErr } = await admin.from('compensation_records').insert({
      organization_id: ORG_A, employee_id: EMP_A, gross_salary_minor: 500_000_000, currency: 'TRY',
      cap_basis_minor: 10_000_000_000, effective_from: '2099-01-01', status: 'active', created_by: HR_A,
    });
    if (compErr) throw new Error(`seed comp: ${compErr.message}`);
  }

  const taskId = await seedApprovedTask(`intel-e2e curr approved ${periodId}`, '2100-06-01T00:00:00Z', '2100-06-02T00:00:00Z');
  const { error: plErr } = await admin.from('point_ledger').insert({
    organization_id: ORG_A, employee_id: EMP_A, event_type: 'task_approved', points_delta: 100,
    reason: 'intel-e2e approved earning', created_by: HR_A, task_id: taskId, scoring_policy_version_id: POLICY_VERSION_A,
  });
  if (plErr) throw new Error(`seed point_ledger: ${plErr.message}`);

  // Lock pool then period (AD10: a period can lock only after its pool is locked).
  await admin.from('bonus_pools').update({ status: 'locked', locked_at: new Date().toISOString(), locked_by: HR_A }).eq('id', poolId);
  await admin.from('bonus_periods').update({ status: 'locked', locked_at: new Date().toISOString(), locked_by: HR_A }).eq('id', periodId);

  // Run the deterministic engine → allocations + immutable snapshot (SI-13 balanced).
  const { error: runErr } = await admin.rpc('run_bonus_calculation', {
    p_organization_id: ORG_A, p_bonus_period_id: periodId, p_bonus_pool_id: poolId,
    p_idempotency_key: `intel-e2e-${periodId}`, p_triggered_by: HR_A,
  });
  if (runErr) throw new Error(`run_bonus_calculation: ${runErr.message}`);

  // Approve the snapshot + period, then post the balanced accrual → v_finance_* light up.
  const { data: snap } = await admin
    .from('bonus_allocation_snapshots')
    .select('id')
    .eq('bonus_period_id', periodId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!snap) throw new Error('seed: no snapshot produced by run_bonus_calculation');
  await admin.from('bonus_allocation_snapshots').update({ approved_at: new Date().toISOString(), approved_by: HR_A }).eq('id', snap.id as string);
  await admin.from('bonus_periods').update({ status: 'approved' }).eq('id', periodId);

  const { error: accErr } = await admin.rpc('post_bonus_accrual', {
    p_organization_id: ORG_A, p_bonus_period_id: periodId, p_triggered_by: HR_A,
  });
  if (accErr) throw new Error(`post_bonus_accrual: ${accErr.message}`);
}
