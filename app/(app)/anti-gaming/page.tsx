import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/features/shared/empty-state';
import { ErrorState } from '@/components/features/shared/error-state';
import { ConfirmDialog } from '@/components/features/shared/confirm-dialog';
import { runScan } from '@/app/actions/bonus/run-scan';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const RULE_LABELS: Record<string, string> = {
  duplicate_task: 'Yinelenen görev',
  tiny_task_splitting: 'Küçük parçalara bölme',
  same_reviewer_concentration: 'Aynı inceleyen yoğunluğu',
  period_end_spike: 'Dönem sonu sıçraması',
  self_approval_attempt: 'Kendi kendine onay girişimi',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Açık',
  reviewing: 'İncelemede',
  confirmed: 'Doğrulandı',
  dismissed: 'Reddedildi',
};

const STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  open: 'secondary',
  reviewing: 'outline',
  confirmed: 'destructive',
  dismissed: 'outline',
};

type FlagRow = {
  id: string;
  rule: string;
  subject_employee_id: string;
  status: string;
  created_at: string;
};

/**
 * Inline server action for the "Tarama Başlat" control. Runs the deterministic
 * anti-gaming scan (period optional) and revalidates the page. Throws on failure so the
 * framework surfaces the error; the DB is the authority (period.manage enforced there).
 */
async function startScan() {
  'use server';
  const result = await runScan({});
  if (!result.ok) {
    throw new Error(`Tarama başlatılamadı (${result.error}).`);
  }
  revalidatePath('/anti-gaming');
}

export default async function AntiGamingPage() {
  if (!(await hasPermission('period.manage'))) redirect('/unauthorized');

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('anti_gaming_flags')
    .select('id, rule, subject_employee_id, status, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = (data ?? []) as FlagRow[];

  // Resolve subject display names (profiles is RLS-scoped identity).
  const subjectIds = [...new Set(rows.map((r) => r.subject_employee_id))];
  const nameById = new Map<string, string>();
  if (subjectIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', subjectIds);
    for (const p of (profiles ?? []) as Array<{ id: string; display_name: string }>) {
      nameById.set(p.id, p.display_name);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Kötüye kullanım işaretleri</h1>
          <p className="text-sm text-muted-foreground">
            Deterministik kurallarla üretilen işaretler. İnsan denetimlidir; otomatik ceza
            yoktur (işaret → inceleme → itiraz).
          </p>
        </div>
        <ConfirmDialog
          triggerLabel="Tarama Başlat"
          title="Kötüye kullanım taraması çalıştırılsın mı?"
          description="Deterministik kurallar tüm organizasyon için çalıştırılır ve yeni işaretler üretebilir. İşlem denetim kaydı üretir; otomatik ceza uygulanmaz."
          confirmLabel="Tarama Başlat"
          onConfirm={startScan}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>İşaretler</CardTitle>
          <CardDescription>En yeni 200 işaret (en yeni önce).</CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <ErrorState message="Kötüye kullanım işaretleri yüklenemedi." />
          ) : rows.length === 0 ? (
            <EmptyState message="Henüz işaret yok" />
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Kötüye kullanım işaretleri listesi</caption>
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Tarih
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Kural
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Çalışan
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Durum
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {dateFormatter.format(new Date(row.created_at))}
                      </td>
                      <td className="px-4 py-3">{RULE_LABELS[row.rule] ?? row.rule}</td>
                      <td className="px-4 py-3">
                        {nameById.get(row.subject_employee_id) ?? row.subject_employee_id}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANTS[row.status] ?? 'outline'}>
                          {STATUS_LABELS[row.status] ?? row.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
