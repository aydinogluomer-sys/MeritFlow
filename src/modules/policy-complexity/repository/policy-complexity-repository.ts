import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { toDomainError } from '@/lib/errors';
import { configFromVersionRow } from '../domain/complexity-rules';
import type { BucketUsage } from '../domain/simplification';
import type { ComplexityDriver, RuntimeSignals, ScoringPolicyConfig } from '../domain/types';

// Phase P1 / slice 4-A — policy-complexity repository. READS a scoring_policy_version's config
// (never mutates it — §26) and persists an append-only evaluation. Artifact READS run through the
// RLS-scoped user client (policy.manage); the evaluation WRITE runs through the service_role (admin)
// client passed by the application (server-only, like policy_change_impacts). policy_complexity_
// evaluations is introduced by 0045; until db types are regenerated it is absent from `Database`, so
// its calls go through a localized generic-client cast. scoring_policy_versions IS typed.

type TypedClient = SupabaseClient<Database>;

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

export interface PolicyComplexityEvaluation {
  id: string;
  organizationId: string;
  policyVersionId: string;
  ruleSetVersion: string;
  staticScore: number;
  runtimeScore: number | null;
  totalScore: number;
  components: ComplexityDriver[];
  evaluatedAt: string;
  createdAt: string;
}

export interface NewEvaluationRow {
  organizationId: string;
  policyVersionId: string;
  ruleSetVersion: string;
  staticScore: number;
  totalScore: number;
  components: ComplexityDriver[];
  runtimeScore?: number | null; // 4-B: a full (static+runtime) evaluation sets this; 4-A leaves it null
}

/** A policy version's identity for the trend read (§6.7). */
export interface PolicyVersionRef {
  policyVersionId: string;
  versionNo: number;
}

interface EvaluationRow {
  id: string;
  organization_id: string;
  policy_version_id: string;
  rule_set_version: string;
  static_score: number | string;
  runtime_score: number | string | null;
  total_score: number | string;
  components: ComplexityDriver[];
  evaluated_at: string;
  created_at: string;
}

const COLUMNS =
  'id, organization_id, policy_version_id, rule_set_version, static_score, runtime_score, ' +
  'total_score, components, evaluated_at, created_at';

function toDomain(row: EvaluationRow): PolicyComplexityEvaluation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    policyVersionId: row.policy_version_id,
    ruleSetVersion: row.rule_set_version,
    staticScore: num(row.static_score),
    runtimeScore: row.runtime_score === null ? null : num(row.runtime_score),
    totalScore: num(row.total_score),
    components: row.components,
    evaluatedAt: row.evaluated_at,
    createdAt: row.created_at,
  };
}

export class PolicyComplexityRepository {
  constructor(private readonly supabase: TypedClient) {}

  private table() {
    return (this.supabase as unknown as SupabaseClient).from('policy_complexity_evaluations');
  }

