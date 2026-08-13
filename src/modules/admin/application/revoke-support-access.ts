import { createClient } from '@/lib/supabase/server';
import { AdminRepository } from '../repository/admin-repository';
import type { RevokeContext, RevokeSupportAccessInput } from '../domain/types';

/** Revoke an active support-access grant. Scoped to the active org and status='active'. */
export async function revokeSupportAccess(
  input: RevokeSupportAccessInput,
  ctx: RevokeContext,
): Promise<{ grantId: string }> {
  const supabase = await createClient();
  const repo = new AdminRepository(supabase);
  await repo.revokeSupportAccess(input, ctx);
  return { grantId: input.grantId };
}
