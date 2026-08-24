import * as React from 'react';
import { cn } from '@/lib/utils';

// Phase P0 — shared visualization primitive (plan §19; every insight is traceable to evidence §1
// pt.5). Presentational only. Built on the native <details>/<summary> disclosure — fully keyboard
// accessible with zero client JS, so it is Server-Component safe and needs no 'use client'. Self-
// contained prop types (no data fetching).

export interface EvidenceItem {
  /** Deterministic source kind (metric/task/review/policy_version/...). */
  sourceType: string;
  sourceId: string;
}

export interface EvidenceDrawerProps {
  evidence: EvidenceItem[];
  label?: string;
  className?: string;
}

export function EvidenceDrawer({ evidence, label = 'Kanıt', className }: EvidenceDrawerProps) {
  return (
    <details className={cn('rounded-md border p-2 text-sm', className)}>
      <summary className="cursor-pointer select-none font-medium">
        {label} ({evidence.length})
      </summary>
      {evidence.length === 0 ? (
        <p className="mt-2 text-muted-foreground">Kanıt bağlanmadı.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {evidence.map((e) => (
            <li key={`${e.sourceType}:${e.sourceId}`} className="flex gap-2">
              <span className="font-mono text-xs text-muted-foreground">{e.sourceType}</span>
              <span className="font-mono text-xs">{e.sourceId}</span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
