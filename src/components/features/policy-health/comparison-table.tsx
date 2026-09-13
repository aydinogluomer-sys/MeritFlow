import { DeltaBadge } from '@/components/intelligence';
import type { HealthComparison } from '@/modules/incentive-health';
import { EmptyState } from '@/components/features/shared/empty-state';
import { dimensionLabel } from './view';

// §3.7 comparison-to-previous-policy: overall + per-dimension deltas, TABLE-FIRST (no Recharts).
// Higher health = better, so a positive delta (rendered green by DeltaBadge) is an improvement.
// Server-safe (presentational).
function Cell({ n }: { n: number | null }) {
  return <span className="tabular-nums">{n === null ? '—' : n}</span>;
}

export function ComparisonTable({ comparison }: { comparison: HealthComparison }) {
  if (!comparison.hasPrevious) {
    return (
      <EmptyState message={`Bu ilk değerlendirilen sürüm (v${comparison.currentVersionNo}); karşılaştırılacak önceki sürüm yok.`} />
    );
  }
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">
        v{comparison.currentVersionNo} ile önceki sürüm v{comparison.previousVersionNo} sağlık karşılaştırması
      </caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-medium">Boyut</th>
          <th scope="col" className="py-1 pr-4 font-medium tabular-nums">v{comparison.previousVersionNo}</th>
          <th scope="col" className="py-1 pr-4 font-medium tabular-nums">v{comparison.currentVersionNo}</th>
          <th scope="col" className="py-1 font-medium">Değişim</th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-t font-medium">
          <th scope="row" className="py-2 pr-4 text-left">Genel</th>
          <td className="py-2 pr-4"><Cell n={comparison.overall.previous} /></td>
          <td className="py-2 pr-4"><Cell n={comparison.overall.current} /></td>
          <td className="py-2">
            {comparison.overall.delta === null ? '—' : <DeltaBadge value={comparison.overall.delta} higherIsBetter />}
          </td>
        </tr>
        {comparison.dimensions.map((d) => (
          <tr key={d.dimension} className="border-t">
            <th scope="row" className="py-2 pr-4 font-normal">{dimensionLabel(d.dimension)}</th>
            <td className="py-2 pr-4"><Cell n={d.previous} /></td>
            <td className="py-2 pr-4"><Cell n={d.current} /></td>
            <td className="py-2">
              {d.delta === null ? '—' : <DeltaBadge value={d.delta} higherIsBetter />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
