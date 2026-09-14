import Link from 'next/link';
import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { logError } from '@/lib/logger';
import { FeatureFlagResolver } from '@/modules/intelligence';
import {
  IncentiveHealthRepository,
  getHealthComparison,
  HEALTH_RULE_SET_VERSION,
  type HealthComparison,
} from '@/modules/incentive-health';
import { getPolicyComplexityTrend, type VersionTrendEntry } from '@/modules/policy-complexity';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.generated';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { ChartFrame, TrendChart, DeltaBadge } from '@/components/intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import { comparisonRows, complexityTrendPoints, formatScore } from '@/components/features/policy-intelligence/model';

type Client = SupabaseClient<Database>;

async function safe<T>(p: PromiseLike<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    logError('[policy-intelligence] dashboard source read failed', { details: { err: String(err) } });
    return null;
  }
}

interface Anchor {
  policyId: string;
  policyName: string;
  anchorVersionId: string;
  anchorVersionNo: number;
}

// Resolve the DEFAULT policy + anchor version: the scoring policy of the freshest health-v1 evaluation
// (mirrors the /policy-health detail page's "latest evaluated version" anchor). RLS scopes every read →
// a caller without policy visibility sees no evaluation → null → honest "not yet evaluated" state.
async function resolveAnchor(supabase: Client, orgId: string): Promise<Anchor | null> {
  const evals = await new IncentiveHealthRepository(supabase).list(orgId); // evaluated_at desc
  const freshest = evals.find((e) => e.ruleSetVersion === HEALTH_RULE_SET_VERSION);
  if (!freshest) return null;

  const { data: ver } = await supabase
    .from('scoring_policy_versions')
    .select('id, version_no, scoring_policy_id')
    .eq('id', freshest.policyVersionId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (!ver) return null;
  const v = ver as { id: string; version_no: number; scoring_policy_id: string };

  const { data: pol } = await supabase
    .from('scoring_policies')
    .select('name')
    .eq('id', v.scoring_policy_id)
    .eq('organization_id', orgId)
    .maybeSingle();

  return {
    policyId: v.scoring_policy_id,
    policyName: (pol as { name: string } | null)?.name ?? 'Politika',
    anchorVersionId: v.id,
    anchorVersionNo: v.version_no,
  };
}

const UNAVAILABLE = 'Bu görünüm için veri yok veya yetkiniz kapsamında değil (politika verileri RLS + Sağlık/Borç motoruna bağlıdır).';

export default async function PolicyIntelligencePage() {
  if (!(await hasPermission('intelligence.read'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');
  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('intelligence'))) redirect('/unauthorized');

  const anchor = await safe(resolveAnchor(supabase, org.organization_id));

  const [comparison, trend] = anchor
    ? await Promise.all([
        // getHealthComparison self-gates on the 'health_engine' flag + RLS (policy.manage) → throws when
        // denied → safe() → null → honest UnavailableCard, never a fabricated delta.
        safe<HealthComparison>(getHealthComparison(anchor.anchorVersionId, { organizationId: org.organization_id }, supabase)),
        // getPolicyComplexityTrend self-gates on the 'policy_debt' flag + RLS → safe() → null when denied.
        safe<VersionTrendEntry[]>(getPolicyComplexityTrend(anchor.policyId, { organizationId: org.organization_id })),
      ])
    : [null, null];

  const rows = comparison ? comparisonRows(comparison) : [];
  const trendPoints = trend ? complexityTrendPoints(trend) : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Politika Zekası</h1>
        <p className="text-sm text-muted-foreground">
          Puanlama politikası sürümlerinin karşılaştırması — itiraz / oyunlaştırma / yönetici takdiri /
          karmaşıklık / yoğunlaşma boyutlarında önceki sürüme göre değişim (Sağlık Motoru’ndan; yüksek =
          daha sağlıklı) ve sürümler arası karmaşıklık eğilimi. Deterministik; uydurma değer yoktur.
          Ayrıntı için ilgili detay sayfalarına bağlanır (yeniden uygulama yok).
        </p>
      </div>

      {!anchor ? (
        <Card>
          <CardHeader>
            <CardTitle>Henüz değerlendirilmedi</CardTitle>
            <CardDescription>
              Karşılaştırılacak bir politika sağlık değerlendirmesi yok (veya yetkiniz kapsamında değil).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState message="Bir politikayı değerlendirmek için Politika Sağlığı sayfasını kullanın." />
            <div className="mt-3 text-sm">
              <Link href="/policy-health" className="underline underline-offset-4">
                → Politika Sağlığı
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Version-vs-version dimension comparison (§10.9 / §10.16) — table-first (§19 accessible). */}
          <ChartFrame
            question={`${anchor.policyName}: sürümler arasında ne değişti?`}
            metricDefinition="Sağlık Motoru boyut skorları (0–100, yüksek = daha sağlıklı); Δ = güncel − önceki sürüm. Pozitif = iyileşme."
            filters={[
              `Politika: ${anchor.policyName}`,
              comparison?.hasPrevious
                ? `Sürüm: v${comparison.currentVersionNo} vs v${comparison.previousVersionNo}`
                : `Sürüm: v${anchor.anchorVersionNo}`,
            ]}
          >
            {!comparison ? (
              <EmptyState message={UNAVAILABLE} />
            ) : (
              <div className="flex flex-col gap-3">
                {!comparison.hasPrevious ? (
                  <EmptyState message="Karşılaştırma için en az 2 değerlendirilmiş sürüm gerekir (önceki sürüm yok); güncel skorlar aşağıda." />
                ) : null}
                <table className="w-full text-sm" aria-label="Sürüm karşılaştırması (boyut skorları)">
                  <caption className="sr-only">
                    {anchor.policyName} sürüm karşılaştırması — boyut başına önceki/güncel skor ve değişim.
                  </caption>
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th scope="col" className="py-1 text-left">Boyut</th>
                      <th scope="col" className="py-1 text-right">Önceki</th>
                      <th scope="col" className="py-1 text-right">Güncel</th>
                      <th scope="col" className="py-1 text-right">Değişim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-b last:border-0">
                        <th scope="row" className="py-1 text-left font-normal">{r.label}</th>
                        <td className="py-1 text-right tabular-nums">{formatScore(r.previous)}</td>
                        <td className="py-1 text-right tabular-nums">{formatScore(r.current)}</td>
                        <td className="py-1 text-right">
                          {r.delta === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <DeltaBadge value={r.delta} higherIsBetter />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartFrame>

          {/* Complexity/debt across versions (§10.16) — TrendChart pairs an accessible data table. */}
          <ChartFrame
            question={`${anchor.policyName}: karmaşıklık sürümler boyunca nasıl değişti?`}
            metricDefinition="Politika Borcu toplam skoru (statik + çalışma-zamanı) sürüm bazında (yüksek = daha karmaşık)."
            filters={[`Politika: ${anchor.policyName}`]}
          >
            {trendPoints.length > 0 ? (
              <TrendChart data={trendPoints} valueLabel="Karmaşıklık" caption={`${anchor.policyName} — sürüm bazında karmaşıklık/borç skoru`} />
            ) : (
              <EmptyState message={UNAVAILABLE} />
            )}
          </ChartFrame>

          {/* Cross-links to the detail pages — aggregate + link, NOT a re-implementation (§23) */}
          <Card>
            <CardHeader>
              <CardTitle>Ayrıntıya git</CardTitle>
              <CardDescription>Bu genel bakış, aşağıdaki detay sayfalarını özetler ve onlara bağlanır (yeniden uygulama yok).</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                <li>
                  <Link href="/policy-health" className="underline underline-offset-4">→ Politika Sağlığı</Link>
                  <span className="text-muted-foreground"> — boyut sürücüleri, kanıt, gerekçeli “Riski kabul et”.</span>
                </li>
                <li>
                  <Link href="/policy-debt" className="underline underline-offset-4">→ Politika Borcu</Link>
                  <span className="text-muted-foreground"> — karmaşıklık kırılımı ve sadeleştirme adayları.</span>
                </li>
                <li>
                  <Link href="/policy-impact" className="underline underline-offset-4">→ Politika Değişiklik Etkisi</Link>
                  <span className="text-muted-foreground"> — sürümler arası yapısal diff ve backtest.</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
