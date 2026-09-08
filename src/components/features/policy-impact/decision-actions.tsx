'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { submitChangeRequest } from '@/app/actions/policy-impact/submit-change-request';
import { approveChangeRequest } from '@/app/actions/policy-impact/approve-change-request';
import { decideChangeRequest } from '@/app/actions/policy-impact/decide-change-request';
import type { ChangeRequestStatus } from '@/modules/policy-change-impact';

// §8.10 CTAs. Client component; every action re-checks authz server-side (requirePermission / role)
// and relies on RLS + the validate trigger. Buttons only reflect the caller's coarse capability —
// client-side gating is never the source of truth.
export interface DecisionActionsProps {
  changeRequestId: string;
  status: ChangeRequestStatus;
  toDraftVersionId: string;
  /** policy.manage — may create/submit. */
  canManage: boolean;
  /** HR or Finance — may approve / reject / request changes. */
  canDecide: boolean;
  hrApproved: boolean;
  financeApproved: boolean;
}

export function DecisionActions({
  changeRequestId,
  status,
  toDraftVersionId,
  canManage,
  canDecide,
  hrApproved,
  financeApproved,
}: DecisionActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [decision, setDecision] = React.useState<'reject' | 'request_changes'>('request_changes');
  const [note, setNote] = React.useState('');

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(`İşlem başarısız (${result.error}).`);
        toast.error(`İşlem başarısız (${result.error}).`);
        return;
      }
      toast.success(okMsg);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {status === 'submitted' ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Onay durumu — İK: {hrApproved ? '✓ onayladı' : 'bekliyor'} · Finans:{' '}
          {financeApproved ? '✓ onayladı' : 'bekliyor'} (her iki onay tamamlanınca talep onaylanır).
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canManage && (status === 'draft' || status === 'changes_requested') ? (
          <Button
            type="button"
            disabled={isPending}
            onClick={() => run(() => submitChangeRequest({ changeRequestId }), 'Onaya sunuldu.')}
          >
            {status === 'changes_requested' ? 'Yeniden onaya sun' : 'Onaya sun'}
          </Button>
        ) : null}

        {canDecide && status === 'submitted' ? (
          <Button
            type="button"
            disabled={isPending}
            onClick={() => run(() => approveChangeRequest({ changeRequestId }), 'Onayınız kaydedildi.')}
          >
            Onayla (rolüne göre)
          </Button>
        ) : null}

        {canManage ? (
          <Button
            type="button"
            variant="outline"
            disabled
            title={`Taslak sürüm ${toDraftVersionId} ayrı politika editöründe düzenlenir (bu sürümde kapsam dışı).`}
          >
            Taslağı düzenle
          </Button>
        ) : null}
      </div>

      {canDecide && status === 'submitted' ? (
        <form
          className="flex flex-col gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim().length === 0) {
              setError('Karar notu gereklidir.');
              return;
            }
            run(
              () => decideChangeRequest({ changeRequestId, decision, note: note.trim() }),
              decision === 'reject' ? 'Talep reddedildi.' : 'Değişiklik istendi.',
            );
          }}
        >
          <label htmlFor="pci-decision" className="text-sm font-medium">
            Reddet / değişiklik iste
          </label>
          <select
            id="pci-decision"
            value={decision}
            onChange={(e) => setDecision(e.target.value as 'reject' | 'request_changes')}
            disabled={isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="request_changes">Değişiklik iste</option>
            <option value="reject">Reddet</option>
          </select>
          <textarea
            aria-label="Karar notu"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isPending}
            rows={3}
            maxLength={2000}
            placeholder="Karar notu (zorunlu)"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <div>
            <Button type="submit" variant="outline" disabled={isPending}>
              {isPending ? 'Kaydediliyor…' : 'Kararı gönder'}
            </Button>
          </div>
        </form>
      ) : null}

      {status === 'approved' || status === 'rejected' ? (
        <p className="text-sm text-muted-foreground">
          Bu talep {status === 'approved' ? 'onaylandı' : 'reddedildi'}; başka işlem yapılamaz.
        </p>
      ) : null}

      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}
