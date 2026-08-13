// Public API for the `reviews` domain module (ENGINEERING-02A boundary / 02B fill).
// Consumers import only from `@/modules/reviews` — never deep internal paths.
export { reviewTask } from './application/review-task';
export { ReviewRepository } from './repository/review-repository';
export type {
  ReviewDecision,
  ReviewQuality,
  ReviewTimeliness,
  ReviewTaskInput,
  ReviewContext,
} from './domain/types';
