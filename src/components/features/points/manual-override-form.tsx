'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { ConfirmDialog } from '@/components/features/shared/confirm-dialog';
import { manualOverride } from '@/app/actions/points/manual-override';

/** An org member selectable as the employee or the second approver. */
export type MemberOption = {
  id: string;
  label: string;
};

/** An optional task the adjustment can be attached to (RLS-scoped). */
export type TaskOption = {
  id: string;
  label: string;
};

export interface ManualOverrideFormProps {
  /** Org members (employees the adjustment can target). */
  memberOptions: MemberOption[];
  /** Optional tasks the adjustment can reference. */
  taskOptions: TaskOption[];
}

/**
 * Manual point override (two-person control): pick an employee, an optional task, a
 * non-zero integer points delta, a reason, and a SECOND approver (a different member).
 * The DB (apply_manual_point_adjustment) enforces both approvers hold point.override and
 * are distinct; this form only collects. Confirmed behind {@link ConfirmDialog}; errors
 * surface inline. A successful adjustment appends an audited manual_adjustment ledger row.
 */
export function ManualOverrideForm({ memberOptions, taskOptions }: ManualOverrideFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const [employeeId, setEmployeeId] = React.useState('');
  const [taskId, setTaskId] = React.useState('');
  const [pointsDelta, setPointsDelta] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [secondApproverId, setSecondApproverId] = React.useState('');

  const parsedDelta = pointsDelta.trim() === '' ? NaN : Number(pointsDelta);

  const validate = (): string | null => {
    if (!employeeId) return 'Lütfen bir çalışan seçin.';
    if (pointsDelta.trim() === '' || !Number.isInteger(parsedDelta)) {
      return 'Puan farkı geçerli bir tam sayı olmalıdır.';
    }
    if (parsedDelta === 0) return 'Puan farkı sıfır olamaz.';
    if (reason.trim().length < 1) return 'Gerekçe zorunludur.';
    if (!secondApproverId) return 'Lütfen ikinci onaylayan seçin.';
    if (secondApproverId === employeeId) {
      // Not a DB rule, but a confusing choice — surface early.
      return 'İkinci onaylayan, düzeltilen çalışandan farklı olmalıdır.';
    }
    return null;
  };

  const handleSubmit = () => {
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    startTransition(async () => {
      const result = await manualOverride({
        employeeId,
        pointsDelta: parsedDelta,
        reason: reason.trim(),
        secondApproverId,
        ...(taskId ? { taskId } : {}),
      });
      if (!result.ok) {
        setError(`Düzeltme uygulanamadı (${result.error}).`);
        return;
      }
      setDone(true);
      setEmployeeId('');
      setTaskId('');
      setPointsDelta('');
      setReason('');
      setSecondApproverId('');
      router.refresh();
    });
  };

  const canSubmit = validate() === null && !isPending;

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-col gap-5"
      aria-busy={isPending}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="override-employee" className="text-sm font-medium">
          Çalışan
        </label>
        <select
          id="override-employee"
          value={employeeId}
          onChange={(e) => {
            setEmployeeId(e.target.value);
            setDone(false);
          }}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value="">Çalışan seçin…</option>
          {memberOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="override-task" className="text-sm font-medium">
          Görev (opsiyonel)
        </label>
        <select
          id="override-task"
          value={taskId}
          onChange={(e) => setTaskId(e.target.value)}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value="">Görev seçilmedi</option>
          {taskOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="override-delta" className="text-sm font-medium">
          Puan farkı (delta)
        </label>
        <input
          id="override-delta"
          type="number"
          inputMode="numeric"
          step={1}
          value={pointsDelta}
          onChange={(e) => setPointsDelta(e.target.value)}
          disabled={isPending}
          placeholder="Örn. 20 veya -10"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
        <p className="text-xs text-muted-foreground">
          Sıfır olamaz. Düzeltme, puan defterine ayrı bir kayıt olarak yazılır (defter
          değiştirilmez).
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="override-reason" className="text-sm font-medium">
          Gerekçe
        </label>
        <textarea
          id="override-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isPending}
          minLength={1}
          maxLength={1000}
          rows={3}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="override-second-approver" className="text-sm font-medium">
          İkinci onaylayan
        </label>
        <select
          id="override-second-approver"
          value={secondApproverId}
          onChange={(e) => setSecondApproverId(e.target.value)}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value="">İkinci onaylayan seçin…</option>
          {memberOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          İki kişilik kontrol: ikinci onaylayan senden farklı olmalı ve point.override
          yetkisine sahip olmalıdır (veritabanı doğrular).
        </p>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {done && !error ? (
        <p className="text-sm font-medium text-primary">Puan düzeltmesi uygulandı.</p>
      ) : null}

      <div>
        <ConfirmDialog
          triggerLabel={isPending ? 'Uygulanıyor…' : 'Düzeltmeyi uygula'}
          title="Manuel puan düzeltmesi uygulansın mı?"
          description="İki kişilik onayla puan defterine ayrı bir manuel düzeltme kaydı yazılır. Bu işlem denetim kaydı üretir ve geri alınamaz (düzeltme = ayrı kayıt)."
          confirmLabel="Uygula"
          disabled={!canSubmit}
          onConfirm={handleSubmit}
        />
      </div>

      {/* Hidden submit so screen readers/enter still route through the confirm flow. */}
      <Button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
        Gönder
      </Button>
    </form>
  );
}
