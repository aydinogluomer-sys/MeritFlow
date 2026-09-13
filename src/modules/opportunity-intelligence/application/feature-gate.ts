import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { FeatureFlagResolver } from '@/modules/intelligence';

// The Opportunity Intelligence surface is gated behind the P0 'opportunity_intelligence' feature flag
// (tenant-scoped rollout, §2.5/§21). Fail-closed: a disabled/missing flag blocks the computation.
export interface OpportunityContext {
  organizationId: string;
  userId: string;
}

export async function assertOpportunityIntelligenceEnabled(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<void> {
  const resolver = new FeatureFlagResolver(supabase, organizationId);
  if (!(await resolver.isEnabled('opportunity_intelligence'))) {
    throw new Error('opportunity_intelligence feature is not enabled for this organization');
  }
}
