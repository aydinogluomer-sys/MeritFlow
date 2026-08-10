'use client';

import * as React from 'react';

/** A candidate bonus period the accepted adjustment can be tied to (triggers recalculation). */
export type AdjustmentPeriodOption = {
  id: string;
  label: string;
};

export interface DisputeAdjustmentFormProps {
  /** Current points delta (empty string = unset). Controlled by the parent flow form. */
  pointsDelta: string;
  onPointsDeltaChange: (value: string) => void;
  /** Current bonus period id ('' = none). Controlled by the parent flow form. */
  bonusPeriodId: string;
  onBonusPeriodIdChange: (value: string) => void;
  /** Candidate periods (from bonus_periods, RLS-scoped). */
  periodOptions: AdjustmentPeriodOption[];
  disabled?: boolean;
}

/**
 * Collects the accepted-resolution effects: a signed `pointsDelta` (point_ledger
 * dispute_adjustment) and an optional `bonusPeriodId` that ties the adjustment to a
 * period (triggering a recalculation). Rendered ONLY when resolution='accepted' — the
 * parent flow form feeds these values into `resolveDispute`. Controlled component; no
 * action call of its own.
 */
export function DisputeAdjustmentForm({
  pointsDelta,
  onPointsDeltaChange,
  bonusPeriodId,
  onBonusPeriodIdChange,
  periodOptions,
  disabled = false,
}: DisputeAdjustmentFormProps) {
  return (
    <div className="flex flex-col gap-5 rounded-lg border border-dashed p-4">
      <p className="text-xs text-muted-foreground">
        Kabul edilen itiraz için puan düzeltmesi. Düzeltme puan defterine ayrı bir kayıt
        (dispute_adjustment) olarak yazılır; bir prim dönemi seçilirse o dönem yeniden
        hesaplanır.
      </p>

      <div className="flex flex-col gap-2">
        <label htmlFor="dispute-points-delta" className="text-sm font-medium">
          Puan farkı (delta)
        </label>
        <input
          id="dispute-points-delta"
          type="number"
          inputMode="numeric"
          step={1}
          value={pointsDelta}
          onChange={(e) => onPointsDeltaChange(e.target.value)}
          disabled={disabled}
          placeholder="Örn. 20 veya -10"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
        <p className="text-xs text-muted-foreground">
          Pozitif değer puan ekler, negatif değer düşer. Boş bırakılırsa puan düzeltmesi
          uygulanmaz.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="dispute-bonus-period" className="text-sm font-medium">
          Prim dönemi (opsiyonel)
        </label>
        <select
          id="dispute-bonus-period"
          value={bonusPeriodId}
          onChange={(e) => onBonusPeriodIdChange(e.target.value)}
          disabled={disabled}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value="">Dönem seçilmedi</option>
          {periodOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
