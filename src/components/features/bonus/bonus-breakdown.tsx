/**
 * "neden bu prim?" — a right-to-explanation breakdown for a single allocation row.
 * Presentational (server-renderable). Reads the calculation `factors` jsonb plus the
 * derived amounts to explain the pro-rata share transparently. All amounts here are
 * ESTIMATED (estimated ≠ vested) unless the parent marks the row as accrued.
 */

/**
 * Shape of `bonus_allocations.factors` (jsonb). Populated by the calculation engine
 * (role/quality/team/eligibility/proration + pool-share metadata). Every field is
 * optional/defensive — the engine's exact keys are not guaranteed at read time.
 */
export type AllocationFactors = {
  adj_points?: number;
  adjusted_score?: number;
  pool_share?: number;
  pro_rata?: number;
  proration_factor?: number;
  eligibility?: string | boolean;
  role?: string;
  quality?: string | number;
  team?: string;
  [key: string]: unknown;
};

const numberFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat('tr-TR', {
  style: 'percent',
  maximumFractionDigits: 2,
});

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface BonusBreakdownProps {
  factors: AllocationFactors | null;
  adjustedScore: number;
  finalAmountMinor: number;
  capMinor: number | null;
  capApplied: string;
  currency: string;
}

export function BonusBreakdown({
  factors,
  adjustedScore,
  finalAmountMinor,
  capMinor,
  capApplied,
  currency,
}: BonusBreakdownProps) {
  const moneyFormatter = new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: currency || 'TRY',
  });

  const f = factors ?? {};
  // adj_points / adjusted score: prefer the explicit factor, fall back to the column.
  const adjPoints = toNumber(f.adj_points) ?? toNumber(f.adjusted_score) ?? adjustedScore;
  const poolShare = toNumber(f.pool_share) ?? toNumber(f.pro_rata);
  const proration = toNumber(f.proration_factor);

  const rows: Array<{ label: string; value: string }> = [];
  rows.push({ label: 'Düzeltilmiş puan (adj)', value: numberFormatter.format(adjPoints) });
  if (poolShare != null) {
    rows.push({ label: 'Havuz payı (pro-rata)', value: percentFormatter.format(poolShare) });
  }
  if (proration != null) {
    rows.push({ label: 'Oranlama katsayısı', value: numberFormatter.format(proration) });
  }
  if (capApplied === 'yes' && capMinor != null) {
    rows.push({ label: 'Uygulanan cap', value: moneyFormatter.format(capMinor / 100) });
  }
  rows.push({
    label: 'Tahmini tutar',
    value: `${moneyFormatter.format(finalAmountMinor / 100)} (tahmini)`,
  });

  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-xs text-primary underline-offset-4 hover:underline">
        Açıklamayı gör
      </summary>
      <dl className="mt-2 flex flex-col gap-1 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="tabular-nums">{row.value}</dd>
          </div>
        ))}
        {capApplied === 'pending_missing_cap_basis' ? (
          <p className="mt-1 text-destructive">
            Cap tabanı eksik olduğundan tutar askıya alındı (AD6).
          </p>
        ) : null}
        <p className="mt-1 text-muted-foreground">
          Tutarlar tahmindir; tahakkuk (accrual) yapılana kadar kesinleşmez. Tahmini ≠ hak
          edilmiş.
        </p>
      </dl>
    </details>
  );
}
