import type { AntiGamingRepository } from '../repository/anti-gaming-repository';
import type { AntiGamingContext, RunScanInput } from '../domain/types';

/**
 * Run the deterministic anti-gaming scan and return the flag count. The admin-backed repo is
 * injected by the action (admin client is never value-imported into module files).
 */
export async function runScan(
  input: RunScanInput,
  ctx: AntiGamingContext,
  repo: AntiGamingRepository,
): Promise<{ flagCount: number }> {
  const flagCount = await repo.runScan(input, ctx);
  return { flagCount };
}
