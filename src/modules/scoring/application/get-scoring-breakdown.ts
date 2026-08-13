import { createClient } from '@/lib/supabase/server';
import { ScoringRepository } from '../repository/scoring-repository';
import type { ScoringBreakdown } from '../domain/types';

/**
 * Read a task's scoring breakdown (explainability). Uses the RLS-scoped user client; the score
 * itself is computed and persisted by the DB trigger (0020) — this only reads it back.
 */
export async function getScoringBreakdown(
  taskId: string,
  ctx: { organizationId: string },
): Promise<ScoringBreakdown | null> {
  const supabase = await createClient();
  const repo = new ScoringRepository(supabase);
  return repo.breakdownForTask(taskId, ctx.organizationId);
}
