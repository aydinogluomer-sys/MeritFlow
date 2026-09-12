import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';

// Presentational scoring-policy list for the Policy Debt surface (server-safe). One row per policy →
// debt detail link, with the latest evaluated total (or "—" when never evaluated).
export interface PolicyRow {
  id: string;
  name: string;
  status: string;
  latestTotal: number | null;
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
      <caption className="sr-only">Puanlama politikaları ve borç skorları</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-medium">Politika</th>
          <th scope="col" className="py-1 pr-4 font-medium">Durum</th>
          <th scope="col" className="py-1 pr-4 font-medium">Son borç skoru</th>
          <th scope="col" className="py-1 font-medium">Aksiyon</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <th scope="row" className="max-w-md truncate py-2 pr-4 font-normal">{r.name}</th>
            <td className="py-2 pr-4">
              <Badge variant="outline">{STATUS_LABEL[r.status] ?? r.status}</Badge>
            </td>
            <td className="py-2 pr-4 tabular-nums">
              {r.latestTotal !== null ? r.latestTotal.toLocaleString('tr-TR') : '—'}
            </td>
            <td className="py-2">
              <Link href={`/policy-debt/${r.id}`} className="text-primary underline underline-offset-4">
                İncele
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
