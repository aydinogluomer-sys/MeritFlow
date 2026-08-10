import Link from 'next/link';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';

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

const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  open: 'outline',
  under_review: 'secondary',
  needs_info: 'outline',
  resolved: 'default',
  closed: 'outline',
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
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">İtiraz listesi</caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Tür
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Durum
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Sonuç
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Açılış
            </th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((dispute) => (
            <tr key={dispute.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <Link
                  href={`/disputes/${dispute.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {typeLabel(dispute.dispute_type)}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Badge variant={STATUS_VARIANTS[dispute.status] ?? 'outline'}>
                  {STATUS_LABELS[dispute.status] ?? dispute.status}
                </Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {dispute.resolution
                  ? (RESOLUTION_LABELS[dispute.resolution] ?? dispute.resolution)
                  : '—'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {dateFormatter.format(new Date(dispute.opened_at))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
