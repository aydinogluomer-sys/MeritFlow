import { captureServerError, logError } from '@/lib/logger';
import {
  INVARIANT_SEVERITY,
  type ReconciliationContext,
  type ReconciliationReport,
} from '../domain/types';
import type { ReconciliationRepository } from '../repository/reconciliation-repository';

/**
 * Independent, READ-ONLY financial reconciliation (ENGINEERING-05). Runs all 5 invariant checks
 * and returns a report — it NEVER auto-fixes (no row mutation, no RPC). Critical findings are
 * routed to captureServerError (04); warnings are structured-logged. captureServerError never
 * throws, so a logging failure cannot break the run.
 */
export async function runReconciliation(
  ctx: ReconciliationContext,
  repo: ReconciliationRepository,
): Promise<ReconciliationReport> {
  const ranAt = new Date().toISOString();

  const findings = [
    ...(await repo.checkPoolSum(ctx)),
    ...(await repo.checkLedgerBalance(ctx)),
    ...(await repo.checkMissingSnapshot(ctx)),
    ...(await repo.checkDuplicateAccrual(ctx)),
    ...(await repo.checkBL2Overaccrual(ctx)),
  ];

  for (const f of findings) {
    if (INVARIANT_SEVERITY[f.invariant] === 'critical') {
      void captureServerError(
        new Error(`[RECON] ${f.invariant}: critical financial invariant violated`),
        { code: 'INTERNAL', action: 'run-reconciliation' },
      );
    } else {
      logError(`[RECON] ${f.invariant}: warning finding`, { details: f.details });
    }
  }

  return {
    organizationId: ctx.organizationId,
    ranAt,
    findingCount: findings.length,
    findings,
  };
}
