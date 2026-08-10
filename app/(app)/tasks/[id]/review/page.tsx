import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/features/shared/empty-state';
import { ErrorState } from '@/components/features/shared/error-state';
import { TaskReviewForm } from '@/components/features/tasks/task-review-form';

const numberFormatter = new Intl.NumberFormat('tr-TR');

export default async function TaskReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await hasPermission('task.review'))) redirect('/unauthorized');

  const { id } = await params;
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from('tasks')
    .select('id, title, status, complexity, impact, base_points')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink taskId={id} />
        <ErrorState message="Görev yüklenemedi." />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink taskId={id} />
        <EmptyState message="Görev bulunamadı veya görüntüleme yetkin yok." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink taskId={task.id} />

      <div>
        <h1 className="text-2xl font-semibold">İnceleme</h1>
        <p className="text-sm text-muted-foreground">{task.title}</p>
      </div>

      {task.status !== 'submitted' ? (
        <EmptyState message="Bu görev inceleme için uygun durumda değil (yalnızca gönderilmiş görevler incelenebilir)." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Karar</CardTitle>
            <CardDescription>
              Karar, kalite ve zamanlama puanlamayı belirler. Kalite &apos;zayıf&apos;
              iken onay verilemez (D3). Temel puan:{' '}
              {numberFormatter.format(task.base_points)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TaskReviewForm taskId={task.id} redirectTo={`/tasks/${task.id}`} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BackLink({ taskId }: { taskId: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="self-start px-2">
      <Link href={`/tasks/${taskId}`}>← Göreve dön</Link>
    </Button>
  );
}
