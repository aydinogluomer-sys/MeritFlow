// Opportunity-to-Perform Intelligence (Module 2-A) — domain types. The engine is PURE + DETERMINISTIC
// + VERSIONED and COHORT-relative: it maps frozen WORK-CONTEXT signals for a cohort (same primary_role
// + same PRIMARY team [team_memberships.is_primary, AD9] + same bonus_period) to a decomposed,
// transparent opportunity_index per employee — NEVER an opaque ML score (§4.2/§26). It reads ONLY
// work-context signals; NO protected characteristic and NO compensation is ever read (§4.2). Output is
// ADVISORY (drives no pay/ledger/policy change); flags say "Investigate", never a verdict. A cohort
// below MIN_COHORT_SIZE is SUPPRESSED (statistical validity + §17 small-cohort privacy) — never a
// misleading score, never a raw-count comparison.

export type Complexity = 'low' | 'medium' | 'high' | 'critical';

/** Frozen per-employee raw work signals for one (employee, bonus_period). Repository-produced. */
export interface MemberSignals {
  employeeId: string;
  primaryRole: string;
  primaryTeamId: string | null; // AD9 primary team; null ⇒ cannot be cohorted ⇒ suppressed
  activeDays: number; // bonus_pool_eligibility.days_active (D10); 0 ⇒ no active window ⇒ suppressed
  periodDays: number; // calendar length of the bonus period (for active-period coverage)
  eligibleWorkCount: number; // the employee's PRIMARY-team task pool in the period (opportunity pool)
  assignedWorkCount: number; // tasks assigned_to the employee in the period
  completedWorkCount: number; // the employee's approved/rejected tasks in the period
  complexityWeightedAvailable: number; // team pool, complexity-weighted
  complexityWeightedAssigned: number; // employee's assigned work, complexity-weighted
  reviewLatencyP50Days: number | null; // median days submitted→first review for the employee's tasks
}

/** A transparent driver behind a component sub-score: the employee's value vs the cohort reference. */
export interface OpportunityDriver {
  code: string;
  label: string;
  value: number; // the employee's measured (per-active-day / coverage) value
  cohortValue: number; // the cohort reference (median / target)
  ratio: number; // value ÷ cohortValue (1.0 = at the cohort norm); 0 when cohortValue is 0
}

export type OpportunityComponentCode =
  | 'work_availability'
  | 'assignment_share'
  | 'complexity_exposure'
  | 'review_throughput'
  | 'active_period';

export interface OpportunityComponent {
  code: OpportunityComponentCode;
  label: string;
  score: number; // 0..100 cohort-normalized sub-score (higher = more opportunity)
  drivers: OpportunityDriver[];
}

export type OpportunityFlag =
  | 'LOW_ASSIGNMENT_OPPORTUNITY'
  | 'HIGH_COMPLEXITY_IMBALANCE'
  | 'REVIEW_BOTTLENECK'
  | 'LOW_ELIGIBLE_WORK_AVAILABILITY'
  | 'PERFORMANCE_OPPORTUNITY_MISMATCH'
  | 'COHORT_SUPPRESSED';

export interface OpportunityComponentWeight {
  code: OpportunityComponentCode;
  weight: number;
}

/** The per-employee result. opportunityIndex is null when the cohort is suppressed (too small / no
 * active window) — a decomposed transparent aggregate of the component sub-scores otherwise. */
export interface OpportunityResult {
  employeeId: string;
  cohortKey: string; // `${primaryRole}::${primaryTeamId}` (period is fixed for the batch)
  cohortSize: number;
  suppressed: boolean;
  suppressionReason: string | null; // e.g. 'cohort_below_min_sample' | 'no_active_period' | 'no_primary_team'
  opportunityIndex: number | null; // 0..100; null when suppressed
  components: OpportunityComponent[];
  weights: OpportunityComponentWeight[]; // published weights (so the index is re-derivable — no opaque score)
  flags: OpportunityFlag[];
  // Raw signals echoed for the snapshot columns.
  signals: MemberSignals;
}
