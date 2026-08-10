'use client';

import * as React from 'react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';
import { PointBreakdown, type ScoringMetadata } from './point-breakdown';

const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const pointFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 3 });

const EVENT_LABELS: Record<string, string> = {
  task_approved: 'Görev onayı',
  manual_adjustment: 'Manuel düzeltme',
  reversal: 'Ters kayıt',
};

const EVENT_VARIANTS: Record<string, BadgeProps['variant']> = {
  task_approved: 'default',
  manual_adjustment: 'secondary',
  reversal: 'outline',
};

/** Subset of `point_ledger` columns used by the table (RLS-scoped). */
export type PointLedgerRow = {
  id: string;
  event_type: string;
  points_delta: number;
  reason: string;
  created_at: string;
  metadata: ScoringMetadata;
};

export interface PointLedgerTableProps {
  rows: PointLedgerRow[];
}

/**
 * Plain Tailwind table of the caller's point ledger (append-only). `task_approved` rows
 * are expandable to reveal the "neden bu puan?" breakdown ({@link PointBreakdown}) from
 * their scoring `metadata`. Read-only.
 */
export function PointLedgerTable({ rows }: PointLedgerTableProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  if (rows.length === 0) {
    return <EmptyState message="Henüz puan kaydın yok" />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Puan defteri</caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Tarih
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Olay
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Gerekçe
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Puan
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Kırılım
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isTaskApproved = row.event_type === 'task_approved';
            const isExpanded = expandedId === row.id;
            return (
              <React.Fragment key={row.id}>
                <tr className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 whitespace-nowrap">
                    {dateFormatter.format(new Date(row.created_at))}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={EVENT_VARIANTS[row.event_type] ?? 'outline'}>
                      {EVENT_LABELS[row.event_type] ?? row.event_type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.reason}</td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${
                      row.points_delta < 0 ? 'text-destructive' : ''
                    }`}
                  >
                    {row.points_delta > 0 ? '+' : ''}
                    {pointFormatter.format(row.points_delta)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {isTaskApproved ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : row.id)}
                        aria-expanded={isExpanded}
                        className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {isExpanded ? 'Gizle' : 'Neden bu puan?'}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
                {isTaskApproved && isExpanded ? (
                  <tr className="border-b last:border-0 bg-muted/20">
                    <td colSpan={5} className="px-4 py-4">
                      <PointBreakdown metadata={row.metadata} />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
