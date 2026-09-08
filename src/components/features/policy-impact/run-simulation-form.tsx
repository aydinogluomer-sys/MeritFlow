'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { runSimulation } from '@/app/actions/policy-impact/run-simulation';

// §8.10 "Run another simulation". Client component; runSimulation re-checks policy.manage server-side
// and injects the admin client there. Reference periods are the frozen historical datasets to backtest.
export interface PeriodOption {
  id: string;
  label: string;
}

export function RunSimulationForm({
  changeRequestId,
  periodOptions,
}: {
  changeRequestId: string;
  periodOptions: PeriodOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [referencePeriodId, setReferencePeriodId] = React.useState('');

  if (periodOptions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Simülasyon için kilitli bir referans dönemi bulunamadı.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!referencePeriodId) {
          setError('Lütfen bir referans dönemi seçin.');
          return;
        }
        startTransition(async () => {
          const result = await runSimulation({ changeRequestId, referencePeriodId });
          if (!result.ok) {
            setError(`Simülasyon çalıştırılamadı (${result.error}).`);
            toast.error(`Simülasyon çalıştırılamadı (${result.error}).`);
            return;
          }
          toast.success('Simülasyon çalıştırıldı.');
          router.refresh();
        });
      }}
    >
      <label htmlFor="pci-ref-period" className="text-sm font-medium">
        Referans dönemi (dondurulmuş veri)
      </label>
      <select
        id="pci-ref-period"
        value={referencePeriodId}
        onChange={(e) => setReferencePeriodId(e.target.value)}
        disabled={isPending}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Dönem seçin…</option>
        {periodOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {error ? <ErrorState message={error} /> : null}
      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Çalışıyor…' : 'Simülasyonu çalıştır'}
        </Button>
      </div>
    </form>
  );
}
