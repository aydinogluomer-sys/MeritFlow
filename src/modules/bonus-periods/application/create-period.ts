import { createClient } from '@/lib/supabase/server';
import { BonusPeriodsRepository } from '../repository/bonus-periods-repository';
import type { BonusPeriodContext, CreatePeriodInput } from '../domain/types';

/** Create a bonus period (starts 'open' by DB default). RLS user client; audit via DB trigger. */
export async function createPeriod(
  input: CreatePeriodInput,
  ctx: BonusPeriodContext,
): Promise<{ periodId: string }> {
  const supabase = await createClient();
  const repo = new BonusPeriodsRepository(supabase);
  const periodId = await repo.insertPeriod(input, ctx);
  return { periodId };
}
