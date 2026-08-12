'use client';

import * as React from 'react';
import { Star } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
    return <EmptyState message="Henüz puan kaydın yok" icon={Star} />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableCaption className="sr-only">Puan defteri</TableCaption>
        <TableHeader>
          <TableRow className="bg-muted/50 text-xs text-muted-foreground">
            <TableHead>Tarih</TableHead>
            <TableHead>Olay</TableHead>
            <TableHead>Gerekçe</TableHead>
            <TableHead className="text-right">Puan</TableHead>
            <TableHead className="text-right">Kırılım</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isTaskApproved = row.event_type === 'task_approved';
            const isExpanded = expandedId === row.id;
            return (
              <React.Fragment key={row.id}>
                <TableRow>
                  <TableCell className="whitespace-nowrap">
                    {dateFormatter.format(new Date(row.created_at))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={EVENT_VARIANTS[row.event_type] ?? 'outline'}>
                      {EVENT_LABELS[row.event_type] ?? row.event_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.reason}</TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${
                      row.points_delta < 0 ? 'text-destructive' : ''
                    }`}
                  >
                    {row.points_delta > 0 ? '+' : ''}
                    {pointFormatter.format(row.points_delta)}
                  </TableCell>
                  <TableCell className="text-right">
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
                  </TableCell>
                </TableRow>
                {isTaskApproved && isExpanded ? (
                  <TableRow className="bg-muted/20">
                    <TableCell colSpan={5} className="py-4">
                      <PointBreakdown metadata={row.metadata} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
