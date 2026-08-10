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
  AllocationSnapshotTable,
  type AllocationRow,
} from '@/components/features/bonus/allocation-snapshot-table';
import type { AllocationFactors } from '@/components/features/bonus/bonus-breakdown';

type RawAllocation = {
  id: string;
  employee_id: string;
  adjusted_score: number;
  final_amount_minor: number;
  cap_minor: number | null;
  cap_applied: string;
  factors: AllocationFactors | null;
  status: string;
};

export default async function BonusSnapshotPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await hasPermission('period.manage'))) redirect('/unauthorized');

  const { id } = await params;
  const supabase = await createClient();

  const { data: period, error: periodError } = await supabase
    .from('bonus_periods')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (periodError) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink periodId={id} />
        <ErrorState message="Prim dönemi yüklenemedi." />
      </div>
    );
  }

  if (!period) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink periodId={id} />
        <EmptyState message="Dönem bulunamadı veya görüntüleme yetkin yok." />
      </div>
    );
  }

  // The period's completed run (allocations belong to it). RLS may restrict runs to
  // HR/Finance/Auditor; when it is not visible, treat as "no completed run yet".
  const { data: run, error: runError } = await supabase
    .from('bonus_calculation_runs')
    .select('id')
    .eq('bonus_period_id', id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Currency comes from the pool; fetch the active pool separately (defensive default TRY).
  const { data: pool } = await supabase
    .from('bonus_pools')
    .select('currency')
    .eq('bonus_period_id', id)
    .neq('status', 'superseded')
    .maybeSingle();
  const currency = (pool?.currency as string | undefined) ?? 'TRY';

  const body = await (async () => {
    if (runError) return <ErrorState message="Hesaplama çalışması yüklenemedi." />;
    if (!run) {
      return (
        <EmptyState message="Bu dönem için tamamlanmış bir hesaplama çalışması yok." />
      );
    }

    const { data: rawAllocations, error: allocError } = await supabase
      .from('bonus_allocations')
      .select(
        'id, employee_id, adjusted_score, final_amount_minor, cap_minor, cap_applied, factors, status',
      )
      .eq('calculation_run_id', run.id)
      .order('final_amount_minor', { ascending: false });

    if (allocError) {
      return <ErrorState message="Dağıtım satırları yüklenemedi." />;
    }

    const allocations = (rawAllocations ?? []) as RawAllocation[];

    // Resolve employee display names (profiles is global identity; RLS-scoped read).
    const employeeIds = [...new Set(allocations.map((a) => a.employee_id))];
    const nameById = new Map<string, string>();
    if (employeeIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', employeeIds);
      for (const p of (profiles ?? []) as Array<{ id: string; display_name: string }>) {
        nameById.set(p.id, p.display_name);
      }
    }

    const rows: AllocationRow[] = allocations.map((a) => ({
      id: a.id,
      employee_id: a.employee_id,
      employeeName: nameById.get(a.employee_id) ?? null,
      adjusted_score: a.adjusted_score,
      final_amount_minor: a.final_amount_minor,
      cap_minor: a.cap_minor,
      cap_applied: a.cap_applied,
      factors: a.factors,
      status: a.status,
    }));

    return <AllocationSnapshotTable allocations={rows} currency={currency} />;
  })();

  return (
    <div className="flex flex-col gap-6">
      <BackLink periodId={id} />

      <div>
        <h1 className="text-2xl font-semibold">Prim dağıtımı</h1>
        <p className="text-sm text-muted-foreground">
          Çalışan bazlı dağıtım ve &quot;neden bu prim?&quot; açıklaması. Tutarlar
          tahakkuk edilene kadar <strong>tahminidir</strong> (tahmini ≠ hak edilmiş).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dağıtım satırları</CardTitle>
          <CardDescription>
            Tamamlanmış hesaplama çalışmasının çıktısıdır; anlık görüntü değişmezdir.
          </CardDescription>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    </div>
  );
}

function BackLink({ periodId }: { periodId: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="self-start px-2">
      <Link href={`/bonus/periods/${periodId}`}>← Döneme dön</Link>
    </Button>
  );
}
