'use client';

import * as React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { ChartDataTable } from './data-table';

// Phase P4 (8-B1) — waterfall flow (§10.16), e.g. pool → accrual → adjustments → undistributed.
// Recharts has no native waterfall, so each step is a stacked [transparent base, magnitude] bar from
// the prior running total. SVG aria-hidden; the data table (signed delta + running total, with a ▲/▼/→
// glyph — not color) is the accessible truth (§19).
export interface WaterfallStep {
  label: string;
  /** Signed change applied at this step. */
  delta: number;
}

export interface WaterfallChartProps {
  data: WaterfallStep[];
  /** Starting running total (default 0). */
  start?: number;
  valueLabel: string;
  unit?: string;
  caption: string;
  height?: number;
  className?: string;
}

function glyph(delta: number): string {
  return delta > 0 ? '▲' : delta < 0 ? '▼' : '→';
}

export function WaterfallChart({
  data,
  start = 0,
  valueLabel,
  unit,
  caption,
  height = 240,
  className,
}: WaterfallChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Gösterilecek veri yok.</p>;
  }
  // Pure prefix-sum (no render-time mutation): each step's running total = start + Σ prior deltas.
  const rows = data.map((step, i) => {
    const prev = start + data.slice(0, i).reduce((sum, s) => sum + s.delta, 0);
    const total = prev + step.delta;
    return {
      label: step.label,
      delta: step.delta,
      base: Math.min(prev, total),
      magnitude: Math.abs(step.delta),
      total,
    };
  });
  const fmt = (n: number) => n.toLocaleString('tr-TR');
  return (
    <div className={className}>
      <div aria-hidden="true" style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              width={72}
              label={{ value: unit ? `${valueLabel} (${unit})` : valueLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, textAnchor: 'middle' } }}
            />
            <Tooltip />
            {/* transparent base lifts each magnitude bar to its running position */}
            <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="magnitude" stackId="wf" fill="currentColor" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption={caption}
        rows={rows}
        rowKey={(r) => r.label}
        columns={[
          { key: 'label', header: 'Adım', rowHeader: true, cell: (r) => r.label },
          {
            key: 'delta',
            header: unit ? `Değişim (${unit})` : 'Değişim',
            numeric: true,
            cell: (r) => `${glyph(r.delta)} ${r.delta > 0 ? '+' : ''}${fmt(r.delta)}`,
          },
          {
            key: 'total',
            header: unit ? `${valueLabel} (${unit})` : valueLabel,
            numeric: true,
            cell: (r) => fmt(r.total),
          },
        ]}
      />
    </div>
  );
}
