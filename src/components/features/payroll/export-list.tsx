import Link from 'next/link';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';

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

const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  requested: 'secondary',
  generated: 'default',
  downloaded: 'default',
  failed: 'destructive',
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
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Ödeme dışa aktarımları listesi</caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Oluşturulma
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Biçim
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Durum
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Satır sayısı
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              İşlem
            </th>
          </tr>
        </thead>
        <tbody>
          {exports.map((row) => (
            <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                {dateFormatter.format(new Date(row.created_at))}
              </td>
              <td className="px-4 py-3 uppercase">{row.format}</td>
              <td className="px-4 py-3">
                <Badge variant={STATUS_VARIANTS[row.status] ?? 'outline'}>
                  {STATUS_LABELS[row.status] ?? row.status}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {row.row_count != null
                  ? new Intl.NumberFormat('tr-TR').format(row.row_count)
                  : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/payroll/exports/${row.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Detay
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
