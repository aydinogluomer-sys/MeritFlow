import { redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { FeatureFlagResolver } from '@/modules/intelligence';
import { OpportunityRepository } from '@/modules/opportunity-intelligence';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/features/shared/error-state';
import { PeriodList, type PeriodRow } from '@/components/features/opportunity/period-list';

// Opportunity Intelligence (Module 2-B) — period list. Gated (server-side) on intelligence.read AND
// the opportunity_intelligence flag; else /unauthorized. RLS scopes every read (a manager sees only
// their own primary-team snapshots; HR/org sees org). NO compensation, NO protected attribute.
export default async function OpportunityPage() {
  if (!(await hasPermission('intelligence.read'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('opportunity_intelligence'))) redirect('/unauthorized');

  let rows: PeriodRow[] = [];
  let loadError = false;
  try {
    const [{ data: periods, error: pErr }, snapshots] = await Promise.all([
      supabase
        .from('bonus_periods')
        .select('id, starts_on, ends_on')
        .eq('organization_id', org.organization_id)
        .order('starts_on', { ascending: false }),
      new OpportunityRepository(supabase).list(org.organization_id),
    ]);
    if (pErr) throw pErr;

    const countByPeriod = new Map<string, number>();
    for (const s of snapshots) countByPeriod.set(s.bonusPeriodId, (countByPeriod.get(s.bonusPeriodId) ?? 0) + 1);
    rows = ((periods ?? []) as Array<{ id: string; starts_on: string; ends_on: string }>)
      .map((p) => ({ id: p.id, label: `${p.starts_on} → ${p.ends_on}`, snapshotCount: countByPeriod.get(p.id) ?? 0 }))
      .filter((r) => r.snapshotCount > 0);
  } catch {
    loadError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fırsat Zekası</h1>
        <p className="text-sm text-muted-foreground">
          Düşük sonucu düşük fırsattan ayırt edin: iş bağlamı sinyallerinden türetilen, kohorta göre
          normalize edilmiş şeffaf fırsat endeksi. Bulgular “incele” çağrısıdır — kesin hüküm değil;
          korunan özellik/ücret gösterilmez.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dönemler</CardTitle>
          <CardDescription>Fırsat değerlendirmesi olan dönemler (yalnızca görebildikleriniz).</CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <ErrorState message="Dönemler yüklenemedi." />
          ) : (
            <PeriodList rows={rows} emptyMessage="Fırsat değerlendirmesi olan dönem yok." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