  /** Read a scoring_policy_version's analyzed config (multipliers/penalty/thresholds). READ-ONLY. */
  async readVersionConfig(
    versionId: string,
    organizationId: string,
  ): Promise<ScoringPolicyConfig | null> {
    const { data, error } = await this.supabase
      .from('scoring_policy_versions')
      .select('multipliers, revision_penalty_rule, timeliness_thresholds')
      .eq('id', versionId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw toDomainError(error);
    if (!data) return null;
    return configFromVersionRow(data as Record<string, unknown>);
  }

  async findByVersionAndRuleSet(
    versionId: string,
    organizationId: string,
    ruleSetVersion: string,
  ): Promise<PolicyComplexityEvaluation | null> {
    const { data, error } = await this.table()
      .select(COLUMNS)
      .eq('organization_id', organizationId)
      .eq('policy_version_id', versionId)
      .eq('rule_set_version', ruleSetVersion)
      .maybeSingle();
    if (error) throw toDomainError(error);
    return data ? toDomain(data as unknown as EvaluationRow) : null;
  }

  async list(organizationId: string, versionId?: string): Promise<PolicyComplexityEvaluation[]> {
    let q = this.table().select(COLUMNS).eq('organization_id', organizationId);
    if (versionId) q = q.eq('policy_version_id', versionId);
    const { data, error } = await q.order('evaluated_at', { ascending: false });
    if (error) throw toDomainError(error);
    return ((data ?? []) as unknown as EvaluationRow[]).map(toDomain);
  }

  async getById(id: string, organizationId: string): Promise<PolicyComplexityEvaluation | null> {
    const { data, error } = await this.table()
      .select(COLUMNS)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw toDomainError(error);
    return data ? toDomain(data as unknown as EvaluationRow) : null;
  }

  /** Persist an evaluation (SERVER-ONLY — expects the admin client). runtime_score = null for a 4-A
   * static-only row; set for a 4-B full (static+runtime) row. Append-only (unique version+rule_set). */
  async insert(row: NewEvaluationRow): Promise<PolicyComplexityEvaluation> {
    const { data, error } = await this.table()
      .insert({
        organization_id: row.organizationId,
        policy_version_id: row.policyVersionId,
        rule_set_version: row.ruleSetVersion,
        static_score: row.staticScore,
        runtime_score: row.runtimeScore ?? null,
        total_score: row.totalScore,
        components: row.components,
      })
      .select(COLUMNS)
      .single();
    if (error) throw toDomainError(error);
    return toDomain(data as unknown as EvaluationRow);
  }

  // ── Module 4-B: runtime-signal reads (READ-ONLY over operational tables — §26) ────────────────

  /** Count rows matching a filtered point_ledger / runs query (head:true → no rows fetched). The
   * supabase query builder is a thenable (PromiseLike), not a Promise — accept it as such. */
  private async count(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
    const { count, error } = await query;
    if (error) throw toDomainError(error);
    return count ?? 0;
  }

  /**
   * Read the frozen runtime signals of a policy version (§6.5). Overrides are attributed via the
   * point_ledger→tasks join (the manual-adjustment RPC does not stamp scoring_policy_version_id, but
   * tasks do); recalculations via bonus_calculation_runs.policy_version_id; scored volume via
   * point_ledger.scoring_policy_version_id (set on task_approved). All sources are append-only/terminal.
   * Dispute-adjustment usage is DEFERRED (not cleanly version-attributable — see RuntimeSignals note).
   */
  async readRuntimeSignals(versionId: string, organizationId: string): Promise<RuntimeSignals> {
    const [taskApprovedCount, overrideCount, recalculationCount] = await Promise.all([
      this.count(
        this.supabase
          .from('point_ledger')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('scoring_policy_version_id', versionId)
          .eq('event_type', 'task_approved'),
      ),
      this.count(
        this.supabase
          .from('point_ledger')
          .select('id, tasks!inner(scoring_policy_version_id)', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('event_type', 'manual_adjustment')
          .eq('tasks.scoring_policy_version_id', versionId),
      ),
      this.count(
        this.supabase
          .from('bonus_calculation_runs')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .eq('policy_version_id', versionId)
          .eq('status', 'superseded'),
      ),
    ]);
    return { overrideCount, recalculationCount, taskApprovedCount };
  }

  /** Which scoring buckets the version's scored work actually used (from task_approved metadata). */
  async readBucketUsage(versionId: string, organizationId: string): Promise<BucketUsage> {
    const { data, error } = await this.supabase
      .from('point_ledger')
      .select('metadata')
      .eq('organization_id', organizationId)
      .eq('scoring_policy_version_id', versionId)
      .eq('event_type', 'task_approved');
    if (error) throw toDomainError(error);
    const dims = ['complexity', 'impact', 'quality', 'timeliness'] as const;
    const used: Record<string, Set<string>> = { complexity: new Set(), impact: new Set(), quality: new Set(), timeliness: new Set() };
    for (const row of (data ?? []) as Array<{ metadata: Record<string, unknown> | null }>) {
      const md = row.metadata ?? {};
      for (const d of dims) {
        const v = md[d];
        if (typeof v === 'string' && v.length > 0) used[d]!.add(v);
      }
    }
    return { complexity: [...used.complexity!], impact: [...used.impact!], quality: [...used.quality!], timeliness: [...used.timeliness!] };
  }

  /** All versions of a scoring policy (id + version_no) for the trend read (§6.7). */
  async listVersionsForPolicy(scoringPolicyId: string, organizationId: string): Promise<PolicyVersionRef[]> {
    const { data, error } = await this.supabase
      .from('scoring_policy_versions')
      .select('id, version_no')
      .eq('organization_id', organizationId)
      .eq('scoring_policy_id', scoringPolicyId)
      .order('version_no', { ascending: true });
    if (error) throw toDomainError(error);
    return ((data ?? []) as Array<{ id: string; version_no: number }>).map((v) => ({
      policyVersionId: v.id,
      versionNo: v.version_no,
    }));
  }
}
