'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { submitTask } from '@/app/actions/tasks/submit-task';

export interface TaskSubmitFormProps {
  taskId: string;
}

/**
 * Submit a task for review (in_progress → submitted). Calls the 8-B `submitTask`
 * action, which returns an `ActionResult`; on failure the domain error is surfaced.
 */
export function TaskSubmitForm({ taskId }: TaskSubmitFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitTask({ taskId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Button type="button" onClick={handleSubmit} disabled={isPending}>
        {isPending ? 'Gönderiliyor…' : 'İncelemeye gönder'}
      </Button>
      {error ? <ErrorState message={`Görev gönderilemedi (${error}).`} /> : null}
    </div>
  );
}
