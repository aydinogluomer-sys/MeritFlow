import type { MetricStatus } from '@/components/intelligence';
import type {
  DimensionScore,
  HealthDimensionKey,
  HealthDriver,
  PolicyHealthRiskAcceptance,
} from '@/modules/incentive-health';

// Pure presentation helpers for the Policy Health UI (Module 1-C). No JSX, no I/O — deterministic
// given their inputs (the caller supplies `nowMs`), so they are unit-testable. The UI renders the
// engine's output; it never computes or alters a score.

export const DIMENSION_LABELS: Record<HealthDimensionKey, string> = {
  financial_integrity: 'Finansal Bütünlük',
  gaming_resistance: 'Oyunlama Direnci',
  payout_concentration: 'Ödeme Yoğunlaşması',
  manager_discretion: 'Yönetici Takdiri',
  dispute_exposure: 'İtiraz Maruziyeti',
  complexity: 'Karmaşıklık',
};

// §3.2 dimensions intentionally NOT evaluated by the engine — shown honestly as "not evaluated",
// never a fake 0. Labels for whatever deferredDimensions the evaluation reports.
export const DEFERRED_DIMENSION_LABELS: Record<string, string> = {
  opportunity_balance: 'Fırsat Dengesi',
  controllability: 'Kontrol Edilebilirlik',
};

export function dimensionLabel(key: string): string {
  return DIMENSION_LABELS[key as HealthDimensionKey] ?? DEFERRED_DIMENSION_LABELS[key] ?? key;
}

/** Health status band (higher = healthier): critical < 50 ≤ warning < 75 ≤ ok. */
export function healthStatus(score: number): MetricStatus {
  if (score < 50) return 'critical';
  if (score < 75) return 'warning';
  return 'ok';
}

/** An acceptance is ACTIVE when it has no expiry or expires strictly after `nowMs`. An UNPARSEABLE
 * expiry is treated as EXPIRED (fail-closed) — a corrupt waiver must surface its risk for review, not
 * silently suppress it forever (§3.8). (Unreachable via the app writer, which stores valid ISO.) */
export function isActiveAcceptance(a: Pick<PolicyHealthRiskAcceptance, 'expiresAt'>, nowMs: number): boolean {
  if (!a.expiresAt) return true;
  const t = Date.parse(a.expiresAt);
  return Number.isNaN(t) ? false : t > nowMs;
}

/** Keys `dimension::driverCode` of the currently-active accepted risks (for suppressing "requires review"). */
export function activeAcceptanceKeys(acceptances: PolicyHealthRiskAcceptance[], nowMs: number): Set<string> {
  const keys = new Set<string>();
  for (const a of acceptances) if (isActiveAcceptance(a, nowMs)) keys.add(`${a.dimension}::${a.driverCode}`);
  return keys;
}

export interface RiskItem {
  dimension: HealthDimensionKey;
  dimensionLabel: string;
  driver: HealthDriver;
  severity: MetricStatus; // 'critical' | 'warning' — a surfaced risk is NEVER 'ok' (§3.8)
  accepted: boolean; // covered by an active acceptance
}

/**
 * Surface risks: EVERY driver with a NEGATIVE impact (it lowered a sub-score) is a reviewable risk —
 * regardless of the parent dimension's aggregate band — so a real risk in an otherwise-healthy
 * dimension is never silently hidden (§3.8: a risk is only removed via an audited Accept-Risk waiver,
 * never by being filtered out of the list). Severity: 'critical' when the dimension is in a critical
 * band (score < 50), else 'warning' (a negative-impact driver is always at least a warning-level review
 * item — never 'ok'). A risk is `accepted` when an active acceptance covers (dimension, code).
 * Deterministic given (dimensions, acceptedKeys).
 */
export function buildRisks(dimensions: DimensionScore[], acceptedKeys: Set<string>): RiskItem[] {
  const risks: RiskItem[] = [];
  for (const d of dimensions) {
    const severity: MetricStatus = d.score < 50 ? 'critical' : 'warning';
    for (const driver of d.drivers) {
      if (driver.impact >= 0) continue; // only negative-impact drivers are risks
      risks.push({
        dimension: d.dimension,
        dimensionLabel: DIMENSION_LABELS[d.dimension] ?? d.dimension,
        driver,
        severity,
        accepted: acceptedKeys.has(`${d.dimension}::${driver.code}`),
      });
    }
  }
  return risks;
}

/** Count of risks still requiring review: every unaccepted surfaced risk (all are ≥ warning). */
export function issuesRequiringReview(risks: RiskItem[]): number {
  return risks.filter((r) => !r.accepted).length;
}
