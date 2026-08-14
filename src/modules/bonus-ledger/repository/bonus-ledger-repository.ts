import { toDomainError } from '@/lib/errors';
import type { BonusLedgerContext, PostAccrualInput } from '../domain/types';

// Admin (service_role) client INJECTED via the constructor — the module never value-imports
// @/lib/supabase/admin; its type is taken via a type-only import. Used ONLY for the SECURITY
// DEFINER accrual RPC (0022); the double-entry balance is enforced by the DB.
type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;

export class BonusLedgerRepository {
  constructor(private readonly admin: AdminClient) {}

  async postAccrual(input: PostAccrualInput, ctx: BonusLedgerContext): Promise<unknown> {
    const { data, error } = await this.admin.rpc('post_bonus_accrual', {
      p_organization_id: ctx.organizationId,
      p_bonus_period_id: input.periodId,
      p_triggered_by: ctx.userId,
    });
    if (error) throw toDomainError(error);
    return data;
  }
}
