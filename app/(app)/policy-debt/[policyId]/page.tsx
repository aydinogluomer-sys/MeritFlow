import { notFound, redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { FeatureFlagResolver, IntelligenceRepository } from '@/modules/intelligence';
import {
  PolicyComplexityRepository,
  getPolicyComplexityTrend,
  FULL_RULE_SET_VERSION,
  type ComplexityDriver,
} from '@/modules/policy-complexity';
import { DriverList, InsightCard } from '@/components/intelligence';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/features/shared/empty-state';
import { DebtTrend } from '@/components/features/policy-debt/debt-trend';
import {
  SimplificationCandidates,
  type CandidateView,
} from '@/components/features/policy-debt/simplification-candidates';
import { EvaluateButton, type VersionOption } from '@/components/features/policy-debt/evaluate-button';

function toCandidates(facts: Record<string, unknown> | undefined): CandidateView[] {
  const raw = facts?.simplificationCandidates;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is { code: string; kind: string; detail: string } => typeof c === 'object' && c !== null)
    .map((c) => ({ code: String(c.code), kind: String(c.kind), detail: String(c.detail) }));
}

export default async function PolicyDebtDetailPage({
  params,
}: {
  params: Promise<{ policyId: string }>;
}) {
  if (!(await hasPermission('policy.manage'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('policy_debt'))) redirect('/unauthorized');

  const { policyId } = await params;
  const { data: policy } = await supabase
    .from('scoring_policies')
    .select('name')
    .eq('id', policyId)
    .eq('organization_id', org.organization_id)
    .maybeSingle();
  if (!policy) notFound();

  const repo = new PolicyComplexityRepository(supabase);
  const [trend, versions] = await Promise.all([
    getPolicyComplexityTrend(policyId, { organizationId: org.organization_id }),
    repo.listVersionsForPolicy(policyId, org.organization_id),
  ]);

  const latestVersionId = trend.length > 0 ? trend[trend.length - 1]!.policyVersionId : null;

  // Highest drivers + advisory candidates come from the latest evaluated version.
  let drivers: ComplexityDriver[] = [];
  let candidates: CandidateView[] = [];
  let insight: Awaited<ReturnType<IntelligenceRepository['list']>>[number] | undefined;
  if (latestVersionId) {
    const evals = await repo.list(org.organization_id, latestVersionId);
    const chosen = evals.find((e) => e.ruleSetVersion === FULL_RULE_SET_VERSION) ?? evals[0];
    drivers = chosen?.components ?? [];
    try {
      const insights = await new IntelligenceRepository(supabase).list(org.organization_id, {
        insightType: 'policy_debt',
        subjectType: 'scoring_policy_version',
      });
      insight = insights.find((i) => i.subjectId === latestVersionId);
      candidates = toCandidates(insight?.deterministicFacts);
    } catch {
      insight = undefined;
    }
  }

  const versionOptions: VersionOption[] = versions.map((v) => ({ id: v.policyVersionId, versionNo: v.versionNo }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{policy.name} — Politika borcu</h1>
        <p className="text-sm text-muted-foreground">
          Statik + çalışma-zamanı karmaşıklığı, şeffaf sürücüler ve danışma amaçlı sadeleştirme
          adayları. Politika hiçbir zaman otomatik değiştirilmez (§26).
        </p>
      </div>

      {/* What matters + what changed — debt badge + trend */}
      <Card>
        <CardHeader>
          <CardTitle>Borç ve eğilim</CardTitle>
          <CardDescription>Toplam borç skoru ve önceki sürüme göre değişim.</CardDescription>
        </CardHeader>
        <CardContent>
          <DebtTrend trend={trend} />
        </CardContent>
      </Card>

      {/* Why — highest complexity drivers */}
      <Card>
        <CardHeader>
          <CardTitle>En yüksek karmaşıklık sürücüleri</CardTitle>
          <CardDescription>Skorun her puanı bir sürücüye dayanır (opak skor yok).</CardDescription>
        </CardHeader>
        <CardContent>
          {drivers.length > 0 ? (
            <DriverList drivers={drivers} caption="Statik + çalışma-zamanı karmaşıklık sürücüleri" />
          ) : (
            <EmptyState message="Bu politika için henüz bir değerlendirme yok. Aşağıdan değerlendirin." />
          )}
        </CardContent>
      </Card>

      {/* Evidence + advisory candidates */}
      <Card>
        <CardHeader>
          <CardTitle>Sadeleştirme adayları</CardTitle>
          <CardDescription>Danışma amaçlı; otomatik uygulanmaz (§26).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <SimplificationCandidates candidates={candidates} />
          {insight ? (
            <InsightCard
              headline={insight.headline}
              severity={insight.severity}
              evidence={insight.evidence}
              actions={insight.suggestedActions.map((a) => ({ code: a.code, label: a.label }))}
            />
          ) : null}
        </CardContent>
      </Card>

      {/* What action — evaluate/refresh (advisory path; no policy mutation) */}
      <Card>
        <CardHeader>
          <CardTitle>Değerlendir</CardTitle>
          <CardDescription>Bir sürümün borç değerlendirmesini çalıştırın/yenileyin (idempotent).</CardDescription>
        </CardHeader>
        <CardContent>
          <EvaluateButton versionOptions={versionOptions} />
        </CardContent>
      </Card>
    </div>
  );
}
