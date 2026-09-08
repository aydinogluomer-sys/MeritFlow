import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { toDomainError } from '@/lib/errors';
import type { EmployeeImpact, ImpactSummary, ReferenceDataset, ReferenceEmployee, ReferenceTask } from '../domain/backtest';
import type { ScoringInputs, ScoringPolicy } from '../domain/scoring-mirror';
import type { JsonObject } from '../domain/types';

// Phase P1 / slice 6-B — impact artifact repository + FROZEN reference-dataset reader.
//   * Artifact READS (list/getById) run through the RLS-scoped user client (policy.impact.read).
//   * The reference-dataset reader + the artifact WRITE run through the service_role (admin) client
//     passed by the application — it reads compensation cap basis (sensitive) for the deterministic
//     engine, exactly as run_bonus_calculation does as SECURITY DEFINER. NOTHING here writes a ledger
//     or mutates a policy version. policy_change_impacts is introduced by 0044; until db types are
//     regenerated it is absent from `Database`, so its calls go through a localized generic-client cast.

type TypedClient = SupabaseClient<Database>;

export interface PolicyChangeImpact {
  id: string;
  organizationId: string;
  changeRequestId: string;
  referencePeriodId: string;
  impactVersion: number;
  fromVersionId: string;
  toDraftVersionId: string;
  financialImpact: ImpactSummary;
  employeeDistribution: EmployeeImpact[];
  healthDelta: unknown | null;
  complexityDelta: unknown | null;
  generatedAt: string;
  createdAt: string;
}

export interface NewImpactRow {
  organizationId: string;
  changeRequestId: string;
  referencePeriodId: string;
  impactVersion: number;
  fromVersionId: string;
  toDraftVersionId: string;
  financialImpact: ImpactSummary;
  employeeDistribution: EmployeeImpact[];
}

interface ImpactRow {
  id: string;
  organization_id: string;
  change_request_id: string;
  reference_period_id: string;
  impact_version: number;
  from_version_id: string;
  to_draft_version_id: string;
  financial_impact: ImpactSummary;
  employee_distribution: EmployeeImpact[];
  health_delta: unknown | null;
  complexity_delta: unknown | null;
  generated_at: string;
  created_at: string;
}

const COLUMNS =
  'id, organization_id, change_request_id, reference_period_id, impact_version, from_version_id, ' +
  'to_draft_version_id, financial_impact, employee_distribution, health_delta, complexity_delta, ' +
  'generated_at, created_at';

function toDomain(row: ImpactRow): PolicyChangeImpact {
  return {
    id: row.id,
    organizationId: row.organization_id,
    changeRequestId: row.change_request_id,
    referencePeriodId: row.reference_period_id,
    impactVersion: row.impact_version,
    fromVersionId: row.from_version_id,
    toDraftVersionId: row.to_draft_version_id,
    financialImpact: row.financial_impact,
    employeeDistribution: row.employee_distribution,
    healthDelta: row.health_delta,
    complexityDelta: row.complexity_delta,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
  };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0);
}

export class PolicyChangeImpactRepository {
  constructor(private readonly supabase: TypedClient) {}

  private table() {
    return (this.supabase as unknown as SupabaseClient).from('policy_change_impacts');
  }

  // ---- artifact reads (RLS-scoped) ------------------------------------------------------------
  async list(organizationId: string, changeRequestId?: string): Promise<PolicyChangeImpact[]> {
    let q = this.table().select(COLUMNS).eq('organization_id', organizationId);
    if (changeRequestId) q = q.eq('change_request_id', changeRequestId);
    const { data, error } = await q.order('generated_at', { ascending: false });
    if (error) throw toDomainError(error);
    return ((data ?? []) as unknown as ImpactRow[]).map(toDomain);
  }

  async getById(id: string, organizationId: string): Promise<PolicyChangeImpact | null> {
    const { data, error } = await this.table()
      .select(COLUMNS)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw toDomainError(error);
    return data ? toDomain(data as unknown as ImpactRow) : null;
  }

