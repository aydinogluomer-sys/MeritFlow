import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { toDomainError } from '@/lib/errors';
import { type EvidenceRef } from '../domain/evidence';
import { type SuggestedAction } from '../domain/evidence';
import { InsightSchema, type Insight, type InsightSeverity } from '../domain/insight';
import { assertTransition, type InsightStatus } from '../domain/insight-status';

// Phase P0 — Insight store repository (plan §2.4/§2.8). READS run through the RLS-scoped user client
// (tenant + intelligence.read/employee-own enforced by policy); WRITES are SERVER-ONLY and expect the
// service_role (admin) client — there is no client write policy. The §2.8 status machine is enforced
// here (assertTransition) since the DB constrains only the value set, not the transitions. No LLM,
// no financial calculation: deterministic_payload + evidence_refs are the authoritative facts.

type IntelClient = SupabaseClient<Database>;

/** The persisted deterministic content embedded in deterministic_payload (§2.4 has no separate cols). */
interface DeterministicPayload {
  headline: string;
  facts: Record<string, unknown>;
  suggestedActions: SuggestedAction[];
}

/** A stored insight: DB metadata (subject/period/status/timestamps) + the domain Insight content. */
export interface StoredInsight extends Insight {
  organizationId: string;
  subjectType: string;
  subjectId: string | null;
  bonusPeriodId: string | null;
  status: InsightStatus;
  modelPayload: Record<string, unknown> | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  resolutionCode: string | null;
}

/** Input to persist a new insight. The evidence+action invariant is validated before the write. */
export interface NewInsightInput {
  organizationId: string;
  insightType: string;
  subjectType: string;
  subjectId?: string | null;
  bonusPeriodId?: string | null;
  severity: InsightSeverity;
  status?: InsightStatus;
  headline: string;
  deterministicFacts: Record<string, unknown>;
  evidence: EvidenceRef[];
  suggestedActions: SuggestedAction[];
}

interface InsightRow {
  id: string;
  organization_id: string;
  insight_type: string;
  subject_type: string;
  subject_id: string | null;
  bonus_period_id: string | null;
  severity: string;
  status: string;
  deterministic_payload: Record<string, unknown>;
  model_payload: Record<string, unknown> | null;
  evidence_refs: unknown;
  first_detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  resolution_code: string | null;
  created_at: string;
}

function toStored(row: InsightRow): StoredInsight {
  const payload = (row.deterministic_payload ?? {}) as Partial<DeterministicPayload>;
  return {
    id: row.id,
    type: row.insight_type,
    severity: row.severity as InsightSeverity,
    headline: payload.headline ?? '',
    deterministicFacts: payload.facts ?? {},
    evidence: (row.evidence_refs as EvidenceRef[]) ?? [],
    suggestedActions: payload.suggestedActions ?? [],
    generatedAt: row.created_at,
    organizationId: row.organization_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    bonusPeriodId: row.bonus_period_id,
    status: row.status as InsightStatus,
    modelPayload: row.model_payload,
    firstDetectedAt: row.first_detected_at,
    lastDetectedAt: row.last_detected_at,
    resolvedAt: row.resolved_at,
    resolutionCode: row.resolution_code,
  };
}

const SELECT_COLUMNS =
  'id, organization_id, insight_type, subject_type, subject_id, bonus_period_id, severity, status, ' +
  'deterministic_payload, model_payload, evidence_refs, first_detected_at, last_detected_at, ' +
  'resolved_at, resolution_code, created_at';

export interface ListInsightsFilter {
  status?: InsightStatus;
  insightType?: string;
  subjectType?: string;
}

export class IntelligenceRepository {
  constructor(private readonly supabase: IntelClient) {}

  /** RLS-scoped list for an org (visibility enforced by policy: intelligence.read OR employee-own). */
  async list(organizationId: string, filter: ListInsightsFilter = {}): Promise<StoredInsight[]> {
    let q = this.supabase
      .from('intelligence_insights')
      .select(SELECT_COLUMNS)
      .eq('organization_id', organizationId);
    if (filter.status) q = q.eq('status', filter.status);
    if (filter.insightType) q = q.eq('insight_type', filter.insightType);
    if (filter.subjectType) q = q.eq('subject_type', filter.subjectType);

    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw toDomainError(error);
    return ((data ?? []) as unknown as InsightRow[]).map(toStored);
  }

  /** RLS-scoped single read, or null when absent/not visible. */
  async getById(id: string, organizationId: string): Promise<StoredInsight | null> {
    const { data, error } = await this.supabase
      .from('intelligence_insights')
      .select(SELECT_COLUMNS)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw toDomainError(error);
    return data ? toStored(data as unknown as InsightRow) : null;
  }

  /**
   * Persist a new insight (SERVER-ONLY — expects the service_role client). Validates the
   * evidence+action invariant (InsightSchema) before writing; the DB re-checks it structurally.
   */
  async insert(input: NewInsightInput): Promise<StoredInsight> {
    // Enforce the domain invariant (>=1 evidence, >=1 action) with a throwaway id for validation.
    InsightSchema.parse({
      id: '00000000-0000-0000-0000-000000000000',
      type: input.insightType,
      severity: input.severity,
      headline: input.headline,
      deterministicFacts: input.deterministicFacts,
      evidence: input.evidence,
      suggestedActions: input.suggestedActions,
      generatedAt: new Date().toISOString(),
    } satisfies Insight);

    const deterministicPayload: DeterministicPayload = {
      headline: input.headline,
      facts: input.deterministicFacts,
      suggestedActions: input.suggestedActions,
    };

    const { data, error } = await this.supabase
      .from('intelligence_insights')
      .insert({
        organization_id: input.organizationId,
        insight_type: input.insightType,
        subject_type: input.subjectType,
        subject_id: input.subjectId ?? null,
        bonus_period_id: input.bonusPeriodId ?? null,
        severity: input.severity,
        status: input.status ?? 'draft',
        deterministic_payload: deterministicPayload as unknown as Database['public']['Tables']['intelligence_insights']['Insert']['deterministic_payload'],
        model_payload: null,
        evidence_refs: input.evidence as unknown as Database['public']['Tables']['intelligence_insights']['Insert']['evidence_refs'],
      })
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw toDomainError(error);
    return toStored(data as unknown as InsightRow);
  }

  /**
   * Advance an insight's status (SERVER-ONLY). Enforces the §2.8 lifecycle via assertTransition, then
   * stamps resolved_at/resolution_code when moving into a terminal (dismissed/retrospective) state.
   */
  async transition(
    id: string,
    organizationId: string,
    to: InsightStatus,
    resolutionCode?: string,
  ): Promise<StoredInsight> {
    const current = await this.getById(id, organizationId);
    if (!current) throw new Error(`insight not found: ${id}`);
    assertTransition(current.status, to);

    const patch: Record<string, unknown> = { status: to };
    if (to === 'dismissed' || to === 'retrospective') {
      patch.resolved_at = new Date().toISOString();
      if (resolutionCode) patch.resolution_code = resolutionCode;
    }

    const { data, error } = await this.supabase
      .from('intelligence_insights')
      .update(patch as Database['public']['Tables']['intelligence_insights']['Update'])
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select(SELECT_COLUMNS)
      .single();
    if (error) throw toDomainError(error);
    return toStored(data as unknown as InsightRow);
  }
}
