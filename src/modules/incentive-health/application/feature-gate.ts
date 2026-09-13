import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { FeatureFlagResolver } from '@/modules/intelligence';

// The Incentive Health surface is gated behind the P0 'health_engine' feature flag (tenant-scoped
// rollout, §2.5/§21). Fail-closed: a disabled/missing flag blocks the evaluation.
export interface HealthContext {
  organizationId: string;
  userId: string;
}

export async function assertHealthEngineEnabled(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<void> {
  const resolver = new FeatureFlagResolver(supabase, organizationId);
  if (!(await resolver.isEnabled('health_engine'))) {
    throw new Error('health_engine feature is not enabled for this organization');
  }
}
