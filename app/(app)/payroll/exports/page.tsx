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
import { ExportList, type ExportListRow } from '@/components/features/payroll/export-list';
import {
  ExportGenerator,
  type ExportPeriodOption,
  type ExportSnapshotOption,
} from '@/components/features/payroll/export-generator';

const periodDateFormatter = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium' });
const snapshotDateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

type ExportRow = {
  id: string;
  format: string;
  status: string;
  row_count: number | null;
  created_at: string;
};

type ApprovedPeriodRow = { id: string; starts_on: string; ends_on: string };

type SnapshotRow = {
  id: string;
  bonus_period_id: string;
  created_at: string;
  approved_at: string | null;
};

export default async function PayrollExportsPage() {
  if (!(await hasPermission('payout.export'))) redirect('/unauthorized');

  const supabase = await createClient();

  // Existing export records (RLS: Finance/Auditor). Newest first.
  const { data: exportsData, error: exportsError } = await supabase
    .from('exports')
    .select('id, format, status, row_count, created_at')
    .order('created_at', { ascending: false });

  // Approved periods that can be exported (produce_payout_export requires status='approved').
  const { data: periodsData } = await supabase
    .from('bonus_periods')
    .select('id, starts_on, ends_on')
    .eq('status', 'approved')
    .order('starts_on', { ascending: false });

  const approvedPeriods = (periodsData ?? []) as ApprovedPeriodRow[];
  const periodOptions: ExportPeriodOption[] = approvedPeriods.map((p) => ({
    id: p.id,
    label: `${periodDateFormatter.format(new Date(p.starts_on))} – ${periodDateFormatter.format(
      new Date(p.ends_on),
    )}`,
  }));

  // Approved snapshots (of completed runs) for those periods. bonus_allocation_snapshots
  // has no status column — an "approved" snapshot is one with approved_at set; if none in
  // the org carry approvals yet, fall back to any snapshot of an approved period's run.
  let snapshotOptions: ExportSnapshotOption[] = [];
  const periodIds = approvedPeriods.map((p) => p.id);
  if (periodIds.length > 0) {
    const { data: snapshotsData } = await supabase
      .from('bonus_allocation_snapshots')
      .select('id, bonus_period_id, created_at, approved_at')
      .in('bonus_period_id', periodIds)
      .order('created_at', { ascending: false });

    const snapshots = (snapshotsData ?? []) as SnapshotRow[];
    const approvedOnly = snapshots.filter((s) => s.approved_at != null);
    const usable = approvedOnly.length > 0 ? approvedOnly : snapshots;

    snapshotOptions = usable.map((s) => ({
      id: s.id,
      periodId: s.bonus_period_id,
      label: `Anlık görüntü · ${snapshotDateFormatter.format(new Date(s.created_at))}`,
    }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Ödeme dışa aktarımları</h1>
        <p className="text-sm text-muted-foreground">
          Dışa aktarım yalnızca değişmez onaylı anlık görüntüden üretilir; kayıtlar
          kalıcıdır ve denetlenebilir.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Yeni dışa aktarım</CardTitle>
          <CardDescription>
            Onaylı bir dönem ve onun tamamlanmış çalışmasına ait onaylı anlık görüntüyü
            seçip biçimi belirleyin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ExportGenerator periodOptions={periodOptions} snapshotOptions={snapshotOptions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dışa aktarım kayıtları</CardTitle>
          <CardDescription>Organizasyonun ödeme dışa aktarım izi.</CardDescription>
        </CardHeader>
        <CardContent>
          {exportsError ? (
            <ErrorState message="Dışa aktarım kayıtları yüklenemedi." />
          ) : (
            <ExportList exports={(exportsData ?? []) as ExportListRow[]} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
