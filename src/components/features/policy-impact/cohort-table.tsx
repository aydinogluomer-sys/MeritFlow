import { DeltaBadge } from '@/components/intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import type { EmployeeImpact } from '@/modules/policy-change-impact';

// Presentational affected-cohort table (server-safe). Shows SIMULATED bonus deltas per employee —
// NO raw compensation (SI-12). Accessible <table>; delta direction via DeltaBadge (glyph+sign, not
// colour). Optional employeeLabels maps ids → display names when available.

const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });

export interface CohortTableProps {
  distribution: EmployeeImpact[];
  employeeLabels?: Record<string, string>;
}

export function CohortTable({ distribution, employeeLabels }: CohortTableProps) {
  if (distribution.length === 0) {
    return <EmptyState message="Etkilenen çalışan yok." />;
  }

  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Etkilenen çalışanlar ve simüle edilen prim değişimi</caption>
      <thead>
        <tr className="text-left text-muted-foreground">
          <th scope="col" className="py-1 pr-4 font-medium">Çalışan</th>
          <th scope="col" className="py-1 pr-4 font-medium">Önce</th>
          <th scope="col" className="py-1 pr-4 font-medium">Sonra</th>
          <th scope="col" className="py-1 font-medium">Değişim</th>
        </tr>
      </thead>
      <tbody>
        {distribution.map((d) => (
          <tr key={d.employeeId} className="border-t">
            <th scope="row" className="py-2 pr-4 font-normal">
              {employeeLabels?.[d.employeeId] ?? d.employeeId}
            </th>
            <td className="py-2 pr-4 tabular-nums">{money.format(d.fromMinor / 100)}</td>
            <td className="py-2 pr-4 tabular-nums">{money.format(d.toMinor / 100)}</td>
            <td className="py-2">
              <DeltaBadge
                value={d.deltaMinor / 100}
                higherIsBetter
                formatValue={(abs) => money.format(abs)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
