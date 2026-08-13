import { createClient } from '@/lib/supabase/server';
import { AuditRepository } from '../repository/audit-repository';
import type { CompAccessRepository } from '../repository/comp-access-repository';
import { AUDIT_CSV_HEADER, csvField, jsonbField } from '../domain/csv';
import type { AuditExportContext, AuditExportResult, ExportAuditInput } from '../domain/types';

/**
 * Export the active org's audit trail as CSV. AD3 masking: sensitive rows expose raw before/after
 * ONLY when the caller can see raw (audit.read AND comp.read — decided in the action and passed as
 * ctx.canSeeRaw); otherwise both fields become the literal 'MASKED'.
 *
 * The comp-access audit fires ONLY when a sensitive row was actually exported in raw form —
 * `canSeeRaw` alone (permission to unmask) is not enough. Fail-closed: no unaudited raw access.
 */
export async function exportAudit(
  input: ExportAuditInput,
  ctx: AuditExportContext,
  compAccessRepo: CompAccessRepository,
): Promise<AuditExportResult> {
  const supabase = await createClient();
  const repo = new AuditRepository(supabase);
  const rows = await repo.fetchAuditLogs(input, ctx.organizationId);

  const lines = rows.map((row) => {
    const masked = row.is_sensitive && !ctx.canSeeRaw;
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

  const csv = [AUDIT_CSV_HEADER, ...lines].join('\n');

  if (ctx.canSeeRaw && rows.some((r) => r.is_sensitive === true)) {
    await compAccessRepo.logRawAccess(ctx.organizationId, ctx.actorProfileId);
  }

  return { csv, rowCount: rows.length };
}
