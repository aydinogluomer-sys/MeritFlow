import { notFound, redirect } from 'next/navigation';
import { hasPermission } from '@/lib/auth/rbac';
import { getActiveOrg } from '@/lib/auth/org';
import { createClient } from '@/lib/supabase/server';
import {
  PolicyChangeRequestRepository,
  PolicyChangeImpactRepository,
  computePolicyDiff,
  type PolicyDiff,
  type PolicyChangeImpact,
} from '@/modules/policy-change-impact';
import { FeatureFlagResolver, IntelligenceRepository } from '@/modules/intelligence';
import { InsightCard } from '@/components/intelligence';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/features/shared/error-state';
import { EmptyState } from '@/components/features/shared/empty-state';
import { statusBadgeClass } from '@/components/features/shared/status-badge';
import { CHANGE_REQUEST_STATUS_LABEL } from '@/components/features/policy-impact/change-request-list';
import { PolicyDiffView } from '@/components/features/policy-impact/policy-diff-view';
import { ImpactSummaryCards } from '@/components/features/policy-impact/impact-summary';
import { CohortTable } from '@/components/features/policy-impact/cohort-table';
import { CommunicationPreview } from '@/components/features/policy-impact/communication-preview';
import { DecisionActions } from '@/components/features/policy-impact/decision-actions';
import { RunSimulationForm, type PeriodOption } from '@/components/features/policy-impact/run-simulation-form';

const REFERENCE_PERIOD_STATUSES = ['locked', 'calculated', 'approved', 'exported', 'closed'];

