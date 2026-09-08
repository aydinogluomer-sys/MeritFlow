// Static-complexity rule engine (Module 4-A, §6.2/§6.3/§6.4). PURE + DETERMINISTIC + VERSIONED.
// Computes a static complexity score from a scoring_policy_version config, decomposed into TRANSPARENT
// per-component drivers — no opaque aggregate (§26/§3.3), no NaN, score ≥ 0. Reproducible: the same
// config + RULE_SET_VERSION always yield the identical score + drivers. READ-ONLY on the config
// (never mutates a policy — §26). No LLM. Runtime complexity / debt total / trend / simplification
// candidates are 4-B and are NOT computed here.
import type {
  ComplexityDriver,
  JsonObject,
  JsonValue,
  ScoringPolicyConfig,
  StaticComplexityResult,
} from './types';

// Bumping ANY weight, threshold, or rule below REQUIRES a new RULE_SET_VERSION so persisted
// evaluations stay reproducible (an evaluation is keyed by (policy_version, rule_set_version)).
export const RULE_SET_VERSION = 'static-v1';

const WEIGHT = { dimension: 2, bucket: 1, cliff: 5, penalty: 3, threshold: 2 } as const;
const CLIFF_RATIO = 2.0; // adjacent buckets whose multiplier ratio ≥ 2× are a "cliff" (§3.7)

function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function numeric(v: JsonValue | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Ascending finite multiplier values of one dimension's bucket table. */
function bucketValues(dimension: JsonValue | undefined): number[] {
  if (!isObject(dimension)) return [];
  return Object.values(dimension)
    .map((v) => numeric(v))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}

interface RuleOutput {
  impact: number;
  value: number;
  threshold?: number;
}

interface ComplexityRule {
  id: string;
  version: string;
  label: string;
  rationale: string;
  evaluate: (config: ScoringPolicyConfig) => RuleOutput;
}

// The versioned rule set (§3.5: each rule carries id/version/rationale/input/output).
const RULES: ComplexityRule[] = [
  {
    id: 'dimension_count',
    version: '1',
    label: 'Boyut sayısı',
    rationale: 'Puanlanan her çarpan boyutu (metrik) akıl yürütülecek ayrı bir eksendir.',
    evaluate: (c) => {
      const value = Object.keys(c.multipliers).filter((k) => isObject(c.multipliers[k])).length;
      return { impact: value * WEIGHT.dimension, value };
    },
  },
  {
    id: 'bucket_count',
    version: '1',
    label: 'Kova sayısı',
    rationale: 'Her çarpan kovası bir koşullu daldır; toplam kova sayısı dallanmayı ölçer.',
    evaluate: (c) => {
      let value = 0;
      for (const dim of Object.values(c.multipliers)) {
        if (isObject(dim)) value += Object.keys(dim).length;
      }
      return { impact: value * WEIGHT.bucket, value };
    },
  },
  {
    id: 'threshold_cliffs',
    version: '1',
    label: 'Eşik uçurumları',
    rationale:
      'Bitişik kovalar arasında büyük çarpan sıçraması (≥2×) veya sıfır-çarpanlı kova, akıl ' +
      'yürütülmesi zor uçurumlardır (§3.7).',
    evaluate: (c) => {
      let cliffs = 0;
      for (const dim of Object.values(c.multipliers)) {
        const vals = bucketValues(dim);
        for (let i = 0; i + 1 < vals.length; i++) {
          const a = vals[i]!;
          const b = vals[i + 1]!;
          if ((a === 0 && b > 0) || (a > 0 && b / a >= CLIFF_RATIO)) cliffs += 1;
        }
      }
      return { impact: cliffs * WEIGHT.cliff, value: cliffs, threshold: CLIFF_RATIO };
    },
  },
  {
    id: 'revision_penalty',
    version: '1',
    label: 'Revizyon cezası',
    rationale: 'Sıfırdan büyük bir revizyon cezası oranı ek bir koşullu hesaplama yolu ekler.',
    evaluate: (c) => {
      const rate = numeric(c.revisionPenaltyRule.rate_per_revision);
      const value = rate !== null && rate > 0 ? 1 : 0;
      return { impact: value * WEIGHT.penalty, value };
    },
  },
  {
    id: 'timeliness_threshold_count',
    version: '1',
    label: 'Özel zamanındalık eşikleri',
    rationale: 'Her özel zamanındalık eşiği, politikaya ek bir yapılandırma girdisi ekler.',
    evaluate: (c) => {
      const value = Object.keys(c.timelinessThresholds).length;
      return { impact: value * WEIGHT.threshold, value };
    },
  },
];

/**
 * Compute the static complexity of a policy config. Deterministic + reproducible + transparent:
 * static_score = Σ component impacts, every point traced to a driver. Never throws on valid config.
 */
export function evaluateStaticComplexity(config: ScoringPolicyConfig): StaticComplexityResult {
  const components: ComplexityDriver[] = RULES.map((r) => {
    const out = r.evaluate(config);
    return { code: r.id, label: r.label, impact: out.impact, value: out.value, threshold: out.threshold };
  });
  const staticScore = components.reduce((sum, c) => sum + c.impact, 0);
  return { ruleSetVersion: RULE_SET_VERSION, staticScore, components };
}

function asObject(v: unknown): JsonObject {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
}

/** Extract the analyzed config from a raw scoring_policy_versions row (ignores all other columns). */
export function configFromVersionRow(row: Record<string, unknown>): ScoringPolicyConfig {
  return {
    multipliers: asObject(row.multipliers),
    revisionPenaltyRule: asObject(row.revision_penalty_rule),
    timelinessThresholds: asObject(row.timeliness_thresholds),
  };
}

/** The immutable rule catalog (id/version/rationale) — exposed for transparency / audit (§3.5). */
export const COMPLEXITY_RULES: ReadonlyArray<{ id: string; version: string; label: string; rationale: string }> =
  RULES.map((r) => ({ id: r.id, version: r.version, label: r.label, rationale: r.rationale }));
