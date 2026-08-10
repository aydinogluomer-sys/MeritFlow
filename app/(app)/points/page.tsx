import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ErrorState } from '@/components/features/shared/error-state';
import {
  PointLedgerTable,
  type PointLedgerRow,
} from '@/components/features/points/point-ledger-table';
import type { ScoringMetadata } from '@/components/features/points/point-breakdown';

const pointFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

type RawLedgerRow = {
  id: string;
  event_type: string;
  points_delta: number;
  reason: string;
  created_at: string;
  metadata: ScoringMetadata;
};

export default async function PointsPage() {
  // Any authenticated user: RLS returns the caller's own point_ledger rows (plus
  // manager/HR/admin-visible rows, but this page is framed as "my points").
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('point_ledger')
    .select('id, event_type, points_delta, reason, created_at, metadata')
    .order('created_at', { ascending: false });

  const rows = (data ?? []) as RawLedgerRow[];
  const total = rows.reduce((sum, r) => sum + (Number(r.points_delta) || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Puanlarım</h1>
        <p className="text-sm text-muted-foreground">
          Onaylanmış işten kazanılan puanlar ve düzeltmeler. Her satır için &quot;neden
          bu puan?&quot; açıklaması görülebilir.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Toplam puan</CardTitle>
          <CardDescription>Puan defterindeki satırların toplamı.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold tabular-nums">
            {pointFormatter.format(total)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Puan defteri</CardTitle>
          <CardDescription>Değiştirilemez, yalnızca eklenebilir kayıt.</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message="Puan defteri yüklenemedi." />
          ) : (
            <PointLedgerTable rows={rows as PointLedgerRow[]} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
