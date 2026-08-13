// Public API for the `bonus-periods` domain module (ENGINEERING-02A boundary / 02D fill).
// Consumers import only from `@/modules/bonus-periods` — never deep internal paths.
export { createPeriod } from './application/create-period';
export { createPool } from './application/create-pool';
export { BonusPeriodsRepository } from './repository/bonus-periods-repository';
export type { CreatePeriodInput, CreatePoolInput, BonusPeriodContext } from './domain/types';
