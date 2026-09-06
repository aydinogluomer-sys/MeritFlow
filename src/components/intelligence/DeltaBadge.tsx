import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Phase P0 — shared visualization primitive (plan §19). Presentational only. Accessibility (§19):
// direction is conveyed by a glyph (▲/▼/→) AND a sign (+/−) AND an aria-label — NEVER by color alone.
// Color (via Badge variant) is supplementary. Prop types are self-contained (no data fetching, no
// domain-module import) so the primitive is reusable in any tree.

export interface DeltaBadgeProps {
  /** Signed delta. Positive = increase, negative = decrease, 0 = no change. */
  value: number;
  /** Unit suffix appended to the magnitude (e.g. '%', 'ms'). */
  unit?: string;
  /** Optional formatter for the absolute magnitude (defaults to localized number). */
  formatValue?: (abs: number) => string;
  /** When true (default), an increase is styled "good". Affects color only, never the label. */
  higherIsBetter?: boolean;
  className?: string;
}

export function DeltaBadge({
  value,
  unit = '',
  formatValue,
  higherIsBetter = true,
  className,
}: DeltaBadgeProps) {
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const glyph = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '→';
  const sign = direction === 'up' ? '+' : direction === 'down' ? '−' : '';
  const abs = Math.abs(value);
  const magnitude = formatValue ? formatValue(abs) : abs.toLocaleString('tr-TR');
  const word = direction === 'up' ? 'arttı' : direction === 'down' ? 'azaldı' : 'değişmedi';

  const good =
    direction === 'flat' ? 'neutral' : (direction === 'up') === higherIsBetter ? 'good' : 'bad';
  const variant = good === 'good' ? 'secondary' : good === 'bad' ? 'destructive' : 'outline';

  return (
    <Badge
      variant={variant}
      className={cn('gap-1 tabular-nums', className)}
      aria-label={`${magnitude}${unit} ${word}`}
    >
      <span aria-hidden="true">{glyph}</span>
      <span>
        {sign}
        {magnitude}
        {unit}
      </span>
    </Badge>
  );
}
