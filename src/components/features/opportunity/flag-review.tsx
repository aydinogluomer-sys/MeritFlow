import { nextStatuses, type StoredInsight, type InsightStatus } from '@/modules/intelligence';
import { InsightCard } from '@/components/intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { ResolveFlagButton, type NextOption } from './resolve-flag-button';
import { INSIGHT_STATUS_LABELS } from './view';

// §4.9/§2.7/§2.8 advisory flag review. Lists the opportunity_flag insights (advisory, "Investigate")
// with their current status; each offers the valid next §2.8 transitions (computed server-side) via
// the audited resolution action. Resolving is a human review outcome, NEVER a pay/policy change.
// Server-safe (renders the client ResolveFlagButton). severity maps to InsightCard.
// 2-B supports the reviewer sub-lifecycle only (up to accepted|dismissed); the resolve action schema
// rejects the observe-phase statuses (applied/observed/retrospective). Intersect the §2.8 next-statuses
// with the schema-permitted set so no dead button is rendered (a resolved flag then shows "terminal").
const RESOLVABLE = new Set<InsightStatus>(['calculated', 'reviewed', 'accepted', 'dismissed']);
function toNextOptions(status: InsightStatus): NextOption[] {
  return nextStatuses(status)
    .filter((v) => RESOLVABLE.has(v))
    .map((v) => ({ value: v, label: INSIGHT_STATUS_LABELS[v] ?? v }));
}

export function FlagReview({ insights }: { insights: StoredInsight[] }) {
  if (insights.length === 0) {
    return <EmptyState message="Bu dönem için fırsat bayrağı yok." />;
  }
  return (
    <ul className="flex flex-col gap-4">
      {insights.map((i) => (
        <li key={i.id} className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{INSIGHT_STATUS_LABELS[i.status] ?? i.status}</Badge>
            <span className="text-xs text-muted-foreground">Özne: <span className="font-mono">{i.subjectId ?? '—'}</span></span>
          </div>
          <InsightCard
            headline={i.headline}
            severity={i.severity}
            evidence={i.evidence}
            actions={i.suggestedActions.map((a) => ({ code: a.code, label: a.label }))}
          />
          <ResolveFlagButton insightId={i.id} nextOptions={toNextOptions(i.status)} />
        </li>
      ))}
    </ul>
  );
}
