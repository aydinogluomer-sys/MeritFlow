'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/features/shared/empty-state';
import { statusBadgeClass } from '@/components/features/shared/status-badge';

/** TableRow's own class string, replicated so `motion.tr` matches the styled rows. */
const ROW_CLASS = 'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted';
/** Only the first rows animate; later rows render as plain TableRow (perf guard). */
const ANIMATED_ROW_LIMIT = 10;

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
    return <EmptyState message={emptyMessage} icon={ClipboardList} />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableCaption className="sr-only">Görev listesi</TableCaption>
        <TableHeader>
          <TableRow className="bg-muted/50 text-xs text-muted-foreground">
            <TableHead>Başlık</TableHead>
            <TableHead>Durum</TableHead>
            <TableHead>Karmaşıklık</TableHead>
            <TableHead>Etki</TableHead>
            <TableHead className="text-right">Puan</TableHead>
            <TableHead>Oluşturulma</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task, index) => {
            const cells = (
              <>
                <TableCell>
                  <Link
                    href={`/tasks/${task.id}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {task.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusBadgeClass(task.status)}>
                    {statusLabel(task.status)}
                  </Badge>
                </TableCell>
                <TableCell className="capitalize">{task.complexity}</TableCell>
                <TableCell className="capitalize">{task.impact}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {task.final_points != null
                    ? numberFormatter.format(task.final_points)
                    : `~${numberFormatter.format(task.base_points)}`}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {dateFormatter.format(new Date(task.created_at))}
                </TableCell>
              </>
            );

            // Perf guard: animate only the first ~10 rows; the rest render plainly.
            if (index >= ANIMATED_ROW_LIMIT) {
              return <TableRow key={task.id}>{cells}</TableRow>;
            }

            return (
              <motion.tr
                key={task.id}
                className={ROW_CLASS}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.04, duration: 0.2 }}
              >
                {cells}
              </motion.tr>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
