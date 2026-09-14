'use client';

import * as React from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

// Phase P4 (8-B1) — micro-trend for a MetricCard (§10.3). The card's value + delta are the accessible
// numeric truth; the sparkline is a supplementary glyph carrying an aria-label that summarizes the
// trend in TEXT (not color) — §19. Rendered only for ≥2 points.
export interface SparklineProps {
  data: number[];
  /** Overrides the auto-generated accessible trend summary. */
  label?: string;
  height?: number;
  className?: string;
}

export function Sparkline({ data, label, height = 32, className }: SparklineProps) {
  if (data.length < 2) return null;
  const points = data.map((value, index) => ({ index, value }));
  const first = data[0]!;
  const last = data[data.length - 1]!;
  const direction = last > first ? 'yükseliş' : last < first ? 'düşüş' : 'sabit';
  const aria =
    label ?? `Eğilim: ${direction} (${first.toLocaleString('tr-TR')} → ${last.toLocaleString('tr-TR')})`;
  return (
    <span
      role="img"
      aria-label={aria}
      className={className}
      style={{ display: 'inline-block', width: '100%', height }}
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </span>
  );
}
