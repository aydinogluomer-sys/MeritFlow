import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { toDomainError } from '@/lib/errors';
import { evaluateStaticComplexity, configFromVersionRow } from '@/modules/policy-complexity';
import type { DimensionScore, HealthSignals, HealthWeight } from '../domain/types';

// Phase P2 / slice 1-A — incentive-health repository. READS a scoring_policy_version's config + the
// version's operational data (all READ-ONLY — §26; no policy/ledger mutation) and produces the frozen
// HealthSignals the pure engine consumes. It also persists an append-only, reproducible evaluation.
// Reads run through the RLS-scoped user client OR the injected admin client; the WRITE runs through the
// service_role (admin) client passed by the application (server-only). policy_health_evaluations is
// introduced by 0046; until db types are regenerated it is absent from `Database`, so its calls go
// through a localized generic-client cast (mirrors the 0045 policy_complexity_evaluations precedent).
// Every operational join keys off the version via the deterministic paths Module 4-B established:
//   task_approved → point_ledger.scoring_policy_version_id;  manual_adjustment → tasks.scoring_policy_version_id;
//   allocations/snapshots → bonus_calculation_runs.policy_version_id;  disputes → polymorphic target ids.
// COVERAGE LIMITATION (documented, not a bug): manual_adjustment rows are attributed via their linked
// task's version (INNER join on task_id). apply_manual_point_adjustment (0030) allows a NULL task_id
// and does not stamp scoring_policy_version_id, so TASK-LESS manual adjustments have no version linkage
// and are (correctly) not attributed to any version here — they cannot be deterministically. Manager
// Discretion therefore measures the TASK-LINKED override share. Full attribution is deferred to a slice
// that stamps scoring_policy_version_id on the manual_adjustment ledger row (out of scope for 1-A —
// no schema/RPC change). This mirrors Module 4-B's task-linked override attribution.

type TypedClient = SupabaseClient<Database>;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface PolicyHealthEvaluation {
  id: string;
  organizationId: string;
  policyVersionId: string;
  ruleSetVersion: string;
  overallScore: number;
  dimensions: DimensionScore[];
  weights: HealthWeight[];
  deferredDimensions: string[];
  evaluatedAt: string;
  createdAt: string;
}

export interface NewHealthEvaluationRow {
  organizationId: string;
  policyVersionId: string;
  ruleSetVersion: string;
  overallScore: number;
  dimensions: DimensionScore[];
  weights: HealthWeight[];
  deferredDimensions: string[];
}

interface DimensionsPayload {
  items: DimensionScore[];
  weights: HealthWeight[];
  deferred: string[];
}

interface EvaluationRow {
  id: string;
  organization_id: string;
  policy_version_id: string;
  rule_set_version: string;
  overall_score: number | string;
  dimensions: DimensionsPayload;
  evaluated_at: string;
  created_at: string;
}

const COLUMNS =
  'id, organization_id, policy_version_id, rule_set_version, overall_score, dimensions, ' +
  'evaluated_at, created_at';

function toDomain(row: EvaluationRow): PolicyHealthEvaluation {
  const payload = row.dimensions ?? { items: [], weights: [], deferred: [] };
  return {
    id: row.id,
    organizationId: row.organization_id,
    policyVersionId: row.policy_version_id,
    ruleSetVersion: row.rule_set_version,
    overallScore: num(row.overall_score),
    dimensions: payload.items ?? [],
    weights: payload.weights ?? [],
    deferredDimensions: payload.deferred ?? [],
    evaluatedAt: row.evaluated_at,
    createdAt: row.created_at,
  };
}

const DISPUTE_TARGET_TYPES = ['bonus_allocation', 'bonus_calculation_run', 'point_ledger'] as const;

export class IncentiveHealthRepository {
  constructor(private readonly supabase: TypedClient) {}

  private table() {
    return (this.supabase as unknown as SupabaseClient).from('policy_health_evaluations');
  }

  // ── persistence (append-only, reproducible) ──────────────────────────────────────────────────

  async findByVersionAndRuleSet(
    versionId: string,
    organizationId: string,
    ruleSetVersion: string,
  ): Promise<PolicyHealthEvaluation | null> {
    const { data, error } = await this.table()
      .select(COLUMNS)
      .eq('organization_id', organizationId)
      .eq('policy_version_id', versionId)
      .eq('rule_set_version', ruleSetVersion)
      .maybeSingle();
    if (error) throw toDomainError(error);
    return data ? toDomain(data as unknown as EvaluationRow) : null;
  }

