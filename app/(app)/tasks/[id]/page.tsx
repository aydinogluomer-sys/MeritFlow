import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import { Badge, type BadgeProps } from '@/components/ui/badge';
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
import { TaskSubmitForm } from '@/components/features/tasks/task-submit-form';

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

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const canSubmit = await hasPermission('task.submit');
  const canReview = await hasPermission('task.review');
  if (!canSubmit && !canReview) redirect('/unauthorized');

  const { id } = await params;
  const user = await getUser();
  const supabase = await createClient();

  const { data: task, error } = await supabase
    .from('tasks')
    .select(
      'id, title, description, status, assigned_to, reviewer_id, complexity, impact, base_points, final_points, created_at, submitted_at, approved_at, employee_note, reviewer_note',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ErrorState message="Görev yüklenemedi." />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <EmptyState message="Görev bulunamadı veya görüntüleme yetkin yok." />
      </div>
    );
  }

  const isAssignee = task.assigned_to === user!.id;
  const canSubmitThis = canSubmit && isAssignee && task.status === 'in_progress';
  const canReviewThis = canReview && task.status === 'submitted';

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{task.title}</h1>
        <Badge variant={STATUS_VARIANTS[task.status] ?? 'outline'}>
          {STATUS_LABELS[task.status] ?? task.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Görev bilgileri</CardTitle>
          <CardDescription>
            Puanlama onaylı işten üretilir; nihai puan onay sonrası kesinleşir.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Field label="Karmaşıklık" value={task.complexity} className="capitalize" />
          <Field label="Etki" value={task.impact} className="capitalize" />
          <Field
            label="Temel puan"
            value={numberFormatter.format(task.base_points)}
          />
          <Field
            label="Nihai puan"
            value={
              task.final_points != null
                ? numberFormatter.format(task.final_points)
                : 'Beklemede'
            }
          />
          <Field
            label="Oluşturulma"
            value={dateFormatter.format(new Date(task.created_at))}
          />
          <Field
            label="Gönderilme"
            value={
              task.submitted_at
                ? dateFormatter.format(new Date(task.submitted_at))
                : '—'
            }
          />
          {task.description ? (
            <div className="sm:col-span-2">
              <Field label="Açıklama" value={task.description} />
            </div>
          ) : null}
          {task.reviewer_note ? (
            <div className="sm:col-span-2">
              <Field label="İnceleyen notu" value={task.reviewer_note} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {canSubmitThis ? (
        <Card>
          <CardHeader>
            <CardTitle>İncelemeye gönder</CardTitle>
            <CardDescription>
              Görevi tamamladıysan incelemeye gönder. Gönderim zamanı puanlamada esas
              alınır.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TaskSubmitForm taskId={task.id} />
          </CardContent>
        </Card>
      ) : null}

      {canReviewThis ? (
        <Card>
          <CardHeader>
            <CardTitle>İnceleme</CardTitle>
            <CardDescription>Bu görev incelemeni bekliyor.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/tasks/${task.id}/review`}>İncelemeye git</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="self-start px-2">
      <Link href="/tasks">← Görevlere dön</Link>
    </Button>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={className}>{value}</span>
    </div>
  );
}
