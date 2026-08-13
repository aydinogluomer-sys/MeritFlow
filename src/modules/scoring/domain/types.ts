// Scoring domain types (ENGINEERING-02C). Read-only explainability of the DB-computed score.
// The scoring FORMULA lives in a DB trigger (0020) and is NEVER re-implemented here — this
// module only reads back the breakdown the trigger persisted in point_ledger.metadata.

export interface ScoringBreakdown {
  taskId: string;
  employeeId: string;
  finalPoints: number;
  complexityMultiplier: number;
  impactMultiplier: number;
  qualityMultiplier: number;
  timelinessFactor: number;
  revisionPenaltyRate: number;
  basePts: number;
  policyVersionId: string;
  metadata: Record<string, unknown>;
}
