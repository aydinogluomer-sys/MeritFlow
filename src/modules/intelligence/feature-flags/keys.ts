// Phase P0 — Feature flag keys (plan §2.5). The CLOSED set of module rollout flags. The DB column is
// permissive (any non-empty key) so future modules can add keys via a flag row, but the resolver is
// strict: only these typed keys are addressable from code.
import { z } from 'zod';

export const FEATURE_FLAG_KEYS = [
  'health_engine',
  'opportunity_intelligence',
  'cycle_postmortem',
  'policy_debt',
  'credit_recovery',
  'policy_change_impact',
  'digital_twin',
  'intelligence',
  'assist',
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export const FeatureFlagKeySchema = z.enum(FEATURE_FLAG_KEYS);

/** Rollout stages (plan §21). `off` is the default; a flag is effectively on only when enabled=true. */
export const FEATURE_FLAG_STAGES = ['off', 'internal', 'design_partner', 'beta', 'general'] as const;
export type FeatureFlagStage = (typeof FEATURE_FLAG_STAGES)[number];
export const FeatureFlagStageSchema = z.enum(FEATURE_FLAG_STAGES);
