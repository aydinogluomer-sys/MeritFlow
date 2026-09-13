'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { resolveOpportunityFlagAction } from '@/app/actions/opportunity/resolve-flag';

// §2.8/§2.7 flag resolution — advance an opportunity_flag through the audited status lifecycle. The
// valid next statuses are computed SERVER-side (nextStatuses) and passed as plain data, so this client
// component never imports the module (no server-only leakage). A resolution OUTCOME (accepted/
// dismissed) REQUIRES a reason. Resolving is a review outcome, NEVER a pay/policy change.
export interface NextOption {
  value: string; // InsightStatus
  label: string;
}

const REQUIRES_REASON = new Set(['accepted', 'dismissed']);

export function ResolveFlagButton({
  insightId,
  nextOptions,
}: {
  insightId: string;
  nextOptions: NextOption[];
}) {
  const router = useRouter();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();

  if (nextOptions.length === 0) {
    return <span className="text-xs text-muted-foreground">Çözüldü (terminal durum).</span>;
  }

  const needsReason = nextOptions.some((o) => REQUIRES_REASON.has(o.value));

  function submit(toStatus: string) {
    setError(null);
    const trimmed = reason.trim();
    if (REQUIRES_REASON.has(toStatus) && trimmed.length === 0) {
      setError('Karar gerekçesi zorunludur.');
      return;
    }
    startTransition(async () => {
      const result = await resolveOpportunityFlagAction({
        insightId,
        toStatus: toStatus as 'calculated' | 'reviewed' | 'accepted' | 'dismissed',
        ...(trimmed ? { resolutionCode: trimmed } : {}),
      });
      if (!result.ok) {
        setError(`İşlem başarısız (${result.error}).`);
        toast.error(`İşlem başarısız (${result.error}).`);
        return;
      }
      toast.success('Bayrak durumu güncellendi (denetime kaydedildi).');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {needsReason ? (
        <textarea
          aria-label="Karar gerekçesi"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isPending}
          rows={2}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          placeholder="Karar gerekçesi (kabul/ret için zorunlu)"
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {nextOptions.map((o) => (
          <Button
            key={o.value}
            type="button"
            size="sm"
            variant={o.value === 'dismissed' ? 'outline' : 'default'}
            disabled={isPending}
            onClick={() => submit(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}
