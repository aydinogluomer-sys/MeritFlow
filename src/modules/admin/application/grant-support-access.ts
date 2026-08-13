import { createClient } from '@/lib/supabase/server';
import { AdminRepository } from '../repository/admin-repository';
import type { GrantContext, GrantSupportAccessInput } from '../domain/types';

/** Grant time-bounded, scoped support access (D4). Returns the new grant id. */
export async function grantSupportAccess(
  input: GrantSupportAccessInput,
  ctx: GrantContext,
): Promise<{ grantId: string }> {
  const supabase = await createClient();
  const repo = new AdminRepository(supabase);
  const grantId = await repo.grantSupportAccess(input, ctx);
  return { grantId };
}
