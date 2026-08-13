import { createClient } from '@/lib/supabase/server';
import { AdminRepository } from '../repository/admin-repository';
import type { InviteMemberInput } from '../domain/types';

/**
 * Mint a pending member invitation (no email in MVP — the returned token builds a
 * /join?token=<uuid> link). The DB RPC enforces user.invite + role<>'owner' + active org.
 */
export async function inviteMember(input: InviteMemberInput): Promise<{ token: string }> {
  const supabase = await createClient();
  const repo = new AdminRepository(supabase);
  const token = await repo.createInvitation(input);
  return { token };
}
