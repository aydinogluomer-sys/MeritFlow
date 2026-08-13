// Reviews domain types (ENGINEERING-02B). Enums mirror the DB CHECKs (0019 task_reviews).
// The D3 guard (approve + quality=poor) and scoring are enforced by the DB; the app-layer
// D3 pre-check lives in the server action (behavior parity; may move to 03).

export type ReviewDecision = 'approve' | 'needs_revision' | 'reject';
export type ReviewQuality = 'poor' | 'acceptable' | 'good' | 'excellent';
export type ReviewTimeliness = 'early' | 'on_time' | 'late_minor' | 'late_major';

/** Validated input for recording a review (mirrors ReviewTaskSchema). */
export interface ReviewTaskInput {
  taskId: string;
  decision: ReviewDecision;
  quality: ReviewQuality;
  timeliness: ReviewTimeliness;
  reviewerNote?: string | null;
}

/** Orchestration context resolved by the server-action layer (authz stays there — AD1). */
export interface ReviewContext {
  organizationId: string;
  reviewerId: string;
}
