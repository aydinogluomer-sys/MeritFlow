import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  captureServerError: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn(),
}));

import { runReconciliation, type ReconciliationRepository, type ReconciliationFinding } from '@/modules/reconciliation';
import { captureServerError, logError } from '@/lib/logger';

const captureMock = vi.mocked(captureServerError);
const logErrorMock = vi.mocked(logError);

beforeEach(() => vi.clearAllMocks());

const ctx = { organizationId: 'o1', userId: 'u1' };

type Method =
  | 'checkPoolSum'
  | 'checkLedgerBalance'
  | 'checkMissingSnapshot'
  | 'checkDuplicateAccrual'
  | 'checkBL2Overaccrual';

function finding(
  invariant: ReconciliationFinding['invariant'],
  severity: ReconciliationFinding['severity'] = 'critical',
): ReconciliationFinding {
  return { invariant, severity, details: {} };
}

function repoWith(overrides: Partial<Record<Method, ReconciliationFinding[]>> = {}): ReconciliationRepository {
  return {
    checkPoolSum: vi.fn().mockResolvedValue(overrides.checkPoolSum ?? []),
    checkLedgerBalance: vi.fn().mockResolvedValue(overrides.checkLedgerBalance ?? []),
    checkMissingSnapshot: vi.fn().mockResolvedValue(overrides.checkMissingSnapshot ?? []),
    checkDuplicateAccrual: vi.fn().mockResolvedValue(overrides.checkDuplicateAccrual ?? []),
    checkBL2Overaccrual: vi.fn().mockResolvedValue(overrides.checkBL2Overaccrual ?? []),
  } as unknown as ReconciliationRepository;
}

describe('reconciliation module — runReconciliation', () => {
  it('clean slate: no findings, no capture, no warning log', async () => {
    const report = await runReconciliation(ctx, repoWith());

    expect(report.findingCount).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.organizationId).toBe('o1');
    expect(report.ranAt).toEqual(expect.any(String));
    expect(captureMock).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('INV-SI13 (critical) routes to captureServerError once', async () => {
    const report = await runReconciliation(ctx, repoWith({ checkPoolSum: [finding('INV-SI13-POOL-SUM')] }));

    expect(report.findingCount).toBe(1);
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('INV-LEDGER-BALANCE (critical) routes to captureServerError', async () => {
    await runReconciliation(ctx, repoWith({ checkLedgerBalance: [finding('INV-LEDGER-BALANCE')] }));
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it('INV-MISSING-SNAPSHOT (warning) logs, never captures', async () => {
    await runReconciliation(ctx, repoWith({ checkMissingSnapshot: [finding('INV-MISSING-SNAPSHOT', 'warning')] }));
    expect(captureMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it('INV-DUPLICATE-ACCRUAL (critical) routes to captureServerError', async () => {
    await runReconciliation(ctx, repoWith({ checkDuplicateAccrual: [finding('INV-DUPLICATE-ACCRUAL')] }));
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it('INV-BL2-OVERACCRUAL (critical) routes to captureServerError', async () => {
    await runReconciliation(ctx, repoWith({ checkBL2Overaccrual: [finding('INV-BL2-OVERACCRUAL')] }));
    expect(captureMock).toHaveBeenCalledTimes(1);
  });

  it('mixed: 2 critical + 1 warning → findingCount 3, capture 2×, log 1×', async () => {
    const report = await runReconciliation(
      ctx,
      repoWith({
        checkPoolSum: [finding('INV-SI13-POOL-SUM')],
        checkDuplicateAccrual: [finding('INV-DUPLICATE-ACCRUAL')],
        checkMissingSnapshot: [finding('INV-MISSING-SNAPSHOT', 'warning')],
      }),
    );

    expect(report.findingCount).toBe(3);
    expect(captureMock).toHaveBeenCalledTimes(2);
    expect(logErrorMock).toHaveBeenCalledTimes(1);
  });

  it('severity routing uses the INVARIANT_SEVERITY map, not the finding.severity field', async () => {
    // A critical invariant mislabeled 'warning' on the finding is STILL captured.
    await runReconciliation(ctx, repoWith({ checkPoolSum: [finding('INV-SI13-POOL-SUM', 'warning')] }));
    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});
