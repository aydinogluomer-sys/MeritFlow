// Runtime-complexity rule engine (Module 4-B, §6.5). PURE + DETERMINISTIC + VERSIONED — mirrors the
// 4-A static engine. Given the frozen RuntimeSignals of a policy version, produces a runtime_score
// decomposed into TRANSPARENT per-component drivers (override usage, recalculation, dispute
// adjustment). No opaque aggregate, no NaN, score ≥ 0. Reproducible: same signals + RUNTIME_RULE_SET
// → identical score + drivers. READ-ONLY analysis — never mutates a policy (§26). No LLM.
import type { ComplexityDriver, RuntimeComplexityResult, RuntimeSignals } from './types';

// The runtime rule-set tag. It composes with the static tag into the full debt rule_set_version
// ('full-v1'); bumping any weight/rule below requires bumping FULL_RULE_SET_VERSION so persisted
// evaluations stay reproducible.
export const RUNTIME_RULE_SET_VERSION = 'runtime-v1';

const WEIGHT = { override: 3, recalculation: 4 } as const;

interface RuntimeRule {
  id: string;
  version: string;
  label: string;
  rationale: string;
  evaluate: (s: RuntimeSignals) => { impact: number; value: number };
}

const RULES: RuntimeRule[] = [
  {
    id: 'override_usage',
    version: '1',
    label: 'Manuel override kullanımı',
    rationale: 'Sürümün görevlerinde biriken manuel puan düzeltmeleri sürekli bakım yükünü ölçer.',
    evaluate: (s) => ({ impact: s.overrideCount * WEIGHT.override, value: s.overrideCount }),
  },
  {
    id: 'recalculation',
    version: '1',
    label: 'Yeniden hesaplama',
    rationale: 'Supersede edilen prim hesaplama koşuları (itiraz vb.) politikanın oynaklığını gösterir.',
    evaluate: (s) => ({ impact: s.recalculationCount * WEIGHT.recalculation, value: s.recalculationCount }),
  },
];

/**
 * Compute runtime complexity from frozen operational signals. Deterministic + transparent:
 * runtime_score = Σ component impacts. Never throws on valid (finite, non-negative) signals.
 */
export function evaluateRuntimeComplexity(signals: RuntimeSignals): RuntimeComplexityResult {
  const components: ComplexityDriver[] = RULES.map((r) => {
    const out = r.evaluate(signals);
    return { code: r.id, label: r.label, impact: out.impact, value: out.value };
  });
  // Context driver (scored-work volume) — value only, no score contribution.
  components.push({
    code: 'scored_volume',
    label: 'Puanlanan iş hacmi',
    impact: 0,
    value: signals.taskApprovedCount,
  });
  const runtimeScore = components.reduce((sum, c) => sum + c.impact, 0);
  return { ruleSetVersion: RUNTIME_RULE_SET_VERSION, runtimeScore, components };
}

/** The immutable runtime rule catalog (id/version/rationale) — exposed for transparency (§3.5). */
export const RUNTIME_RULES: ReadonlyArray<{ id: string; version: string; label: string; rationale: string }> =
  RULES.map((r) => ({ id: r.id, version: r.version, label: r.label, rationale: r.rationale }));
