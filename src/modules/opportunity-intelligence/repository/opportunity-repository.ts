import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { toDomainError } from '@/lib/errors';
import { COMPLEXITY_WEIGHTS } from '../domain/rules/weights.rules';
import type { Complexity, MemberSignals, OpportunityComponent, OpportunityComponentWeight, OpportunityFlag } from '../domain/types';

// Phase P3 / slice 2-A — opportunity-intelligence repository. READS only WORK-CONTEXT signals for a
// bonus period (tasks / task_reviews / bonus_pool_eligibility / memberships / bonus_periods) and
// produces the frozen MemberSignals[] the pure engine consumes. NEVER reads a protected characteristic
// (none exist) and NEVER reads compensation_records (§4.2/§26). Persists an append-only, immutable
// snapshot. opportunity_snapshots is introduced by 0048; until db types are regenerated it is absent
// from `Database`, so its calls go through a localized generic-client cast (0045/0046/0047 precedent).

type TypedClient = SupabaseClient<Database>;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function complexityWeight(c: string): number {
  return COMPLEXITY_WEIGHTS[c as Complexity] ?? 0;
}

export interface OpportunitySnapshotRecord {
  id: string;
  organizationId: string;
  employeeId: string;
  bonusPeriodId: string;
  ruleSetVersion: string;
  eligibleWorkCount: number;
  assignedWorkCount: number;
  completedWorkCount: number;
  complexityWeightedAvailable: number;
  complexityWeightedAssigned: number;
  activeDays: number;
  reviewLatencyP50: number | null;
  opportunityIndex: number | null;
  components: OpportunityComponentsPayload;
  computedAt: string;
  createdAt: string;
}

export interface OpportunityComponentsPayload {
  items: OpportunityComponent[];
  weights: OpportunityComponentWeight[];
  flags: OpportunityFlag[];
  cohortKey: string;
  cohortSize: number;
  suppressed: boolean;
  suppressionReason: string | null;
}

export interface NewOpportunitySnapshotRow {
  organizationId: string;
  employeeId: string;
  bonusPeriodId: string;
  ruleSetVersion: string;
  eligibleWorkCount: number;
  assignedWorkCount: number;
  completedWorkCount: number;
  complexityWeightedAvailable: number;
  complexityWeightedAssigned: number;
  activeDays: number;
  reviewLatencyP50: number | null;
  opportunityIndex: number | null;
  components: OpportunityComponentsPayload;
}

interface SnapshotRow {
  id: string;
  organization_id: string;
  employee_id: string;
  bonus_period_id: string;
  rule_set_version: string;
  eligible_work_count: number | string;
  assigned_work_count: number | string;
  completed_work_count: number | string;
  complexity_weighted_available: number | string;
  complexity_weighted_assigned: number | string;
  active_days: number | string;
  review_latency_p50: number | string | null;
  opportunity_index: number | string | null;
  components: OpportunityComponentsPayload;
  computed_at: string;
  created_at: string;
}

const COLUMNS =
  'id, organization_id, employee_id, bonus_period_id, rule_set_version, eligible_work_count, ' +
  'assigned_work_count, completed_work_count, complexity_weighted_available, ' +
  'complexity_weighted_assigned, active_days, review_latency_p50, opportunity_index, components, ' +
  'computed_at, created_at';

function toDomain(row: SnapshotRow): OpportunitySnapshotRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    employeeId: row.employee_id,
    bonusPeriodId: row.bonus_period_id,
    ruleSetVersion: row.rule_set_version,
    eligibleWorkCount: num(row.eligible_work_count),
    assignedWorkCount: num(row.assigned_work_count),
    completedWorkCount: num(row.completed_work_count),
    complexityWeightedAvailable: num(row.complexity_weighted_available),
    complexityWeightedAssigned: num(row.complexity_weighted_assigned),
    activeDays: num(row.active_days),
    reviewLatencyP50: row.review_latency_p50 === null ? null : num(row.review_latency_p50),
    opportunityIndex: row.opportunity_index === null ? null : num(row.opportunity_index),
    components: row.components,
    computedAt: row.computed_at,
    createdAt: row.created_at,
  };
}

