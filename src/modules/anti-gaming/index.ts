// Public API for the `anti-gaming` domain module (ENGINEERING-02A boundary).
// Consumers import only from `@/modules/anti-gaming` — never deep internal paths.
export { runScan } from './application/run-scan';
export { AntiGamingRepository } from './repository/anti-gaming-repository';
export type { RunScanInput, AntiGamingContext } from './domain/types';
