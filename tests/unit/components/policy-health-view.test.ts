import { describe, expect, it } from 'vitest';
import {
  healthStatus,
  isActiveAcceptance,
  activeAcceptanceKeys,
  buildRisks,
  issuesRequiringReview,
} from '@/components/features/policy-health/view';
import type { DimensionScore, PolicyHealthRiskAcceptance } from '@/modules/incentive-health';

// Pure presentation helpers for the Policy Health UI (Module 1-C). Locks in the §3.8 invariant
// (no surfaced risk is silently hidden) + fail-closed expiry.

function dim(dimension: string, score: number, drivers: Array<{ code: string; impact: number }>): DimensionScore {
  return {
    dimension: dimension as never,
    score,
    confidence: 1,
    drivers: drivers.map((d) => ({ code: d.code, label: d.code, impact: d.impact, value: 0 })),
    evidence: [{ sourceType: 'policy_version', sourceId: 'v1' }],
  };
}
function acc(dimension: string, driverCode: string, expiresAt: string | null): PolicyHealthRiskAcceptance {
  return {
    id: `${dimension}-${driverCode}`,
    organizationId: 'o1',
    policyVersionId: 'v1',
    healthEvaluationId: 'e1',
    dimension,
    driverCode,
    reason: 'r',
    acceptedBy: 'u1',
    acceptedAt: '2026-01-01T00:00:00.000Z',
    expiresAt,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const NOW = Date.parse('2026-06-01T00:00:00.000Z');

describe('healthStatus bands', () => {
  it('critical < 50 ≤ warning < 75 ≤ ok', () => {
    expect(healthStatus(49)).toBe('critical');
    expect(healthStatus(50)).toBe('warning');
    expect(healthStatus(74)).toBe('warning');
    expect(healthStatus(75)).toBe('ok');
    expect(healthStatus(100)).toBe('ok');
  });
});

describe('isActiveAcceptance (fail-closed on corrupt expiry)', () => {
  it('null expiry → active; future → active; past → expired', () => {
    expect(isActiveAcceptance({ expiresAt: null }, NOW)).toBe(true);
    expect(isActiveAcceptance({ expiresAt: '2026-12-01T00:00:00.000Z' }, NOW)).toBe(true);
    expect(isActiveAcceptance({ expiresAt: '2026-02-01T00:00:00.000Z' }, NOW)).toBe(false);
  });
  it('unparseable expiry → EXPIRED (fail-closed, never silently suppresses a risk)', () => {
    expect(isActiveAcceptance({ expiresAt: 'not-a-date' }, NOW)).toBe(false);
  });
});

describe('activeAcceptanceKeys', () => {
  it('keys only the currently-active acceptances', () => {
    const keys = activeAcceptanceKeys(
      [acc('complexity', 'COMPLEXITY_DEBT', null), acc('gaming_resistance', 'THRESHOLD_CLIFF', '2026-02-01T00:00:00.000Z')],
      NOW,
    );
    expect(keys.has('complexity::COMPLEXITY_DEBT')).toBe(true); // no expiry → active
    expect(keys.has('gaming_resistance::THRESHOLD_CLIFF')).toBe(false); // expired
  });
});

describe('buildRisks — §3.8: every negative-impact driver is surfaced (never hidden)', () => {
  it('a negative driver in an OTHERWISE-HEALTHY dimension is still a reviewable warning', () => {
    // dimension score 90 (healthy) but a driver contributed −8 → must still surface as a risk.
    const risks = buildRisks([dim('payout_concentration', 90, [{ code: 'GINI_HIGH', impact: -8 }])], new Set());
    expect(risks).toHaveLength(1);
    expect(risks[0]!.severity).toBe('warning'); // NEVER 'ok' — no silent dismiss
    expect(risks[0]!.accepted).toBe(false);
  });

  it('critical band → critical severity; positive-impact drivers are not risks', () => {
    const risks = buildRisks(
      [dim('financial_integrity', 40, [{ code: 'POOL_CONSERVATION_BREACH', impact: -45 }, { code: 'OK_DRIVER', impact: 0 }])],
      new Set(),
    );
    expect(risks).toHaveLength(1); // impact 0 excluded
    expect(risks[0]!.severity).toBe('critical');
  });

  it('an active acceptance marks the matching risk accepted', () => {
    const keys = activeAcceptanceKeys([acc('complexity', 'COMPLEXITY_DEBT', null)], NOW);
    const risks = buildRisks([dim('complexity', 60, [{ code: 'COMPLEXITY_DEBT', impact: -18 }])], keys);
    expect(risks[0]!.accepted).toBe(true);
  });
});

describe('issuesRequiringReview', () => {
  it('counts every unaccepted surfaced risk (accepted ones are excluded)', () => {
    const keys = activeAcceptanceKeys([acc('complexity', 'COMPLEXITY_DEBT', null)], NOW);
    const risks = buildRisks(
      [
        dim('complexity', 60, [{ code: 'COMPLEXITY_DEBT', impact: -18 }]), // accepted
        dim('gaming_resistance', 90, [{ code: 'THRESHOLD_CLIFF', impact: -16 }]), // healthy dim, still a risk
      ],
      keys,
    );
    expect(issuesRequiringReview(risks)).toBe(1); // only the unaccepted one
  });
});
