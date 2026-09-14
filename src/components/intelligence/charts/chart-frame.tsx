import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Phase P4 (8-B1) — the §10.16 chart contract wrapper: every chart is framed with its QUESTION (title),
// METRIC DEFINITION (what it measures), the active FILTERS (chips), a DRILL affordance, an EXPLAIN slot
// (evidence/insight), and an ACTION slot. No decorative charts (§23) — a chart without a question +
// definition should not be rendered. Presentational, Server-Component safe.
export interface ChartFrameProps {
  /** The question this chart answers (e.g. "Ödemeler dönem boyunca nasıl değişti?"). */
  question: string;
  /** What the metric measures + how it is derived (the §10.3/§10.16 definition). */
  metricDefinition: string;
  /** Active filter chips (e.g. "Dönem: current", "Takım: Alpha"). */
  filters?: string[];
  /** The chart itself. */
  children: React.ReactNode;
  /** Permission-aware drill control (§10.10). */
  drill?: React.ReactNode;
  /** Explain: evidence / insight facts behind the chart. */
  explain?: React.ReactNode;
  /** Action affordances (e.g. suggested actions). */
  actions?: React.ReactNode;
  className?: string;
}

export function ChartFrame({
  question,
  metricDefinition,
  filters,
  children,
  drill,
  explain,
  actions,
  className,
}: ChartFrameProps) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{question}</CardTitle>
            <CardDescription>{metricDefinition}</CardDescription>
          </div>
          {drill ? <div className="shrink-0">{drill}</div> : null}
        </div>
        {filters && filters.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {filters.map((f) => (
              <Badge key={f} variant="outline" className="text-xs font-normal">
                {f}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
      {explain || actions ? (
        <div className="mt-auto flex flex-col items-stretch gap-2 border-t px-6 py-3">
          {explain}
          {actions}
        </div>
      ) : null}
    </Card>
  );
}
