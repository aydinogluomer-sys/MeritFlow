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
import {
  PeriodDetail,
  type PeriodDetailPool,
  type PeriodDetailRun,
} from '@/components/features/bonus/period-detail';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' });

export default async function BonusPeriodDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await hasPermission('period.manage'))) redirect('/unauthorized');

  const { id } = await params;
  const supabase = await createClient();

  const { data: period, error } = await supabase
    .from('bonus_periods')
    .select('id, period_type, starts_on, ends_on, status')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ErrorState message="Prim dönemi yüklenemedi." />
      </div>
    );
  }

  if (!period) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <EmptyState message="Dönem bulunamadı veya görüntüleme yetkin yok." />
      </div>
    );
  }

  // Active (non-superseded) pool + last calculation run (both RLS-scoped; may be null).
  const [poolRes, runRes] = await Promise.all([
    supabase
      .from('bonus_pools')
      .select('amount_minor, currency, status, t_org, top_up_approved')
      .eq('bonus_period_id', id)
      .neq('status', 'superseded')
      .maybeSingle(),
    supabase
      .from('bonus_calculation_runs')
      .select('id, status, created_at, completed_at')
      .eq('bonus_period_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const pool = (poolRes.data ?? null) as PeriodDetailPool;
  const lastRun = (runRes.data ?? null) as PeriodDetailRun;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {dateFormatter.format(new Date(period.starts_on))} –{' '}
          {dateFormatter.format(new Date(period.ends_on))}
        </h1>
        <Button asChild variant="outline" size="sm">
          <Link href={`/bonus/periods/${period.id}/snapshot`}>Dağıtımı gör</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dönem ve havuz</CardTitle>
          <CardDescription>
            Havuz bilgisi ve son hesaplama durumu. Tehlikeli işlemler onay gerektirir;
            tahakkuk yalnızca onaylı dönemde yapılabilir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PeriodDetail
            periodId={period.id}
            periodStatus={period.status}
            pool={pool}
            lastRun={lastRun}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="self-start px-2">
      <Link href="/bonus/periods">← Dönemlere dön</Link>
    </Button>
  );
}
