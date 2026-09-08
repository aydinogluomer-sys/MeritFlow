import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { FeatureFlagResolver } from '@/modules/intelligence';

// The Policy Debt / Complexity surface is gated behind the P0 'policy_debt' feature flag (tenant-
// scoped rollout, §21). Fail-closed: a disabled/missing flag blocks the evaluation.
export interface PolicyComplexityContext {
  organizationId: string;
  userId: string;
}

export async function assertPolicyDebtEnabled(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<void> {
  const resolver = new FeatureFlagResolver(supabase, organizationId);
  if (!(await resolver.isEnabled('policy_debt'))) {
    throw new Error('policy_debt feature is not enabled for this organization');
  }
}
