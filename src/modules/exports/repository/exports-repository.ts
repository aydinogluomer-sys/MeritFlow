import type { ExportPayoutInput, ExportsContext, MarkPaidInput } from '../domain/types';

type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;

/**
 * Payout export / mark-paid RPC touchpoints (ENGINEERING-02F). Both are SECURITY DEFINER RPCs →
 * injected admin client. The immutable-snapshot requirement (no export without a snapshot) and
 * the double-entry money invariants stay in the DB functions; this only invokes them.
 */
export class ExportsRepository {
  constructor(private readonly admin: AdminClient) {}

  /** Returns the produced export id. */
  async produceExport(input: ExportPayoutInput, ctx: ExportsContext): Promise<string> {
    const { data, error } = await this.admin.rpc('produce_payout_export', {
      p_organization_id: ctx.organizationId,
      p_bonus_period_id: input.periodId,
      p_snapshot_id: input.snapshotId,
      p_format: input.format,
      p_actor: ctx.userId,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** Returns the raw RPC result (unwrapped, to preserve action behavior). */
  async markPaid(input: MarkPaidInput, ctx: ExportsContext): Promise<unknown> {
    const { data, error } = await this.admin.rpc('mark_payout_paid', {
      p_organization_id: ctx.organizationId,
      p_bonus_period_id: input.periodId,
      p_export_id: input.exportId,
      p_actor: ctx.userId,
    });
    if (error) throw new Error(error.message);
    return data;
  }
}
