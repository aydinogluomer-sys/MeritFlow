import { DriverList, EvidenceDrawer } from '@/components/intelligence';
import type { DimensionScore, PolicyHealthRiskAcceptance } from '@/modules/incentive-health';
import { EmptyState } from '@/components/features/shared/empty-state';
import { AcceptRiskButton } from './accept-risk-button';
import { activeAcceptanceKeys, buildRisks, dimensionLabel, type RiskItem } from './view';

// §3.7 risk list. Each surfaced risk (a negative-impact driver) is shown with its transparent driver
// breakdown (DriverList: code/impact/value/threshold) + evidence drill-down (EvidenceDrawer). The ONLY
// action is Accept Risk (reason required, audited — §3.8); there is NO silent dismiss. Accepted (active)
// waivers are listed separately with their reason + expiry. Server-safe (renders a client button).

const SEVERITY_LABEL = { critical: 'Kritik', warning: 'Uyarı', ok: 'Bilgi' } as const;

function evidenceFor(dimensions: DimensionScore[], dimension: string) {
  return dimensions.find((d) => d.dimension === dimension)?.evidence ?? [];
}

function RiskRow({
  risk,
  healthEvaluationId,
  evidence,
}: {
  risk: RiskItem;
  healthEvaluationId: string;
  evidence: { sourceType: string; sourceId: string }[];
}) {
  return (
    <li className="flex flex-col gap-2 border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {SEVERITY_LABEL[risk.severity]}
        </span>
        <span className="font-medium">{risk.dimensionLabel}</span>
        <span className="text-sm text-muted-foreground">· {risk.driver.label ?? risk.driver.code}</span>
      </div>
      <DriverList drivers={[risk.driver]} caption={`${risk.dimensionLabel} risk sürücüsü`} />
      {evidence.length > 0 ? <EvidenceDrawer evidence={evidence} /> : null}
      <div>
        <AcceptRiskButton
          healthEvaluationId={healthEvaluationId}
          dimension={risk.dimension}
          driverCode={risk.driver.code}
        />
      </div>
    </li>
  );
}

export function RiskList({
  healthEvaluationId,
  dimensions,
  acceptances,
  nowMs,
}: {
  healthEvaluationId: string;
  dimensions: DimensionScore[];
  acceptances: PolicyHealthRiskAcceptance[];
  nowMs: number;
}) {
  const acceptedKeys = activeAcceptanceKeys(acceptances, nowMs);
  const risks = buildRisks(dimensions, acceptedKeys);
  // Every unaccepted surfaced risk is reviewable — a negative-impact driver is never filtered out
  // (§3.8: no silent dismiss). Critical first, then warning.
  const open = risks
    .filter((r) => !r.accepted)
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
  const acceptedActive = acceptances.filter((a) => acceptedKeys.has(`${a.dimension}::${a.driverCode}`));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 text-sm font-semibold">İnceleme gerektiren riskler</h3>
        {open.length === 0 ? (
          <EmptyState message="İnceleme gerektiren risk yok." />
        ) : (
          <ul>
            {open.map((r) => (
              <RiskRow
                key={`${r.dimension}::${r.driver.code}`}
                risk={r}
                healthEvaluationId={healthEvaluationId}
                evidence={evidenceFor(dimensions, r.dimension)}
              />
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Kabul edilmiş riskler (aktif muafiyet)</h3>
        {acceptedActive.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aktif risk kabulü yok.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Aktif risk kabulleri</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-4 font-medium">Boyut / sürücü</th>
                <th scope="col" className="py-1 pr-4 font-medium">Gerekçe</th>
                <th scope="col" className="py-1 font-medium">Son geçerlilik</th>
              </tr>
            </thead>
            <tbody>
              {acceptedActive.map((a) => (
                <tr key={a.id} className="border-t">
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {dimensionLabel(a.dimension)} · {a.driverCode}
                  </th>
                  <td className="py-2 pr-4">{a.reason}</td>
                  <td className="py-2 text-muted-foreground">
                    {a.expiresAt ? new Date(a.expiresAt).toLocaleString('tr-TR') : 'süresiz'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
