import type { OpportunitySnapshotRecord } from '@/modules/opportunity-intelligence';
import { MetricCard, EvidenceDrawer } from '@/components/intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import { teamBalance } from './view';

// §4.8 Manager view — Team Opportunity Balance (cohort median) + the employees significantly below
// cohort opportunity, with evidence drill (assigned work / cohort / active days + snapshot). The
// manager sees ONLY their own PRIMARY-team employees (enforced by RLS upstream — no app-side filter,
// no cross-team leakage). NO compensation, NO protected attribute. Server-safe (EvidenceDrawer is
// server-safe: a native <details>). Findings are advisory ("Investigate").
export function TeamBalance({ snapshots }: { snapshots: OpportunitySnapshotRecord[] }) {
  const { cohortMedian, scoredCount, belowCohort } = teamBalance(snapshots);

  if (cohortMedian === null) {
    return <EmptyState message="Bu dönem için (bastırılmamış) fırsat kaydı yok." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="max-w-xs">
          <MetricCard
            label="Takım fırsat dengesi (medyan)"
            value={cohortMedian}
            unit="/ 100"
            definition="Görünürdeki (bastırılmamış) çalışanların fırsat endeksi medyanı."
          />
        </div>
        <p className="text-sm" role="status">
          {belowCohort.length === 0 ? (
            <span className="text-muted-foreground">Medyanın belirgin altında çalışan yok ({scoredCount} kayıt).</span>
          ) : (
            <span>
              <span className="tabular-nums">{belowCohort.length}</span> çalışan kohort medyanının altında — inceleyin.
            </span>
          )}
        </p>
      </div>

      {belowCohort.length > 0 ? (
        <table className="w-full text-sm">
          <caption className="sr-only">Kohort medyanının altındaki çalışanlar ve kanıtı</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1 pr-4 font-medium">Çalışan</th>
              <th scope="col" className="py-1 pr-4 font-medium tabular-nums">Fırsat</th>
              <th scope="col" className="py-1 pr-4 font-medium tabular-nums">Atanan / havuz</th>
              <th scope="col" className="py-1 pr-4 font-medium tabular-nums">Aktif gün</th>
              <th scope="col" className="py-1 font-medium">Kanıt</th>
            </tr>
          </thead>
          <tbody>
            {belowCohort.map((s) => (
              <tr key={s.id} className="border-t align-top">
                <th scope="row" className="py-2 pr-4 font-normal font-mono text-xs">{s.employeeId}</th>
                <td className="py-2 pr-4 tabular-nums">{s.opportunityIndex} / 100</td>
                <td className="py-2 pr-4 tabular-nums">{s.assignedWorkCount} / {s.eligibleWorkCount}</td>
                <td className="py-2 pr-4 tabular-nums">{s.activeDays}</td>
                <td className="py-2">
                  <EvidenceDrawer
                    evidence={[{ sourceType: 'snapshot', sourceId: s.id }]}
                    label="Kanıt (snapshot)"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
