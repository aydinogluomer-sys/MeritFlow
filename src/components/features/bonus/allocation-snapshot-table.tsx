import { Badge, type BadgeProps } from '@/components/ui/badge';
import { EmptyState } from '@/components/features/shared/empty-state';
import { BonusBreakdown, type AllocationFactors } from './bonus-breakdown';

/** Subset of `bonus_allocations` columns used by the snapshot view (RLS-scoped select). */
export type AllocationRow = {
  id: string;
  employee_id: string;
  /** Resolved display name (from profiles); falls back to the id. */
  employeeName?: string | null;
  adjusted_score: number;
  final_amount_minor: number;
  cap_minor: number | null;
  cap_applied: string;
  factors: AllocationFactors | null;
  status: string;
};

const scoreFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

const CAP_LABELS: Record<string, string> = {
  yes: 'Uygulandı',
  no: 'Uygulanmadı',
  pending_missing_cap_basis: 'Cap tabanı eksik',
};

const CAP_VARIANTS: Record<string, BadgeProps['variant']> = {
  yes: 'secondary',
  no: 'outline',
  pending_missing_cap_basis: 'destructive',
};

/**
 * An allocation is only "vested" (final/paid) once its status is 'paid' (accrued).
 * Every other status is an estimate and is labelled "(tahmini)" — never presented as
 * final/paid (estimated ≠ vested).
 */
function isAccrued(status: string): boolean {
  return status === 'paid';
}

export interface AllocationSnapshotTableProps {
  allocations: AllocationRow[];
  currency: string;
}

/**
 * Per-employee allocation rows from the period's completed run. Amounts are labelled
 * "(tahmini)" unless the row is accrued (status='paid'); an allocation is never shown
 * as final/paid otherwise. Each row carries a "neden bu prim?" breakdown.
 */
export function AllocationSnapshotTable({
  allocations,
  currency,
}: AllocationSnapshotTableProps) {
  if (allocations.length === 0) {
    return <EmptyState message="Bu dönem için dağıtım satırı yok" />;
  }

  const moneyFormatter = new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: currency || 'TRY',
  });

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Prim dağıtım satırları (tahmini)</caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Çalışan
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Düzeltilmiş puan
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Cap
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Tutar
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Neden bu prim?
            </th>
          </tr>
        </thead>
        <tbody>
          {allocations.map((row) => {
            const accrued = isAccrued(row.status);
            return (
              <tr key={row.id} className="border-b align-top last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">
                  {row.employeeName ?? row.employee_id}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {scoreFormatter.format(row.adjusted_score)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={CAP_VARIANTS[row.cap_applied] ?? 'outline'}>
                    {CAP_LABELS[row.cap_applied] ?? row.cap_applied}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-medium">
                      {moneyFormatter.format(row.final_amount_minor / 100)}
                    </span>
                    <span
                      className={
                        accrued
                          ? 'text-xs font-medium text-primary'
                          : 'text-xs text-muted-foreground'
                      }
                    >
                      {accrued ? 'Tahakkuk etti' : '(tahmini)'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <BonusBreakdown
                    factors={row.factors}
                    adjustedScore={row.adjusted_score}
                    finalAmountMinor={row.final_amount_minor}
                    capMinor={row.cap_minor}
                    capApplied={row.cap_applied}
                    currency={currency}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
