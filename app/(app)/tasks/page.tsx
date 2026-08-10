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

const TASK_COLUMNS = 'id, title, status, complexity, impact, base_points, final_points, created_at';

export default async function TasksPage() {
  const canSubmit = await hasPermission('task.submit');
  const canReview = await hasPermission('task.review');
  if (!canSubmit && !canReview) redirect('/unauthorized');

  const user = await getUser();
  const supabase = await createClient();

  // "Görevlerim" — tasks assigned to the current user (RLS-scoped).
  const mine = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('assigned_to', user!.id)
    .order('created_at', { ascending: false });

  // "İnceleme Kuyruğu" — submitted tasks awaiting review (only for reviewers).
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
        <CardContent>
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
