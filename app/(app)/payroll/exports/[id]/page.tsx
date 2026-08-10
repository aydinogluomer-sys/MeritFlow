import Link from 'next/link';
import { redirect } from 'next/navigation';
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
import { MarkPaidButton } from '@/components/features/payroll/mark-paid-button';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const EXPORT_STATUS_LABELS: Record<string, string> = {
  requested: 'Talep edildi',
  generated: 'Üretildi',
  downloaded: 'İndirildi',
  failed: 'Başarısız',
};

const PAYOUT_STATUS_LABELS: Record<string, string> = {
  paid: 'Ödendi',
  accrued: 'Tahakkuk etti',
};

const PAYOUT_STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  paid: 'default',
  accrued: 'secondary',
};

type ExportDetail = {
  id: string;
  bonus_period_id: string;
  format: string;
  status: string;
  row_count: number | null;
  created_at: string;
};

type PayoutRow = {
  employee_id: string;
  display_name: string | null;
  final_amount_minor: number;
  paid_amount_minor: number;
  status: string;
  paid_at: string | null;
};

export default async function PayrollExportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await hasPermission('payout.export'))) redirect('/unauthorized');

  const { id } = await params;
  const supabase = await createClient();

  const { data: exportRow, error } = await supabase
    .from('exports')
    .select('id, bonus_period_id, format, status, row_count, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <ErrorState message="Dışa aktarım yüklenemedi." />
      </div>
    );
  }

  if (!exportRow) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        <EmptyState message="Dışa aktarım bulunamadı veya görüntüleme yetkin yok." />
      </div>
    );
  }

  const exp = exportRow as ExportDetail;

  // v_finance_payout is security_invoker → read via the RLS-scoped createClient(), NOT
  // adminClient. It has no export_id; filter by the export's bonus_period_id.
  const { data: payoutData, error: payoutError } = await supabase
    .from('v_finance_payout')
    .select('employee_id, display_name, final_amount_minor, paid_amount_minor, status, paid_at')
    .eq('bonus_period_id', exp.bonus_period_id)
    .order('final_amount_minor', { ascending: false });

  const payoutRows = (payoutData ?? []) as PayoutRow[];

  const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });
  const totalFinal = payoutRows.reduce((sum, r) => sum + r.final_amount_minor, 0);
  const totalPaid = payoutRows.reduce((sum, r) => sum + r.paid_amount_minor, 0);
  const anyPaid = payoutRows.some((r) => r.paid_amount_minor > 0);

  // Mark-paid is meaningful only for a period still 'exported' (RPC requires it) and not
  // already paid. We surface the control; the RPC is the authority (idempotent).
  const canMarkPaid = exp.status !== 'failed' && !anyPaid;

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Ödeme dışa aktarımı</h1>
        <Badge variant="outline">
          {EXPORT_STATUS_LABELS[exp.status] ?? exp.status}
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dışa aktarım bilgileri</CardTitle>
          <CardDescription>Değişmez anlık görüntüden üretilen finansal iz.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <Field label="Biçim" value={exp.format.toUpperCase()} />
          <Field
            label="Oluşturulma"
            value={dateFormatter.format(new Date(exp.created_at))}
          />
          <Field
            label="Satır sayısı"
            value={
              exp.row_count != null
                ? new Intl.NumberFormat('tr-TR').format(exp.row_count)
                : '—'
            }
          />
          <Field label="Durum" value={EXPORT_STATUS_LABELS[exp.status] ?? exp.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ödeme özeti</CardTitle>
          <CardDescription>
            Bu döneme ait çalışan bazlı net tahakkuk ve ödenen tutarlar
            (v_finance_payout). Ham puan / kalite / cap gösterilmez.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payoutError ? (
            <ErrorState message="Ödeme özeti yüklenemedi." />
          ) : payoutRows.length === 0 ? (
            <EmptyState message="Bu dönem için ödeme satırı bulunamadı." />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Ödeme özeti</caption>
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-4 py-3 font-medium">
                        Çalışan
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Net tahakkuk
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Ödenen
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Durum
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutRows.map((row) => (
                      <tr
                        key={row.employee_id}
                        className="border-b last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-4 py-3">
                          {row.display_name ?? row.employee_id}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {money.format(row.final_amount_minor / 100)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {money.format(row.paid_amount_minor / 100)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={PAYOUT_STATUS_VARIANTS[row.status] ?? 'outline'}
                          >
                            {PAYOUT_STATUS_LABELS[row.status] ?? row.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/30 font-medium">
                      <td className="px-4 py-3">Toplam</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money.format(totalFinal / 100)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {money.format(totalPaid / 100)}
                      </td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tfoot>
                </table>
              </div>
              {!anyPaid ? (
                <p className="text-xs text-muted-foreground">
                  Tutarlar ödeme yapılana kadar tahminidir (tahmini ≠ hak edilmiş).
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ödeme</CardTitle>
          <CardDescription>
            Ödeme yapıldığında prim defterine kayıt yazılır ve dönem kapanır. İşlem
            değişmezdir ve dönem başına tek seferdir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {anyPaid ? (
            <p className="text-sm text-muted-foreground">
              Bu dönem için ödeme zaten işaretlenmiş.
            </p>
          ) : (
            <MarkPaidButton
              periodId={exp.bonus_period_id}
              exportId={exp.id}
              disabled={!canMarkPaid}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="self-start px-2">
      <Link href="/payroll/exports">← Dışa aktarımlara dön</Link>
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
