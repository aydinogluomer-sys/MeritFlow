import { toDomainError } from '@/lib/errors';
import { MANUAL_OVERRIDE_RPC, type ManualOverrideInput, type PointLedgerContext } from '../domain/types';

// The admin (service_role) client is INJECTED via the constructor — this module never
// value-imports @/lib/supabase/admin (module boundary / eslint). Its type is taken via a
// type-only import. Used ONLY for the SECURITY DEFINER RPC (append-only ledger write), never
// for raw table access.
type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;

export class PointLedgerRepository {
  constructor(private readonly admin: AdminClient) {}

  /** Apply a manual point adjustment via the SECURITY DEFINER RPC; returns the ledger entry id. */
  async applyManualAdjustment(
    input: ManualOverrideInput,
    ctx: PointLedgerContext,
  ): Promise<string> {
    const { data, error } = await this.admin.rpc(MANUAL_OVERRIDE_RPC, {
      p_organization_id: ctx.organizationId,
      p_employee_id: input.employeeId,
      p_points_delta: input.pointsDelta,
      p_reason: input.reason,
      p_actor: ctx.userId,
      p_second_approver: input.secondApproverId,
      p_task_id: input.taskId ?? null,
    });
    if (error) throw toDomainError(error);
    return data as string;
  }
}
