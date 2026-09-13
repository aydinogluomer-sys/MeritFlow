'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { acceptHealthRiskAction } from '@/app/actions/policy-health/accept-risk';

// §3.8 Accept Risk — the ONLY action on a risk (never a silent "dismiss"). Reason is REQUIRED; expiry
// optional. Submits to the permission-gated, AUDITED server action (the 1-B workflow). Accepting does
// NOT change the health score — it records an explicit, time-boundable waiver. Client component.
export function AcceptRiskButton({
  healthEvaluationId,
  dimension,
  driverCode,
}: {
  healthEvaluationId: string;
  dimension: string;
  driverCode: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [expiresLocal, setExpiresLocal] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Riski kabul et
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (reason.trim().length === 0) {
          setError('Gerekçe zorunludur.');
          return;
        }
        let expiresAt: string | undefined;
        if (expiresLocal) {
          const parsed = new Date(expiresLocal);
          if (Number.isNaN(parsed.getTime())) {
            setError('Geçersiz son geçerlilik tarihi.');
            return;
          }
          if (parsed.getTime() <= Date.now()) {
            setError('Son geçerlilik gelecekte olmalı.');
            return;
          }
          expiresAt = parsed.toISOString();
        }
        startTransition(async () => {
          const result = await acceptHealthRiskAction({
            healthEvaluationId,
            dimension,
            driverCode,
            reason: reason.trim(),
            ...(expiresAt ? { expiresAt } : {}),
          });
          if (!result.ok) {
            setError(`Kabul başarısız (${result.error}).`);
            toast.error(`Kabul başarısız (${result.error}).`);
            return;
          }
          toast.success('Risk kabul edildi (denetime kaydedildi).');
          setOpen(false);
          setReason('');
          setExpiresLocal('');
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`reason-${dimension}-${driverCode}`} className="text-sm font-medium">
          Gerekçe (zorunlu)
        </label>
        <textarea
          id={`reason-${dimension}-${driverCode}`}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isPending}
          rows={2}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Bu riski neden kabul ediyorsunuz?"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`expiry-${dimension}-${driverCode}`} className="text-sm font-medium">
          Son geçerlilik (opsiyonel)
        </label>
        <input
          id={`expiry-${dimension}-${driverCode}`}
          type="datetime-local"
          value={expiresLocal}
          onChange={(e) => setExpiresLocal(e.target.value)}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Kaydediliyor…' : 'Kabul et'}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
      {error ? <ErrorState message={error} /> : null}
    </form>
  );
}
