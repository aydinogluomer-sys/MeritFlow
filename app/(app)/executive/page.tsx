import { redirect } from 'next/navigation';
import { hasPermission, getPermissions } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { getUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { logError } from '@/lib/logger';
import {
  FeatureFlagResolver,
  executeSemanticQuery,
  IntelligenceRepository,
  availableDrillLevels,
  type SemanticQueryContext,
  type StoredInsight,
} from '@/modules/intelligence';
import { IncentiveHealthRepository } from '@/modules/incentive-health';
import { runReconciliation, ReconciliationRepository } from '@/modules/reconciliation';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { MetricCard, ChartFrame, TrendChart, InsightCard, DeltaBadge, type MetricStatus, type TrendPoint } from '@/components/intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import { DrillPanel } from '@/components/features/executive/drill-panel';
import {
  readOrgMetric,
  formatMetric,
  changesFrom,
  attentionInsights,
  criticalExceptionCount,
} from '@/components/features/executive/model';

type Client = SupabaseClient<Database>;
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
async function safe<T>(p: PromiseLike<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    // A genuine read error (DB/RLS failure) degrades that card to an honest "unavailable" state —
    // but is NOT silently swallowed: log it for observability (RLS-empty reads do not throw here).
    logError('[executive] dashboard source read failed', { details: { err: String(err) } });
    return null;
  }
}

// Deterministic Level-1 payout forecast (§10.13): Known = net accrued this period; Projected = the
// remaining distributable headroom; Forecast = Known + Projected. NO statistical band (that is P8).
// v_finance_period_totals is finance/auditor-scoped (SI-12) → non-finance callers see no row → null.
async function loadForecast(supabase: Client, orgId: string): Promise<{ known: number; forecast: number } | null> {
  const { data: period } = await supabase
    .from('bonus_periods')
    .select('id')
    .eq('organization_id', orgId)
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!period) return null;
  const { data: totals } = await supabase
    .from('v_finance_period_totals')
    .select('total_accrued, distributable')
    .eq('bonus_period_id', (period as { id: string }).id)
    .maybeSingle();
  if (!totals) return null;
  const known = num((totals as { total_accrued: number | null }).total_accrued);
  const projectedRemaining = Math.max(0, num((totals as { distributable: number | null }).distributable) - known);
  return { known, forecast: known + projectedRemaining };
}

// Ordered payout trend for the TrendChart + the payout card sparkline. payout_total is finance/auditor
// -scoped (v_finance_payout, SI-12) → non-finance callers get an empty series (honest, not fabricated).
async function loadPayoutTrend(supabase: Client, ctx: SemanticQueryContext, orgId: string): Promise<TrendPoint[]> {
  const { data: periods } = await supabase
    .from('bonus_periods')
    .select('id, starts_on')
    .eq('organization_id', orgId)
    .order('starts_on', { ascending: true });
  const ordered = ((periods ?? []) as Array<{ id: string; starts_on: string }>).slice(-6);
  if (ordered.length === 0) return [];
  const outcome = await executeSemanticQuery(supabase, ctx, {
    metrics: ['payout_total'],
    dimensions: ['bonus_period'],
    filters: [],
    period: { kind: 'relative', trailing: 'trailing_6' },
  });
  const byPeriod = new Map<string, number>();
  if (outcome.ok) {
    const mqr = outcome.metrics.find((m) => m.metricId === 'payout_total');
    for (const r of mqr?.results ?? []) {
      const pid = r.dimensions.bonus_period;
      if (pid && typeof r.value === 'number') byPeriod.set(pid, r.value);
    }
  }
  // RLS scoped the caller out (no rows) → return an EMPTY series so the caller renders an honest
  // "unavailable" state — NOT a fabricated flat-zero line (SI-12 honesty). Finance/auditor get the
  // real series (a period with genuinely no payout keeps its real 0).
  if (byPeriod.size === 0) return [];
  return ordered.map((p) => ({ label: p.starts_on.slice(0, 7), value: Math.round((byPeriod.get(p.id) ?? 0) / 100) }));
}

/** A card whose metric the caller's role/RLS scoped out — honest, never a fabricated 0. */
function UnavailableCard({ label, note }: { label: string; note: string }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <EmptyState message={note} />
      </CardContent>
    </Card>
  );
}

const UNAVAILABLE = 'Bu görünüm için veri yok veya yetkiniz kapsamında değil.';

