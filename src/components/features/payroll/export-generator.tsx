'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/features/shared/error-state';
import { ConfirmDialog } from '@/components/features/shared/confirm-dialog';
import { exportPayout } from '@/app/actions/payroll/export-payout';

type ExportFormat = 'csv' | 'xlsx';

/** An approved bonus period that can be exported (status='approved'). */
export type ExportPeriodOption = {
  id: string;
  label: string;
};

/** An approved snapshot of a period's completed calculation run. */
export type ExportSnapshotOption = {
  id: string;
  /** The period this snapshot belongs to (for client-side filtering). */
  periodId: string;
  label: string;
};

export interface ExportGeneratorProps {
  periodOptions: ExportPeriodOption[];
  snapshotOptions: ExportSnapshotOption[];
}

/**
 * Payout export generator: pick an approved period → an approved snapshot of its
 * completed run → format (csv|xlsx) → produce the export (behind {@link ConfirmDialog}).
 * The DB (produce_payout_export + validate_export) enforces period=approved, snapshot/
 * period match and AD6/SI-15; this form only collects. Errors surface inline.
 */
export function ExportGenerator({ periodOptions, snapshotOptions }: ExportGeneratorProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [periodId, setPeriodId] = React.useState('');
  const [snapshotId, setSnapshotId] = React.useState('');
  const [format, setFormat] = React.useState<ExportFormat>('csv');

  // Only snapshots of the selected period are selectable.
  const periodSnapshots = React.useMemo(
    () => snapshotOptions.filter((s) => s.periodId === periodId),
    [snapshotOptions, periodId],
  );

  const canSubmit = periodId !== '' && snapshotId !== '' && !isPending;

  const handleExport = () => {
    setError(null);
    if (!periodId || !snapshotId) {
      setError('Lütfen dönem ve anlık görüntü seçin.');
      return;
    }
    startTransition(async () => {
      const result = await exportPayout({ periodId, snapshotId, format });
      if (!result.ok) {
        setError(`Dışa aktarım üretilemedi (${result.error}).`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="export-period" className="text-sm font-medium">
          Prim dönemi (onaylı)
        </label>
        <select
          id="export-period"
          value={periodId}
          onChange={(e) => {
            setPeriodId(e.target.value);
            setSnapshotId('');
          }}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value="">Dönem seçin…</option>
          {periodOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Dışa aktarım yalnızca &apos;Onaylandı&apos; durumundaki dönemler için üretilebilir.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="export-snapshot" className="text-sm font-medium">
          Onaylı anlık görüntü
        </label>
        <select
          id="export-snapshot"
          value={snapshotId}
          onChange={(e) => setSnapshotId(e.target.value)}
          disabled={isPending || periodId === ''}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value="">
            {periodId === '' ? 'Önce dönem seçin' : 'Anlık görüntü seçin…'}
          </option>
          {periodSnapshots.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {periodId !== '' && periodSnapshots.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Bu dönemin tamamlanmış çalışmasına ait onaylı bir anlık görüntü bulunamadı.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="export-format" className="text-sm font-medium">
          Biçim
        </label>
        <select
          id="export-format"
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
          disabled={isPending}
          className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value="csv">CSV</option>
          <option value="xlsx">XLSX</option>
        </select>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div>
        <ConfirmDialog
          triggerLabel={isPending ? 'Üretiliyor…' : 'Dışa aktarım üret'}
          title="Ödeme dışa aktarımı üretilsin mi?"
          description="Değişmez onaylı anlık görüntüden bir ödeme dışa aktarımı üretilir ve dönem 'Onaylandı' → 'Dışa aktarıldı' durumuna geçer. İşlem denetim kaydı üretir."
          confirmLabel="Dışa aktarım üret"
          disabled={!canSubmit}
          onConfirm={handleExport}
        />
      </div>
    </div>
  );
}
