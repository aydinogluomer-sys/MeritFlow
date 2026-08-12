'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ErrorState } from '@/components/features/shared/error-state';
import { ConfirmDialog } from '@/components/features/shared/confirm-dialog';
import { markPaid } from '@/app/actions/payroll/mark-paid';

export interface MarkPaidButtonProps {
  periodId: string;
  exportId: string;
  /** Disable when the export/period is not in an exported (payable) state. */
  disabled?: boolean;
}

/**
 * Marks a payout export as paid (behind {@link ConfirmDialog}). Calls the 8-B
 * `markPaid` action → mark_payout_paid RPC (exported period → balanced payout ledger,
 * period exported→closed; idempotent per export). Errors surface inline.
 */
export function MarkPaidButton({ periodId, exportId, disabled = false }: MarkPaidButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const handleMarkPaid = () => {
    setError(null);
    startTransition(async () => {
      const result = await markPaid({ periodId, exportId });
      if (!result.ok) {
        setError(`Ödeme işaretlenemedi (${result.error}).`);
        toast.error(`Ödeme işaretlenemedi (${result.error}).`);
        return;
      }
      toast.success('Ödeme işaretlendi.');
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorState message={error} /> : null}
      <div>
        <ConfirmDialog
          triggerLabel="Ödendi olarak işaretle"
          title="Ödeme yapıldı olarak işaretlensin mi?"
          description="Çift taraflı prim defterine ödeme kaydı yazılır (tahakkuk borç / ödeme alacak) ve dönem 'Dışa aktarıldı' → 'Kapandı' durumuna geçer. Bu işlem geri alınamaz ve denetim kaydı üretir."
          confirmLabel="Ödendi olarak işaretle"
          disabled={disabled || isPending}
          onConfirm={handleMarkPaid}
        />
      </div>
    </div>
  );
}
