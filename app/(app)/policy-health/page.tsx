import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { FeatureFlagResolver } from '@/modules/intelligence';
import { IncentiveHealthRepository, HEALTH_RULE_SET_VERSION } from '@/modules/incentive-health';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/features/shared/error-state';
import { PolicyList, type PolicyRow } from '@/components/features/policy-health/policy-list';

// Policy Health (Module 1-C) — scoring-policy list. Gated (server-side) on policy.manage AND the
// health_engine feature flag; unauthorised / flag-off → /unauthorized. RLS scopes every read.
export default async function PolicyHealthPage() {
  if (!(await hasPermission('policy.manage'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('health_engine'))) redirect('/unauthorized');

  let rows: PolicyRow[] = [];
  let loadError = false;
  try {
    const [{ data: policies, error: pErr }, { data: versions, error: vErr }, evaluations] = await Promise.all([
      supabase.from('scoring_policies').select('id, name, status').eq('organization_id', org.organization_id),
      supabase
        .from('scoring_policy_versions')
        .select('id, scoring_policy_id')
        .eq('organization_id', org.organization_id),
      new IncentiveHealthRepository(supabase).list(org.organization_id),
    ]);
    if (pErr) throw pErr;
    if (vErr) throw vErr; // fail honest (ErrorState), never mislabel evaluated policies as "not evaluated"

    // version → policy, then the most-recently-evaluated overall per policy (evaluations are desc).
    const versionToPolicy = new Map(
      ((versions ?? []) as Array<{ id: string; scoring_policy_id: string }>).map((v) => [v.id, v.scoring_policy_id]),
    );
    const latestByPolicy = new Map<string, number>();
    for (const e of evaluations) {
      if (e.ruleSetVersion !== HEALTH_RULE_SET_VERSION) continue; // match the detail page's strict anchor
      const policyId = versionToPolicy.get(e.policyVersionId);
      if (policyId && !latestByPolicy.has(policyId)) latestByPolicy.set(policyId, e.overallScore);
    }
    rows = ((policies ?? []) as Array<{ id: string; name: string; status: string }>).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      latestOverall: latestByPolicy.has(p.id) ? latestByPolicy.get(p.id)! : null,
    }));
  } catch {
    loadError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Politika Sağlığı</h1>
        <p className="text-sm text-muted-foreground">
          Puanlama politikalarının davranışsal/operasyonel sağlığı: şeffaf alt boyut skorları, risk
          sürücüleri ve önceki sürüme göre değişim. Opak tek skor yok (§26).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Politikalar</CardTitle>
          <CardDescription>Her politikanın en son genel sağlık skoru; ayrıntı için inceleyin.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <ErrorState message="Politikalar yüklenemedi." />
          ) : (
            <PolicyList rows={rows} emptyMessage="Puanlama politikası yok" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
