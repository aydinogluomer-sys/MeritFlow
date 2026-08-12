'use client';

import * as React from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
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
import { ErrorState } from '@/components/features/shared/error-state';
import { ConfirmDialog } from '@/components/features/shared/confirm-dialog';
import { statusBadgeClass } from '@/components/features/shared/status-badge';
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

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** TableRow's own class string, replicated so `motion.tr` matches the styled rows. */
const ROW_CLASS = 'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted';
/** Only the first rows animate; later rows render as plain TableRow (perf guard). */
const ANIMATED_ROW_LIMIT = 10;

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
        <Table>
          <TableCaption className="sr-only">Prim dönemleri listesi</TableCaption>
          <TableHeader>
            <TableRow className="bg-muted/50 text-xs text-muted-foreground">
              <TableHead>Dönem</TableHead>
              <TableHead>Tür</TableHead>
              <TableHead>Durum</TableHead>
              <TableHead className="text-right">İşlem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((period, index) => {
              // "Hesapla" is available only for a locked period that has an active pool.
              const canCalculate = period.status === 'locked' && period.poolId != null;
              const cells = (
                <>
                  <TableCell>
                    <Link
                      href={`/bonus/periods/${period.id}`}
                      className="font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {periodRange(period)}
                    </Link>
                  </TableCell>
                  <TableCell className="capitalize">{period.period_type}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(period.status)}>
                      {statusLabel(period.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
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
                  </TableCell>
                </>
              );

              // Perf guard: animate only the first ~10 rows; the rest render plainly.
              if (index >= ANIMATED_ROW_LIMIT) {
                return <TableRow key={period.id}>{cells}</TableRow>;
              }

              return (
                <motion.tr
                  key={period.id}
                  className={ROW_CLASS}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, duration: 0.2 }}
                >
                  {cells}
                </motion.tr>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
