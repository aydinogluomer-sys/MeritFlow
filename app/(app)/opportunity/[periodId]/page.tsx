import { notFound, redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import { FeatureFlagResolver, IntelligenceRepository, type StoredInsight } from '@/modules/intelligence';
import { OpportunityRepository, type OpportunitySnapshotRecord } from '@/modules/opportunity-intelligence';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/features/shared/error-state';
import { QuadrantTable } from '@/components/features/opportunity/quadrant-table';
import { TeamBalance } from '@/components/features/opportunity/team-balance';
import { FlagReview } from '@/components/features/opportunity/flag-review';

const DAY_MS = 86_400_000;
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default async function OpportunityDetailPage({ params }: { params: Promise<{ periodId: string }> }) {
  if (!(await hasPermission('intelligence.read'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('opportunity_intelligence'))) redirect('/unauthorized');

  const { periodId } = await params;
  const { data: period } = await supabase
    .from('bonus_periods')
    .select('starts_on, ends_on')
    .eq('id', periodId)
    .eq('organization_id', org.organization_id)
    .maybeSingle();
  if (!period) notFound();
  const { starts_on: startsOn, ends_on: endsOn } = period as { starts_on: string; ends_on: string };

  let loadError = false;
  let snapshots: OpportunitySnapshotRecord[] = [];
  let opportunityFlags: StoredInsight[] = [];
  const perfByEmployee = new Map<string, number>();
  try {
    // Performance axis (Y): approved POINTS per employee in the period (NO compensation). RLS-scoped
    // (employee-own + manager-of-primary-team + HR/org) via the user client — half-open [start, end+1d).
    const endExclusive = new Date(Date.parse(endsOn) + DAY_MS).toISOString();
    const [snaps, allFlags, ledgerRes] = await Promise.all([
      new OpportunityRepository(supabase).list(org.organization_id, periodId),
      new IntelligenceRepository(supabase).list(org.organization_id, { insightType: 'opportunity_flag' }),
      supabase
        .from('point_ledger')
        .select('employee_id, points_delta')
        .eq('organization_id', org.organization_id)
        .eq('event_type', 'task_approved')
        .gte('created_at', startsOn)
        .lt('created_at', endExclusive),
    ]);
    if (ledgerRes.error) throw ledgerRes.error;
    snapshots = snaps;
    // intelligence_insights read is intelligence.read-scoped (org-wide for a manager), whereas
    // opportunity_snapshots is team-scoped (RLS). Align the flag list to the viewer's VISIBLE snapshot
    // subjects so a manager sees only their own team's flags (no cross-team leakage) — matching §4.8.
    const visibleEmployees = new Set(snaps.map((s) => s.employeeId));
    opportunityFlags = allFlags.filter(
      (i) => i.bonusPeriodId === periodId && i.subjectId !== null && visibleEmployees.has(i.subjectId),
    );
    for (const r of (ledgerRes.data ?? []) as Array<{ employee_id: string; points_delta: number | string }>) {
      perfByEmployee.set(r.employee_id, (perfByEmployee.get(r.employee_id) ?? 0) + num(r.points_delta));
    }
  } catch {
    loadError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Fırsat Zekası — {startsOn} → {endsOn}</h1>
        <p className="text-sm text-muted-foreground">
          Fırsat (X) × performans (Y) dörtlü görünümü, takım fırsat dengesi ve danışma amaçlı bayrak
          incelemesi. Her bulgu “incele” çağrısıdır; otomatik ücret kararı yoktur (§4.2/§26).
        </p>
      </div>

      {loadError ? (
        <ErrorState message="Fırsat verisi yüklenemedi." />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Fırsat / performans dörtlüsü</CardTitle>
              <CardDescription>X = fırsat endeksi, Y = onaylı puan. Küçük kohortlar bastırılır.</CardDescription>
            </CardHeader>
            <CardContent>
              <QuadrantTable snapshots={snapshots} perfByEmployee={perfByEmployee} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Takım fırsat dengesi</CardTitle>
              <CardDescription>Kohort medyanı + medyanın altındaki çalışanlar (kanıt ile). Yalnızca kendi takımınız.</CardDescription>
            </CardHeader>
            <CardContent>
              <TeamBalance snapshots={snapshots} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fırsat bayrakları (danışma)</CardTitle>
              <CardDescription>İnceleyip §2.8 durum akışıyla çözün (kabul/ret gerekçe ister; denetlenir).</CardDescription>
            </CardHeader>
            <CardContent>
              <FlagReview insights={opportunityFlags} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
