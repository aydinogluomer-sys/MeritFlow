import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/features/shared/empty-state';
import {
  LeaderboardTable,
  type LeaderboardRow,
} from '@/components/features/leaderboard/leaderboard-table';

const pointFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

type LedgerRow = { employee_id: string; points_delta: number };

export default async function LeaderboardPage() {
  // Any authenticated user. RLS enforces privacy: a plain employee only reads their OWN
  // task_approved rows → one aggregated row; managers/HR/admin read their team/org →
  // many rows. We NEVER use adminClient and never fabricate rows we cannot see.
  const supabase = await createClient();
  const user = await getUser();

  const { data, error } = await supabase
    .from('point_ledger')
    .select('employee_id, points_delta')
    .eq('event_type', 'task_approved');

  const ledgerRows = (data ?? []) as LedgerRow[];

  // Aggregate approved points per employee (client-side; RLS already scoped the rows).
  const totals = new Map<string, number>();
  for (const row of ledgerRows) {
    totals.set(
      row.employee_id,
      (totals.get(row.employee_id) ?? 0) + (Number(row.points_delta) || 0),
    );
  }

  const employeeIds = [...totals.keys()];

  // Resolve display names (profiles is RLS-scoped identity).
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

  const rows: LeaderboardRow[] = employeeIds.map((employeeId) => ({
    employeeId,
    name: nameById.get(employeeId) ?? employeeId,
    totalPoints: totals.get(employeeId) ?? 0,
    isSelf: user?.id === employeeId,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Sıralama</h1>
        <p className="text-sm text-muted-foreground">
          Onaylanmış işten kazanılan toplam puanlar. Gizlilik önceliklidir: yalnızca
          görme yetkin olan satırlar gösterilir.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Puan sıralaması</CardTitle>
          <CardDescription>
            Karşılaştırmalı sıralama yalnızca yetkili roller (yönetici/İK) için görünür.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <EmptyState message="Sıralama şu anda gösterilemiyor." />
          ) : rows.length === 0 ? (
            <EmptyState message="Sıralama için henüz puan yok" />
          ) : rows.length === 1 ? (
            // RLS returned only the caller's own aggregate → show own standing only.
            <OwnStanding row={rows[0]!} />
          ) : (
            <LeaderboardTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OwnStanding({ row }: { row: LeaderboardRow }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border p-6">
        <p className="text-xs text-muted-foreground">{row.name}</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {pointFormatter.format(row.totalPoints)} puan
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Yalnızca kendi puan durumun gösteriliyor. Karşılaştırmalı sıralama için ek yetki
        (yönetici/İK) gereklidir.
      </p>
    </div>
  );
}
