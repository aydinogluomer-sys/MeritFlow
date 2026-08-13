// Public API for the `scoring` domain module (ENGINEERING-02A boundary / 02C fill).
// Consumers import only from `@/modules/scoring` — never deep internal paths.
export { getScoringBreakdown } from './application/get-scoring-breakdown';
export { ScoringRepository } from './repository/scoring-repository';
export type { ScoringBreakdown } from './domain/types';
