export interface ExportAuditInput {
  fromDate?: string;
  toDate?: string;
}

export interface AuditExportRow {
  id: string;
  action: string;
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  is_sensitive: boolean;
  before: unknown;
  after: unknown;
  reason: string | null;
  created_at: string;
}

/**
 * Authz is resolved in the action and handed to the module as data: `canSeeRaw` = the caller
 * holds BOTH audit.read and comp.read (AD3). The module never imports auth helpers.
 */
export interface AuditExportContext {
  organizationId: string;
  actorProfileId: string;
  canSeeRaw: boolean;
}

export interface AuditExportResult {
  csv: string;
  rowCount: number;
}
