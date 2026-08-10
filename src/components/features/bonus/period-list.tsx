'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';
import { ErrorState } from '@/components/features/shared/error-state';
import { ConfirmDialog } from '@/components/features/shared/confirm-dialog';
import { runCalculation } from '@/app/actions/bonus/run-calculation';

/** Subset of `bonus_periods` (+ active pool) columns used by the list view (RLS-scoped). */
export type PeriodListRow = {
  id: string;
  period_type: string;
  starts_on: string;
  ends_on: string;
  status: string;
  /** Active (non-superseded) pool id for this period, if any (needed to run a calculation). */
  poolId: string | null;
};

const dateFormatter = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' });

const STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  locked: 'Kilitli',
  calculated: 'Hesaplandı',
  approved: 'Onaylandı',
  exported: 'Dışa aktarıldı',
  closed: 'Kapandı',
};

const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  open: 'outline',
  locked: 'secondary',
  calculated: 'secondary',
  approved: 'default',
  exported: 'default',
  closed: 'outline',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function periodRange(row: PeriodListRow): string {
  return `${dateFormatter.format(new Date(row.starts_on))} – ${dateFormatter.format(
    new Date(row.ends_on),
  )}`;
}

export interface PeriodListProps {
  periods: PeriodListRow[];
}

/**
 * Plain Tailwind table of bonus periods (no TanStack Table dependency). Each locked
 * period with an active pool exposes a "Hesapla" control (behind {@link ConfirmDialog})
 * that runs the calculation via the 8-B `runCalculation` action. Errors are surfaced
 * inline; the trigger is disabled while pending.
 */
export function PeriodList({ periods }: PeriodListProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  if (periods.length === 0) {
    return <EmptyState message="Henüz prim dönemi yok" />;
  }

  const handleCalculate = (periodId: string, poolId: string) => {
    setError(null);
    startTransition(async () => {
      const result = await runCalculation({ periodId, poolId });
      if (!result.ok) {
        setError(`Hesaplama başlatılamadı (${result.error}).`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorState message={error} /> : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Prim dönemleri listesi</caption>
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-3 font-medium">
                Dönem
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Tür
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Durum
              </th>
              <th scope="col" className="px-4 py-3 text-right font-medium">
                İşlem
              </th>
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              // "Hesapla" is available only for a locked period that has an active pool.
              const canCalculate = period.status === 'locked' && period.poolId != null;
              return (
                <tr key={period.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <Link
                      href={`/bonus/periods/${period.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {periodRange(period)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 capitalize">{period.period_type}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANTS[period.status] ?? 'outline'}>
                      {statusLabel(period.status)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canCalculate ? (
                      <ConfirmDialog
                        triggerLabel="Hesapla"
                        title="Prim hesaplaması çalıştırılsın mı?"
                        description="Kilitli havuz ve puanlardan bu dönem için prim dağıtımı hesaplanır. İşlem denetim kaydı üretir."
                        confirmLabel="Hesapla"
                        disabled={isPending}
                        onConfirm={() => handleCalculate(period.id, period.poolId!)}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
