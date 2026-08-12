'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { assignReviewer } from '@/app/actions/disputes/assign-reviewer';
import { resolveDispute } from '@/app/actions/disputes/resolve-dispute';
import {
  DisputeAdjustmentForm,
  type AdjustmentPeriodOption,
} from './dispute-adjustment-form';

type Resolution = 'accepted' | 'rejected';

/** A candidate reviewer (≠ complainant / decision owner — D9 filtered server-side). */
export type ReviewerOption = {
  id: string;
  label: string;
};

export interface DisputeFlowFormProps {
  disputeId: string;
  /** disputes.status — decides which step is shown. */
  status: string;
  /** Assignable reviewers (already filtered to exclude complainant / decision owner). */
  reviewerOptions: ReviewerOption[];
  /** Candidate bonus periods for an accepted adjustment. */
  periodOptions: AdjustmentPeriodOption[];
}

/**
 * Drives the two-step dispute lifecycle:
 *  - status='open'          → "Assign Reviewer" (assignReviewer → under_review). D9
 *    (reviewer ≠ complainant / decision owner) is enforced by the DB; the option list
 *    is pre-filtered.
 *  - status='under_review'  → "Resolve" (resolveDispute → resolved). When
 *    resolution='accepted', the {@link DisputeAdjustmentForm} collects pointsDelta +
 *    optional bonusPeriodId, fed into the resolve call.
 * Thrown action errors (invalid transition, D9 violation) surface inline; controls
 * disable while pending.
 */
export function DisputeFlowForm({
  disputeId,
  status,
  reviewerOptions,
  periodOptions,
}: DisputeFlowFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  // Assign step state.
  const [reviewerId, setReviewerId] = React.useState<string>('');

  // Resolve step state.
  const [resolution, setResolution] = React.useState<Resolution>('accepted');
  const [decisionNote, setDecisionNote] = React.useState('');
  const [pointsDelta, setPointsDelta] = React.useState('');
  const [bonusPeriodId, setBonusPeriodId] = React.useState('');

  if (status === 'open') {
    const handleAssign = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      if (!reviewerId) {
        setError('Lütfen bir inceleyen seçin.');
        return;
      }
      startTransition(async () => {
        const result = await assignReviewer({ disputeId, reviewerId });
        if (!result.ok) {
          setError(`İnceleyen atanamadı (${result.error}).`);
          toast.error(`İnceleyen atanamadı (${result.error}).`);
          return;
        }
        toast.success('İnceleyen atandı.');
        router.refresh();
      });
    };

    return (
      <form onSubmit={handleAssign} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="dispute-reviewer" className="text-sm font-medium">
            İnceleyen ata
          </label>
          <select
            id="dispute-reviewer"
            value={reviewerId}
            onChange={(e) => setReviewerId(e.target.value)}
            disabled={isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="">İnceleyen seçin…</option>
            {reviewerOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            İnceleyen, itiraz sahibi veya kararın sahibi olamaz (D9).
          </p>
        </div>

        {error ? <ErrorState message={error} /> : null}

        <div>
          <Button type="submit" disabled={isPending || reviewerOptions.length === 0}>
            {isPending ? 'Atanıyor…' : 'İncelemeye al'}
          </Button>
        </div>
      </form>
    );
  }

  if (status === 'under_review') {
    const handleResolve = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);
      if (decisionNote.trim().length < 5) {
        setError('Karar notu en az 5 karakter olmalıdır.');
        return;
      }

      const parsedDelta =
        resolution === 'accepted' && pointsDelta.trim() !== ''
          ? Number.parseInt(pointsDelta, 10)
          : undefined;
      if (parsedDelta !== undefined && !Number.isInteger(parsedDelta)) {
        setError('Puan farkı geçerli bir tam sayı olmalıdır.');
        return;
      }

      startTransition(async () => {
        const result = await resolveDispute({
          disputeId,
          resolution,
          decisionNote: decisionNote.trim(),
          ...(parsedDelta !== undefined ? { pointsDelta: parsedDelta } : {}),
          ...(resolution === 'accepted' && bonusPeriodId
            ? { bonusPeriodId }
            : {}),
        });
        if (!result.ok) {
          setError(`İtiraz sonuçlandırılamadı (${result.error}).`);
          toast.error(`İtiraz sonuçlandırılamadı (${result.error}).`);
          return;
        }
        toast.success(
          resolution === 'accepted' ? 'İtiraz kabul edildi.' : 'İtiraz reddedildi.',
        );
        router.refresh();
      });
    };

    return (
      <form onSubmit={handleResolve} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="dispute-resolution" className="text-sm font-medium">
            Karar
          </label>
          <select
            id="dispute-resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value as Resolution)}
            disabled={isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="accepted">Kabul et</option>
            <option value="rejected">Reddet</option>
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="dispute-decision-note" className="text-sm font-medium">
            Karar notu
          </label>
          <textarea
            id="dispute-decision-note"
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            disabled={isPending}
            minLength={5}
            maxLength={2000}
            rows={4}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
        </div>

        {resolution === 'accepted' ? (
          <DisputeAdjustmentForm
            pointsDelta={pointsDelta}
            onPointsDeltaChange={setPointsDelta}
            bonusPeriodId={bonusPeriodId}
            onBonusPeriodIdChange={setBonusPeriodId}
            periodOptions={periodOptions}
            disabled={isPending}
          />
        ) : null}

        {error ? <ErrorState message={error} /> : null}

        <div>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Kaydediliyor…' : 'İtirazı sonuçlandır'}
          </Button>
        </div>
      </form>
    );
  }

  // needs_info / resolved / closed: no resolver action available from this form.
  return (
    <p className="text-sm text-muted-foreground">
      Bu itiraz için şu anda yapılabilecek bir işlem yok.
    </p>
  );
}
