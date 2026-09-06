// Phase P0 — Feature flag resolver (plan §2.5). Typed isEnabled(flagKey) over the org-scoped
// feature_flags table. FAIL-CLOSED: a missing row (or any read error) resolves to false, so a feature
// is off unless explicitly enabled for the tenant. Reads through whatever client is passed (the
// RLS-scoped user client in the app; org scope is also applied explicitly).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import type { FeatureFlagKey, FeatureFlagStage } from './keys';

type FlagClient = SupabaseClient<Database>;

export interface ResolvedFlag {
  key: FeatureFlagKey;
  enabled: boolean;
  stage: FeatureFlagStage;
}

export class FeatureFlagResolver {
  constructor(
    private readonly supabase: FlagClient,
    private readonly organizationId: string,
  ) {}

  /** True only when a row exists for (org, key) with enabled=true. Missing/error ⇒ false (fail-closed). */
  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    const flag = await this.resolve(key);
    return flag?.enabled ?? false;
  }

  /** The full resolved flag, or null when no row exists for this tenant. */
  async resolve(key: FeatureFlagKey): Promise<ResolvedFlag | null> {
    const { data, error } = await this.supabase
      .from('feature_flags')
      .select('flag_key, enabled, stage')
      .eq('organization_id', this.organizationId)
      .eq('flag_key', key)
      .maybeSingle();

    if (error || !data) return null;
    const row = data as { flag_key: string; enabled: boolean; stage: string };
    return { key, enabled: row.enabled === true, stage: row.stage as FeatureFlagStage };
  }
}
