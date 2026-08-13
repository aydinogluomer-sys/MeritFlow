export type DisputeType =
  | 'task_points_too_low'
  | 'unfair_rejection'
  | 'quality_score_dispute'
  | 'missing_task_credit'
  | 'bonus_calculation_dispute'
  | 'manager_bias_report'
  | 'anomaly_false_positive'
  | 'system_error'
  | 'clawback_dispute';

export type DisputeResolution = 'accepted' | 'rejected';

export interface OpenDisputeInput {
  taskId: string;
  disputeType: DisputeType;
}

export interface AssignReviewerInput {
  disputeId: string;
  reviewerId: string;
}

export interface ResolveDisputeInput {
  disputeId: string;
  resolution: DisputeResolution;
  decisionNote: string;
  pointsDelta?: number;
  bonusPeriodId?: string;
}

export interface DisputeContext {
  organizationId: string;
  userId: string;
}

export interface ReviewerContext {
  organizationId: string;
}
