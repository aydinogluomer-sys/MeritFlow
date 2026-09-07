import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { toDomainError } from '@/lib/errors';
import { configFromVersionRow } from '../domain/diff';
import type { ChangeRequestStatus, PolicyVersionConfig } from '../domain/types';

// Phase P1 / slice 6-A — governance repository for policy_change_requests. All reads/writes go
// through the RLS-scoped user client; tenant + permission/role gating is enforced by the RLS
// policies and the validate_policy_change_request() trigger (migration 0043). This module NEVER
// mutates a scoring_policy_version (published versions are read-only — §8.2) and NEVER writes any
// ledger. NOTE: policy_change_requests is introduced by 0043; until `npm run db:types` regenerates
// src/types/database.generated.ts (verify:db on CI/Docker) the table is absent from `Database`, so
// its calls go through a localized generic-client cast (`asGeneric`). scoring_policy_versions IS in
// `Database` and is read via the typed client.

type TypedClient = SupabaseClient<Database>;

export interface PolicyChangeRequest {
  id: string;
  organizationId: string;
  scoringPolicyId: string;
  fromVersionId: string;
  toDraftVersionId: string;
  reason: string;
  status: ChangeRequestStatus;
  requestedBy: string;
  effectiveDate: string | null;
  allowRetroactive: boolean;
  hrApprovedBy: string | null;
  hrApprovedAt: string | null;
  financeApprovedBy: string | null;
  financeApprovedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewChangeRequestRow {
  organizationId: string;
  scoringPolicyId: string;
  fromVersionId: string;
  toDraftVersionId: string;
  reason: string;
  requestedBy: string;
  effectiveDate?: string | null;
  allowRetroactive?: boolean;
}

interface PcrRow {
  id: string;
  organization_id: string;
  scoring_policy_id: string;
  from_version_id: string;
  to_draft_version_id: string;
  reason: string;
  status: string;
  requested_by: string;
  effective_date: string | null;
  allow_retroactive: boolean;
  hr_approved_by: string | null;
  hr_approved_at: string | null;
  finance_approved_by: string | null;
  finance_approved_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, organization_id, scoring_policy_id, from_version_id, to_draft_version_id, reason, status, ' +
  'requested_by, effective_date, allow_retroactive, hr_approved_by, hr_approved_at, ' +
  'finance_approved_by, finance_approved_at, decided_at, decision_note, created_at, updated_at';

function toDomain(row: PcrRow): PolicyChangeRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    scoringPolicyId: row.scoring_policy_id,
    fromVersionId: row.from_version_id,
    toDraftVersionId: row.to_draft_version_id,
    reason: row.reason,
    status: row.status as ChangeRequestStatus,
    requestedBy: row.requested_by,
    effectiveDate: row.effective_date,
    allowRetroactive: row.allow_retroactive,
    hrApprovedBy: row.hr_approved_by,
    hrApprovedAt: row.hr_approved_at,
    financeApprovedBy: row.finance_approved_by,
    financeApprovedAt: row.finance_approved_at,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListFilter {
  status?: ChangeRequestStatus;
  scoringPolicyId?: string;
}

export class PolicyChangeRequestRepository {
  constructor(private readonly supabase: TypedClient) {}

  // Localized escape hatch for the not-yet-in-Database table (see file header). Drop the cast
  // once database.generated.ts is regenerated.
  private table() {
    return (this.supabase as unknown as SupabaseClient).from('policy_change_requests');
  }

  /** Read a scoring_policy_version's diffable config (metadata ignored). RLS-scoped. */
  async getVersionConfig(versionId: string, organizationId: string): Promise<PolicyVersionConfig | null> {
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

  async create(input: NewChangeRequestRow): Promise<PolicyChangeRequest> {
    const { data, error } = await this.table()
      .insert({
        organization_id: input.organizationId,
        scoring_policy_id: input.scoringPolicyId,
        from_version_id: input.fromVersionId,
        to_draft_version_id: input.toDraftVersionId,
        reason: input.reason,
        requested_by: input.requestedBy,
        effective_date: input.effectiveDate ?? null,
        allow_retroactive: input.allowRetroactive ?? false,
        status: 'draft',
      })
      .select(COLUMNS)
      .single();
    if (error) throw toDomainError(error);
    return toDomain(data as unknown as PcrRow);
  }

  async getById(id: string, organizationId: string): Promise<PolicyChangeRequest | null> {
    const { data, error } = await this.table()
      .select(COLUMNS)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (error) throw toDomainError(error);
    return data ? toDomain(data as unknown as PcrRow) : null;
  }

  async list(organizationId: string, filter: ListFilter = {}): Promise<PolicyChangeRequest[]> {
    let q = this.table().select(COLUMNS).eq('organization_id', organizationId);
    if (filter.status) q = q.eq('status', filter.status);
    if (filter.scoringPolicyId) q = q.eq('scoring_policy_id', filter.scoringPolicyId);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw toDomainError(error);
    return ((data ?? []) as unknown as PcrRow[]).map(toDomain);
  }

  private async patch(
    id: string,
    organizationId: string,
    patch: Record<string, unknown>,
  ): Promise<PolicyChangeRequest> {
    const { data, error } = await this.table()
      .update(patch)
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select(COLUMNS)
      .single();
    if (error) throw toDomainError(error);
    return toDomain(data as unknown as PcrRow);
  }

  /** draft -> submitted (requester). */
  submit(id: string, organizationId: string): Promise<PolicyChangeRequest> {
    return this.patch(id, organizationId, { status: 'submitted' });
  }

  /** Stamp the HR approval slot (the trigger enforces role=hr, self-stamp, one-time, auto-complete). */
  recordHrApproval(id: string, organizationId: string, approverId: string): Promise<PolicyChangeRequest> {
    return this.patch(id, organizationId, { hr_approved_by: approverId });
  }

  /** Stamp the Finance approval slot (trigger enforces role=finance, self-stamp, one-time). */
  recordFinanceApproval(
    id: string,
    organizationId: string,
    approverId: string,
  ): Promise<PolicyChangeRequest> {
    return this.patch(id, organizationId, { finance_approved_by: approverId });
  }

  /** submitted -> rejected (HR/Finance; decision_note required by the trigger). */
  reject(id: string, organizationId: string, note: string): Promise<PolicyChangeRequest> {
    return this.patch(id, organizationId, { status: 'rejected', decision_note: note });
  }

  /** submitted -> changes_requested (HR/Finance; decision_note required). */
  requestChanges(id: string, organizationId: string, note: string): Promise<PolicyChangeRequest> {
    return this.patch(id, organizationId, { status: 'changes_requested', decision_note: note });
  }
}
