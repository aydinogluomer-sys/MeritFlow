import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { toDomainError } from '@/lib/errors';
import { configFromVersionRow } from '../domain/complexity-rules';
import type { ComplexityDriver, ScoringPolicyConfig } from '../domain/types';

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

  /** Persist an evaluation (SERVER-ONLY — expects the admin client). runtime_score stays NULL (4-B). */
  async insert(row: NewEvaluationRow): Promise<PolicyComplexityEvaluation> {
    const { data, error } = await this.table()
      .insert({
        organization_id: row.organizationId,
        policy_version_id: row.policyVersionId,
        rule_set_version: row.ruleSetVersion,
        static_score: row.staticScore,
        runtime_score: null,
        total_score: row.totalScore,
        components: row.components,
      })
      .select(COLUMNS)
      .single();
    if (error) throw toDomainError(error);
    return toDomain(data as unknown as EvaluationRow);
  }
}
