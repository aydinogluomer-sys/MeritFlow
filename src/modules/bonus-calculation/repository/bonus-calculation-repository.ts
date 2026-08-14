import { toDomainError } from '@/lib/errors';
import type { BonusCalculationContext, RecalculateInput, RunCalculationInput } from '../domain/types';

// Admin (service_role) client INJECTED via the constructor — the module never value-imports
// @/lib/supabase/admin; its type is taken via a type-only import. Used ONLY for the SECURITY
// DEFINER calculation RPCs (0021/0026). The RPC param is `p_bonus_pool_id` (NOT p_pool_id).
type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;

export class BonusCalculationRepository {
  constructor(private readonly admin: AdminClient) {}

  async runCalculation(
    input: RunCalculationInput,
    ctx: BonusCalculationContext,
  ): Promise<string> {
    const { data, error } = await this.admin.rpc('run_bonus_calculation', {
      p_organization_id: ctx.organizationId,
      p_bonus_period_id: input.periodId,
      p_bonus_pool_id: input.poolId,
      p_idempotency_key: input.idempotencyKey,
      p_triggered_by: ctx.userId,
    });
    if (error) throw toDomainError(error);
    return data as string;
  }

  async recalculate(
    input: RecalculateInput,
    ctx: BonusCalculationContext,
  ): Promise<unknown> {
    const { data, error } = await this.admin.rpc('recalculate_bonus_after_dispute', {
      p_organization_id: ctx.organizationId,
      p_bonus_period_id: input.periodId,
      p_triggered_by: ctx.userId,
    });
    if (error) throw toDomainError(error);
    return data;
  }
}