  /** Next impact_version for a change request (1 + current max). */
  async nextImpactVersion(organizationId: string, changeRequestId: string): Promise<number> {
    const { data, error } = await this.table()
      .select('impact_version')
      .eq('organization_id', organizationId)
      .eq('change_request_id', changeRequestId)
      .order('impact_version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw toDomainError(error);
    const current = data ? num((data as { impact_version: number }).impact_version) : 0;
    return current + 1;
  }

  /** Persist an impact artifact (SERVER-ONLY — expects the admin client). */
  async insert(row: NewImpactRow): Promise<PolicyChangeImpact> {
    const { data, error } = await this.table()
      .insert({
        organization_id: row.organizationId,
        change_request_id: row.changeRequestId,
        reference_period_id: row.referencePeriodId,
        impact_version: row.impactVersion,
        from_version_id: row.fromVersionId,
        to_draft_version_id: row.toDraftVersionId,
        financial_impact: row.financialImpact,
        employee_distribution: row.employeeDistribution,
        health_delta: null,
        complexity_delta: null,
      })
      .select(COLUMNS)
      .single();
    if (error) throw toDomainError(error);
    return toDomain(data as unknown as ImpactRow);
  }

  // ---- policy config + frozen reference dataset (admin client) --------------------------------
  /** A scoring_policy_version's diffable scoring config (multipliers + penalty rule). */
  async readPolicyConfig(versionId: string, organizationId: string): Promise<ScoringPolicy | null> {
    const { data, error } = await this.supabase
      .from('scoring_policy_versions')
      .select('multipliers, revision_penalty_rule')
      .eq('id', versionId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw toDomainError(error);
    if (!data) return null;
    const row = data as { multipliers: unknown; revision_penalty_rule: unknown };
    return {
      multipliers: (row.multipliers ?? {}) as JsonObject,
      revisionPenaltyRule: (row.revision_penalty_rule ?? {}) as JsonObject,
    };
  }

  /**
   * Read the FROZEN reference dataset for a locked reference period: its pool config, eligible
   * employees (eligibility + comp cap basis), and every approved task's raw scoring inputs (from the
   * point_ledger task_approved metadata joined to tasks by approved_at ∈ period). Deterministic:
   * every input is append-only / frozen. Reads sensitive comp → admin client (server-only engine).
   */
  async readReferenceDataset(
    organizationId: string,
    referencePeriodId: string,
  ): Promise<ReferenceDataset | null> {
    // Period window.
    const { data: periodData, error: periodErr } = await this.supabase
      .from('bonus_periods')
      .select('starts_on, ends_on')
      .eq('id', referencePeriodId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (periodErr) throw toDomainError(periodErr);
    if (!periodData) return null;
    const period = periodData as { starts_on: string; ends_on: string };

    // The period's pool (config identical for both versions).
    const { data: poolData, error: poolErr } = await this.supabase
      .from('bonus_pools')
      .select('id, amount_minor, t_org')
      .eq('bonus_period_id', referencePeriodId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (poolErr) throw toDomainError(poolErr);
    if (!poolData) return null;
    const pool = poolData as { id: string; amount_minor: number; t_org: number | null };

    // Org default cap rate.
    const { data: settingsData, error: settingsErr } = await this.supabase
      .from('organization_settings')
      .select('cap_rate_default')
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (settingsErr) throw toDomainError(settingsErr);
    const capRate = settingsData ? num((settingsData as { cap_rate_default: number }).cap_rate_default) : 0.5;

    // Eligible employees for the pool.
    const { data: eligData, error: eligErr } = await this.supabase
      .from('bonus_pool_eligibility')
      .select('employee_id, eligibility_factor, proration_factor')
      .eq('organization_id', organizationId)
      .eq('bonus_pool_id', pool.id)
      .eq('eligible', true);
    if (eligErr) throw toDomainError(eligErr);
    const eligRows = (eligData ?? []) as Array<{
      employee_id: string;
      eligibility_factor: number;
      proration_factor: number;
    }>;

    // Active comp cap basis for those employees.
    const { data: compData, error: compErr } = await this.supabase
      .from('compensation_records')
      .select('employee_id, cap_basis_minor')
      .eq('organization_id', organizationId)
      .eq('status', 'active');
    if (compErr) throw toDomainError(compErr);
    const capByEmployee = new Map<string, number | null>();
    for (const c of (compData ?? []) as Array<{ employee_id: string; cap_basis_minor: number | null }>) {
      capByEmployee.set(c.employee_id, c.cap_basis_minor);
    }

    const employees: ReferenceEmployee[] = eligRows.map((e) => ({
      employeeId: e.employee_id,
      eligibilityFactor: num(e.eligibility_factor),
      prorataFactor: num(e.proration_factor),
      capBasisMinor: capByEmployee.has(e.employee_id) ? capByEmployee.get(e.employee_id)! : null,
    }));

    // Approved tasks of the period: point_ledger task_approved joined to tasks (approved_at ∈ period).
    const endInclusive = `${period.ends_on}T23:59:59.999Z`;
    const { data: ledgerData, error: ledgerErr } = await this.supabase
      .from('point_ledger')
      .select('employee_id, metadata, tasks!inner(approved_at)')
      .eq('organization_id', organizationId)
      .eq('event_type', 'task_approved')
      .gte('tasks.approved_at', period.starts_on)
      .lte('tasks.approved_at', endInclusive);
    if (ledgerErr) throw toDomainError(ledgerErr);

    const tasks: ReferenceTask[] = ((ledgerData ?? []) as Array<{ employee_id: string; metadata: unknown }>).map(
      (row) => {
        const md = (row.metadata ?? {}) as Record<string, unknown>;
        const inputs: ScoringInputs = {
          basePoints: num(md.base_points),
          complexity: str(md.complexity),
          impact: str(md.impact),
          quality: str(md.quality),
          timeliness: str(md.timeliness),
          revisionCount: num(md.revision_count),
        };
        return { employeeId: row.employee_id, inputs };
      },
    );

    return {
      tasks,
      employees,
      pool: {
        amountMinor: num(pool.amount_minor),
        tOrg: num(pool.t_org ?? 1),
        // AD8: a 1.2 organisational multiplier implies an approved top-up in the frozen run.
        topUpApproved: num(pool.t_org ?? 1) === 1.2,
        capRate,
      },
    };
  }
}
