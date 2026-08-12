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
import { CheckCircle2, AlertTriangle } from 'lucide-react';

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

  // Role/permission gates. RBAC is DB-derived (AD1); primary_role is only used
  // for labelling. RLS is the ultimate enforcement — these gates are UX only.
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
  let pendingReviewNum = 0;
  if (isManager && orgId) {
    const { count, error } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'submitted');
    pendingReviewNum = error ? 0 : count ?? 0;
    pendingReviewCount = error ? '—' : numberFmt.format(pendingReviewNum);
  }

  // --- HR/Admin card: open disputes + latest bonus period status ---
  let openDisputeCount: string | null = null;
  let openDisputeNum = 0;
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
    openDisputeNum = disputeError ? 0 : count ?? 0;
    openDisputeCount = disputeError ? '—' : numberFmt.format(openDisputeNum);

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

  // --- Status banner (hero): derived from data already fetched. Amber when
  // anything needs attention (pending reviews or open disputes visible to this
  // user); otherwise green. The active period label comes from latestPeriod. ---
  const needsAttention = pendingReviewNum > 0 || openDisputeNum > 0;
  const activePeriodLabel =
    latestPeriod && latestPeriod !== 'error'
      ? `${formatDate(latestPeriod.starts_on)} – ${formatDate(latestPeriod.ends_on)}`
      : null;
  const attentionParts: string[] = [];
  if (pendingReviewNum > 0) {
    attentionParts.push(`Bekleyen onay: ${numberFmt.format(pendingReviewNum)} görev`);
  }
  if (openDisputeNum > 0) {
    attentionParts.push(`Aktif itiraz: ${numberFmt.format(openDisputeNum)}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Pano</h1>
        <p className="text-sm text-muted-foreground">
          Hoş geldin{user?.email ? `, ${user.email}` : ''}.
        </p>
      </div>

      {/* Status banner (hero) — 3B */}
      <div
        className={`animate-slide-up flex items-start gap-3 rounded-lg border p-4 ${
          needsAttention
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-emerald-200 bg-emerald-50 text-emerald-900'
        }`}
        role="status"
      >
        {needsAttention ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
        )}
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">
            {needsAttention
              ? `Dikkat gerekiyor • ${attentionParts.join(' • ')}`
              : 'Tüm sistemler normal'}
          </p>
          <p className="text-xs opacity-80">
            {activePeriodLabel
              ? `Aktif dönem: ${activePeriodLabel}`
              : 'Aktif bonus dönemi bilgisi yok.'}
          </p>
        </div>
      </div>

      {/* KPI grid — 3D: role-gated cards flow into a 2-column grid on desktop */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Employee card — always shown for the signed-in user */}
        <Card className="animate-slide-up" style={{ animationDelay: '0.05s' }}>
          <CardHeader>
            <CardTitle>Puanlarım ve Prim</CardTitle>
            <CardDescription>
              Onaylanmış görevlerden kazanılan toplam puan (puan defteri) ve tahmini prim.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {employeeErrored && totalPoints === null ? (
              <p className="text-sm text-muted-foreground">Şu an gösterilemiyor.</p>
            ) : (
              <>
                <div>
                  <p className="text-3xl font-bold tracking-tight">{totalPoints ?? '—'}</p>
                  <p className="text-sm text-muted-foreground">
                    Onaylanmış görevlerden toplam puan
                  </p>
                </div>
                <div>
                  {estimatedBonus !== null ? (
                    <>
                      <p className="text-3xl font-bold tracking-tight">
                        {estimatedBonus}{' '}
                        <span className="text-base font-normal text-muted-foreground">
                          (tahmini)
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Tahmini prim — kesinleşmiş değildir.
                      </p>
                    </>
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
          <Card className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
            <CardHeader>
              <CardTitle>İnceleme Bekleyen Görevler</CardTitle>
              <CardDescription>
                Ekibinizde onay bekleyen, gönderilmiş görevler (RLS ekibinize göre kısıtlar).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tracking-tight">
                {pendingReviewCount ?? '—'}
              </p>
              <p className="text-sm text-muted-foreground">
                {pendingReviewNum > 0
                  ? 'Görev incelemenizi bekliyor.'
                  : 'İnceleme bekleyen görev yok.'}
              </p>
            </CardContent>
          </Card>
        )}

        {/* HR/Admin card — period.manage or dispute.resolve */}
        {isHrAdmin && (
          <Card className="animate-slide-up" style={{ animationDelay: '0.15s' }}>
            <CardHeader>
              <CardTitle>İtirazlar ve Bonus Dönemi</CardTitle>
              <CardDescription>
                Açık itiraz sayısı ve en güncel bonus döneminin durumu.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <p className="text-3xl font-bold tracking-tight">
                  {openDisputeCount ?? '—'}
                </p>
                <p className="text-sm text-muted-foreground">
                  Açık itirazlar (açık + incelemede)
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Son bonus dönemi</p>
                {latestPeriod === 'error' ? (
                  <p className="text-sm text-muted-foreground">Şu an gösterilemiyor.</p>
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
          <Card className="animate-slide-up" style={{ animationDelay: '0.2s' }}>
            <CardHeader>
              <CardTitle>Son Ödeme Export&apos;u</CardTitle>
              <CardDescription>
                En güncel ödeme export&apos;unun durumu ve tarihi.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {latestExport === 'error' ? (
                <p className="text-sm text-muted-foreground">Şu an gösterilemiyor.</p>
              ) : latestExport ? (
                <>
                  <p className="text-3xl font-bold tracking-tight">{latestExport.status}</p>
                  <p className="text-sm text-muted-foreground">
                    Son export: {formatDate(latestExport.created_at)}
                  </p>
                </>
              ) : (
                <EmptyState message="Henüz export yok." className="p-6" />
              )}
            </CardContent>
          </Card>
        )}

        {/* Auditor card — audit.read (read-only) */}
        {isAuditor && (
          <Card className="animate-slide-up" style={{ animationDelay: '0.25s' }}>
            <CardHeader>
              <CardTitle>Son Denetim Kayıtları</CardTitle>
              <CardDescription>
                Salt okunur özet — en yeni denetim kayıtları (yeniden eskiye).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditRows === 'error' ? (
                <p className="text-sm text-muted-foreground">Şu an gösterilemiyor.</p>
              ) : auditRows && auditRows.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm">
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
    </div>
  );
}
