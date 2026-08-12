import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { TaskList, type TaskListRow } from '@/components/features/tasks/task-list';
import { ErrorState } from '@/components/features/shared/error-state';
import {
  StatusFilter,
  type StatusFilterOption,
} from '@/components/features/shared/status-filter';

const TASK_COLUMNS = 'id, title, status, complexity, impact, base_points, final_points, created_at';

// URL filter values for "Görevlerim". `all` is the no-filter sentinel.
const STATUS_FILTERS = ['submitted', 'approved', 'rejected', 'all'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_OPTIONS: readonly StatusFilterOption[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'submitted', label: 'Gönderildi' },
  { value: 'approved', label: 'Onaylandı' },
  { value: 'rejected', label: 'Reddedildi' },
];

function normalizeStatus(raw: string | string[] | undefined): StatusFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (STATUS_FILTERS as readonly string[]).includes(value ?? '')
    ? (value as StatusFilter)
    : 'all';
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const canSubmit = await hasPermission('task.submit');
  const canReview = await hasPermission('task.review');
  if (!canSubmit && !canReview) redirect('/unauthorized');

  // Next 16: searchParams is a Promise. The filter narrows the server-side query for
  // "Görevlerim"; the page stays a server component (gate + fetch preserved).
  const status = normalizeStatus((await searchParams).status);

  const user = await getUser();
  const supabase = await createClient();

  // "Görevlerim" — tasks assigned to the current user (RLS-scoped), optionally filtered by
  // status. `all`/absent → no status filter.
  let mineQuery = supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('assigned_to', user!.id);
  if (status !== 'all') {
    mineQuery = mineQuery.eq('status', status);
  }
  const mine = await mineQuery.order('created_at', { ascending: false });

  // "İnceleme Kuyruğu" — submitted tasks awaiting review (only for reviewers). This is a
  // fixed queue (always status = 'submitted') and is not affected by the personal filter.
  const queue = canReview
    ? await supabase
        .from('tasks')
        .select(TASK_COLUMNS)
        .eq('status', 'submitted')
        .order('created_at', { ascending: false })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Görevler</h1>
        <p className="text-sm text-muted-foreground">
          Sana atanan görevler ve incelemeni bekleyen gönderiler.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Görevlerim</CardTitle>
          <CardDescription>Sana atanmış görevler.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <StatusFilter options={FILTER_OPTIONS} ariaLabel="Görev durumu filtresi" />
          {mine.error ? (
            <ErrorState message="Görevlerin yüklenemedi." />
          ) : (
            <TaskList
              tasks={(mine.data ?? []) as TaskListRow[]}
              emptyMessage="Henüz görev yok"
            />
          )}
        </CardContent>
      </Card>

      {canReview ? (
        <Card>
          <CardHeader>
            <CardTitle>İnceleme Kuyruğu</CardTitle>
            <CardDescription>İncelemeni bekleyen gönderilmiş görevler.</CardDescription>
          </CardHeader>
          <CardContent>
            {queue?.error ? (
              <ErrorState message="İnceleme kuyruğu yüklenemedi." />
            ) : (
              <TaskList
                tasks={(queue?.data ?? []) as TaskListRow[]}
                emptyMessage="İncelenecek görev yok"
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
