'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { evaluatePolicyDebtAction } from '@/app/actions/policy-debt/evaluate-policy-debt';

// §6.10 "Evaluate now / refresh" CTA. Client component; the action re-checks policy.manage server-side
// and runs the idempotent (advisory) evaluate path — it NEVER mutates a policy (§26). Pick a version
// to (re)evaluate; an existing (version, rule_set_version) evaluation is reused unchanged.
export interface VersionOption {
  id: string;
  versionNo: number;
}

export function EvaluateButton({ versionOptions }: { versionOptions: VersionOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [versionId, setVersionId] = React.useState(versionOptions[0]?.id ?? '');

  if (versionOptions.length === 0) {
    return <p className="text-sm text-muted-foreground">Değerlendirilecek politika sürümü yok.</p>;
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!versionId) {
          setError('Lütfen bir sürüm seçin.');
          return;
        }
        startTransition(async () => {
          const result = await evaluatePolicyDebtAction({ policyVersionId: versionId });
          if (!result.ok) {
            setError(`Değerlendirme başarısız (${result.error}).`);
            toast.error(`Değerlendirme başarısız (${result.error}).`);
            return;
          }
          toast.success('Borç değerlendirmesi güncellendi.');
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="pd-version" className="text-sm font-medium">Sürüm</label>
        <select
          id="pd-version"
          value={versionId}
          onChange={(e) => setVersionId(e.target.value)}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {versionOptions.map((v) => (
            <option key={v.id} value={v.id}>v{v.versionNo}</option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Değerlendiriliyor…' : 'Şimdi değerlendir'}
      </Button>
      {error ? <ErrorState message={error} /> : null}
    </form>
  );
}
