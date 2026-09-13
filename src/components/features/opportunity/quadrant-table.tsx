import type { OpportunitySnapshotRecord } from '@/modules/opportunity-intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { buildQuadrants } from './view';

// §4.7 opportunity/performance quadrant — TABLE-FIRST (no Recharts primitive exists). X = opportunity
// index (≥50 high), Y = performance points (≥ visible median high). EVERY row is labelled "İncele"
// (Investigate) — never a verdict (§26). Suppressed (small-cohort) snapshots are listed separately,
// never placed in a quadrant (§17). Performance is approved POINTS only — NO compensation. Server-safe.
export function QuadrantTable({
  snapshots,
  perfByEmployee,
}: {
  snapshots: OpportunitySnapshotRecord[];
  perfByEmployee: Map<string, number>;
}) {
  const { rows, suppressed } = buildQuadrants(snapshots, perfByEmployee);

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <EmptyState message="Bu dönem için gösterilecek (bastırılmamış) fırsat kaydı yok." />
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">Fırsat/performans dörtlü görünümü — her satır bir inceleme çağrısıdır</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1 pr-4 font-medium">Çalışan</th>
              <th scope="col" className="py-1 pr-4 font-medium tabular-nums">Fırsat endeksi</th>
              <th scope="col" className="py-1 pr-4 font-medium tabular-nums">Performans (puan)</th>
              <th scope="col" className="py-1 font-medium">Bölge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId} className="border-t">
                <th scope="row" className="py-2 pr-4 font-normal font-mono text-xs">{r.employeeId}</th>
                <td className="py-2 pr-4 tabular-nums">{r.opportunityIndex} / 100</td>
                <td className="py-2 pr-4 tabular-nums">{Math.round(r.performance * 100) / 100}</td>
                <td className="py-2"><Badge variant="outline">{r.quadrantLabel}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {suppressed.length > 0 ? (
        <div className="rounded-md border border-dashed p-3 text-sm">
          <p className="mb-1 font-medium">Bastırılan kayıtlar (küçük kohort — §17)</p>
          <p className="text-muted-foreground">
            {suppressed.length} çalışan istatistiksel geçerlilik/gizlilik nedeniyle bastırıldı; bir
            fırsat endeksi/bölge gösterilmez.
          </p>
        </div>
      ) : null}
    </div>
  );
}
