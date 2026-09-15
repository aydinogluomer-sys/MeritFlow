import { redirect } from 'next/navigation';
import { hasPermission, getPermissions } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { FeatureFlagResolver, executeSemanticQuery, availableDrillLevels, type SemanticQueryContext } from '@/modules/intelligence';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { logError } from '@/lib/logger';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { MetricCard, ChartFrame, TrendChart, WaterfallChart, DistributionChart, type TrendPoint } from '@/components/intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import { DrillPanel } from '@/components/features/executive/drill-panel';
import {
  readOrgMetric,
  formatMetric,
  deriveRollup,
  financialWaterfall,
  binPayouts,
  anchoredMetricPeriod,
  DEFERRED_MONEY_CARDS,
  type PeriodTotals,
  type FinancialRollup,
} from '@/components/features/financial/model';
import type { DistributionBin } from '@/components/intelligence';

type Client = SupabaseClient<Database>;
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
async function safe<T>(p: PromiseLike<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    logError('[financial] dashboard source read failed', { details: { err: String(err) } });
    return null;
  }
}

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

// Sanctioned SI-12-safe read of the finance roll-up view (security_invoker → finance/auditor only).
async function loadPeriodTotals(supabase: Client, periodId: string): Promise<PeriodTotals | null> {
  const { data } = await supabase
    .from('v_finance_period_totals')
    .select('pool_amount, distributable, total_accrued, total_paid, undistributed_remainder')
    .eq('bonus_period_id', periodId)
    .maybeSingle();
  return (data as PeriodTotals | null) ?? null;
}

// Accrual trend over the last 6 periods. RLS-denied (non-finance) → empty series → honest EmptyState
// (SI-12; NOT a fabricated flat-zero line — mirrors the 8-B1 payout-trend fix).
async function loadAccrualTrend(supabase: Client, orgId: string): Promise<TrendPoint[]> {
  const { data: periods } = await supabase
    .from('bonus_periods')
    .select('id, starts_on')
    .eq('organization_id', orgId)
    .order('starts_on', { ascending: true });
  const ordered = ((periods ?? []) as Array<{ id: string; starts_on: string }>).slice(-6);
  if (ordered.length === 0) return [];
  const { data: rows } = await supabase
    .from('v_finance_period_totals')
    .select('bonus_period_id, total_accrued')
    .in('bonus_period_id', ordered.map((p) => p.id));
  const byPeriod = new Map<string, number>();
  for (const r of (rows ?? []) as Array<{ bonus_period_id: string | null; total_accrued: number | null }>) {
    if (r.bonus_period_id) byPeriod.set(r.bonus_period_id, num(r.total_accrued));
  }
  if (byPeriod.size === 0) return [];
  // Plot ONLY periods that have a real finance-totals row — omit gaps (uncalculated / RLS-scoped)
  // rather than fill them with a fabricated ₺0 (§23 / SI-12). All-empty → [] → honest EmptyState.
  return ordered
    .filter((p) => byPeriod.has(p.id))
    .map((p) => ({ label: p.starts_on.slice(0, 7), value: Math.round(byPeriod.get(p.id)! / 100) }));
}

async function loadConcentration(supabase: Client, periodId: string): Promise<DistributionBin[]> {
  const { data } = await supabase.from('v_finance_payout').select('final_amount_minor').eq('bonus_period_id', periodId);
  const amounts = ((data ?? []) as Array<{ final_amount_minor: number | null }>).map((r) => num(r.final_amount_minor));
  return binPayouts(amounts);
}

const UNAVAILABLE = 'Bu görünüm için veri yok veya yetkiniz kapsamında değil (SI-12: finansal veriler yalnızca Finans/Denetçi).';

function MoneyCard({ label, minor, definition }: { label: string; minor: number; definition: string }) {
  const fmt = formatMetric(minor, 'minor_currency');
  return <MetricCard label={label} value={fmt.display} unit={fmt.suffix} definition={definition} />;
}
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

