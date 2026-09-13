// Versioned constants for the opportunity engine (§4.3/§4.5). Bumping ANY constant here REQUIRES
// bumping OPPORTUNITY_RULE_SET_VERSION so persisted snapshots (keyed by employee+period+rule_set) stay
// reproducible. All are transparent, documented — there is NO opaque ML anywhere (§4.2/§26).
import type { Complexity, OpportunityComponentCode, OpportunityComponentWeight } from '../types';

export const OPPORTUNITY_RULE_SET_VERSION = 'opportunity-v1';

// Cohort statistical-validity + §17 small-cohort privacy floor: a cohort with FEWER than this many
// members is SUPPRESSED (index null + COHORT_SUPPRESSED) — never a misleading normalized score.
export const MIN_COHORT_SIZE = 5;

// Complexity → weight (transparent; used for complexity_weighted_* signals). Bump ⇒ bump rule set.
export const COMPLEXITY_WEIGHTS: Record<Complexity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 5,
};

// Target opportunity pool (complexity-weighted team work) PER active cohort member for a "full" work
// availability score. Below this, the team pool is thin ⇒ lower work_availability + a possible flag.
export const TARGET_POOL_PER_MEMBER = 20;

// Overall index = published weighted mean of the component sub-scores (re-derivable ⇒ NOT opaque, §26).
export const COMPONENT_WEIGHTS: Record<OpportunityComponentCode, number> = {
  assignment_share: 3,
  complexity_exposure: 2,
  review_throughput: 2,
  work_availability: 2,
  active_period: 1,
};

export const COMPONENT_LABELS: Record<OpportunityComponentCode, string> = {
  assignment_share: 'Atama payı',
  complexity_exposure: 'Karmaşıklık maruziyeti',
  review_throughput: 'İnceleme akışı',
  work_availability: 'İş uygunluğu',
  active_period: 'Aktif dönem',
};

export function componentWeights(): OpportunityComponentWeight[] {
  return (Object.keys(COMPONENT_WEIGHTS) as OpportunityComponentCode[]).map((code) => ({
    code,
    weight: COMPONENT_WEIGHTS[code],
  }));
}