interface EligibilityRow {
  employee_id: string;
  primary_team_id: string | null;
  days_active: number | string;
}
interface TaskRow {
  assigned_to: string;
  team_id: string | null;
  complexity: string;
  status: string;
  submitted_at: string | null;
  task_reviews: Array<{ created_at: string }> | null;
}

const COMPLETED_STATUSES = new Set(['approved', 'rejected']);
const DAY_MS = 86_400_000;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export class OpportunityRepository {
  constructor(private readonly supabase: TypedClient) {}

  private table() {
    return (this.supabase as unknown as SupabaseClient).from('opportunity_snapshots');
  }

  // ── persistence (append-only, reproducible) ──────────────────────────────────────────────────

  async findByEmployeePeriodRuleSet(
    employeeId: string,
    bonusPeriodId: string,
    ruleSetVersion: string,
    organizationId: string,
  ): Promise<OpportunitySnapshotRecord | null> {
    const { data, error } = await this.table()
      .select(COLUMNS)
      .eq('organization_id', organizationId)
      .eq('employee_id', employeeId)
      .eq('bonus_period_id', bonusPeriodId)
      .eq('rule_set_version', ruleSetVersion)
      .maybeSingle();
    if (error) throw toDomainError(error);
    return data ? toDomain(data as unknown as SnapshotRow) : null;
  }

  async list(organizationId: string, bonusPeriodId?: string): Promise<OpportunitySnapshotRecord[]> {
    let q = this.table().select(COLUMNS).eq('organization_id', organizationId);
    if (bonusPeriodId) q = q.eq('bonus_period_id', bonusPeriodId);
    const { data, error } = await q.order('computed_at', { ascending: false });
    if (error) throw toDomainError(error);
    return ((data ?? []) as unknown as SnapshotRow[]).map(toDomain);
  }

  async insert(row: NewOpportunitySnapshotRow): Promise<OpportunitySnapshotRecord> {
    const { data, error } = await this.table()
      .insert({
        organization_id: row.organizationId,
        employee_id: row.employeeId,
        bonus_period_id: row.bonusPeriodId,
        rule_set_version: row.ruleSetVersion,
        eligible_work_count: row.eligibleWorkCount,
        assigned_work_count: row.assignedWorkCount,
        completed_work_count: row.completedWorkCount,
        complexity_weighted_available: row.complexityWeightedAvailable,
        complexity_weighted_assigned: row.complexityWeightedAssigned,
        active_days: row.activeDays,
        review_latency_p50: row.reviewLatencyP50,
        opportunity_index: row.opportunityIndex,
        components: row.components,
      })
      .select(COLUMNS)
      .single();
    if (error) throw toDomainError(error);
    return toDomain(data as unknown as SnapshotRow);
  }

  // ── signal reads (READ-ONLY; work-context ONLY — no protected attr, no compensation — §4.2) ────

  /**
   * Read the frozen work-context signals for every eligible member of a bonus period. Throws if the
   * period is not found in the org. Work is period-scoped by tasks.created_at (work that arose in the
   * period). Team pool (eligible_work_count / complexity_weighted_available) is the member's PRIMARY
   * team's task pool. Never reads a protected characteristic or compensation.
   */
  async readMemberSignals(bonusPeriodId: string, organizationId: string): Promise<MemberSignals[]> {
    const { data: period, error: pErr } = await this.supabase
      .from('bonus_periods')
      .select('starts_on, ends_on')
      .eq('id', bonusPeriodId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (pErr) throw toDomainError(pErr);
    if (!period) throw toDomainError({ message: 'bonus_period not found in organization', code: 'PGRST116' });
    const startsOn = (period as { starts_on: string }).starts_on;
    const endsOn = (period as { ends_on: string }).ends_on;
    const periodDays = Math.max(1, Math.round((Date.parse(endsOn) - Date.parse(startsOn)) / DAY_MS) + 1);

    // Cohort universe: the period's pool(s) → eligibility rows (employee, primary team, active days).
    const { data: pools, error: poolErr } = await this.supabase
      .from('bonus_pools')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('bonus_period_id', bonusPeriodId);
    if (poolErr) throw toDomainError(poolErr);
    const poolIds = ((pools ?? []) as Array<{ id: string }>).map((p) => p.id);
    if (poolIds.length === 0) return [];

    const { data: eligRows, error: eErr } = await this.supabase
      .from('bonus_pool_eligibility')
      .select('employee_id, primary_team_id, days_active')
      .eq('organization_id', organizationId)
      .in('bonus_pool_id', poolIds);
    if (eErr) throw toDomainError(eErr);
    const eligibility = (eligRows ?? []) as EligibilityRow[];
    if (eligibility.length === 0) return [];

    const employeeIds = [...new Set(eligibility.map((e) => e.employee_id))];
    const { data: memRows, error: mErr } = await this.supabase
      .from('memberships')
      .select('profile_id, primary_role')
      .eq('organization_id', organizationId)
      .in('profile_id', employeeIds);
    if (mErr) throw toDomainError(mErr);
    const roleByEmployee = new Map<string, string>();
    for (const r of (memRows ?? []) as Array<{ profile_id: string; primary_role: string }>) {
      roleByEmployee.set(r.profile_id, r.primary_role);
    }

    // One period-scoped tasks read (with embedded first-review timestamps) → all work signals.
    // created_at is a timestamptz; ends_on is a DATE, so an inclusive `<= ends_on` compares against
    // ends_on 00:00 and would DROP tasks created during the last day. Use a half-open interval
    // [starts_on, ends_on + 1 day) so the whole final day is included.
    const endExclusive = new Date(Date.parse(endsOn) + DAY_MS).toISOString();
    const { data: taskRows, error: tErr } = await this.supabase
      .from('tasks')
      .select('assigned_to, team_id, complexity, status, submitted_at, task_reviews(created_at)')
      .eq('organization_id', organizationId)
      .gte('created_at', startsOn)
      .lt('created_at', endExclusive);
    if (tErr) throw toDomainError(tErr);
    const tasks = (taskRows ?? []) as unknown as TaskRow[];

    // Aggregate per employee (assigned / completed / complexity / latency) and per team (pool).
    const assignedCount = new Map<string, number>();
    const assignedComplexity = new Map<string, number>();
    const completedCount = new Map<string, number>();
    const latencyDays = new Map<string, number[]>();
    const teamPoolCount = new Map<string, number>();
    const teamPoolComplexity = new Map<string, number>();

    for (const t of tasks) {
      const w = complexityWeight(t.complexity);
      assignedCount.set(t.assigned_to, (assignedCount.get(t.assigned_to) ?? 0) + 1);
      assignedComplexity.set(t.assigned_to, (assignedComplexity.get(t.assigned_to) ?? 0) + w);
      if (COMPLETED_STATUSES.has(t.status)) completedCount.set(t.assigned_to, (completedCount.get(t.assigned_to) ?? 0) + 1);
      if (t.team_id) {
        teamPoolCount.set(t.team_id, (teamPoolCount.get(t.team_id) ?? 0) + 1);
        teamPoolComplexity.set(t.team_id, (teamPoolComplexity.get(t.team_id) ?? 0) + w);
      }
      if (t.submitted_at && t.task_reviews && t.task_reviews.length > 0) {
        const firstReview = Math.min(...t.task_reviews.map((r) => Date.parse(r.created_at)));
        const days = (firstReview - Date.parse(t.submitted_at)) / DAY_MS;
        if (Number.isFinite(days) && days >= 0) {
          const arr = latencyDays.get(t.assigned_to) ?? [];
          arr.push(days);
          latencyDays.set(t.assigned_to, arr);
        }
      }
    }

    return eligibility.map((e) => {
      const teamId = e.primary_team_id;
      const lat = latencyDays.get(e.employee_id) ?? [];
      return {
        employeeId: e.employee_id,
        primaryRole: roleByEmployee.get(e.employee_id) ?? 'employee',
        primaryTeamId: teamId,
        activeDays: num(e.days_active),
        periodDays,
        eligibleWorkCount: teamId ? (teamPoolCount.get(teamId) ?? 0) : 0,
        assignedWorkCount: assignedCount.get(e.employee_id) ?? 0,
        completedWorkCount: completedCount.get(e.employee_id) ?? 0,
        complexityWeightedAvailable: teamId ? (teamPoolComplexity.get(teamId) ?? 0) : 0,
        complexityWeightedAssigned: assignedComplexity.get(e.employee_id) ?? 0,
        reviewLatencyP50Days: lat.length > 0 ? median(lat) : null,
      };
    });
  }
}
