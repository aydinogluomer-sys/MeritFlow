'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { ErrorState } from '@/components/features/shared/error-state';
import { ConfirmDialog } from '@/components/features/shared/confirm-dialog';
import { postAccrual } from '@/app/actions/bonus/post-accrual';
import { recalculate } from '@/app/actions/bonus/recalculate';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const PERIOD_STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  locked: 'Kilitli',
  calculated: 'Hesaplandı',
  approved: 'Onaylandı',
  exported: 'Dışa aktarıldı',
  closed: 'Kapandı',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  running: 'Çalışıyor',
  completed: 'Tamamlandı',
  superseded: 'Geçersiz kılındı',
};

const RUN_STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  running: 'secondary',
  completed: 'default',
  superseded: 'outline',
};

export type PeriodDetailPool = {
  amount_minor: number;
  currency: string;
  status: string;
  t_org: number | null;
  top_up_approved: boolean;
} | null;

export type PeriodDetailRun = {
  id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
} | null;

export interface PeriodDetailProps {
  periodId: string;
  /** bonus_periods.status — drives which mutations are enabled. */
  periodStatus: string;
  pool: PeriodDetailPool;
  lastRun: PeriodDetailRun;
}

/**
 * Bonus period detail: pool info + last run status, plus the dangerous mutations
 * (behind {@link ConfirmDialog}). "Accrual Yap" is enabled only when the period is
 * 'approved'; "Yeniden Hesapla" re-runs the calculation. Errors (e.g. invalid
 * transition) surface inline; controls disable while pending.
 */
export function PeriodDetail({ periodId, periodStatus, pool, lastRun }: PeriodDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const moneyFormatter = React.useMemo(
    () =>
      new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: pool?.currency ?? 'TRY',
      }),
    [pool?.currency],
  );

  const canAccrue = periodStatus === 'approved';

  const handleAccrual = () => {
    setError(null);
    startTransition(async () => {
      const result = await postAccrual({ periodId });
      if (!result.ok) {
        setError(`Accrual gönderilemedi (${result.error}).`);
        return;
      }
      router.refresh();
    });
  };

  const handleRecalculate = () => {
    setError(null);
    startTransition(async () => {
      const result = await recalculate({ periodId });
      if (!result.ok) {
        setError(`Yeniden hesaplama başlatılamadı (${result.error}).`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {error ? <ErrorState message={error} /> : null}

      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <Field label="Dönem durumu" value={PERIOD_STATUS_LABELS[periodStatus] ?? periodStatus} />
        {pool ? (
          <>
            <Field label="Havuz tutarı" value={moneyFormatter.format(pool.amount_minor / 100)} />
            <Field
              label="Havuz durumu"
              value={pool.status === 'locked' ? 'Kilitli' : pool.status}
              className="capitalize"
            />
            <Field
              label="T_org (Zero Factor)"
              value={pool.t_org != null ? new Intl.NumberFormat('tr-TR').format(pool.t_org) : '—'}
            />
            <Field label="Top-up onayı" value={pool.top_up_approved ? 'Evet' : 'Hayır'} />
          </>
        ) : (
          <div className="sm:col-span-2 text-muted-foreground">
            Bu dönem için havuz tanımlı değil.
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <span className="text-xs text-muted-foreground">Son hesaplama çalışması</span>
        {lastRun ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={RUN_STATUS_VARIANTS[lastRun.status] ?? 'outline'}>
              {RUN_STATUS_LABELS[lastRun.status] ?? lastRun.status}
            </Badge>
            <span className="text-muted-foreground">
              {lastRun.completed_at
                ? `Tamamlandı: ${dateFormatter.format(new Date(lastRun.completed_at))}`
                : `Başladı: ${dateFormatter.format(new Date(lastRun.created_at))}`}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">Henüz hesaplama çalıştırılmadı.</span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <ConfirmDialog
          triggerLabel="Yeniden Hesapla"
          title="Dönem yeniden hesaplansın mı?"
          description="İtiraz düzeltmesi sonrası bu dönem için yeni bir hesaplama çalışması üretilir. Önceki çalışma geçersiz kılınır."
          confirmLabel="Yeniden Hesapla"
          disabled={isPending}
          onConfirm={handleRecalculate}
        />
        <ConfirmDialog
          triggerLabel="Accrual Yap"
          title="Prim tahakkuku gönderilsin mi?"
          description="Onaylanmış anlık görüntüden çift taraflı prim defterine tahakkuk yazılır. Bu işlem geri alınamaz ve denetim kaydı üretir."
          confirmLabel="Accrual Yap"
          confirmVariant="default"
          disabled={isPending || !canAccrue}
          onConfirm={handleAccrual}
        />
      </div>
      {!canAccrue ? (
        <p className="text-xs text-muted-foreground">
          Accrual yalnızca dönem &apos;Onaylandı&apos; durumundayken yapılabilir.
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}
