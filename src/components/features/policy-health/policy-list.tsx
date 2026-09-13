import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';

// Presentational list of scoring policies + their latest overall health score (§3.7). Server-safe.
export interface PolicyRow {
  id: string;
  name: string;
  status: string;
  latestOverall: number | null; // null → not evaluated yet
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Taslak',
  active: 'Aktif',
  archived: 'Arşiv',
};

export function PolicyList({ rows, emptyMessage }: { rows: PolicyRow[]; emptyMessage: string }) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Puanlama politikaları ve en son sağlık skoru</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-medium">Politika</th>
          <th scope="col" className="py-1 pr-4 font-medium">Durum</th>
          <th scope="col" className="py-1 font-medium">Sağlık</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <th scope="row" className="py-2 pr-4 font-normal">
              <Link href={`/policy-health/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                {r.name}
              </Link>
            </th>
            <td className="py-2 pr-4"><Badge variant="outline">{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
            <td className="py-2 tabular-nums">
              {r.latestOverall === null ? (
                <span className="text-muted-foreground">değerlendirilmedi</span>
              ) : (
                <span>{r.latestOverall} / 100</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
