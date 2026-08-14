import { toDomainError } from '@/lib/errors';

type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;

const RAW_ACCESS_REASON = 'audit CSV export — raw sensitive payload included';

/**
 * AD3 comp-access audit (ENGINEERING-02F). SECURITY DEFINER RPC → injected admin client. Called
 * ONLY when raw sensitive payloads were actually exported (fail-closed; decided by the caller).
 */
export class CompAccessRepository {
  constructor(private readonly admin: AdminClient) {}

  async logRawAccess(organizationId: string, actorProfileId: string): Promise<void> {
    const { error } = await this.admin.rpc('log_comp_access', {
      p_organization_id: organizationId,
      p_actor_id: actorProfileId,
      p_reason: RAW_ACCESS_REASON,
    });
    if (error) throw toDomainError(error);
  }
}
