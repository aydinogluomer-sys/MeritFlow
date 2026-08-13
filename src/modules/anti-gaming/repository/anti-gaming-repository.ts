import { RUN_ANTI_GAMING_SCAN_RPC, type AntiGamingContext, type RunScanInput } from '../domain/types';

type AdminClient = Awaited<ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>>;

/**
 * Wraps the deterministic anti-gaming scan (ENGINEERING-02E). The 5 rules (0023) live in the
 * SECURITY DEFINER RPC — the module only invokes it. NOTE: this RPC takes NO actor/triggered_by
 * argument; it returns the flag count.
 */
export class AntiGamingRepository {
  constructor(private readonly admin: AdminClient) {}

  async runScan(input: RunScanInput, ctx: AntiGamingContext): Promise<number> {
    const { data, error } = await this.admin.rpc(RUN_ANTI_GAMING_SCAN_RPC, {
      p_organization_id: ctx.organizationId,
      p_bonus_period_id: input.periodId ?? null,
    });
    if (error) throw new Error(error.message);
    return data as number;
  }
}
