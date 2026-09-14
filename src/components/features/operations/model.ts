// Phase P4 (8-C1) — Operations Intelligence view-model (§10.8). PURE + deterministic (no IO, no server
// imports — type-only), unit-testable against a mocked executeSemanticQuery outcome + a mocked
// IntelligenceRepository.list result. Reuses the executive readers (readOrgMetric/formatMetric/changesFrom/
// attentionInsights/criticalExceptionCount). Operations metrics are AGGREGATE process signals — this
// module never derives a per-employee view, and never fabricates a number (§23).
import type { StoredInsight } from '@/modules/intelligence';
import type { DistributionBin } from '@/components/intelligence';
import { attentionInsights } from '@/components/features/executive/model';

export {
  readOrgMetric,
  formatMetric,
  changesFrom,
  attentionInsights,
  criticalExceptionCount,
  type MetricReading,
} from '@/components/features/executive/model';

/**
 * Breakdown of the OPEN, attention-worthy insights (non-terminal, warning/critical — the exact
 * `attentionInsights` filter) grouped by insight type, highest count first. Feeds the §10.16 exception
 * distribution chart. Empty when there is nothing requiring attention → the caller renders an honest
 * EmptyState, never a fabricated bar (§23).
 */
export function insightBreakdown(insights: StoredInsight[]): DistributionBin[] {
  const byType = new Map<string, number>();
  for (const i of attentionInsights(insights)) {
    byType.set(i.type, (byType.get(i.type) ?? 0) + 1);
  }
  return Array.from(byType.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * The §10.8 Operations cards that have NO registered metric / SI-12-safe source — rendered as an honest
 * "not yet available" state, NEVER a fabricated number (§23). Admin Effort Saved specifically: §10.8
 * forbids a false hours-saved claim unless a methodology is defined, and there is no automated-action
 * source in scope, so it is deferred rather than invented.
 */
export interface DeferredCard {
  label: string;
  reason: string;
}
export const DEFERRED_OPS_CARDS: DeferredCard[] = [
  { label: 'İnceleme Gecikmesi', reason: 'Ortalama inceleme süresi — kayıtlı bir metrik yok (yeni metrik gerekir, kapsam dışı).' },
  { label: 'Hatırlatma Sayısı', reason: 'Gönderilen hatırlatma sayısı — kayıtlı bir metrik/kaynak yok.' },
  { label: 'Geciken İşler', reason: 'Vadesi geçen görev sayısı — kayıtlı bir metrik yok.' },
  { label: 'Yeniden Hesaplama', reason: 'Bonus yeniden hesaplama sayısı — kayıtlı bir metrik yok.' },
  { label: 'Yönetim Eforu Tasarrufu', reason: '§10.8: metodoloji tanımlanmadan "kazanılan saat" iddiası yok; otomatik-aksiyon kaynağı olmadığından ertelendi (uydurma sayı yok).' },
];
