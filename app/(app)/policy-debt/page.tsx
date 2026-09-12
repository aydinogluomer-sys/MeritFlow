import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { FeatureFlagResolver } from '@/modules/intelligence';
import { PolicyComplexityRepository } from '@/modules/policy-complexity';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/features/shared/error-state';
import { PolicyList, type PolicyRow } from '@/components/features/policy-debt/policy-list';

// Policy Debt / Complexity Meter — scoring-policy list. Gated (server-side) on policy.manage AND the
// policy_debt feature flag; unauthorised / flag-off → /unauthorized. RLS scopes every read.
export default async function PolicyDebtPage() {
  if (!(await hasPermission('policy.manage'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('policy_debt'))) redirect('/unauthorized');

  let rows: PolicyRow[] = [];
  let loadError = false;
  try {
    const [{ data: policies, error: pErr }, { data: versions }, evaluations] = await Promise.all([
      supabase.from('scoring_policies').select('id, name, status').eq('organization_id', org.organization_id),
      supabase
        .from('scoring_policy_versions')
        .select('id, scoring_policy_id')
        .eq('organization_id', org.organization_id),
      new PolicyComplexityRepository(supabase).list(org.organization_id),
    ]);
    if (pErr) throw pErr;

    // version → policy, then the most-recently-evaluated total per policy (evaluations are desc).
    const versionToPolicy = new Map(
      ((versions ?? []) as Array<{ id: string; scoring_policy_id: string }>).map((v) => [v.id, v.scoring_policy_id]),
    );
    const latestByPolicy = new Map<string, number>();
    for (const e of evaluations) {
      const policyId = versionToPolicy.get(e.policyVersionId);
      if (policyId && !latestByPolicy.has(policyId)) latestByPolicy.set(policyId, e.totalScore);
    }
    rows = ((policies ?? []) as Array<{ id: string; name: string; status: string }>).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      latestTotal: latestByPolicy.has(p.id) ? latestByPolicy.get(p.id)! : null,
    }));
  } catch {
    loadError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Politika Borcu</h1>
        <p className="text-sm text-muted-foreground">
          Puanlama politikalarının statik + çalışma-zamanı karmaşıklığı ve bakım yükü; şeffaf
          sürücüler, sürüm eğilimi ve danışma amaçlı sadeleştirme adayları.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Politikalar</CardTitle>
          <CardDescription>Her politikanın en son borç skoru; ayrıntı için inceleyin.</CardDescription>
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
