import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { FeatureFlagResolver } from '@/modules/intelligence';

// The whole Policy Change Impact surface is gated behind the P0 'policy_change_impact' feature flag
// (tenant-scoped rollout, §21). Fail-closed: a disabled/missing flag blocks the action.
export interface PolicyChangeImpactContext {
  organizationId: string;
  userId: string;
}

export async function assertPolicyChangeImpactEnabled(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<void> {
  const resolver = new FeatureFlagResolver(supabase, organizationId);
  if (!(await resolver.isEnabled('policy_change_impact'))) {
    throw new Error('policy_change_impact feature is not enabled for this organization');
  }
}