export default async function ExecutiveOverviewPage() {
  if (!(await hasPermission('intelligence.read'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');
  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('intelligence'))) redirect('/unauthorized');

  const perms = await getPermissions();
  const user = await getUser();
  const ctx: SemanticQueryContext = { organizationId: org.organization_id, permissions: perms, role: org.primary_role };
  const canReadLedger = org.primary_role === 'finance' || org.primary_role === 'auditor';

  const [main, insights, disputeRes, forecast, health, recon, payoutTrend] = await Promise.all([
    safe(
      executeSemanticQuery(supabase, ctx, {
        metrics: ['cycle_completion_rate', 'budget_variance', 'payout_total'],
        dimensions: [],
        filters: [],
        period: { kind: 'relative', trailing: 'current' },
        comparison: { basis: 'previous_period' },
      }),
    ),
    safe(new IntelligenceRepository(supabase).list(org.organization_id, {})),
    safe(
      supabase
        .from('disputes')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.organization_id)
        .in('status', ['open', 'under_review', 'needs_info']),
    ),
    safe(loadForecast(supabase, org.organization_id)),
    safe(new IncentiveHealthRepository(supabase).list(org.organization_id)),
    canReadLedger && user
      ? safe(runReconciliation({ organizationId: org.organization_id, userId: user.id }, new ReconciliationRepository(supabase)))
      : Promise.resolve(null),
    safe(loadPayoutTrend(supabase, ctx, org.organization_id)),
  ]);

  const insightList: StoredInsight[] = insights ?? [];
  const cycle = main ? readOrgMetric(main, 'cycle_completion_rate') : null;
  const budget = main ? readOrgMetric(main, 'budget_variance') : null;
  const payout = main ? readOrgMetric(main, 'payout_total') : null;
  const disputeCount = disputeRes && !disputeRes.error ? (disputeRes.count ?? 0) : null;
  const exceptionCount = criticalExceptionCount(insightList);
  const latestHealth = (health ?? [])[0] ?? null;
  const attention = attentionInsights(insightList).slice(0, 6);

  const changes = changesFrom([
    { label: 'Döngü tamamlama', reading: cycle, unit: '%', higherIsBetter: true },
    { label: 'Bütçe sapması', reading: budget, unit: '%', higherIsBetter: false },
    { label: 'Toplam ödeme', reading: payout, unit: '₺', higherIsBetter: true },
  ]);

  const payoutSparkline = payoutTrend && payoutTrend.some((p) => p.value > 0) ? payoutTrend.map((p) => p.value) : undefined;
  const payoutDrillLevels = availableDrillLevels('payout_total');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Yönetici Bakışı</h1>
        <p className="text-sm text-muted-foreground">
          Dönemin sağlık, ödeme ve risk özeti — her kart deterministik bir kaynağa dayanır; yetkiniz
          kapsamı dışındaki kartlar boş gösterilir (uydurma değer yoktur). Projeksiyon deterministiktir;
          istatistiksel aralık ilerideki bir faza ertelenmiştir.
        </p>
      </div>

      {/* Above-the-fold cards (§10.2) */}
      <section aria-label="Özet kartlar" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cycle ? (
          <MetricCard
            label="Döngü Sağlığı"
            value={formatMetric(cycle.value, cycle.unit).display}
            unit={formatMetric(cycle.value, cycle.unit).suffix}
            delta={cycle.delta}
            deltaUnit="%"
            definition="Bu dönemde sonuçlanan görevlerin onaylanma oranı."
          />
        ) : (
          <UnavailableCard label="Döngü Sağlığı" note={UNAVAILABLE} />
        )}

        {forecast ? (
          <MetricCard
            label="Ödeme Projeksiyonu"
            value={formatMetric(forecast.forecast, 'minor_currency').display}
            unit="₺"
            definition="Deterministik: bilinen tahakkuk + kalan dağıtılabilir başlık (istatistiksel aralık P8)."
            baseline={`Bilinen: ${formatMetric(forecast.known, 'minor_currency').display} ₺`}
            trend={payoutSparkline}
          />
        ) : (
          <UnavailableCard label="Ödeme Projeksiyonu" note={UNAVAILABLE} />
        )}

        {budget ? (
          <MetricCard
            label="Bütçe Sapması"
            value={formatMetric(budget.value, budget.unit).display}
            unit={formatMetric(budget.value, budget.unit).suffix}
            delta={budget.delta}
            deltaUnit="%"
            deltaHigherIsBetter={false}
            definition="(Tahakkuk − havuz) / havuz. Pozitif = havuzun üstünde."
          />
        ) : (
          <UnavailableCard label="Bütçe Sapması" note={UNAVAILABLE} />
        )}

        <MetricCard
          label="Kritik İstisnalar"
          value={exceptionCount}
          status={(exceptionCount > 0 ? 'critical' : 'ok') as MetricStatus}
          definition="Sonlanmamış, kritik önem taşıyan içgörü/bayrak sayısı (İstisna Merkezi henüz yok)."
        />

        {disputeCount !== null ? (
          <MetricCard
            label="Açık İtirazlar"
            value={disputeCount}
            definition="Açık / incelemede / bilgi bekleyen itiraz sayısı."
          />
        ) : (
          <UnavailableCard label="Açık İtirazlar" note={UNAVAILABLE} />
        )}

        {latestHealth ? (
          <MetricCard
            label="Politika Sağlığı"
            value={formatMetric(latestHealth.overallScore, 'score').display}
            unit="/100"
            definition="En güncel teşvik-sağlığı değerlendirmesinin genel skoru (şeffaf ağırlıklı bileşke)."
          />
        ) : (
          <UnavailableCard label="Politika Sağlığı" note={UNAVAILABLE} />
        )}

        {recon ? (
          <MetricCard
            label="Mutabakat Durumu"
            value={recon.findingCount}
            status={
              (recon.findings.some((f) => f.severity === 'critical')
                ? 'critical'
                : recon.findingCount > 0
                  ? 'warning'
                  : 'ok') as MetricStatus
            }
            definition="Finansal değişmezlik denetiminin bulgu sayısı (salt-okuma doğrulayıcı)."
          />
        ) : (
          <UnavailableCard
            label="Mutabakat Durumu"
            note={canReadLedger ? UNAVAILABLE : 'Mutabakat yalnızca Finans/Denetçi rolüne görünür (SI-12).'}
          />
        )}
      </section>

      {/* Payout trend (charting system introduced here) + permission-aware drill (§10.10/§10.16) */}
      <ChartFrame
        question="Ödemeler son dönemlerde nasıl değişti?"
        metricDefinition="payout_total (v_finance_payout üzerinden net tahakkuk, ₺) — dönem bazında."
        filters={['Metrik: payout_total', 'Pencere: son 6 dönem']}
        drill={<DrillPanel metric="payout_total" metricLabel="Toplam ödeme" levels={payoutDrillLevels} />}
      >
        {payoutTrend && payoutTrend.length > 0 ? (
          <TrendChart data={payoutTrend} valueLabel="Toplam ödeme" unit="₺" caption="Dönem bazında toplam ödeme (₺)" />
        ) : (
          <EmptyState message="Ödeme eğilimi için veri yok veya yetkiniz kapsamında değil (SI-12)." />
        )}
      </ChartFrame>

      {/* What changed? (§10.2) */}
      <Card>
        <CardHeader>
          <CardTitle>Ne değişti?</CardTitle>
          <CardDescription>Önceki döneme göre en belirgin değişimler.</CardDescription>
        </CardHeader>
        <CardContent>
          {changes.length === 0 ? (
            <EmptyState message="Önceki döneme göre belirgin bir değişiklik yok." />
          ) : (
            <ul className="flex flex-col gap-2">
              {changes.map((c) => (
                <li key={c.label} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{c.label}</span>
                  <DeltaBadge value={c.delta} unit={c.unit} higherIsBetter={c.higherIsBetter} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Requires attention (§10.2) */}
      <Card>
        <CardHeader>
          <CardTitle>İnceleme gerektirenler</CardTitle>
          <CardDescription>Sonlanmamış, uyarı/kritik içgörüler (önem sırasına göre).</CardDescription>
        </CardHeader>
        <CardContent>
          {attention.length === 0 ? (
            <EmptyState message="İnceleme gerektiren açık bulgu yok." />
          ) : (
            <ul className="flex flex-col gap-3">
              {attention.map((i) => (
                <li key={i.id}>
                  <InsightCard
                    headline={i.headline}
                    severity={i.severity}
                    evidence={i.evidence}
                    actions={i.suggestedActions.map((a) => ({ code: a.code, label: a.label }))}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
