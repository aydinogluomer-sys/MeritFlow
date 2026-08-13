import { createClient } from '@/lib/supabase/server';
import { DisputeRepository } from '../repository/dispute-repository';
import type { DisputeContext, OpenDisputeInput } from '../domain/types';

/**
 * Open a dispute against a task. Returns the new dispute id (the action's validatedAction
 * wrapper turns it into { ok: true, data: '<id>' }). status defaults to 'open' in the DB.
 */
export async function openDispute(input: OpenDisputeInput, ctx: DisputeContext): Promise<string> {
  const supabase = await createClient();
  const repo = new DisputeRepository(supabase);
  return repo.open(input, ctx);
}
