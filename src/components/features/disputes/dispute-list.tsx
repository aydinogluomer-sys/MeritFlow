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

/** Subset of `disputes` columns used by the list view (RLS-scoped select). */
export type DisputeListRow = {
  id: string;
  dispute_type: string;
  target_type: string;
  status: string;
  resolution: string | null;
  opened_at: string;
};

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const TYPE_LABELS: Record<string, string> = {
  task_points_too_low: 'Puan çok düşük',
  unfair_rejection: 'Haksız ret',
  quality_score_dispute: 'Kalite puanı itirazı',
  missing_task_credit: 'Eksik görev kredisi',
  bonus_calculation_dispute: 'Prim hesabı itirazı',
  manager_bias_report: 'Yönetici önyargısı',
  anomaly_false_positive: 'Yanlış anomali',
  system_error: 'Sistem hatası',
  clawback_dispute: 'Geri alma itirazı',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  under_review: 'İncelemede',
  needs_info: 'Bilgi bekleniyor',
  resolved: 'Çözüldü',
  closed: 'Kapandı',
};

const RESOLUTION_LABELS: Record<string, string> = {
  accepted: 'Kabul edildi',
  rejected: 'Reddedildi',
};

function typeLabel(t: string): string {
  return TYPE_LABELS[t] ?? t;
}

export interface DisputeListProps {
  disputes: DisputeListRow[];
  emptyMessage?: string;
}

/**
 * Plain Tailwind table of disputes (no TanStack Table dependency). Presentational and
 * server-renderable; the RLS-scoped select decides which rows the caller sees.
 */
export function DisputeList({ disputes, emptyMessage = 'Henüz itiraz yok' }: DisputeListProps) {
  if (disputes.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableCaption className="sr-only">İtiraz listesi</TableCaption>
        <TableHeader>
          <TableRow className="bg-muted/50 text-xs text-muted-foreground">
            <TableHead>Tür</TableHead>
            <TableHead>Durum</TableHead>
            <TableHead>Sonuç</TableHead>
            <TableHead>Açılış</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {disputes.map((dispute) => (
            <TableRow key={dispute.id}>
              <TableCell>
                <Link
                  href={`/disputes/${dispute.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {typeLabel(dispute.dispute_type)}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={statusBadgeClass(dispute.status)}>
                  {STATUS_LABELS[dispute.status] ?? dispute.status}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {dispute.resolution
                  ? (RESOLUTION_LABELS[dispute.resolution] ?? dispute.resolution)
                  : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {dateFormatter.format(new Date(dispute.opened_at))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