export default async function FinancialIntelligencePage() {
  if (!(await hasPermission('intelligence.read'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');
  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('intelligence'))) redirect('/unauthorized');

  const perms = await getPermissions();
  const ctx: SemanticQueryContext = { organizationId: org.organization_id, permissions: perms, role: org.primary_role };
  const periodId = await currentPeriodId(supabase, org.organization_id);

  const [financeMetrics, capMetric, moneyMetrics, totals, accrualTrend, concentration] = await Promise.all([
    // Finance metrics bundle (NOT role-gated — RLS scopes v_finance; a non-finance role gets empty).
    safe(
      executeSemanticQuery(supabase, ctx, {
        metrics: ['payout_total', 'budget_variance', 'payout_concentration'],
        dimensions: [],
        filters: [],
        // Anchor to the current bonus_period so previous-period comparison is executable (the service
        // rejects comparison on a relative selector → whole-query ok:false). No period → no comparison.
        ...anchoredMetricPeriod(periodId),
      }),
    ),
    // cap_hit_rate is role-gated (HR/Auditor) — query it SEPARATELY so its reject doesn't poison the bundle.
    safe(
      executeSemanticQuery(supabase, ctx, {
        metrics: ['cap_hit_rate'],
        dimensions: [],
        filters: [],
        period: { kind: 'relative', trailing: 'current' },
      }),
    ),
    // Money-delta metrics (0050/0051 views) are role-gated {hr,finance,auditor} — query them in an
    // ISOLATED bundle so a non-authorized role's reject (metric_not_available_for_role) → null → honest
    // UnavailableCard, never a fabricated ₺0 (SI-12/§23). All four share the same gate (all-or-nothing).
    safe(
      executeSemanticQuery(supabase, ctx, {
        metrics: ['cap_money_impact', 'team_cost', 'cost_per_employee', 'dispute_financial_impact'],
        dimensions: [],
        filters: [],
        period: { kind: 'relative', trailing: 'current' },
      }),
    ),
    periodId ? safe(loadPeriodTotals(supabase, periodId)) : Promise.resolve(null),
    safe(loadAccrualTrend(supabase, org.organization_id)),
    periodId ? safe(loadConcentration(supabase, periodId)) : Promise.resolve<DistributionBin[]>([]),
  ]);

  const payout = financeMetrics ? readOrgMetric(financeMetrics, 'payout_total') : null;
  const budget = financeMetrics ? readOrgMetric(financeMetrics, 'budget_variance') : null;
  const concentrationScore = financeMetrics ? readOrgMetric(financeMetrics, 'payout_concentration') : null;
  const capHit = capMetric ? readOrgMetric(capMetric, 'cap_hit_rate') : null;
  const capMoneyImpact = moneyMetrics ? readOrgMetric(moneyMetrics, 'cap_money_impact') : null;
  const teamCost = moneyMetrics ? readOrgMetric(moneyMetrics, 'team_cost') : null;
  const costPerEmployee = moneyMetrics ? readOrgMetric(moneyMetrics, 'cost_per_employee') : null;
  const disputeFinancialImpact = moneyMetrics ? readOrgMetric(moneyMetrics, 'dispute_financial_impact') : null;
  const rollup: FinancialRollup | null = deriveRollup(totals);
  const waterfall = financialWaterfall(rollup);
  const payoutDrillLevels = availableDrillLevels('payout_total');
  const teamCostDrillLevels = availableDrillLevels('team_cost');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Finansal Zeka</h1>
        <p className="text-sm text-muted-foreground">
          Dönemin havuz/tahakkuk/ödeme finansal özeti — tüm para verileri yalnızca finans görünümlerinden
          (v_finance_*) gelir (SI-12); ham puan/ücret hiçbir yerde okunmaz. Yetkiniz kapsamı dışındaki
          kartlar boş gösterilir (uydurma değer yoktur). Projeksiyon deterministiktir.
        </p>
      </div>

      {/* Pool & distribution roll-up (v_finance_period_totals) + registered finance metrics */}
      <section aria-label="Havuz ve dağıtım" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {payout ? (
          <MetricCard
            label="Toplam Ödeme"
            value={formatMetric(payout.value, payout.unit).display}
            unit={formatMetric(payout.value, payout.unit).suffix}
            delta={payout.delta}
            definition="Dönemin net tahakkuk ödemesi (v_finance_payout toplamı)."
          />
        ) : (
          <UnavailableCard label="Toplam Ödeme" note={UNAVAILABLE} />
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
        {rollup ? (
          <MetricCard
            label="Havuz Kullanımı"
            value={rollup.poolUtilizationPct === null ? '—' : formatMetric(rollup.poolUtilizationPct, 'percent').display}
            unit={rollup.poolUtilizationPct === null ? undefined : '%'}
            definition="Tahakkuk / havuz. Havuzun ne kadarının tahakkuk ettiği."
          />
        ) : (
          <UnavailableCard label="Havuz Kullanımı" note={UNAVAILABLE} />
        )}
        {concentrationScore ? (
          <MetricCard
            label="Ödeme Yoğunlaşması"
            value={formatMetric(concentrationScore.value, concentrationScore.unit).display}
            definition="HHI (0–1). Yüksek = ödemeler az kişide yoğunlaşıyor."
          />
        ) : (
          <UnavailableCard label="Ödeme Yoğunlaşması" note={UNAVAILABLE} />
        )}
        {rollup ? <MoneyCard label="Havuz" minor={rollup.pool} definition="Dönem bonus havuzu (kilitli)." /> : <UnavailableCard label="Havuz" note={UNAVAILABLE} />}
        {rollup ? <MoneyCard label="Tahakkuk" minor={rollup.accrued} definition="Net tahakkuk (kazanılmış)." /> : <UnavailableCard label="Tahakkuk" note={UNAVAILABLE} />}
        {rollup ? <MoneyCard label="Ödenen" minor={rollup.paid} definition="Şimdiye kadar ödenen tutar." /> : <UnavailableCard label="Ödenen" note={UNAVAILABLE} />}
        {rollup ? <MoneyCard label="Bekleyen" minor={rollup.outstanding} definition="Tahakkuk edip henüz ödenmeyen (tahakkuk − ödenen)." /> : <UnavailableCard label="Bekleyen" note={UNAVAILABLE} />}
        {rollup ? <MoneyCard label="Dağıtılmamış" minor={rollup.undistributed} definition="Havuzdan dağıtılmayan kalan (D6 cap artığı dâhil)." /> : <UnavailableCard label="Dağıtılmamış" note={UNAVAILABLE} />}
        {capHit ? (
          <MetricCard
            label="Cap-Hit Oranı"
            value={formatMetric(capHit.value, capHit.unit).display}
            unit={formatMetric(capHit.value, capHit.unit).suffix}
            definition="Cap uygulanan tahsis oranı (yönetişim; İK/Denetçi görünümü)."
          />
        ) : (
          <UnavailableCard label="Cap-Hit Oranı" note="Bu kart İK/Denetçi rolüne görünür (bonus_allocations RLS, SI-12)." />
        )}
      </section>

      {/* Money-delta cards (§10.4 iii) — LIVE via the 0050 (8-B3) + 0051 (dispute) finance views. Role-gated
          {hr,finance,auditor}; a non-authorized role → honest UnavailableCard, never a fake 0 (SI-12/§23). */}
      <section aria-label="Para etkisi" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {capMoneyImpact ? (
          <MoneyCard
            label="Cap Para Etkisi"
            minor={capMoneyImpact.value}
            definition="Σ(cap öncesi pay − cap sonrası tutar) — cap ile kesilen para (snapshot takımı, AD9)."
          />
        ) : (
          <UnavailableCard label="Cap Para Etkisi" note={UNAVAILABLE} />
        )}
        {teamCost ? (
          <MoneyCard
            label="Takım Maliyeti"
            minor={teamCost.value}
            definition="Takım başına net tahakkuk (snapshot takımı, AD9) — Σ takım maliyeti payout_total ile mutabık."
          />
        ) : (
          <UnavailableCard label="Takım Maliyeti" note={UNAVAILABLE} />
        )}
        {costPerEmployee ? (
          <MoneyCard
            label="Çalışan Başına Maliyet"
            minor={costPerEmployee.value}
            definition="Net tahakkuk / aktif çalışan sayısı (dönem). Kişi başı ortalama gider."
          />
        ) : (
          <UnavailableCard label="Çalışan Başına Maliyet" note={UNAVAILABLE} />
        )}
        {disputeFinancialImpact ? (
          <MoneyCard
            label="İtiraz Finansal Etkisi"
            minor={disputeFinancialImpact.value}
            definition="İtiraz yeniden hesaplamalarının döneme NET para etkisi (yeniden tahakkuk − geri alınan tahakkuk). DÖNEM düzeyinde (itiraz başına değil); NET (brüt geri alma değil)."
          />
        ) : (
          <UnavailableCard label="İtiraz Finansal Etkisi" note={UNAVAILABLE} />
        )}
      </section>

      {/* Money-flow waterfall (§10.16) — reconciles by construction: havuz → tahakkuk → ödenen */}
      <ChartFrame
        question="Havuz nasıl dağıldı (havuz → tahakkuk → ödenen)?"
        metricDefinition="v_finance_period_totals: Havuz − Dağıtılmayan = Tahakkuk; Tahakkuk − Bekleyen = Ödenen."
        filters={['Dönem: güncel']}
      >
        {waterfall.length > 0 ? (
          <WaterfallChart data={waterfall} valueLabel="Yürüyen toplam" unit="₺" caption="Dönem para akışı (havuz → ödenen)" />
        ) : (
          <EmptyState message={UNAVAILABLE} />
        )}
      </ChartFrame>

      {/* Accrual trend + permission-aware drill on payout_total (§10.10) */}
      <ChartFrame
        question="Tahakkuk son dönemlerde nasıl değişti?"
        metricDefinition="v_finance_period_totals.total_accrued (₺) — dönem bazında."
        filters={['Pencere: son 6 dönem']}
        drill={<DrillPanel metric="payout_total" metricLabel="Toplam ödeme" levels={payoutDrillLevels} />}
      >
        {accrualTrend && accrualTrend.length > 0 ? (
          <TrendChart data={accrualTrend} valueLabel="Tahakkuk" unit="₺" caption="Dönem bazında tahakkuk (₺)" />
        ) : (
          <EmptyState message={UNAVAILABLE} />
        )}
      </ChartFrame>

      {/* Payout concentration distribution (pairs with the HHI score) */}
      <ChartFrame
        question="Ödemeler çalışanlar arasında nasıl dağılıyor?"
        metricDefinition="v_finance_payout: çalışan başına net ödeme (₺) aralıklara bölünmüş."
        filters={['Dönem: güncel']}
      >
        {concentration && concentration.length > 0 ? (
          <DistributionChart data={concentration} countLabel="Çalışan" caption="Ödeme dağılımı (çalışan sayısı)" />
        ) : (
          <EmptyState message={UNAVAILABLE} />
        )}
      </ChartFrame>

      {/* Per-team cost drill (§10.10) — permission-aware: drillMetricAction re-validates the
          {hr,finance,auditor} gate + RLS server-side; team = the FROZEN AD9 snapshot team. Shown only
          when the org-level team_cost is itself readable (else the drill would have nothing to offer). */}
      {teamCost ? (
        <Card>
          <CardHeader>
            <CardTitle>Takım maliyeti kırılımı</CardTitle>
            <CardDescription>
              Maliyet hangi takımlarda yoğunlaşıyor? v_finance_team_cost: takım (snapshot, AD9) başına net
              tahakkuk (₺). İncele → takım kırılımı (yetki server-side + RLS ile doğrulanır; kapsam dışı rol
              için detay gelmez — SI-12).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DrillPanel metric="team_cost" metricLabel="Takım maliyeti" levels={teamCostDrillLevels} />
          </CardContent>
        </Card>
      ) : null}

      {/* Still-deferred money-delta card (§10.4 iii) — honest, NOT fabricated (§23) */}
      <Card>
        <CardHeader>
          <CardTitle>Ertelenen para etkisi kartı (henüz mevcut değil)</CardTitle>
          <CardDescription>
            Cap Para Etkisi / Takım Maliyeti / Çalışan Başına Maliyet 8-B3 ile, İtiraz Finansal Etkisi ise
            0051 ile canlıya alındı (yukarıda). Kalan tek kart — Düzeltme Para Etkisi — için SI-12-güvenli bir
            para kaynağı yoktur: point_ledger düzeltmeleri paradan çok PUAN’dır ve tek bir düzeltmenin para
            etkisi ancak tam bir yeniden hesaplamayla ortaya çıkar (izole edilemez) — ertelenmiştir. Uydurma
            sayı yok (§23).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {DEFERRED_MONEY_CARDS.map((c) => (
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
