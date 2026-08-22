import { toDomainError } from '@/lib/errors';
import { systemClock, type Clock } from '@/lib/time';
import type {
  GrantContext,
  GrantSupportAccessInput,
  InviteMemberInput,
  RevokeContext,
  RevokeSupportAccessInput,
} from '../domain/types';

type ServerClient = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

/**
 * RLS-scoped admin operations (ENGINEERING-02F): support-access grant/revoke and member
 * invitation. Always the user (server) client — never admin. The 0005 triggers audit the
 * grant/revoke automatically; create_invitation (0034) is SECURITY DEFINER and validates
 * user.invite + role<>'owner' + active org and writes its own audit row.
 */
export class AdminRepository {
  constructor(
    private readonly supabase: ServerClient,
    // ENGINEERING-24: injectable clock (default = real time) for the revoked_at audit timestamp.
    private readonly clock: Clock = systemClock,
  ) {}

  /** Insert a time-bounded, scoped support-access grant; returns the new grant id. */
  async grantSupportAccess(input: GrantSupportAccessInput, ctx: GrantContext): Promise<string> {
    const { data, error } = await this.supabase
      .from('support_access_grants')
      .insert({
        organization_id: ctx.organizationId,
        grantee_id: input.granteeId,
        scope: input.scope,
        reason: input.reason,
        granted_by: ctx.userId,
        expires_at: input.expiresAt,
        status: 'active',
      })
      .select('id')
      .single();
    if (error) throw toDomainError(error);
    return (data as { id: string }).id;
  }

  /** Revoke an active grant (no-op if already revoked/expired). */
  async revokeSupportAccess(input: RevokeSupportAccessInput, ctx: RevokeContext): Promise<void> {
    const { error } = await this.supabase
      .from('support_access_grants')
      .update({ status: 'revoked', revoked_at: this.clock.now().toISOString() })
      .eq('id', input.grantId)
      .eq('organization_id', ctx.organizationId)
      .eq('status', 'active');
    if (error) throw toDomainError(error);
  }

  /** Mint a pending invitation via the SECURITY DEFINER RPC; returns the join token. */
  async createInvitation(input: InviteMemberInput): Promise<string> {
    const { data, error } = await this.supabase.rpc('create_invitation', {
      p_email: input.email,
      p_role: input.role,
    });
    if (error) throw toDomainError(error);
    return data as string;
  }
}
