import type { DimensionScore, HealthWeight } from '@/modules/incentive-health';
import { DIMENSION_LABELS } from './view';

// §26 NO OPAQUE SCORE — shows the overall is a DOCUMENTED weighted aggregate of the sub-scores:
// overall = round( Σ (weightᵢ · scoreᵢ) / Σ weightᵢ ). Renders each dimension's score, its published
// weight, and its weighted contribution, then the totals — so any reader can re-derive the overall.
// Server-safe (presentational). The weights come from the persisted evaluation (DIMENSION_WEIGHTS).
export function OverallDerivation({
  dimensions,
  weights,
  overallScore,
}: {
  dimensions: DimensionScore[];
  weights: HealthWeight[];
  overallScore: number;
}) {
  const weightOf = (dimension: string) => weights.find((w) => w.dimension === dimension)?.weight ?? 0;
  const rows = dimensions.map((d) => {
    const weight = weightOf(d.dimension);
    return { dimension: d.dimension, score: d.score, weight, contribution: weight * d.score };
  });
  const weightSum = rows.reduce((s, r) => s + r.weight, 0);
  const contributionSum = rows.reduce((s, r) => s + r.contribution, 0);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Genel skor opak bir sayı değildir: alt skorların belgelenmiş ağırlıklı ortalamasıdır —
        <span className="font-mono"> genel = yuvarla( Σ(ağırlık·skor) / Σağırlık )</span>.
      </p>
      <table className="w-full text-sm">
        <caption className="sr-only">Genel sağlık skorunun ağırlıklı türetimi</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 pr-4 font-medium">Boyut</th>
            <th scope="col" className="py-1 pr-4 font-medium tabular-nums">Alt skor</th>
            <th scope="col" className="py-1 pr-4 font-medium tabular-nums">Ağırlık</th>
            <th scope="col" className="py-1 font-medium tabular-nums">Katkı (ağırlık·skor)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.dimension} className="border-t">
              <th scope="row" className="py-2 pr-4 font-normal">{DIMENSION_LABELS[r.dimension] ?? r.dimension}</th>
              <td className="py-2 pr-4 tabular-nums">{r.score}</td>
              <td className="py-2 pr-4 tabular-nums">{r.weight}</td>
              <td className="py-2 tabular-nums">{r.contribution}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <th scope="row" className="py-2 pr-4 text-left">Toplam</th>
            <td className="py-2 pr-4" />
            <td className="py-2 pr-4 tabular-nums">{weightSum}</td>
            <td className="py-2 tabular-nums">{contributionSum}</td>
          </tr>
          <tr className="font-medium">
            <th scope="row" className="py-1 pr-4 text-left" colSpan={3}>
              Genel = yuvarla({contributionSum} / {weightSum})
            </th>
            <td className="py-1 tabular-nums">{overallScore} / 100</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
