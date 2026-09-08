import { MetricCard } from '@/components/intelligence';
import type { ImpactSummary } from '@/modules/policy-change-impact';

// Presentational §8.5 impact summary (server-safe). Table-first metric cards (Recharts waterfall
// deferred to a later slice). Amounts are minor units (kuruş) → TL. No raw compensation shown.

const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });
const pct = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

export function ImpactSummaryCards({ summary }: { summary: ImpactSummary }) {
  const budgetDeltaPct = Number((summary.budgetDeltaPct * 100).toFixed(2));

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <MetricCard
        label="Etkilenen çalışan"
        value={summary.employeesAffected}
        definition="Primi değişen çalışan sayısı"
      />
      <MetricCard label="Artan" value={summary.higher} definition="Primi yükselen" />
      <MetricCard label="Azalan" value={summary.lower} definition="Primi düşen" />
      <MetricCard label="Değişmeyen" value={summary.unchanged} definition="Primi aynı kalan" />

      <MetricCard
        label="Yeni bütçe (simülasyon)"
        value={money.format(summary.toBudgetMinor / 100)}
        baseline={money.format(summary.fromBudgetMinor / 100)}
        delta={budgetDeltaPct}
        deltaUnit="%"
        deltaHigherIsBetter={false}
        definition="Dağıtılan toplam prim (taslak sürüm)"
        status={summary.lower > 0 ? 'warning' : 'ok'}
        className="col-span-2"
      />
      <MetricCard
        label="Medyan çalışan değişimi"
        value={money.format(summary.medianEmployeeDeltaMinor / 100)}
        definition="Çalışan başına prim değişiminin medyanı"
      />
      <MetricCard
        label="En yüksek düşüş"
        value={money.format(summary.maxNegativeDeltaMinor / 100)}
        definition="Bir çalışanın primindeki en büyük azalış"
        status={summary.maxNegativeDeltaMinor < 0 ? 'warning' : 'ok'}
      />
      <p className="sr-only">
        Bütçe değişimi yüzde {pct.format(budgetDeltaPct)}.
      </p>
    </div>
  );
}
