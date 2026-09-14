// Phase P4 — Module 8-C3 · DETERMINISTIC insight rule catalog (§10.12/§24). PURE + VERSIONED: each rule
// maps a metric snapshot (value + previous-period delta) to a candidate insight via EXPLICIT thresholds
// with a documented rationale. Deterministic ONLY — NO statistical anomaly / forecast (that is P8) and
// NO LLM (§26). Every candidate carries ≥1 evidence + ≥1 action (the InsightSchema invariant, §23).
// Bumping ANY threshold/rule here REQUIRES bumping INSIGHT_RULE_SET_VERSION so emitted facts stay
// reproducible. All rules are ORG-LEVEL aggregate signals (no per-employee surveillance, CLAUDE.md).
import type { MetricId } from '../metrics/metric-id';
import type { InsightSeverity } from './insight';
import type { EvidenceRef, SuggestedAction } from './evidence';

/** The insight rule-set tag (reproducibility). Bump on ANY threshold/rule change. */
export const INSIGHT_RULE_SET_VERSION = 'insight-v1' as const;

/** One metric's org-level reading for the anchored period: value + previous-period delta (+ previous). */
export interface MetricReading {
  value: number;
  delta: number | null;
  previous: number | null;
}
/** The metric inputs a rule reads (a subset of the metric SSOT), keyed by MetricId. */
export type MetricSnapshot = Partial<Record<MetricId, MetricReading>>;

/** A rule's output — the engine attaches organization_id + bonus_period_id and emits it idempotently. */
export interface CandidateInsight {
  insightType: string;
  subjectType: string;
  subjectId: string | null;
  severity: InsightSeverity;
  headline: string;
  deterministicFacts: Record<string, unknown>;
  evidence: EvidenceRef[];
  suggestedActions: SuggestedAction[];
}

interface FiredDetail {
  severity: InsightSeverity;
  headline: string;
  facts: Record<string, unknown>;
}

interface RuleDef {
  /** Stable insight_type + rule code (greppable; the dedup identity uses it). */
  code: string;
  metric: MetricId;
  rationale: string;
  actions: SuggestedAction[];
  /** PURE: returns the fired detail or null (does not fire). */
  evaluate: (r: MetricReading) => FiredDetail | null;
}

/** Deterministic TR number formatting (fixed locale → reproducible headlines). */
function fmt(n: number): string {
  return n.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
}

