import { getUser } from '@/lib/auth/session';
import { getActiveOrg } from '@/lib/auth/org';
import { getPermissions } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/features/shared/empty-state';

const numberFmt = new Intl.NumberFormat('tr-TR');
const currencyFmt = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
});
const dateFmt = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : dateFmt.format(parsed);
}

export default async function DashboardPage() {
  const user = await getUser();
  const org = await getActiveOrg();
  const permissions = await getPermissions();
  const supabase = await createClient();

  const orgId = org?.organization_id ?? null;

  // Role/permission gates. RBAC is DB-derived (AD1); primary_role (org.primary_role,
  // shown in the Bağlam card) is only used for labelling. RLS is the ultimate
  // enforcement — these gates are UX only.
  const isManager = permissions.includes('task.review');
  const isHrAdmin =
    permissions.includes('period.manage') || permissions.includes('dispute.resolve');
  const isFinance = permissions.includes('payout.export');
  const isAuditor = permissions.includes('audit.read');

  // --- Employee card: approved-task points + estimated bonus (always shown) ---
  let totalPoints: string | null = null;
  let estimatedBonus: string | null = null;
  let employeeErrored = false;
  if (user?.id && orgId) {
    const { data: ledgerRows, error: ledgerError } = await supabase
      .from('point_ledger')
      .select('points_delta')
      .eq('organization_id', orgId)
      .eq('employee_id', user.id)
      .eq('event_type', 'task_approved');
    if (ledgerError) {
      employeeErrored = true;
    } else {
      const sum = (ledgerRows ?? []).reduce(
        (acc, row) => acc + (row.points_delta ?? 0),
        0,
      );
      totalPoints = numberFmt.format(sum);
    }

    const { data: allocRows, error: allocError } = await supabase
      .from('bonus_allocations')
      .select('final_amount_minor')
      .eq('organization_id', orgId)
      .eq('employee_id', user.id);
    if (allocError) {
      employeeErrored = true;
    } else if (allocRows && allocRows.length > 0) {
      const minor = allocRows.reduce(
        (acc, row) => acc + Number(row.final_amount_minor ?? 0),
        0,
      );
      estimatedBonus = currencyFmt.format(minor / 100);
    }
  }

  // --- Manager card: pending reviews (task.review; RLS scopes to their team) ---
  let pendingReviewCount: string | null = null;
  if (isManager && orgId) {
    const { count, error } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'submitted');
    pendingReviewCount = error ? '—' : numberFmt.format(count ?? 0);
  }

  // --- HR/Admin card: open disputes + latest bonus period status ---
  let openDisputeCount: string | null = null;
  let latestPeriod:
    | { status: string; starts_on: string; ends_on: string }
    | null
    | 'error' = null;
  if (isHrAdmin && orgId) {
    const { count, error: disputeError } = await supabase
      .from('disputes')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['open', 'under_review']);
    openDisputeCount = disputeError ? '—' : numberFmt.format(count ?? 0);

    const { data: periodRow, error: periodError } = await supabase
      .from('bonus_periods')
      .select('status, starts_on, ends_on')
      .eq('organization_id', orgId)
      .order('ends_on', { ascending: false })
      .limit(1)
      .maybeSingle();
    latestPeriod = periodError
      ? 'error'
      : (periodRow as { status: string; starts_on: string; ends_on: string } | null);
  }

  // --- Finance card: latest export status/date ---
  let latestExport:
    | { status: string; created_at: string }
    | null
    | 'error' = null;
  if (isFinance && orgId) {
    const { data: exportRow, error } = await supabase
      .from('exports')
      .select('status, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    latestExport = error
      ? 'error'
      : (exportRow as { status: string; created_at: string } | null);
  }

  // --- Auditor card: last few audit entries (newest first) ---
  let auditRows:
    | { action: string; created_at: string }[]
    | null
    | 'error' = null;
  if (isAuditor && orgId) {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('action, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(5);
    auditRows = error
      ? 'error'
      : ((data ?? []) as { action: string; created_at: string }[]);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Pano</h1>
        <p className="text-sm text-muted-foreground">
          Hoş geldin{user?.email ? `, ${user.email}` : ''}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bağlam</CardTitle>
          <CardDescription>
            Aktif organizasyon ve yetkilerin — DB kaynaklı, JWT claim değil (AD1).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div>
            Organizasyon: <span className="font-mono">{org?.organization_id ?? '—'}</span>
          </div>
          <div>
            Rol: <span className="font-medium">{org?.primary_role ?? '—'}</span>
          </div>
          <div>Yetki sayısı: {permissions.length}</div>
        </CardContent>
      </Card>

      {/* Employee card — always shown for the signed-in user */}
      <Card>
        <CardHeader>
          <CardTitle>Puanlarım ve Prim</CardTitle>
          <CardDescription>
            Onaylanmış görevlerden kazanılan toplam puan (puan defteri) ve tahmini prim.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {employeeErrored && totalPoints === null ? (
            <p className="text-muted-foreground">Şu an gösterilemiyor.</p>
          ) : (
            <>
              <div>
                <div className="text-muted-foreground">Onaylanmış puan</div>
                <p className="text-2xl font-semibold">{totalPoints ?? '—'}</p>
              </div>
              <div>
                <div className="text-muted-foreground">Prim (tahmini)</div>
                {estimatedBonus !== null ? (
                  <p className="text-2xl font-semibold">
                    {estimatedBonus}{' '}
                    <span className="text-sm font-normal text-muted-foreground">
                      (tahmini)
                    </span>
                  </p>
                ) : (
                  <EmptyState message="Henüz tahmini prim yok." className="p-6" />
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Manager card — task.review */}
      {isManager && (
        <Card>
          <CardHeader>
            <CardTitle>İnceleme Bekleyen Görevler</CardTitle>
            <CardDescription>
              Ekibinizde onay bekleyen, gönderilmiş görevler (RLS ekibinize göre kısıtlar).
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="text-2xl font-semibold">
              İnceleme bekleyen görev: {pendingReviewCount ?? '—'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* HR/Admin card — period.manage or dispute.resolve */}
      {isHrAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>İtirazlar ve Bonus Dönemi</CardTitle>
            <CardDescription>
              Açık itiraz sayısı ve en güncel bonus döneminin durumu.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div>
              <div className="text-muted-foreground">
                Açık itirazlar (açık + incelemede)
              </div>
              <p className="text-2xl font-semibold">{openDisputeCount ?? '—'}</p>
            </div>
            <div>
              <div className="text-muted-foreground">Son bonus dönemi</div>
              {latestPeriod === 'error' ? (
                <p className="text-muted-foreground">Şu an gösterilemiyor.</p>
              ) : latestPeriod ? (
                <p className="text-sm">
                  <span className="font-medium">{latestPeriod.status}</span>
                  {' — '}
                  {formatDate(latestPeriod.starts_on)} – {formatDate(latestPeriod.ends_on)}
                </p>
              ) : (
                <EmptyState message="Henüz bonus dönemi yok." className="p-6" />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Finance card — payout.export */}
      {isFinance && (
        <Card>
          <CardHeader>
            <CardTitle>Son Ödeme Export'u</CardTitle>
            <CardDescription>
              En güncel ödeme export'unun durumu ve tarihi.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {latestExport === 'error' ? (
              <p className="text-muted-foreground">Şu an gösterilemiyor.</p>
            ) : latestExport ? (
              <p className="text-sm">
                <span className="font-medium">{latestExport.status}</span>
                {' — '}
                {formatDate(latestExport.created_at)}
              </p>
            ) : (
              <EmptyState message="Henüz export yok." className="p-6" />
            )}
          </CardContent>
        </Card>
      )}

      {/* Auditor card — audit.read (read-only) */}
      {isAuditor && (
        <Card>
          <CardHeader>
            <CardTitle>Son Denetim Kayıtları</CardTitle>
            <CardDescription>
              Salt okunur özet — en yeni denetim kayıtları (yeniden eskiye).
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {auditRows === 'error' ? (
              <p className="text-muted-foreground">Şu an gösterilemiyor.</p>
            ) : auditRows && auditRows.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {auditRows.map((row, i) => (
                  <li
                    key={`${row.created_at}:${i}`}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="font-mono">{row.action}</span>
                    <span className="text-muted-foreground">
                      {formatDate(row.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="Henüz denetim kaydı yok." className="p-6" />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
