'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';
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
  const [done, setDone] = React.useState(false);

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await submitTask({ taskId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <Button type="button" onClick={handleSubmit} disabled={isPending}>
        {isPending ? 'Gönderiliyor…' : 'İncelemeye gönder'}
      </Button>
      {error ? <ErrorState message={`Görev gönderilemedi (${error}).`} /> : null}
      {done && !error ? (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="flex items-center gap-2 text-sm font-medium text-primary"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          İncelemeye gönderildi.
        </motion.div>
      ) : null}
    </div>
  );
}