  async list(organizationId: string, versionId?: string): Promise<PolicyHealthEvaluation[]> {
    let q = this.table().select(COLUMNS).eq('organization_id', organizationId);
    if (versionId) q = q.eq('policy_version_id', versionId);
    const { data, error } = await q.order('evaluated_at', { ascending: false });
    if (error) throw toDomainError(error);
    return ((data ?? []) as unknown as EvaluationRow[]).map(toDomain);
  }

  async getById(id: string, organizationId: string): Promise<PolicyHealthEvaluation | null> {
    const { data, error } = await this.table()
      .select(COLUMNS)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw toDomainError(error);
    return data ? toDomain(data as unknown as EvaluationRow) : null;
  }

  /** Persist an evaluation (SERVER-ONLY — expects the admin client). Append-only; unique per
   * (policy_version_id, rule_set_version). The transparent breakdown (items + weights + deferred) is
   * stored in the `dimensions` jsonb so the overall is fully re-derivable from the row (§26). */
  async insert(row: NewHealthEvaluationRow): Promise<PolicyHealthEvaluation> {
    const payload: DimensionsPayload = {
      items: row.dimensions,
      weights: row.weights,
      deferred: row.deferredDimensions,
    };
    const { data, error } = await this.table()
      .insert({
        organization_id: row.organizationId,
        policy_version_id: row.policyVersionId,
        rule_set_version: row.ruleSetVersion,
        overall_score: row.overallScore,
        dimensions: payload,
      })
      .select(COLUMNS)
      .single();
    if (error) throw toDomainError(error);
    return toDomain(data as unknown as EvaluationRow);
  }

  // ── signal reads (READ-ONLY over the policy config + operational tables — §26) ─────────────────

  /** Count rows of a filtered query (head:true → no rows fetched). The supabase builder is a
   * PromiseLike, not a Promise — accept it as such (mirrors Module 4-B). */
  private async count(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
    const { count, error } = await query;
    if (error) throw toDomainError(error);
    return count ?? 0;
  }

