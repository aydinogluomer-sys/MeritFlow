'use client';

import * as React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { ChartDataTable } from './data-table';

// Phase P4 (8-B1) — categorical distribution / histogram (§10.16), e.g. per-employee payout bins
// (pairs with payout_concentration HHI). SVG aria-hidden; the data table is the accessible truth (§19);
// single accessible fill + labelled axes — no color-only semantics.
export interface DistributionBin {
  label: string;
  count: number;
}

export interface DistributionChartProps {
  data: DistributionBin[];
  countLabel: string;
  caption: string;
  height?: number;
  className?: string;
}

export function DistributionChart({ data, countLabel, caption, height = 220, className }: DistributionChartProps) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Gösterilecek veri yok.</p>;
  }
  return (
    <div className={className}>
      <div aria-hidden="true" style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 12 }}
              width={56}
              label={{ value: countLabel, angle: -90, position: 'insideLeft', style: { fontSize: 11, textAnchor: 'middle' } }}
            />
            <Tooltip />
            <Bar dataKey="count" fill="currentColor" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartDataTable
        caption={caption}
        rows={data}
        rowKey={(r) => r.label}
        columns={[
          { key: 'label', header: 'Aralık', rowHeader: true, cell: (r) => r.label },
          { key: 'count', header: countLabel, numeric: true, cell: (r) => r.count.toLocaleString('tr-TR') },
        ]}
      />
    </div>
  );
}
