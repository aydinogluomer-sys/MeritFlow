'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { reviewTask } from '@/app/actions/tasks/review-task';

type Decision = 'approve' | 'needs_revision' | 'reject';
type Quality = 'poor' | 'acceptable' | 'good' | 'excellent';
type Timeliness = 'early' | 'on_time' | 'late_minor' | 'late_major';

const DECISION_OPTIONS: ReadonlyArray<{ value: Decision; label: string }> = [
  { value: 'approve', label: 'Onayla' },
  { value: 'needs_revision', label: 'Revizyon iste' },
  { value: 'reject', label: 'Reddet' },
];

const QUALITY_OPTIONS: ReadonlyArray<{ value: Quality; label: string }> = [
  { value: 'poor', label: 'Zayıf' },
  { value: 'acceptable', label: 'Kabul edilebilir' },
  { value: 'good', label: 'İyi' },
  { value: 'excellent', label: 'Mükemmel' },
];

const TIMELINESS_OPTIONS: ReadonlyArray<{ value: Timeliness; label: string }> = [
  { value: 'early', label: 'Erken' },
  { value: 'on_time', label: 'Zamanında' },
  { value: 'late_minor', label: 'Az gecikmeli' },
  { value: 'late_major', label: 'Çok gecikmeli' },
];

const ERROR_MESSAGES: Record<string, string> = {
  APPROVE_POOR_FORBIDDEN: "Kalite 'zayıf' olan bir görev onaylanamaz (D3).",
  VALIDATION_ERROR: 'Girdiler geçersiz. Lütfen alanları kontrol edin.',
};

function friendlyError(code: string): string {
  return ERROR_MESSAGES[code] ?? `İnceleme kaydedilemedi (${code}).`;
}

const DECISION_SUCCESS: Record<Decision, string> = {
  approve: 'Görev onaylandı.',
  reject: 'Görev reddedildi.',
  needs_revision: 'Revizyon istendi.',
};

export interface TaskReviewFormProps {
  taskId: string;
  /** Where to go after a successful review (defaults to the task detail page). */
  redirectTo?: string;
}

/**
 * Reviewer decision form. Submits to the 8-B `reviewTask` action, which enforces the
 * D3 approve⇒quality≠poor guard server-side; the returned error is surfaced inline.
 */
export function TaskReviewForm({ taskId, redirectTo }: TaskReviewFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [decision, setDecision] = React.useState<Decision>('approve');
  const [quality, setQuality] = React.useState<Quality>('good');
  const [timeliness, setTimeliness] = React.useState<Timeliness>('on_time');
  const [reviewerNote, setReviewerNote] = React.useState('');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await reviewTask({
        taskId,
        decision,
        quality,
        timeliness,
        reviewerNote: reviewerNote.trim() === '' ? null : reviewerNote.trim(),
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(friendlyError(result.error));
        return;
      }
      toast.success(DECISION_SUCCESS[decision]);
      router.push(redirectTo ?? `/tasks/${taskId}`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="review-decision" className="text-sm font-medium">
          Karar
        </label>
        <select
          id="review-decision"
          value={decision}
          onChange={(e) => setDecision(e.target.value as Decision)}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          {DECISION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="review-quality" className="text-sm font-medium">
          Kalite
        </label>
        <select
          id="review-quality"
          value={quality}
          onChange={(e) => setQuality(e.target.value as Quality)}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          {QUALITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {decision === 'approve' && quality === 'poor' ? (
          <p className="text-xs text-destructive">
            Kalite &apos;zayıf&apos; iken onay verilemez (D3).
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="review-timeliness" className="text-sm font-medium">
          Zamanlama
        </label>
        <select
          id="review-timeliness"
          value={timeliness}
          onChange={(e) => setTimeliness(e.target.value as Timeliness)}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          {TIMELINESS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="review-note" className="text-sm font-medium">
          İnceleyen notu (opsiyonel)
        </label>
        <textarea
          id="review-note"
          value={reviewerNote}
          onChange={(e) => setReviewerNote(e.target.value)}
          disabled={isPending}
          maxLength={2000}
          rows={4}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>

      {error ? <ErrorState message={friendlyError(error)} /> : null}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Kaydediliyor…' : 'İncelemeyi kaydet'}
        </Button>
      </div>
    </form>
  );
}
