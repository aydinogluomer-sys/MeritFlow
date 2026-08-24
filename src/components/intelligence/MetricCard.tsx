import * as React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DeltaBadge } from './DeltaBadge';

// Phase P0 — shared visualization primitive (plan §19 / metric card contract §10.3: value, delta,
// baseline, status, definition). Presentational only (no data fetching, no hooks → Server-Component
// safe). Accessibility: the value carries its label via aria-label; status is conveyed by TEXT, not
// color alone; the definition is a visible caption.

export type MetricStatus = 'ok' | 'warning' | 'critical';

const STATUS_LABEL: Record<MetricStatus, string> = {
  ok: 'Normal',
  warning: 'Uyarı',
  critical: 'Kritik',
};

export interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  /** Optional signed delta vs baseline → rendered as a DeltaBadge. */
  delta?: number;
  deltaUnit?: string;
  deltaHigherIsBetter?: boolean;
  baseline?: string | number;
  /** Short "what does this measure?" definition (accessible caption). */
  definition?: string;
  status?: MetricStatus;
  className?: string;
}

export function MetricCard({
  label,
  value,
  unit,
  delta,
  deltaUnit,
  deltaHigherIsBetter,
  baseline,
  definition,
  status,
  className,
}: MetricCardProps) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
          {status ? (
            <Badge variant={status === 'critical' ? 'destructive' : 'outline'}>
              {STATUS_LABEL[status]}
            </Badge>
          ) : null}
        </div>
        {definition ? <CardDescription>{definition}</CardDescription> : null}
      </CardHeader>
      <CardContent className="pt-0">
        <p className="flex items-baseline gap-1" aria-label={`${label}: ${value}${unit ?? ''}`}>
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
        </p>
        <div className="mt-2 flex items-center gap-3">
          {delta !== undefined ? (
            <DeltaBadge value={delta} unit={deltaUnit} higherIsBetter={deltaHigherIsBetter} />
          ) : null}
          {baseline !== undefined ? (
            <span className="text-xs text-muted-foreground">Baz: {baseline}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
