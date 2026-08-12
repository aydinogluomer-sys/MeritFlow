import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/features/shared/empty-state';
import { statusBadgeClass } from '@/components/features/shared/status-badge';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const STATUS_LABELS: Record<string, string> = {
  requested: 'Talep edildi',
  generated: 'Üretildi',
  downloaded: 'İndirildi',
  failed: 'Başarısız',
};

/** Subset of `exports` columns used by the list view (RLS-scoped: Finance/Auditor). */
export type ExportListRow = {
  id: string;
  format: string;
  status: string;
  row_count: number | null;
  created_at: string;
};

export interface ExportListProps {
  exports: ExportListRow[];
}

/**
 * Plain Tailwind table of payout export records (append-only financial trail). Each
 * row links to its detail (payout summary via v_finance_payout). Read-only.
 */
export function ExportList({ exports }: ExportListProps) {
  if (exports.length === 0) {
    return <EmptyState message="Henüz dışa aktarım kaydı yok" />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableCaption className="sr-only">Ödeme dışa aktarımları listesi</TableCaption>
        <TableHeader>
          <TableRow className="bg-muted/50 text-xs text-muted-foreground">
            <TableHead>Oluşturulma</TableHead>
            <TableHead>Biçim</TableHead>
            <TableHead>Durum</TableHead>
            <TableHead className="text-right">Satır sayısı</TableHead>
            <TableHead className="text-right">İşlem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {exports.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{dateFormatter.format(new Date(row.created_at))}</TableCell>
              <TableCell className="uppercase">{row.format}</TableCell>
              <TableCell>
                <Badge variant="outline" className={statusBadgeClass(row.status)}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.row_count != null
                  ? new Intl.NumberFormat('tr-TR').format(row.row_count)
                  : '—'}
              </TableCell>
              <TableCell className="text-right">
                <Link
                  href={`/payroll/exports/${row.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Detay
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
