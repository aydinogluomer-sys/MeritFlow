import { redirect } from 'next/navigation';
import { hasPermission, getPermissions } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
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
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  MetricCard,
  ChartFrame,
  TrendChart,
  DistributionChart,
  InsightCard,
  DeltaBadge,
  type MetricStatus,
  type TrendPoint,
} from '@/components/intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import { DrillPanel } from '@/components/features/executive/drill-panel';
import {
  readOrgMetric,
  formatMetric,
  changesFrom,
  attentionInsights,
  criticalExceptionCount,
  insightBreakdown,
  anchoredMetricPeriod,
  DEFERRED_OPS_CARDS,
} from '@/components/features/operations/model';

type Client = SupabaseClient<Database>;

async function safe<T>(p: PromiseLike<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    logError('[operations] dashboard source read failed', { details: { err: String(err) } });
    return null;
  }
}

// The newest bonus_period id (the "current" period). We anchor the metric bundle to it because a
// previous-period COMPARISON is only executable against a bonus_period selector — the service rejects
// comparison on a relative selector (comparison_not_executable) and fails the WHOLE query.
async function currentPeriodId(supabase: Client, orgId: string): Promise<string | null> {
  const { data } = await supabase
    .from('bonus_periods')
    .select('id')
    .eq('organization_id', orgId)
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

// Approval-latency trend over the last 6 periods. approval_latency is NOT servable by bonus_period (its
// executor serves org/team/task_type), so we read it PER PERIOD (each period's own [start,end] window).
// A period with no data (uncalculated / RLS-scoped) is OMITTED — never plotted as a fabricated 0 (§23).
async function loadLatencyTrend(supabase: Client, ctx: SemanticQueryContext, orgId: string): Promise<TrendPoint[]> {
  const { data: periods } = await supabase
    .from('bonus_periods')
    .select('id, starts_on')
    .eq('organization_id', orgId)
    .order('starts_on', { ascending: true });
  const ordered = ((periods ?? []) as Array<{ id: string; starts_on: string }>).slice(-6);
  if (ordered.length === 0) return [];

  const outcomes = await Promise.all(
    ordered.map((p) =>
      safe(
        executeSemanticQuery(supabase, ctx, {
          metrics: ['approval_latency'],
          dimensions: [],
          filters: [],
          period: { kind: 'bonus_period', bonusPeriodId: p.id },
        }),
      ),
    ),
  );

  const points: TrendPoint[] = [];
  ordered.forEach((p, i) => {
    const outcome = outcomes[i];
    const reading = outcome ? readOrgMetric(outcome, 'approval_latency') : null;
    if (reading) points.push({ label: p.starts_on.slice(0, 7), value: Math.round(reading.value / 1000) }); // ms → sn
  });
  return points;
}

const UNAVAILABLE = 'Bu görünüm için veri yok veya yetkiniz kapsamında değil.';

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

export default async function OperationsIntelligencePage() {
  if (!(await hasPermission('intelligence.read'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');
  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('intelligence'))) redirect('/unauthorized');

  const perms = await getPermissions();
  const ctx: SemanticQueryContext = { organizationId: org.organization_id, permissions: perms, role: org.primary_role };

  // Anchor to the current bonus_period so previous-period comparison is executable (a relative selector
  // makes "previous" ambiguous → the service rejects the whole query). No period yet → run WITHOUT
  // comparison (the metrics still resolve org-level; "Ne değişti?" simply shows no deltas).
  const periodId = await currentPeriodId(supabase, org.organization_id);

  const [main, insights, latencyTrend] = await Promise.all([
    // Operations process signals — none are role-gated (RLS scopes the rows); one bundle. A role scoped
    // out yields an empty result → readOrgMetric → null → honest UnavailableCard, never a fake 0.
    safe(
      executeSemanticQuery(supabase, ctx, {
        metrics: ['cycle_completion_rate', 'approval_latency', 'manual_override_rate', 'gaming_flag_rate', 'dispute_rate'],
        dimensions: [],
        filters: [],
        ...anchoredMetricPeriod(periodId),
      }),
    ),
    safe(new IntelligenceRepository(supabase).list(org.organization_id, {})),
    safe(loadLatencyTrend(supabase, ctx, org.organization_id)),
  ]);

  const insightsAvailable = insights !== null;
  const insightList: StoredInsight[] = insights ?? [];
  const cycle = main ? readOrgMetric(main, 'cycle_completion_rate') : null;
  const latency = main ? readOrgMetric(main, 'approval_latency') : null;
  const manualOverride = main ? readOrgMetric(main, 'manual_override_rate') : null;
  const gamingFlag = main ? readOrgMetric(main, 'gaming_flag_rate') : null;
  const disputeRate = main ? readOrgMetric(main, 'dispute_rate') : null;

  const attention = attentionInsights(insightList);
  const exceptionVolume = attention.length;
  const criticalCount = criticalExceptionCount(insightList);
  const exceptionStatus: MetricStatus = criticalCount > 0 ? 'critical' : exceptionVolume > 0 ? 'warning' : 'ok';
  const breakdown = insightBreakdown(insightList);

  const changes = changesFrom([
    { label: 'Döngü tamamlama', reading: cycle, unit: '%', higherIsBetter: true },
    // approval_latency delta is in ms (duration_ms) — convert to seconds so it agrees with the 'sn' unit
    // (mirrors the ms→sn conversion the Onay Gecikmesi card does), never a 1000× overstated figure.
    {
      label: 'Onay gecikmesi',
      reading: latency ? { ...latency, delta: latency.delta !== undefined ? Math.round(latency.delta / 1000) : undefined } : null,
      unit: 'sn',
      higherIsBetter: false,
    },
    { label: 'Manuel müdahale', reading: manualOverride, unit: '%', higherIsBetter: false },
    { label: 'Oyunlaştırma bayrağı', reading: gamingFlag, unit: '%', higherIsBetter: false },
    { label: 'İtiraz oranı', reading: disputeRate, unit: '%', higherIsBetter: false },
  ]);

  const latencyDrillLevels = availableDrillLevels('approval_latency');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Operasyon Zekası</h1>
        <p className="text-sm text-muted-foreground">
          Sürecin sağlık ve verimlilik sinyalleri — döngü, onay gecikmesi, manuel müdahale ve istisna
          hacmi. Tüm göstergeler <strong>toplu süreç sinyalidir</strong> (kişi bazlı gözetim yoktur);
          yetkiniz kapsamı dışındaki kartlar boş gösterilir (uydurma değer yoktur).
        </p>
      </div>

      {/* Operations signal cards (§10.8 / §10.3) */}
      <section aria-label="Operasyon göstergeleri" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cycle ? (
          <MetricCard
            label="Döngü Sağlığı"
            value={formatMetric(cycle.value, cycle.unit).display}
            unit={formatMetric(cycle.value, cycle.unit).suffix}
            delta={cycle.delta}
            deltaUnit="%"
            definition="Bu dönemde sonuçlanan görevlerin onaylanma oranı (döngü tamamlama)."
          />
        ) : (
          <UnavailableCard label="Döngü Sağlığı" note={UNAVAILABLE} />
        )}

        {latency ? (
          <MetricCard
            label="Onay Gecikmesi"
            value={formatMetric(latency.value, latency.unit).display}
            unit={formatMetric(latency.value, latency.unit).suffix}
            delta={latency.delta !== undefined ? Math.round(latency.delta / 1000) : undefined}
            deltaUnit="sn"
            deltaHigherIsBetter={false}
            definition="Gönderimden onaya medyan süre (submitted_at → approved_at)."
          />
        ) : (
          <UnavailableCard label="Onay Gecikmesi" note={UNAVAILABLE} />
        )}

        {manualOverride ? (
          <MetricCard
            label="Manuel Müdahale"
            value={formatMetric(manualOverride.value, manualOverride.unit).display}
            unit={formatMetric(manualOverride.value, manualOverride.unit).suffix}
            delta={manualOverride.delta}
            deltaUnit="%"
            deltaHigherIsBetter={false}
            definition="Puan girişlerinde manuel düzeltme oranı (manuel / (task_approved + manuel))."
          />
        ) : (
          <UnavailableCard label="Manuel Müdahale" note={UNAVAILABLE} />
        )}

        {gamingFlag ? (
          <MetricCard
            label="Oyunlaştırma Bayrağı"
            value={formatMetric(gamingFlag.value, gamingFlag.unit).display}
            unit={formatMetric(gamingFlag.value, gamingFlag.unit).suffix}
            delta={gamingFlag.delta}
            deltaUnit="%"
            deltaHigherIsBetter={false}
            definition="Doğrulanmış anti-gaming bayrağı olan çalışan oranı (toplu; kişi bazlı değil)."
          />
        ) : (
          <UnavailableCard label="Oyunlaştırma Bayrağı" note={UNAVAILABLE} />
        )}

        {disputeRate ? (
          <MetricCard
            label="İtiraz Oranı"
            value={formatMetric(disputeRate.value, disputeRate.unit).display}
            unit={formatMetric(disputeRate.value, disputeRate.unit).suffix}
            delta={disputeRate.delta}
            deltaUnit="%"
            deltaHigherIsBetter={false}
            definition="Dönemde açılan itiraz / puanlanan çalışan nüfusu."
          />
        ) : (
          <UnavailableCard label="İtiraz Oranı" note={UNAVAILABLE} />
        )}

        {insightsAvailable ? (
          <MetricCard
            label="İstisna Hacmi"
            value={exceptionVolume}
            status={exceptionStatus}
            definition="Sonlanmamış, uyarı/kritik içgörü sayısı (açık istisna hacmi)."
          />
        ) : (
          // The insight-store read genuinely FAILED (null) — show unavailable, not a fabricated 0 (SI-12).
          <UnavailableCard label="İstisna Hacmi" note={UNAVAILABLE} />
        )}
      </section>

      {/* Approval-latency trend + permission-aware drill (§10.10 / §10.16) — org → team (never employee) */}
      <ChartFrame
        question="Onay gecikmesi son dönemlerde nasıl değişti?"
        metricDefinition="approval_latency: gönderimden onaya medyan süre (sn) — dönem bazında."
        filters={['Metrik: approval_latency', 'Pencere: son 6 dönem']}
        drill={<DrillPanel metric="approval_latency" metricLabel="Onay gecikmesi" levels={latencyDrillLevels} />}
      >
        {latencyTrend && latencyTrend.length > 0 ? (
          <TrendChart data={latencyTrend} valueLabel="Onay gecikmesi" unit="sn" caption="Dönem bazında onay gecikmesi (sn)" />
        ) : (
          <EmptyState message={UNAVAILABLE} />
        )}
      </ChartFrame>

      {/* Open-exception breakdown by insight type (§10.16) — existing insight-store source, RLS-scoped */}
      <ChartFrame
        question="Açık istisnalar hangi türlerde yoğunlaşıyor?"
        metricDefinition="Sonlanmamış uyarı/kritik içgörüler, içgörü türüne göre sayı (intelligence_insights)."
        filters={['Durum: sonlanmamış', 'Önem: uyarı/kritik']}
      >
        {breakdown.length > 0 ? (
          <DistributionChart data={breakdown} countLabel="İçgörü" caption="Açık istisna türü dağılımı (adet)" />
        ) : (
          <EmptyState message="İnceleme gerektiren açık istisna yok." />
        )}
      </ChartFrame>

      {/* What changed? (§10.2 pattern) */}
      <Card>
        <CardHeader>
          <CardTitle>Ne değişti?</CardTitle>
          <CardDescription>Önceki döneme göre en belirgin operasyonel değişimler.</CardDescription>
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

      {/* Requires attention (§10.2 pattern) */}
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
              {attention.slice(0, 6).map((i) => (
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

      {/* Deferred §10.8 items — honest "not yet available", NOT fabricated (§23) */}
      <Card>
        <CardHeader>
          <CardTitle>Henüz mevcut olmayan operasyon kartları</CardTitle>
          <CardDescription>
            Bu kartlar için kayıtlı bir metrik / SI-12-güvenli kaynak yoktur — uydurma sayı gösterilmez
            (§23). “Yönetim Eforu Tasarrufu” için §10.8: metodoloji tanımlanmadan kazanılan-saat iddiası yok.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {DEFERRED_OPS_CARDS.map((c) => (
              <li key={c.label} className="rounded-md border border-dashed p-3">
                <div className="text-sm font-medium">{c.label}</div>
                <div className="text-xs text-muted-foreground">{c.reason}</div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
