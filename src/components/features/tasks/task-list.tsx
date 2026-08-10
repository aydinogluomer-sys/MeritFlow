import Link from 'next/link';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';

/** Subset of `tasks` columns used by the list view (RLS-scoped select). */
export type TaskListRow = {
  id: string;
  title: string;
  status: string;
  complexity: string;
  impact: string;
  base_points: number;
  final_points: number | null;
  created_at: string;
};

const numberFormatter = new Intl.NumberFormat('tr-TR');
const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  assigned: 'Atandı',
  in_progress: 'Devam ediyor',
  submitted: 'Gönderildi',
  needs_revision: 'Revizyon gerekli',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  cancelled: 'İptal edildi',
  archived: 'Arşivlendi',
};

const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  approved: 'default',
  submitted: 'secondary',
  in_progress: 'secondary',
  needs_revision: 'outline',
  rejected: 'destructive',
  cancelled: 'outline',
  draft: 'outline',
  assigned: 'outline',
  archived: 'outline',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export interface TaskListProps {
  tasks: TaskListRow[];
  emptyMessage?: string;
}

/**
 * Plain Tailwind table of tasks (no TanStack Table dependency). Presentational and
 * server-renderable. Renders an {@link EmptyState} when there are no rows.
 */
export function TaskList({ tasks, emptyMessage = 'Henüz görev yok' }: TaskListProps) {
  if (tasks.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Görev listesi</caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Başlık
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Durum
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Karmaşıklık
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Etki
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Puan
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Oluşturulma
            </th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3">
                <Link
                  href={`/tasks/${task.id}`}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {task.title}
                </Link>
              </td>
              <td className="px-4 py-3">
                <Badge variant={STATUS_VARIANTS[task.status] ?? 'outline'}>
                  {statusLabel(task.status)}
                </Badge>
              </td>
              <td className="px-4 py-3 capitalize">{task.complexity}</td>
              <td className="px-4 py-3 capitalize">{task.impact}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {task.final_points != null
                  ? numberFormatter.format(task.final_points)
                  : `~${numberFormatter.format(task.base_points)}`}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {dateFormatter.format(new Date(task.created_at))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
