'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorState } from '@/components/features/shared/error-state';
import { createTask } from '@/app/actions/tasks/create-task';

export type TeamOption = { id: string; label: string };
export type AssigneeOption = { id: string; label: string };

type Complexity = 'low' | 'medium' | 'high' | 'critical';
type Impact = 'low' | 'medium' | 'high' | 'strategic';

const COMPLEXITY_OPTIONS: ReadonlyArray<{ value: Complexity; label: string }> = [
  { value: 'low', label: 'Düşük' },
  { value: 'medium', label: 'Orta' },
  { value: 'high', label: 'Yüksek' },
  { value: 'critical', label: 'Kritik' },
];

const IMPACT_OPTIONS: ReadonlyArray<{ value: Impact; label: string }> = [
  { value: 'low', label: 'Düşük' },
  { value: 'medium', label: 'Orta' },
  { value: 'high', label: 'Yüksek' },
  { value: 'strategic', label: 'Stratejik' },
];

const SELECT_CLASS =
  'h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

export interface TaskCreateFormProps {
  teamOptions: TeamOption[];
  assigneeOptions: AssigneeOption[];
  /** Whether the caller may assign to someone else (task.assign). */
  canAssign: boolean;
}

/**
 * Create a new task (and optionally assign it). Team + assignee come from RLS-scoped org
 * data. The server action re-checks task.create (+ task.assign when assigned) and RLS is
 * the ultimate guard; this form only collects. On success: toast + router.refresh().
 */
export function TaskCreateForm({ teamOptions, assigneeOptions, canAssign }: TaskCreateFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [title, setTitle] = React.useState('');
  const [teamId, setTeamId] = React.useState(teamOptions[0]?.id ?? '');
  const [assignedTo, setAssignedTo] = React.useState('');
  const [complexity, setComplexity] = React.useState<Complexity>('medium');
  const [impact, setImpact] = React.useState<Impact>('medium');
  const [basePoints, setBasePoints] = React.useState('10');
  const [dueDate, setDueDate] = React.useState('');

  const parsedBase = basePoints.trim() === '' ? NaN : Number(basePoints);

  const validate = (): string | null => {
    if (title.trim().length < 1) return 'Başlık zorunludur.';
    if (!teamId) return 'Lütfen bir takım seçin.';
    if (!Number.isInteger(parsedBase) || parsedBase < 0) {
      return 'Temel puan negatif olmayan bir tam sayı olmalıdır.';
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
      const result = await createTask({
        title: title.trim(),
        teamId,
        complexity,
        impact,
        basePoints: parsedBase,
        ...(assignedTo ? { assignedTo } : {}),
        ...(dueDate ? { dueDate } : {}),
      });
      if (!result.ok) {
        setError(`Görev oluşturulamadı (${result.error}).`);
        toast.error(`Görev oluşturulamadı (${result.error}).`);
        return;
      }
      toast.success('Görev oluşturuldu.');
      setTitle('');
      setAssignedTo('');
      setBasePoints('10');
      setDueDate('');
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" aria-busy={isPending}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="task-title">Başlık</Label>
        <Input
          id="task-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isPending}
          maxLength={200}
          placeholder="Görev başlığı"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="task-team">Takım</Label>
        <select
          id="task-team"
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          disabled={isPending}
          className={SELECT_CLASS}
        >
          <option value="">Takım seçin…</option>
          {teamOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {canAssign ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="task-assignee">Atanan (opsiyonel)</Label>
          <select
            id="task-assignee"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            disabled={isPending}
            className={SELECT_CLASS}
          >
            <option value="">Bana ata</option>
            {assigneeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="task-complexity">Karmaşıklık</Label>
        <select
          id="task-complexity"
          value={complexity}
          onChange={(e) => setComplexity(e.target.value as Complexity)}
          disabled={isPending}
          className={SELECT_CLASS}
        >
          {COMPLEXITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="task-impact">Etki</Label>
        <select
          id="task-impact"
          value={impact}
          onChange={(e) => setImpact(e.target.value as Impact)}
          disabled={isPending}
          className={SELECT_CLASS}
        >
          {IMPACT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="task-base-points">Temel puan</Label>
        <Input
          id="task-base-points"
          type="number"
          inputMode="numeric"
          step={1}
          min={0}
          value={basePoints}
          onChange={(e) => setBasePoints(e.target.value)}
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="task-due-date">Termin (opsiyonel)</Label>
        <Input
          id="task-due-date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          disabled={isPending}
        />
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Oluşturuluyor…' : 'Görev oluştur'}
        </Button>
      </div>
    </form>
  );
}
