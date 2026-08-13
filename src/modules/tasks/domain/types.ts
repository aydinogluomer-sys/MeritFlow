// Tasks domain types (ENGINEERING-02B). Enums mirror the DB CHECKs (0019); kept minimal
// for the MVP module extraction. No PostgreSQL invariant is re-implemented here — the DB
// triggers/constraints remain the source of truth.

export type TaskComplexity = 'low' | 'medium' | 'high' | 'critical';
export type TaskImpact = 'low' | 'medium' | 'high' | 'strategic';
export type TaskStatus =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'needs_revision';

/** Validated input for creating a task (mirrors CreateTaskSchema). */
export interface CreateTaskInput {
  title: string;
  teamId: string;
  complexity: TaskComplexity;
  impact: TaskImpact;
  basePoints: number;
  assignedTo?: string;
  dueDate?: string;
}

/** Orchestration context resolved by the server-action layer (authz stays there — AD1). */
export interface TaskContext {
  organizationId: string;
  userId: string;
}

/** Domain error code (string parity with the pre-refactor action output). */
export const NO_PUBLISHED_SCORING_POLICY = 'NO_PUBLISHED_SCORING_POLICY';
