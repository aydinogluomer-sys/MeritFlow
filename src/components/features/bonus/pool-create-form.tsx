'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorState } from '@/components/features/shared/error-state';
import { createPool } from '@/app/actions/bonus/create-pool';

export type PeriodOption = { id: string; label: string };

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

export interface PoolCreateFormProps {
  /** Periods a pool can be created for (RLS-scoped). */
  periodOptions: PeriodOption[];
}

/**
 * Create a bonus pool for a period (starts 'draft'). amountMinor is entered in TL and
 * converted to minor units (kuruş) before submit. The server action re-checks pool.create
 * and RLS is the ultimate guard. On success: toast + router.refresh().
 */
export function PoolCreateForm({ periodOptions }: PoolCreateFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [bonusPeriodId, setBonusPeriodId] = React.useState(periodOptions[0]?.id ?? '');
  const [amountMajor, setAmountMajor] = React.useState('');

  const parsedMajor = amountMajor.trim() === '' ? NaN : Number(amountMajor);
  const amountMinor = Number.isFinite(parsedMajor) ? Math.round(parsedMajor * 100) : NaN;

  const validate = (): string | null => {
    if (!bonusPeriodId) return 'Lütfen bir dönem seçin.';
    if (!Number.isFinite(parsedMajor) || parsedMajor < 0) {
      return 'Tutar negatif olmayan bir sayı olmalıdır.';
    }
    return null;
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    startTransition(async () => {
      const result = await createPool({ bonusPeriodId, amountMinor, currency: 'TRY' });
      if (!result.ok) {
        setError(`Havuz oluşturulamadı (${result.error}).`);
        toast.error(`Havuz oluşturulamadı (${result.error}).`);
        return;
      }
      toast.success('Prim havuzu oluşturuldu.');
      setAmountMajor('');
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={isPending}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="pool-period">Dönem</Label>
        <select
          id="pool-period"
          value={bonusPeriodId}
          onChange={(e) => setBonusPeriodId(e.target.value)}
          disabled={isPending}
          className={SELECT_CLASS}
        >
          <option value="">Dönem seçin…</option>
          {periodOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="pool-amount">Tutar (TL)</Label>
        <Input
          id="pool-amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={amountMajor}
          onChange={(e) => setAmountMajor(e.target.value)}
          disabled={isPending}
          placeholder="Örn. 100000"
        />
        <p className="text-xs text-muted-foreground">
          Havuz &apos;draft&apos; başlar; kilitlenene kadar değiştirilebilir (AD10).
        </p>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Oluşturuluyor…' : 'Havuz oluştur'}
        </Button>
      </div>
    </form>
  );
}
