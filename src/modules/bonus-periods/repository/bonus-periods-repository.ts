import { toDomainError } from '@/lib/errors';
import type { BonusPeriodContext, CreatePeriodInput, CreatePoolInput } from '../domain/types';

// RLS user client (never admin) — bonus_periods_insert/bonus_pools_insert enforce org +
// period.manage / pool.create server-side; the AFTER-INSERT audit triggers (0011) write audit.
// status/version_no default in the DB. Client type taken from createClient via a type-only import.
type ServerClient = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

export class BonusPeriodsRepository {
  constructor(private readonly supabase: ServerClient) {}

  async insertPeriod(input: CreatePeriodInput, ctx: BonusPeriodContext): Promise<string> {
    const { data, error } = await this.supabase
      .from('bonus_periods')
      .insert({
        organization_id: ctx.organizationId,
        period_type: input.periodType,
        starts_on: input.startsOn,
        ends_on: input.endsOn,
        created_by: ctx.userId,
      })
      .select('id')
      .single();
    if (error) throw toDomainError(error);
    return (data as { id: string }).id;
  }

  async insertPool(input: CreatePoolInput, ctx: BonusPeriodContext): Promise<string> {
    const { data, error } = await this.supabase
      .from('bonus_pools')
      .insert({
        organization_id: ctx.organizationId,
        bonus_period_id: input.bonusPeriodId,
        amount_minor: input.amountMinor,
        currency: input.currency,
        created_by: ctx.userId,
      })
      .select('id')
      .single();
    if (error) throw toDomainError(error);
    return (data as { id: string }).id;
  }
}
