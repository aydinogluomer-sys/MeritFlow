// Public API for the `bonus-calculation` domain module (ENGINEERING-02A boundary / 02D fill).
// Consumers import only from `@/modules/bonus-calculation` — never deep internal paths.
export { runCalculation } from './application/run-calculation';
export { recalculate } from './application/recalculate';
export { BonusCalculationRepository } from './repository/bonus-calculation-repository';
export type {
  RunCalculationInput,
  RecalculateInput,
  BonusCalculationContext,
} from './domain/types';