  /**
   * Read the frozen health signals of a scoring_policy_version. Throws if the version does not exist
   * in this org. All reads are READ-ONLY; the engine that consumes these is pure + deterministic.
   */
  async readHealthSignals(versionId: string, organizationId: string): Promise<HealthSignals> {
    // Config-derived: static complexity (feeds Complexity dimension) + threshold cliffs (Gaming).
    const { data: versionRow, error: vErr } = await this.supabase
      .from('scoring_policy_versions')
      .select('multipliers, revision_penalty_rule, timeliness_thresholds')
      .eq('id', versionId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (vErr) throw toDomainError(vErr);
    if (!versionRow) {
      throw toDomainError({ message: 'scoring_policy_version not found in organization', code: 'PGRST116' });
    }
    const staticResult = evaluateStaticComplexity(configFromVersionRow(versionRow as Record<string, unknown>));
    const cliffComponent = staticResult.components.find((c) => c.code === 'threshold_cliffs');
    const cliffCount = cliffComponent ? cliffComponent.value : 0;

    // Runs for the version. completed = authoritative (concentration/financial); all statuses used for
    // the disputable-target surface (a dispute may target a superseded run/allocation).
    const { data: runRows, error: rErr } = await this.supabase
      .from('bonus_calculation_runs')
      .select('id, bonus_pool_id, status')
      .eq('organization_id', organizationId)
      .eq('policy_version_id', versionId);
    if (rErr) throw toDomainError(rErr);
    const runs = (runRows ?? []) as Array<{ id: string; bonus_pool_id: string; status: string }>;
    const allRunIds = runs.map((r) => r.id);
    const completed = runs.filter((r) => r.status === 'completed');
    const completedRunIds = completed.map((r) => r.id);

    const [
      concentration,
      financialIntegrity,
      discretion,
      disputeResult,
      allocationIdSet,
    ] = await Promise.all([
      this.readConcentration(organizationId, completedRunIds),
      this.readFinancialIntegrity(organizationId, completed),
      this.readDiscretion(organizationId, versionId),
      this.readDisputeSignals(organizationId, versionId, allRunIds),
      this.readVersionAllocationIds(organizationId, allRunIds),
    ]);

    // Disputable-target coverage denominator: runs + allocations + version-attributable ledger rows.
    const scopedTargets = allRunIds.length + allocationIdSet + discretion.ledgerIdCount;

    return {
      concentration,
      financialIntegrity,
      discretion: {
        scoredPoints: discretion.scoredPoints,
        overrideMagnitude: discretion.overrideMagnitude,
        scoredCount: discretion.scoredCount,
        overrideCount: discretion.overrideCount,
      },
      gaming: { cliffCount },
      dispute: {
        attributableDisputes: disputeResult.attributable,
        openOrUnresolved: disputeResult.open,
        scopedTargets,
      },
      complexity: { staticScore: staticResult.staticScore },
      evidence: {
        policyVersionId: versionId,
        calculationRunIds: completedRunIds,
        disputeIds: disputeResult.disputeIds,
      },
    };
  }

  /** Per-employee payout totals (minor units) across the version's completed runs. */
  private async readConcentration(organizationId: string, completedRunIds: string[]) {
    if (completedRunIds.length === 0) return { payouts: [] };
    const { data, error } = await this.supabase
      .from('bonus_allocations')
      .select('employee_id, final_amount_minor, status')
      .eq('organization_id', organizationId)
      .in('calculation_run_id', completedRunIds)
      .neq('status', 'draft');
    if (error) throw toDomainError(error);
    const byEmployee = new Map<string, number>();
    for (const a of (data ?? []) as Array<{ employee_id: string; final_amount_minor: number | string }>) {
      byEmployee.set(a.employee_id, (byEmployee.get(a.employee_id) ?? 0) + num(a.final_amount_minor));
    }
    return { payouts: [...byEmployee.values()] };
  }

  /** Pool conservation + missing cap basis over the version's completed runs. Literal cap overflow is
   * NOT read: the DB CHECK bonus_allocations_cap_not_exceeded_chk (0013) makes cap_applied='yes' ⇒
   * final ≤ cap structurally, so a cap-exceeded count would be a permanently-dead always-0 signal. */
  private async readFinancialIntegrity(
    organizationId: string,
    completed: Array<{ id: string; bonus_pool_id: string }>,
  ) {
    if (completed.length === 0) {
      return { pools: [], missingCapBasis: 0, allocationCount: 0 };
    }
    const completedRunIds = completed.map((r) => r.id);
    const poolIds = [...new Set(completed.map((r) => r.bonus_pool_id))];

    const [allocRes, snapRes, poolRes] = await Promise.all([
      this.supabase
        .from('bonus_allocations')
        .select('calculation_run_id, final_amount_minor, cap_applied')
        .eq('organization_id', organizationId)
        .in('calculation_run_id', completedRunIds)
        .neq('status', 'draft'),
      this.supabase
        .from('bonus_allocation_snapshots')
        .select('calculation_run_id, bonus_pool_id, undistributed_remainder_minor')
        .eq('organization_id', organizationId)
        .in('calculation_run_id', completedRunIds),
      this.supabase
        .from('bonus_pools')
        .select('id, amount_minor')
        .eq('organization_id', organizationId)
        .in('id', poolIds),
    ]);
    if (allocRes.error) throw toDomainError(allocRes.error);
    if (snapRes.error) throw toDomainError(snapRes.error);
    if (poolRes.error) throw toDomainError(poolRes.error);

    const allocs = (allocRes.data ?? []) as Array<{
      calculation_run_id: string;
      final_amount_minor: number | string;
      cap_applied: string;
    }>;
    const poolAmount = new Map<string, number>();
    for (const p of (poolRes.data ?? []) as Array<{ id: string; amount_minor: number | string }>) {
      poolAmount.set(p.id, num(p.amount_minor));
    }

    // Allocated per run + missing-cap-basis count (the observable cap-enforcement risk, AD6).
    const allocatedByRun = new Map<string, number>();
    let missingCapBasis = 0;
    for (const a of allocs) {
      allocatedByRun.set(a.calculation_run_id, (allocatedByRun.get(a.calculation_run_id) ?? 0) + num(a.final_amount_minor));
      if (a.cap_applied === 'pending_missing_cap_basis') missingCapBasis += 1;
    }

    // One conservation row per snapshot: declared (pool) vs allocated + undistributed.
    const pools = ((snapRes.data ?? []) as Array<{
      calculation_run_id: string;
      bonus_pool_id: string;
      undistributed_remainder_minor: number | string;
    }>).map((s) => ({
      declared: poolAmount.get(s.bonus_pool_id) ?? 0,
      allocated: allocatedByRun.get(s.calculation_run_id) ?? 0,
      undistributed: num(s.undistributed_remainder_minor),
    }));

    return { pools, missingCapBasis, allocationCount: allocs.length };
  }

  /** Manual-override magnitude vs scored points for the version (Module 4-B attribution paths). Only
   * TASK-LINKED manual adjustments are version-attributable (see the coverage note in the file header);
   * task-less overrides are not counted — they carry no version linkage. */
  private async readDiscretion(organizationId: string, versionId: string) {
    const [scoredRes, overrideRes] = await Promise.all([
      this.supabase
        .from('point_ledger')
        .select('id, points_delta')
        .eq('organization_id', organizationId)
        .eq('scoring_policy_version_id', versionId)
        .eq('event_type', 'task_approved'),
      this.supabase
        .from('point_ledger')
        .select('id, points_delta, tasks!inner(scoring_policy_version_id)')
        .eq('organization_id', organizationId)
        .eq('event_type', 'manual_adjustment')
        .eq('tasks.scoring_policy_version_id', versionId),
    ]);
    if (scoredRes.error) throw toDomainError(scoredRes.error);
    if (overrideRes.error) throw toDomainError(overrideRes.error);

    const scoredRows = (scoredRes.data ?? []) as Array<{ id: string; points_delta: number | string }>;
    const overrideRows = (overrideRes.data ?? []) as Array<{ id: string; points_delta: number | string }>;
    const scoredPoints = scoredRows.reduce((sum, r) => sum + Math.max(0, num(r.points_delta)), 0);
    const overrideMagnitude = overrideRows.reduce((sum, r) => sum + Math.abs(num(r.points_delta)), 0);
    return {
      scoredPoints,
      overrideMagnitude,
      scoredCount: scoredRows.length,
      overrideCount: overrideRows.length,
      ledgerIdCount: scoredRows.length + overrideRows.length,
    };
  }

  /** Count of the version's allocation rows (across all its runs) — part of the disputable surface. */
  private async readVersionAllocationIds(organizationId: string, allRunIds: string[]): Promise<number> {
    if (allRunIds.length === 0) return 0;
    return this.count(
      this.supabase
        .from('bonus_allocations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .in('calculation_run_id', allRunIds),
    );
  }

  /** Disputes deterministically attributable to the version via polymorphic targets (allocation /
   * run / point_ledger). Disputes whose target is a task/clawback/other are NOT attributable here. */
  private async readDisputeSignals(organizationId: string, versionId: string, allRunIds: string[]) {
    // Build the version's target-id sets (runs, allocations, version-attributable ledger rows).
    const runIdSet = new Set(allRunIds);

    const [allocRes, ledgerScoredRes, ledgerOverrideRes, disputeRes] = await Promise.all([
      allRunIds.length > 0
        ? this.supabase
            .from('bonus_allocations')
            .select('id')
            .eq('organization_id', organizationId)
            .in('calculation_run_id', allRunIds)
        : Promise.resolve({ data: [], error: null }),
      this.supabase
        .from('point_ledger')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('scoring_policy_version_id', versionId)
        .eq('event_type', 'task_approved'),
      this.supabase
        .from('point_ledger')
        .select('id, tasks!inner(scoring_policy_version_id)')
        .eq('organization_id', organizationId)
        .eq('event_type', 'manual_adjustment')
        .eq('tasks.scoring_policy_version_id', versionId),
      this.supabase
        .from('disputes')
        .select('id, target_type, target_id, status')
        .eq('organization_id', organizationId)
        .in('target_type', [...DISPUTE_TARGET_TYPES]),
    ]);
    if (allocRes.error) throw toDomainError(allocRes.error);
    if (ledgerScoredRes.error) throw toDomainError(ledgerScoredRes.error);
    if (ledgerOverrideRes.error) throw toDomainError(ledgerOverrideRes.error);
    if (disputeRes.error) throw toDomainError(disputeRes.error);

    const allocIdSet = new Set(((allocRes.data ?? []) as Array<{ id: string }>).map((r) => r.id));
    const ledgerIdSet = new Set<string>();
    for (const r of (ledgerScoredRes.data ?? []) as Array<{ id: string }>) ledgerIdSet.add(r.id);
    for (const r of (ledgerOverrideRes.data ?? []) as Array<{ id: string }>) ledgerIdSet.add(r.id);

    const OPEN_STATUSES = new Set(['open', 'under_review', 'needs_info']);
    const disputeIds: string[] = [];
    let attributable = 0;
    let open = 0;
    for (const d of (disputeRes.data ?? []) as Array<{ id: string; target_type: string; target_id: string; status: string }>) {
      const hit =
        (d.target_type === 'bonus_calculation_run' && runIdSet.has(d.target_id)) ||
        (d.target_type === 'bonus_allocation' && allocIdSet.has(d.target_id)) ||
        (d.target_type === 'point_ledger' && ledgerIdSet.has(d.target_id));
      if (!hit) continue;
      attributable += 1;
      disputeIds.push(d.id);
      if (OPEN_STATUSES.has(d.status)) open += 1;
    }
    return { attributable, open, disputeIds };
  }
}