export default async function PolicyImpactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await hasPermission('policy.impact.read'))) redirect('/unauthorized');
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const flags = new FeatureFlagResolver(supabase, org.organization_id);
  if (!(await flags.isEnabled('policy_change_impact'))) redirect('/unauthorized');

  const { id } = await params;
  const cr = await new PolicyChangeRequestRepository(supabase).getById(id, org.organization_id);
  if (!cr) notFound();

  const canManage = await hasPermission('policy.manage');
  const canDecide = org.primary_role === 'hr' || org.primary_role === 'finance';

  // Structural diff (feature-gated inside the module; already flag-checked above).
  let diff: PolicyDiff | null = null;
  let diffError = false;
  try {
    diff = await computePolicyDiff(cr.fromVersionId, cr.toDraftVersionId, {
      organizationId: org.organization_id,
    });
  } catch {
    diffError = true;
  }

  // Latest impact artifact (RLS: policy.impact.read).
  const impacts = await new PolicyChangeImpactRepository(supabase).list(org.organization_id, cr.id);
  const impact: PolicyChangeImpact | undefined = impacts[0];

  // The advisory insight for this change request (RLS: intelligence.read).
  let insight: Awaited<ReturnType<IntelligenceRepository['list']>>[number] | undefined;
  try {
    const insights = await new IntelligenceRepository(supabase).list(org.organization_id, {
      insightType: 'policy_change_impact',
      subjectType: 'policy_change_request',
    });
    insight = insights.find((i) => i.subjectId === cr.id);
  } catch {
    insight = undefined;
  }

  // Version labels + employee labels + reference-period options (all RLS-scoped).
  const [{ data: versionRows }, { data: periodRows }] = await Promise.all([
    supabase
      .from('scoring_policy_versions')
      .select('id, version_no')
      .in('id', [cr.fromVersionId, cr.toDraftVersionId]),
    supabase
      .from('bonus_periods')
      .select('id, period_type, starts_on, ends_on, status')
      .in('status', REFERENCE_PERIOD_STATUSES)
      .order('starts_on', { ascending: false }),
  ]);
  const versionNo = new Map(
    ((versionRows ?? []) as Array<{ id: string; version_no: number }>).map((v) => [v.id, v.version_no]),
  );
  const periodOptions: PeriodOption[] = ((periodRows ?? []) as Array<{
    id: string;
    period_type: string;
    starts_on: string;
    ends_on: string;
  }>).map((p) => ({ id: p.id, label: `${p.period_type} · ${p.starts_on} – ${p.ends_on}` }));

  let employeeLabels: Record<string, string> = {};
  if (impact) {
    const ids = impact.employeeDistribution.map((d) => d.employeeId);
    if (ids.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', ids);
      employeeLabels = Object.fromEntries(
        ((profiles ?? []) as Array<{ id: string; display_name: string | null }>).map((p) => [
          p.id,
          p.display_name ?? p.id,
        ]),
      );
    }
  }

  const fromLabel = versionNo.has(cr.fromVersionId) ? `v${versionNo.get(cr.fromVersionId)}` : 'kaynak';
  const toLabel = versionNo.has(cr.toDraftVersionId) ? `v${versionNo.get(cr.toDraftVersionId)}` : 'taslak';

  return (
    <div className="flex flex-col gap-6">
      {/* Header — What matters at a glance */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Politika değişiklik talebi</h1>
          <Badge variant="outline" className={statusBadgeClass(cr.status)}>
            {CHANGE_REQUEST_STATUS_LABEL[cr.status]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {fromLabel} → {toLabel} · {cr.reason}
        </p>
      </div>

      {/* What changed — structural diff */}
      <Card>
        <CardHeader>
          <CardTitle>Yapısal fark ({fromLabel} → {toLabel})</CardTitle>
          <CardDescription>Yayınlanmış sürüm salt-okunur; hiçbir zaman değiştirilmez (§8.2).</CardDescription>
        </CardHeader>
        <CardContent>
          {diffError || !diff ? (
            <ErrorState message="Fark hesaplanamadı." />
          ) : (
            <PolicyDiffView diff={diff} />
          )}
        </CardContent>
      </Card>

      {/* Impact — the §8.5 summary + affected cohorts + advisory insight */}
      <Card>
        <CardHeader>
          <CardTitle>Etki simülasyonu</CardTitle>
          <CardDescription>
            Dondurulmuş bir referans döneminin verisiyle yeniden hesaplama (danışma amaçlı; deftere
            yazılmaz).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {impact ? (
            <>
              <ImpactSummaryCards summary={impact.financialImpact} />
              <section aria-labelledby="pci-cohorts">
                <h3 id="pci-cohorts" className="mb-2 text-sm font-medium">Etkilenen çalışanlar</h3>
                <CohortTable distribution={impact.employeeDistribution} employeeLabels={employeeLabels} />
              </section>
              {insight ? (
                <section aria-labelledby="pci-insight">
                  <h3 id="pci-insight" className="mb-2 text-sm font-medium">İçgörü ve kanıt</h3>
                  <InsightCard
                    headline={insight.headline}
                    severity={insight.severity}
                    facts={insight.deterministicFacts}
                    evidence={insight.evidence}
                    actions={insight.suggestedActions.map((a) => ({ code: a.code, label: a.label }))}
                  />
                </section>
              ) : null}
              <section aria-labelledby="pci-comms">
                <h3 id="pci-comms" className="mb-2 text-sm font-medium">Çalışan bildirimi önizlemesi</h3>
                <CommunicationPreview summary={impact.financialImpact} effectiveDate={cr.effectiveDate} />
              </section>
            </>
          ) : (
            <EmptyState message="Bu talep için henüz bir simülasyon çalıştırılmadı." />
          )}
        </CardContent>
      </Card>

      {/* What action — CTAs + run another simulation */}
      <Card>
        <CardHeader>
          <CardTitle>Aksiyonlar</CardTitle>
          <CardDescription>Onay dört gözle (İK + Finans); kararlar denetlenir.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <DecisionActions
            changeRequestId={cr.id}
            status={cr.status}
            toDraftVersionId={cr.toDraftVersionId}
            canManage={canManage}
            canDecide={canDecide}
            hrApproved={cr.hrApprovedBy !== null}
            financeApproved={cr.financeApprovedBy !== null}
          />
          {canManage ? (
            <section aria-labelledby="pci-run">
              <h3 id="pci-run" className="mb-2 text-sm font-medium">Yeni simülasyon çalıştır</h3>
              <RunSimulationForm changeRequestId={cr.id} periodOptions={periodOptions} />
            </section>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
