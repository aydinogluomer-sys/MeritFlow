import { createClient } from '@/lib/supabase/server';
import { BonusPeriodsRepository } from '../repository/bonus-periods-repository';
import type { BonusPeriodContext, CreatePoolInput } from '../domain/types';

/** Create a bonus pool for a period (starts 'draft' by DB default). RLS user client. */
export async function createPool(
  input: CreatePoolInput,
  ctx: BonusPeriodContext,
): Promise<{ poolId: string }> {
  const supabase = await createClient();
  const repo = new BonusPeriodsRepository(supabase);
  const poolId = await repo.insertPool(input, ctx);
  return { poolId };
}
