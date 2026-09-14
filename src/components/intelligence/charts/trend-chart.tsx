'use client';

import * as React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { ChartDataTable } from './data-table';

// Phase P4 (8-B1) — time-series line (§10.16). The SVG is aria-hidden decorative; the paired data
// table is the accessible truth (§19). Single accessible stroke (currentColor) + labelled axes — no
// color-only semantics. 'use client' (Recharts needs the DOM).
export interface TrendPoint {
  label: string;
  value: number;
}

export interface TrendChartProps {
  data: TrendPoint[];
  valueLabel: string;
  unit?: string;
  caption: string;
  height?: number;
  className?: string;
}

export function TrendChart({ data, valueLabel, unit, caption, height = 220, className }: TrendChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Gösterilecek veri yok.</p>;
  }
  return (
    <div className={className}>
      <div aria-hidden="true" style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis
              tick={{ fontSize: 12 }}
              width={64}
              label={{ value: unit ? `${valueLabel} (${unit})` : valueLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, textAnchor: 'middle' } }}
            />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption={caption}
        rows={data}
        rowKey={(r) => r.label}
        columns={[
          { key: 'label', header: 'Dönem', rowHeader: true, cell: (r) => r.label },
          {
            key: 'value',
            header: unit ? `${valueLabel} (${unit})` : valueLabel,
            numeric: true,
            cell: (r) => r.value.toLocaleString('tr-TR'),
          },
        ]}
      />
    </div>
  );
}
