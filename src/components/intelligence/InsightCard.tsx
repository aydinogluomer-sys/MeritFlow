import * as React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { EvidenceDrawer, type EvidenceItem } from './EvidenceDrawer';

// Phase P0 — shared visualization primitive (plan §19; insight envelope §2.3). Presentational only
// (no data fetching, no hooks → Server-Component safe). Surfaces the evidence+action invariant
// visually: evidence via EvidenceDrawer, and at least one suggested action. Severity is conveyed by a
// glyph + TEXT label, never color alone (§19). Self-contained prop types.

export type InsightSeverity = 'info' | 'warning' | 'critical';

const SEVERITY: Record<InsightSeverity, { label: string; glyph: string; variant: 'secondary' | 'default' | 'destructive' }> = {
  info: { label: 'Bilgi', glyph: 'ℹ', variant: 'secondary' },
  warning: { label: 'Uyarı', glyph: '⚠', variant: 'default' },
  critical: { label: 'Kritik', glyph: '⛔', variant: 'destructive' },
};

export interface InsightCardAction {
  code: string;
  label: string;
}

export interface InsightCardProps {
  headline: string;
  severity: InsightSeverity;
  /** Authoritative deterministic facts (rendered as a definition list). */
  facts?: Record<string, unknown>;
  evidence: EvidenceItem[];
  /** Suggested actions — the invariant guarantees at least one. */
  actions: InsightCardAction[];
  className?: string;
}

function renderFactValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function InsightCard({
  headline,
  severity,
  facts,
  evidence,
  actions,
  className,
}: InsightCardProps) {
  const sev = SEVERITY[severity];
  const factEntries = facts ? Object.entries(facts) : [];

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{headline}</CardTitle>
          <Badge variant={sev.variant} aria-label={`Önem: ${sev.label}`}>
            <span aria-hidden="true" className="mr-1">
              {sev.glyph}
            </span>
            {sev.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {factEntries.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {factEntries.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular-nums">{renderFactValue(v)}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        <EvidenceDrawer evidence={evidence} />

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Önerilen aksiyonlar</p>
          <ul className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <li key={a.code}>
                <button
                  type="button"
                  data-action-code={a.code}
                  className="rounded-md border px-2.5 py-1 text-sm hover:bg-accent"
                >
                  {a.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