// ── The §10.12 deterministic rules (threshold / delta). "unusual anomaly" is EXCLUDED (statistical = P8).
const RULES: readonly RuleDef[] = [
  // Threshold breach on the budget — accrual exceeding the pool is a budget risk.
  {
    code: 'budget_risk',
    metric: 'budget_variance',
    rationale: 'Tahakkukun havuzu belirgin aşması bütçe riskidir (≥%10 uyarı, ≥%20 kritik).',
    actions: [
      { code: 'inspect_budget', label: 'Bütçe sapmasını incele', route: 'inspect' },
      { code: 'review_pool', label: 'Havuz/politikayı gözden geçir', route: 'policy_review' },
    ],
    evaluate: (r) => {
      if (r.value < 10) return null;
      return {
        severity: r.value >= 20 ? 'critical' : 'warning',
        headline: `Bütçe riski: tahakkuk havuzu %${fmt(r.value)} aştı.`,
        facts: { metric: 'budget_variance', value: r.value, warnThreshold: 10, criticalThreshold: 20 },
      };
    },
  },
  // Significant NEGATIVE delta on cycle completion — a cycle slowdown vs the previous period.
  {
    code: 'cycle_slowdown',
    metric: 'cycle_completion_rate',
    rationale: 'Tamamlama oranının önceki döneme göre belirgin düşüşü döngü yavaşlamasıdır (≤ −15 puan uyarı, ≤ −30 kritik).',
    actions: [{ code: 'inspect_cycle', label: 'Döngü sağlığını incele', route: 'work_queue' }],
    evaluate: (r) => {
      if (r.delta === null || r.delta > -15) return null;
      return {
        severity: r.delta <= -30 ? 'critical' : 'warning',
        headline: `Döngü yavaşlaması: tamamlama oranı ${fmt(Math.abs(r.delta))} puan düştü.`,
        facts: { metric: 'cycle_completion_rate', current: r.value, previous: r.previous, delta: r.delta, warnThreshold: -15, criticalThreshold: -30 },
      };
    },
  },
  // Threshold — dispute concentration (high dispute rate for the period).
  {
    code: 'dispute_concentration',
    metric: 'dispute_rate',
    rationale: 'Yüksek itiraz oranı itiraz yoğunluğudur (≥%20 uyarı, ≥%40 kritik).',
    actions: [{ code: 'inspect_disputes', label: 'İtirazları incele', route: 'dispute_list' }],
    evaluate: (r) => {
      if (r.value < 20) return null;
      return {
        severity: r.value >= 40 ? 'critical' : 'warning',
        headline: `İtiraz yoğunluğu: itiraz oranı %${fmt(r.value)}.`,
        facts: { metric: 'dispute_rate', value: r.value, warnThreshold: 20, criticalThreshold: 40 },
      };
    },
  },
  // Concentration change — payouts concentrated in few employees (HHI, 0–1).
  {
    code: 'concentration_change',
    metric: 'payout_concentration',
    rationale: 'Yüksek HHI ödemelerin az kişide yoğunlaştığını gösterir (≥0.5 uyarı, ≥0.7 kritik).',
    actions: [
      { code: 'inspect_concentration', label: 'Ödeme dağılımını incele', route: 'inspect' },
      { code: 'review_policy_concentration', label: 'Politikayı gözden geçir', route: 'policy_review' },
    ],
    evaluate: (r) => {
      if (r.value < 0.5) return null;
      return {
        severity: r.value >= 0.7 ? 'critical' : 'warning',
        headline: `Ödeme yoğunlaşması: HHI ${fmt(r.value)} (ödemeler az kişide).`,
        facts: { metric: 'payout_concentration', value: r.value, warnThreshold: 0.5, criticalThreshold: 0.7 },
      };
    },
  },
  // Significant POSITIVE delta — manual intervention (override) jumped vs the previous period.
  {
    code: 'significant_delta',
    metric: 'manual_override_rate',
    rationale: 'Manuel müdahale oranının önceki döneme göre belirgin artışı yönetişim sinyalidir (≥ +15 puan uyarı, ≥ +30 kritik).',
    actions: [{ code: 'inspect_override', label: 'Manuel müdahaleleri incele', route: 'exception_center' }],
    evaluate: (r) => {
      if (r.delta === null || r.delta < 15) return null;
      return {
        severity: r.delta >= 30 ? 'critical' : 'warning',
        headline: `Belirgin değişim: manuel müdahale oranı ${fmt(r.delta)} puan arttı.`,
        facts: { metric: 'manual_override_rate', current: r.value, previous: r.previous, delta: r.delta, warnThreshold: 15, criticalThreshold: 30 },
      };
    },
  },
  // Generic threshold breach — gaming-flag rate over the acceptable ceiling.
  {
    code: 'threshold_breach',
    metric: 'gaming_flag_rate',
    rationale: 'Yüksek oyunlaştırma bayrak oranı eşik aşımıdır (≥%15 uyarı, ≥%30 kritik).',
    actions: [{ code: 'inspect_gaming', label: 'Bayrakları İstisna Merkezi’nde incele', route: 'exception_center' }],
    evaluate: (r) => {
      if (r.value < 15) return null;
      return {
        severity: r.value >= 30 ? 'critical' : 'warning',
        headline: `Eşik aşımı: oyunlaştırma bayrak oranı %${fmt(r.value)}.`,
        facts: { metric: 'gaming_flag_rate', value: r.value, warnThreshold: 15, criticalThreshold: 30 },
      };
    },
  },
];

/** The metric ids the engine must fetch to run the full catalog (SSOT for the engine's read). */
export const RULE_METRICS: readonly MetricId[] = Array.from(new Set(RULES.map((r) => r.metric)));

/**
 * Run the deterministic catalog over a metric snapshot → the fired candidate insights (PURE). A metric
 * absent from the snapshot (unavailable read) simply does not fire its rule — never a fabricated value.
 * Every candidate carries ≥1 evidence + ≥1 action + the rule-set version stamp (reproducible facts).
 */
export function runRules(snapshot: MetricSnapshot): CandidateInsight[] {
  const out: CandidateInsight[] = [];
  for (const rule of RULES) {
    const reading = snapshot[rule.metric];
    if (!reading) continue;
    const fired = rule.evaluate(reading);
    if (!fired) continue;
    out.push({
      insightType: rule.code,
      subjectType: 'organization',
      subjectId: null,
      severity: fired.severity,
      headline: fired.headline,
      deterministicFacts: { ...fired.facts, rule: rule.code, ruleSetVersion: INSIGHT_RULE_SET_VERSION, rationale: rule.rationale },
      evidence: [{ sourceType: 'metric', sourceId: rule.metric }],
      suggestedActions: rule.actions,
    });
  }
  return out;
}
