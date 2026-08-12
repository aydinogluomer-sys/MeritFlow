import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ErrorState } from '@/components/features/shared/error-state';
import { PeriodList, type PeriodListRow } from '@/components/features/bonus/period-list';
import { PeriodCreateForm } from '@/components/features/bonus/period-create-form';
import {
  PoolCreateForm,
  type PeriodOption,
} from '@/components/features/bonus/pool-create-form';

type PeriodRow = {
  id: string;
  period_type: string;
  starts_on: string;
  ends_on: string;
  status: string;
};

type PoolRow = {
  id: string;
  bonus_period_id: string;
  status: string;
};

export default async function BonusPeriodsPage() {
  const canManagePeriods = await hasPermission('period.manage');
  const canCreatePool = await hasPermission('pool.create');
  if (!canManagePeriods && !canCreatePool) redirect('/unauthorized');

  const supabase = await createClient();

  const [periodsRes, poolsRes] = await Promise.all([
    supabase
      .from('bonus_periods')
      .select('id, period_type, starts_on, ends_on, status')
      .order('starts_on', { ascending: false }),
    // Active (non-superseded) pools; RLS may exclude these for non-HR/Finance roles,
    // in which case "Hesapla" is simply unavailable (poolId stays null).
    supabase
      .from('bonus_pools')
      .select('id, bonus_period_id, status')
      .neq('status', 'superseded'),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Prim dönemleri</h1>
        <p className="text-sm text-muted-foreground">
          Dönem yaşam döngüsü ve prim hesaplaması. Hesaplama kilitli havuz ve onaylı
          puanlardan üretilir; denetlenebilir.
        </p>
      </div>

      {canManagePeriods ? (
        <Card>
          <CardHeader>
            <CardTitle>Yeni dönem</CardTitle>
            <CardDescription>Aylık bir prim dönemi oluştur.</CardDescription>
          </CardHeader>
          <CardContent>
            <PeriodCreateForm />
          </CardContent>
        </Card>
      ) : null}

      {canCreatePool ? (
        <Card>
          <CardHeader>
            <CardTitle>Yeni havuz</CardTitle>
            <CardDescription>Bir dönem için prim havuzu oluştur.</CardDescription>
          </CardHeader>
          <CardContent>
            <PoolCreateForm periodOptions={periodOptions(periodsRes.data ?? [])} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Dönemler</CardTitle>
          <CardDescription>Organizasyonun prim dönemleri.</CardDescription>
        </CardHeader>
        <CardContent>
          {periodsRes.error ? (
            <ErrorState message="Prim dönemleri yüklenemedi." />
          ) : (
            <PeriodList periods={toRows(periodsRes.data ?? [], poolsRes.data ?? [])} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function periodOptions(periods: PeriodRow[]): PeriodOption[] {
  return periods.map((p) => ({
    id: p.id,
    label: `${p.starts_on} → ${p.ends_on} (${p.status})`,
  }));
}

function toRows(periods: PeriodRow[], pools: PoolRow[]): PeriodListRow[] {
  const poolByPeriod = new Map<string, string>();
  for (const pool of pools) {
    // One active pool per period (uq_bonus_pool_active_per_period).
    if (!poolByPeriod.has(pool.bonus_period_id)) {
      poolByPeriod.set(pool.bonus_period_id, pool.id);
    }
  }
  return periods.map((p) => ({
    id: p.id,
    period_type: p.period_type,
    starts_on: p.starts_on,
    ends_on: p.ends_on,
    status: p.status,
    poolId: poolByPeriod.get(p.id) ?? null,
  }));
}
