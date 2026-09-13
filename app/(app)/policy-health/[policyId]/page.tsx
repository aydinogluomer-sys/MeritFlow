import { notFound, redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { FeatureFlagResolver } from '@/modules/intelligence';
import {
  IncentiveHealthRepository,
  getHealthComparison,
  listHealthRiskAcceptances,
  HEALTH_RULE_SET_VERSION,
  type PolicyHealthEvaluation,
  type HealthComparison,
  type PolicyHealthRiskAcceptance,
} from '@/modules/incentive-health';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/features/shared/empty-state';
import { ErrorState } from '@/components/features/shared/error-state';
import { HealthHeader } from '@/components/features/policy-health/health-header';
import { DimensionCards } from '@/components/features/policy-health/dimension-cards';
import { OverallDerivation } from '@/components/features/policy-health/overall-derivation';
import { RiskList } from '@/components/features/policy-health/risk-list';
import { ComparisonTable } from '@/components/features/policy-health/comparison-table';
import { EvaluateButton, type VersionOption } from '@/components/features/policy-health/evaluate-button';
import { activeAcceptanceKeys, buildRisks, issuesRequiringReview } from '@/components/features/policy-health/view';

export default async function PolicyHealthDetailPage({
  params,
}: {
  params: Promise<{ policyId: string }>;
}) {
  if (!(await hasPermission('policy.manage'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('health_engine'))) redirect('/unauthorized');

  const { policyId } = await params;
  const { data: policy } = await supabase
    .from('scoring_policies')
    .select('name')
    .eq('id', policyId)
    .eq('organization_id', org.organization_id)
    .maybeSingle();
  if (!policy) notFound();

  const repo = new IncentiveHealthRepository(supabase);

  let loadError = false;
  let versionsDesc: Array<{ id: string; versionNo: number }> = [];
  let anchor: { versionNo: number; evaluation: PolicyHealthEvaluation } | null = null;
  let comparison: HealthComparison | null = null;
  let acceptances: PolicyHealthRiskAcceptance[] = [];

  try {
    const versions = await repo.listPolicyVersions(policyId, org.organization_id);
    versionsDesc = [...versions].sort((a, b) => b.versionNo - a.versionNo);

    // Anchor on the latest version that HAS a health-v1 evaluation.
    const evals = await repo.list(org.organization_id);
    const evalByVersion = new Map<string, PolicyHealthEvaluation>();
    for (const e of evals) {
      if (e.ruleSetVersion === HEALTH_RULE_SET_VERSION && !evalByVersion.has(e.policyVersionId)) {
        evalByVersion.set(e.policyVersionId, e);
      }
    }
    const anchorVersion = versionsDesc.find((v) => evalByVersion.has(v.id));
    if (anchorVersion) {
      anchor = { versionNo: anchorVersion.versionNo, evaluation: evalByVersion.get(anchorVersion.id)! };
      [comparison, acceptances] = await Promise.all([
        getHealthComparison(anchorVersion.id, { organizationId: org.organization_id }, supabase),
        listHealthRiskAcceptances(anchorVersion.id, { organizationId: org.organization_id }, supabase),
      ]);
    }
  } catch {
    loadError = true;
  }

  const versionOptions: VersionOption[] = versionsDesc.map((v) => ({ id: v.id, versionNo: v.versionNo }));
  // Per-request server timestamp for active-vs-expired acceptance filtering (new Date() is the repo's
  // server-component convention; Date.now() is flagged impure by react-hooks/purity).
  const nowMs = new Date().getTime();
  const issueCount = anchor
    ? issuesRequiringReview(buildRisks(anchor.evaluation.dimensions, activeAcceptanceKeys(acceptances, nowMs)))
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{policy.name} — Politika Sağlığı</h1>
        <p className="text-sm text-muted-foreground">
          Alt boyut skorları + şeffaf genel türetim + risk sürücüleri (kanıt drill-down) + önceki
          sürüme göre değişim. Riskler sessizce kapatılamaz; yalnızca gerekçeli “Riski kabul et” (§3.8).
        </p>
      </div>

      {loadError ? (
        <ErrorState message="Sağlık verisi yüklenemedi." />
      ) : !anchor ? (
        <Card>
          <CardHeader>
            <CardTitle>Henüz değerlendirilmedi</CardTitle>
            <CardDescription>Bu politikanın hiçbir sürümü için sağlık değerlendirmesi yok.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <EmptyState message="Aşağıdan bir sürümü değerlendirin." />
            <EvaluateButton versionOptions={versionOptions} />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* What matters — header (overall + issues) */}
          <Card>
            <CardHeader>
              <CardTitle>Genel sağlık</CardTitle>
              <CardDescription>Sürümün genel sağlığı ve inceleme gerektiren risk sayısı.</CardDescription>
            </CardHeader>
            <CardContent>
              <HealthHeader
                versionNo={anchor.versionNo}
                overallScore={anchor.evaluation.overallScore}
                overallDelta={comparison ? comparison.overall.delta : null}
                issueCount={issueCount}
              />
            </CardContent>
          </Card>

          {/* Why — per-dimension sub-scores + deltas */}
          <Card>
            <CardHeader>
              <CardTitle>Boyut skorları</CardTitle>
              <CardDescription>Her boyutun alt skoru ve önceki sürüme göre değişimi.</CardDescription>
            </CardHeader>
            <CardContent>
              <DimensionCards
                dimensions={anchor.evaluation.dimensions}
                deferredDimensions={anchor.evaluation.deferredDimensions}
                comparison={comparison}
              />
            </CardContent>
          </Card>

          {/* No opaque score — transparent overall derivation (§26) */}
          <Card>
            <CardHeader>
              <CardTitle>Genel skor nasıl türetildi?</CardTitle>
              <CardDescription>Ağırlıklar politikaya değil, sürüm değerlendirmesine gömülüdür.</CardDescription>
            </CardHeader>
            <CardContent>
              <OverallDerivation
                dimensions={anchor.evaluation.dimensions}
                weights={anchor.evaluation.weights}
                overallScore={anchor.evaluation.overallScore}
              />
            </CardContent>
          </Card>

          {/* Evidence + What action — risk list (drivers + evidence + Accept Risk) */}
          <Card>
            <CardHeader>
              <CardTitle>Riskler</CardTitle>
              <CardDescription>Sürücü + kanıt; tek eylem gerekçeli “Riski kabul et” (denetimli).</CardDescription>
            </CardHeader>
            <CardContent>
              <RiskList
                healthEvaluationId={anchor.evaluation.id}
                dimensions={anchor.evaluation.dimensions}
                acceptances={acceptances}
                nowMs={nowMs}
              />
            </CardContent>
          </Card>

          {/* What changed — comparison to previous */}
          <Card>
            <CardHeader>
              <CardTitle>Önceki sürümle karşılaştırma</CardTitle>
              <CardDescription>Genel + boyut bazında değişim (tablo öncelikli).</CardDescription>
            </CardHeader>
            <CardContent>
              {comparison ? <ComparisonTable comparison={comparison} /> : <EmptyState message="Karşılaştırma yok." />}
            </CardContent>
          </Card>

          {/* CTAs */}
          <Card>
            <CardHeader>
              <CardTitle>Eylemler</CardTitle>
              <CardDescription>Değerlendir/yenile (idempotent). Simülasyon/taslak Modül 6/7 (kapsam dışı).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <EvaluateButton versionOptions={versionOptions} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled title="Modül 7 (Digital Twin) — kapsam dışı">
                  Simülasyon çalıştır
                </Button>
                <Button type="button" variant="outline" size="sm" disabled title="Modül 6 (Policy Change) — kapsam dışı">
                  Politika taslağı oluştur
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
