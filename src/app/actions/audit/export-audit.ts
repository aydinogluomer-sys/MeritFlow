'use server';
import 'server-only';

import { validatedAction } from '@/lib/validation/action';
import { ExportAuditSchema } from '@/lib/validation/schemas/audit';
import { requirePermission, getPermissions } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';

type AuditExportRow = {
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
};

const CSV_HEADER =
  'id,action,actor_id,target_type,target_id,is_sensitive,before,after,reason,created_at';

/** RFC-4180 style escape: wrap in double-quotes, double internal quotes; null → ''. */
function csvField(v: unknown): string {
  if (v === null || v === undefined) return '';
  return '"' + String(v).replace(/"/g, '""') + '"';
}

/** Serialize a jsonb value for CSV: '' when null, otherwise JSON string. */
function jsonbField(v: unknown): string {
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}

/**
 * Export the active org's audit trail as CSV (Phase 10-A). Reads `audit_logs`
 * through the RLS-scoped client (never the admin client) — the caller's
 * `audit.read` grant plus row-level policy govern visibility.
 *
 * AD3 masking: sensitive rows expose raw before/after payloads ONLY to callers
 * holding BOTH `audit.read` and `comp.read`; otherwise both fields are replaced
 * with the literal 'MASKED'.
 */
export const exportAudit = validatedAction(ExportAuditSchema, async (input) => {
  await requirePermission('audit.read');
  const org = await getActiveOrg();
  const permissions = await getPermissions();

  const supabase = await createClient();

  let query = supabase
    .from('audit_logs')
    .select(
      'id, action, actor_id, target_type, target_id, is_sensitive, before, after, reason, created_at',
    )
    .eq('organization_id', org!.organization_id)
    .order('created_at', { ascending: false });

  if (input.fromDate) query = query.gte('created_at', input.fromDate);
  if (input.toDate) query = query.lte('created_at', input.toDate);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as AuditExportRow[];

  const canSeeRaw =
    permissions.includes('audit.read') && permissions.includes('comp.read');

  const lines = rows.map((row) => {
    const masked = row.is_sensitive && !canSeeRaw;
    const beforeValue = masked ? 'MASKED' : jsonbField(row.before);
    const afterValue = masked ? 'MASKED' : jsonbField(row.after);

    return [
      csvField(row.id),
      csvField(row.action),
      csvField(row.actor_id),
      csvField(row.target_type),
      csvField(row.target_id),
      csvField(row.is_sensitive),
      csvField(beforeValue),
      csvField(afterValue),
      csvField(row.reason),
      csvField(row.created_at),
    ].join(',');
  });

  const csv = [CSV_HEADER, ...lines].join('\n');

  return { csv, rowCount: rows.length };
});
