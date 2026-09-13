import Link from 'next/link';
import { EmptyState } from '@/components/features/shared/empty-state';

// Presentational list of bonus periods with computed opportunity snapshots. Server-safe.
export interface PeriodRow {
  id: string;
  label: string; // e.g. "2026-06-01 → 2026-06-30"
  snapshotCount: number; // snapshots the viewer can see (RLS-scoped)
}

export function PeriodList({ rows, emptyMessage }: { rows: PeriodRow[]; emptyMessage: string }) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Fırsat değerlendirmesi olan bonus dönemleri</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-medium">Dönem</th>
          <th scope="col" className="py-1 font-medium tabular-nums">Görünür kayıt</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <th scope="row" className="py-2 pr-4 font-normal">
              <Link href={`/opportunity/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                {r.label}
              </Link>
            </th>
            <td className="py-2 tabular-nums">{r.snapshotCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
