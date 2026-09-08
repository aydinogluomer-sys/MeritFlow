import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';
import { statusBadgeClass } from '@/components/features/shared/status-badge';
import type { ChangeRequestStatus } from '@/modules/policy-change-impact';

// Presentational change-request list (server-safe). One row per request → detail link.
export interface ChangeRequestRow {
  id: string;
  status: ChangeRequestStatus;
  reason: string;
  createdAt: string;
}

export const CHANGE_REQUEST_STATUS_LABEL: Record<ChangeRequestStatus, string> = {
  draft: 'Taslak',
  submitted: 'Onaya sunuldu',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  changes_requested: 'Değişiklik istendi',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR');
}

export function ChangeRequestList({
  rows,
  emptyMessage,
}: {
  rows: ChangeRequestRow[];
  emptyMessage: string;
}) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} />;

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Politika değişiklik talepleri</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-medium">Durum</th>
          <th scope="col" className="py-1 pr-4 font-medium">Gerekçe</th>
          <th scope="col" className="py-1 pr-4 font-medium">Oluşturuldu</th>
          <th scope="col" className="py-1 font-medium">Aksiyon</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="py-2 pr-4">
              <Badge variant="outline" className={statusBadgeClass(r.status)}>
                {CHANGE_REQUEST_STATUS_LABEL[r.status]}
              </Badge>
            </td>
            <th scope="row" className="max-w-md truncate py-2 pr-4 font-normal">
              {r.reason}
            </th>
            <td className="py-2 pr-4 tabular-nums text-muted-foreground">{formatDate(r.createdAt)}</td>
            <td className="py-2">
              <Link
                href={`/policy-impact/${r.id}`}
                className="text-primary underline underline-offset-4"
              >
                İncele
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
