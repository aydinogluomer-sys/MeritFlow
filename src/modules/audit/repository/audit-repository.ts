import type { AuditExportRow, ExportAuditInput } from '../domain/types';

type ServerClient = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

/**
 * Reads the audit trail through the RLS-scoped client (never admin) — the caller's audit.read
 * grant plus row-level policy govern visibility (ENGINEERING-02F).
 */
export class AuditRepository {
  constructor(private readonly supabase: ServerClient) {}

  async fetchAuditLogs(input: ExportAuditInput, organizationId: string): Promise<AuditExportRow[]> {
    let query = this.supabase
      .from('audit_logs')
      .select(
        'id, action, actor_id, target_type, target_id, is_sensitive, before, after, reason, created_at',
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (input.fromDate) query = query.gte('created_at', input.fromDate);
    if (input.toDate) query = query.lte('created_at', input.toDate);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data ?? []) as AuditExportRow[];
  }
}
