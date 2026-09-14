'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { formatMetric } from './model';
import { drillMetricAction } from '@/app/actions/intelligence/drill';

// Phase P4 (8-B1) — permission-aware drill control (§10.10). Renders the metric's servable drill levels
// (from availableDrillLevels, passed as props) as buttons; selecting one calls the server action and
// renders the returned slice as an accessible <table>. Authz is enforced SERVER-SIDE by the action +
// RLS (this control only offers levels the metric can serve; the sensitive employee level is gated by
// the validator at execution). 'company' is the top-level already shown, so only deeper levels appear.
const LEVEL_LABEL: Record<string, string> = { company: 'Şirket', team: 'Takım', employee: 'Çalışan' };

interface DrilledRow {
  key: string;
  dimensions: Record<string, string>;
  value: number | string;
  unit: string;
}

export interface DrillPanelProps {
  metric: string;
  metricLabel: string;
  levels: string[];
}

export function DrillPanel({ metric, metricLabel, levels }: DrillPanelProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<DrilledRow[] | null>(null);
  const [activeLevel, setActiveLevel] = React.useState<string | null>(null);

  const deeperLevels = levels.filter((l) => l !== 'company');
  if (deeperLevels.length === 0) return null;

  async function drill(level: string) {
    setLoading(true);
    setError(null);
    const res = await drillMetricAction({ metric: metric as never, level: level as 'team' | 'employee' });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (!res.data.drilled) {
      setError(res.data.error);
      setRows(null);
      return;
    }
    setActiveLevel(level);
    setRows(res.data.rows);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">İncele:</span>
        {deeperLevels.map((l) => (
          <Button key={l} size="sm" variant="outline" onClick={() => drill(l)} disabled={loading}>
            {LEVEL_LABEL[l] ?? l}
          </Button>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-muted-foreground">Detay getirilemedi ({error}).</p>
      ) : null}
      {rows ? (
        rows.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Bu kırılım için veri yok.</p>
        ) : (
          <table
            className="mt-2 w-full text-sm"
            aria-label={`${metricLabel} — ${activeLevel ? (LEVEL_LABEL[activeLevel] ?? activeLevel) : 'Kırılım'} kırılımı`}
          >
            <caption className="sr-only">
              {metricLabel} — {activeLevel ? (LEVEL_LABEL[activeLevel] ?? activeLevel) : 'Kırılım'} kırılımı
            </caption>
            <thead>
              <tr className="border-b text-muted-foreground">
                <th scope="col" className="py-1 text-left">
                  {activeLevel ? (LEVEL_LABEL[activeLevel] ?? activeLevel) : 'Kırılım'}
                </th>
                <th scope="col" className="py-1 text-right">Değer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fmt = typeof r.value === 'number' ? formatMetric(r.value, r.unit) : { display: String(r.value) };
                return (
                  <tr key={r.key} className="border-b last:border-0">
                    <th scope="row" className="py-1 text-left font-mono text-xs font-normal">
                      {Object.values(r.dimensions)[0] ?? '—'}
                    </th>
                    <td className="py-1 text-right tabular-nums">
                      {fmt.display}
                      {fmt.suffix ? ` ${fmt.suffix}` : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )
      ) : null}
    </div>
  );
}
