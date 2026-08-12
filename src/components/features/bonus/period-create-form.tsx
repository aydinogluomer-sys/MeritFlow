'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorState } from '@/components/features/shared/error-state';
import { createPeriod } from '@/app/actions/bonus/create-period';

/**
 * Create a bonus period (monthly MVP — D11). The server action re-checks period.manage and
 * RLS is the ultimate guard. On success: toast + router.refresh().
 */
export function PeriodCreateForm() {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [startsOn, setStartsOn] = React.useState('');
  const [endsOn, setEndsOn] = React.useState('');

  const validate = (): string | null => {
    if (!startsOn) return 'Başlangıç tarihi zorunludur.';
    if (!endsOn) return 'Bitiş tarihi zorunludur.';
    if (endsOn <= startsOn) return 'Bitiş tarihi başlangıçtan sonra olmalıdır.';
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
      const result = await createPeriod({ periodType: 'monthly', startsOn, endsOn });
      if (!result.ok) {
        setError(`Dönem oluşturulamadı (${result.error}).`);
        toast.error(`Dönem oluşturulamadı (${result.error}).`);
        return;
      }
      toast.success('Prim dönemi oluşturuldu.');
      setStartsOn('');
      setEndsOn('');
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={isPending}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="period-starts-on">Başlangıç</Label>
        <Input
          id="period-starts-on"
          type="date"
          value={startsOn}
          onChange={(e) => setStartsOn(e.target.value)}
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="period-ends-on">Bitiş</Label>
        <Input
          id="period-ends-on"
          type="date"
          value={endsOn}
          onChange={(e) => setEndsOn(e.target.value)}
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">Aylık dönem (MVP). Dönem &apos;open&apos; başlar.</p>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Oluşturuluyor…' : 'Dönem oluştur'}
        </Button>
      </div>
    </form>
  );
}
