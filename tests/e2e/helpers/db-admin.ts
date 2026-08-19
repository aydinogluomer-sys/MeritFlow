import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ENGINEERING-17 — service-role DB helpers for E2E setup + verification. These BYPASS RLS (test
// setup + assertions only), never used by app code. All column/table names verified against the
// migrations (NOTE: several diverge from the ENGINEERING-17 spec draft — point_ledger uses
// `event_type`/`task_id` not `entry_type`/`reference_id`; the audit table is `audit_logs` with
// `target_id` not `audit_log`/`entity_id`; there is no `run_reconciliation` RPC, so the two
// critical invariants are reimplemented here, mirroring ReconciliationRepository).

// Org A published scoring policy version (seed) — every E2E task is Org A.
const ORG_A_POLICY_VERSION = 'a0000000-0000-0000-0000-0000000000d2';
const HR_A = 'a0000000-0000-0000-0000-0000000000a3';
const FINANCE_A = 'a0000000-0000-0000-0000-0000000000a4';

export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'db-admin: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from env.',
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Row = Record<string, unknown>;

export async function getTask(id: string): Promise<Row | null> {
  const { data } = await adminClient().from('tasks').select('*').eq('id', id).maybeSingle();
  return (data as Row) ?? null;
}

// point_ledger rows for a task (event_type is the earning marker: 'task_approved').
export async function getPointLedgerEntries(taskId: string): Promise<Row[]> {
  const { data } = await adminClient().from('point_ledger').select('*').eq('task_id', taskId);
  return (data ?? []) as Row[];
}

export async function getBonusPeriod(id: string): Promise<Row | null> {
  const { data } = await adminClient().from('bonus_periods').select('*').eq('id', id).maybeSingle();
  return (data as Row) ?? null;
}

export async function getBonusPool(periodId: string): Promise<Row | null> {
  const { data } = await adminClient()
    .from('bonus_pools')
    .select('*')
    .eq('bonus_period_id', periodId)
    .neq('status', 'superseded')
    .limit(1)
    .maybeSingle();
  return (data as Row) ?? null;
}

export async function getLatestCalculationRun(periodId: string): Promise<Row | null> {
  const { data } = await adminClient()
    .from('bonus_calculation_runs')
    .select('*')
    .eq('bonus_period_id', periodId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Row) ?? null;
}

export async function getLatestSnapshot(periodId: string): Promise<Row | null> {
  const { data } = await adminClient()
    .from('bonus_allocation_snapshots')
    .select('*')
    .eq('bonus_period_id', periodId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Row) ?? null;
}

export async function getExports(periodId: string): Promise<Row[]> {
  const { data } = await adminClient().from('exports').select('*').eq('bonus_period_id', periodId);
  return (data ?? []) as Row[];
}

// audit_logs rows targeting an entity (target_id), oldest first.
export async function getAuditRows(entityId: string): Promise<Row[]> {
  const { data } = await adminClient()
    .from('audit_logs')
    .select('*')
    .eq('target_id', entityId)
    .order('created_at', { ascending: true });
  return (data ?? []) as Row[];
}

/**
 * Reimplements the two CRITICAL reconciliation invariants (no `run_reconciliation` RPC exists —
 * reconciliation is a TS module). Mirrors ReconciliationRepository:
 *   INV-SI13-POOL-SUM  — Σ(final_amount_minor) + undistributed_remainder = pool_ref_minor, per
 *                        completed run, ONLY when the snapshot carries a pool_ref_minor basis
 *                        (hand-built seed snapshots without it are skipped — NaN → continue).
 *   INV-LEDGER-BALANCE — Σdebit = Σcredit per (org, transaction_id) in bonus_ledger.
 */
export async function runReconciliation(
  organizationId: string,
): Promise<{ criticalFindings: string[] }> {
  const admin = adminClient();
  const criticalFindings: string[] = [];

  const { data: runs } = await admin
    .from('bonus_calculation_runs')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('status', 'completed');
  const completedRuns = (runs ?? []) as Array<{ id: string }>;

  if (completedRuns.length > 0) {
    const { data: snaps } = await admin
      .from('bonus_allocation_snapshots')
      .select('calculation_run_id, undistributed_remainder_minor, calculation_metadata')
      .eq('organization_id', organizationId);
    const { data: allocs } = await admin
      .from('bonus_allocations')
      .select('calculation_run_id, final_amount_minor')
      .eq('organization_id', organizationId);

    const snapByRun = new Map(
      ((snaps ?? []) as Array<{
        calculation_run_id: string;
        undistributed_remainder_minor: number | string;
        calculation_metadata: { pool_ref_minor?: number | string } | null;
      }>).map((s) => [s.calculation_run_id, s]),
    );
    const finalSumByRun = new Map<string, number>();
    for (const a of (allocs ?? []) as Array<{ calculation_run_id: string; final_amount_minor: number | string }>) {
      finalSumByRun.set(
        a.calculation_run_id,
        (finalSumByRun.get(a.calculation_run_id) ?? 0) + Number(a.final_amount_minor),
      );
    }

    for (const run of completedRuns) {
      const snap = snapByRun.get(run.id);
      if (!snap) continue;
      const raw = snap.calculation_metadata?.pool_ref_minor;
      if (raw == null || raw === '') continue; // no pool_ref basis → not an SI-13 subject
      const poolRef = Number(raw);
      if (Number.isNaN(poolRef)) continue;
      const actual = (finalSumByRun.get(run.id) ?? 0) + Number(snap.undistributed_remainder_minor);
      if (actual !== poolRef) {
        criticalFindings.push('INV-SI13-POOL-SUM');
        break;
      }
    }
  }

  const { data: ledger } = await admin
    .from('bonus_ledger')
    .select('transaction_id, entry_type, amount_minor')
    .eq('organization_id', organizationId);
  const byTxn = new Map<string, { debit: number; credit: number }>();
  for (const r of (ledger ?? []) as Array<{ transaction_id: string; entry_type: string; amount_minor: number | string }>) {
    const acc = byTxn.get(r.transaction_id) ?? { debit: 0, credit: 0 };
    if (r.entry_type === 'debit') acc.debit += Number(r.amount_minor);
    else if (r.entry_type === 'credit') acc.credit += Number(r.amount_minor);
    byTxn.set(r.transaction_id, acc);
  }
  for (const { debit, credit } of byTxn.values()) {
    if (debit !== credit) {
      criticalFindings.push('INV-LEDGER-BALANCE');
      break;
    }
  }

  return { criticalFindings };
}

// ── Test-only row factories (service role; bypass RLS) ──────────────────────────────────────────
// NOTE: `tasks` requires complexity/impact/base_points/scoring_policy_version_id (NOT NULL) beyond
// the spec's opts, so sensible defaults are filled here. `status` defaults to 'in_progress'.
// The DB trigger only allows INSERT with status='draft'|'assigned'; any other target status is
// reached by walking the valid state-machine transitions after the initial INSERT.

// Valid task status transitions (from doc-16 §1 state machine).
const TASK_TRANSITIONS: Record<string, string[]> = {
  draft: ['assigned'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['submitted', 'cancelled'],
  submitted: ['needs_revision', 'approved', 'rejected'],
  needs_revision: ['in_progress'],
};

export async function createTestTask(opts: {
  organizationId: string;
  teamId: string;
  createdBy: string;
  assignedTo: string;
  title: string;
  status?: string;
}): Promise<string> {
  const targetStatus = opts.status ?? 'in_progress';

  // The DB trigger only allows INSERT with status 'draft' or 'assigned'.
  // Walk the state machine from 'draft' to the target status via valid transitions.
  const path: string[] = ['draft'];
  if (targetStatus !== 'draft') {
    const visited = new Set<string>();
    const queue: string[][] = [['draft']];
    let found = false;
    while (queue.length > 0) {
      const current = queue.shift()!;
      const last = current[current.length - 1];
      if (last === targetStatus) {
        path.splice(0, path.length, ...current);
        found = true;
        break;
      }
      if (visited.has(last)) continue;
      visited.add(last);
      for (const next of TASK_TRANSITIONS[last] ?? []) {
        queue.push([...current, next]);
      }
    }
    if (!found) {
      throw new Error(`createTestTask: no valid transition path from 'draft' to '${targetStatus}'`);
    }
  }

  // INSERT with the first status in the path (must be 'draft' or 'assigned').
  const { data, error } = await adminClient()
    .from('tasks')
    .insert({
      organization_id: opts.organizationId,
      team_id: opts.teamId,
      title: opts.title,
      status: path[0],
      created_by: opts.createdBy,
      assigned_to: opts.assignedTo,
      complexity: 'medium',
      impact: 'medium',
      base_points: 100,
      scoring_policy_version_id: ORG_A_POLICY_VERSION,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createTestTask: ${error.message}`);
  const id = (data as { id: string }).id;

  // Advance through intermediate states to reach the target.
  for (let i = 1; i < path.length; i++) {
    const { error: updateError } = await adminClient()
      .from('tasks')
      .update({ status: path[i] })
      .eq('id', id);
    if (updateError) {
      throw new Error(`createTestTask: transition to '${path[i]}' failed — ${updateError.message}`);
    }
  }

  return id;
}

export async function createTestPeriod(opts: {
  organizationId: string;
  startsOn: string;
  endsOn: string;
}): Promise<string> {
  const { data, error } = await adminClient()
    .from('bonus_periods')
    .insert({
      organization_id: opts.organizationId,
      period_type: 'monthly',
      starts_on: opts.startsOn,
      ends_on: opts.endsOn,
      status: 'open',
      created_by: HR_A,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createTestPeriod: ${error.message}`);
  return (data as { id: string }).id;
}

// Pools start 'draft' (there is no 'open' pool status — the spec draft said 'open'). t_org=1 +
// top_up_approved=false are set so a later lock→calculate produces a balanced run.
export async function createTestPool(opts: {
  organizationId: string;
  periodId: string;
  amountMinor: number;
  currency: string;
}): Promise<string> {
  const { data, error } = await adminClient()
    .from('bonus_pools')
    .insert({
      organization_id: opts.organizationId,
      bonus_period_id: opts.periodId,
      amount_minor: opts.amountMinor,
      currency: opts.currency,
      status: 'draft',
      t_org: 1,
      top_up_approved: false,
      created_by: FINANCE_A,
    })
    .select('id')
    .single();
  if (error) throw new Error(`createTestPool: ${error.message}`);
  return (data as { id: string }).id;
}
