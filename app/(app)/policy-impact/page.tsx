import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { PolicyChangeRequestRepository } from '@/modules/policy-change-impact';
import { FeatureFlagResolver } from '@/modules/intelligence';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ErrorState } from '@/components/features/shared/error-state';
import {
  ChangeRequestList,
  type ChangeRequestRow,
} from '@/components/features/policy-impact/change-request-list';
import {
  CreateChangeRequestForm,
  type PolicyOption,
  type VersionOption,
} from '@/components/features/policy-impact/create-change-request-form';

// Policy Change Impact — change-request list. Gated (server-side) on policy.impact.read AND the
// policy_change_impact feature flag; unauthorised / flag-off → /unauthorized. RLS scopes rows.
export default async function PolicyImpactPage() {
  if (!(await hasPermission('policy.impact.read'))) redirect('/unauthorized');

  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('policy_change_impact'))) redirect('/unauthorized');

  const canManage = await hasPermission('policy.manage');

  const repo = new PolicyChangeRequestRepository(supabase);
  let rows: ChangeRequestRow[] = [];
  let loadError = false;
  try {
    const requests = await repo.list(org.organization_id);
    rows = requests.map((r) => ({
      id: r.id,
      status: r.status,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
  } catch {
    loadError = true;
  }

  // Options for the "new change request" form (RLS-scoped catalog reads).
  let policyOptions: PolicyOption[] = [];
  let versionOptions: VersionOption[] = [];
  if (canManage) {
    const [{ data: policies }, { data: versions }] = await Promise.all([
      supabase.from('scoring_policies').select('id, name').eq('organization_id', org.organization_id),
      supabase
        .from('scoring_policy_versions')
        .select('id, scoring_policy_id, version_no, status')
        .eq('organization_id', org.organization_id),
    ]);
    policyOptions = ((policies ?? []) as Array<{ id: string; name: string }>).map((p) => ({
      id: p.id,
      name: p.name,
    }));
    versionOptions = (
      (versions ?? []) as Array<{ id: string; scoring_policy_id: string; version_no: number; status: string }>
    ).map((v) => ({ id: v.id, policyId: v.scoring_policy_id, versionNo: v.version_no, status: v.status }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Politika Değişiklik Etkisi</h1>
          <p className="text-sm text-muted-foreground">
            Yayınlanmış bir puanlama politikasını taslak sürümle değiştirme talepleri; yürürlükten
            önce etki simülasyonu, dört gözle onay ve denetlenebilir kayıt.
          </p>
        </div>
        {canManage ? (
          <CreateChangeRequestForm policyOptions={policyOptions} versionOptions={versionOptions} />
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Değişiklik talepleri</CardTitle>
          <CardDescription>Taslak, onaya sunulan ve sonuçlanan talepler.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <ErrorState message="Talepler yüklenemedi." />
          ) : (
            <ChangeRequestList rows={rows} emptyMessage="Henüz değişiklik talebi yok" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
