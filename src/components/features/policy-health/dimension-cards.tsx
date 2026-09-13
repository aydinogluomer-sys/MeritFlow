import { MetricCard } from '@/components/intelligence';
import type { DimensionScore } from '@/modules/incentive-health';
import type { HealthComparison } from '@/modules/incentive-health';
import { DIMENSION_LABELS, DEFERRED_DIMENSION_LABELS, healthStatus, dimensionLabel } from './view';

// §3.3/§3.4 per-dimension sub-score cards: MetricCard (score /100) + delta vs previous version. A
// low confidence is surfaced as a caption. Deferred dimensions (opportunity_balance, controllability)
// are shown HONESTLY as "not evaluated" — never a fake 0 (§26 no opaque score / no fake data).
// Server-safe (presentational).

const DIMENSION_DEFINITIONS: Record<string, string> = {
  financial_integrity: 'Havuz korunumu + tavan tabanı eksikliği (parasal bütünlük).',
  gaming_resistance: 'Eşik uçurumları (küçük puan farkının ödülü büyük değiştirmesi).',
  payout_concentration: 'İlk %10 payı + Gini + ortalama/medyan sapması.',
  manager_discretion: 'Göreve bağlı manuel override payı.',
  dispute_exposure: 'Sürüme atfedilebilen itiraz oranı + açık itirazlar.',
  complexity: 'Modül 4 statik karmaşıklık skorunun sağlığa normalize hâli.',
};

function deltaFor(comparison: HealthComparison | null, dimension: string): number | null {
  if (!comparison) return null;
  return comparison.dimensions.find((d) => d.dimension === dimension)?.delta ?? null;
}

export function DimensionCards({
  dimensions,
  deferredDimensions,
  comparison,
}: {
  dimensions: DimensionScore[];
  deferredDimensions: string[];
  comparison: HealthComparison | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {dimensions.map((d) => (
        <div key={d.dimension} className="flex flex-col gap-1">
          <MetricCard
            label={DIMENSION_LABELS[d.dimension] ?? d.dimension}
            value={d.score}
            unit="/ 100"
            delta={deltaFor(comparison, d.dimension) ?? undefined}
            deltaHigherIsBetter
            status={healthStatus(d.score)}
            definition={DIMENSION_DEFINITIONS[d.dimension]}
          />
          <p className="px-1 text-xs text-muted-foreground">
            Güven: {Math.round(d.confidence * 100)}%
            {d.confidence === 0 ? ' (bu sürüm için veri yok)' : ''}
          </p>
        </div>
      ))}

      {deferredDimensions.map((key) => (
        <div
          key={key}
          className="flex flex-col justify-center rounded-xl border border-dashed p-4 text-sm"
        >
          <span className="font-medium">{DEFERRED_DIMENSION_LABELS[key] ?? dimensionLabel(key)}</span>
          <span className="text-muted-foreground">Değerlendirilmedi (bu dilimde kapsam dışı).</span>
        </div>
      ))}
    </div>
  );
}
