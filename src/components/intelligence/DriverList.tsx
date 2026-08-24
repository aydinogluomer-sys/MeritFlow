import * as React from 'react';
import { cn } from '@/lib/utils';

// Phase P0 — shared visualization primitive (plan §19; risk drivers §3.4). Presentational only.
// Rendered as a real <table> with a caption + header row, so it is inherently the accessible "table
// alternative" for driver data (§19) and readable by screen readers. Impact carries a sign; nothing
// relies on color. Self-contained prop types (no data fetching).

export interface Driver {
  /** Stable driver code (e.g. 'VOLUME_WEIGHT_HIGH'). */
  code: string;
  /** Human label; falls back to `code`. */
  label?: string;
  /** Signed contribution of this driver to the score. */
  impact: number;
  value?: number;
  threshold?: number;
}

export interface DriverListProps {
  drivers: Driver[];
  caption?: string;
  className?: string;
}

function signed(n: number): string {
  const s = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${s}${Math.abs(n).toLocaleString('tr-TR')}`;
}

export function DriverList({ drivers, caption = 'Etki eden sürücüler', className }: DriverListProps) {
  if (drivers.length === 0) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>Gösterilecek sürücü yok.</p>
    );
  }

  return (
    <table className={cn('w-full text-sm', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-medium">
            Sürücü
          </th>
          <th scope="col" className="py-1 pr-4 font-medium">
            Etki
          </th>
          <th scope="col" className="py-1 pr-4 font-medium">
            Değer
          </th>
          <th scope="col" className="py-1 font-medium">
            Eşik
          </th>
        </tr>
      </thead>
      <tbody>
        {drivers.map((d) => (
          <tr key={d.code} className="border-t">
            <th scope="row" className="py-1 pr-4 font-normal">
              {d.label ?? d.code}
            </th>
            <td className="py-1 pr-4 tabular-nums">{signed(d.impact)}</td>
            <td className="py-1 pr-4 tabular-nums">
              {d.value !== undefined ? d.value.toLocaleString('tr-TR') : '—'}
            </td>
            <td className="py-1 tabular-nums">
              {d.threshold !== undefined ? d.threshold.toLocaleString('tr-TR') : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
