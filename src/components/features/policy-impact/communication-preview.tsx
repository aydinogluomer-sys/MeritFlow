import type { ImpactSummary } from '@/modules/policy-change-impact';

// §8.9 employee communication preview — a DETERMINISTIC template (NO LLM). Every value is rendered
// straight from the impact facts; the wording is fixed. "estimated ≠ vested" framing (CLAUDE.md).

const money = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });
const pct = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

export interface CommunicationPreviewProps {
  summary: ImpactSummary;
  effectiveDate: string | null;
}

export function CommunicationPreview({ summary, effectiveDate }: CommunicationPreviewProps) {
  const budgetPct = pct.format(Number((summary.budgetDeltaPct * 100).toFixed(2)));

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-xs text-muted-foreground">
        Aşağıdaki metin, gerçeklerden otomatik üretilen bir taslaktır (LLM kullanılmaz). Rakamlar
        tahminidir ve kesinleşmiş prim anlamına gelmez.
      </p>

      <div>
        <h3 className="font-medium">Ne değişiyor?</h3>
        <p className="text-muted-foreground">
          Bu politika değişikliği {summary.employeesAffected} çalışanın primini etkiliyor
          ({summary.higher} arttı, {summary.lower} azaldı, {summary.unchanged} değişmedi).
        </p>
      </div>

      <div>
        <h3 className="font-medium">Yürürlük tarihi</h3>
        <p className="text-muted-foreground">{effectiveDate ?? 'Henüz belirtilmedi.'}</p>
      </div>

      <div>
        <h3 className="font-medium">Hesaplama nasıl farklılaşıyor?</h3>
        <p className="text-muted-foreground">
          Dağıtılan toplam prim {money.format(summary.toBudgetMinor / 100)} olur
          (%{budgetPct} değişim). Çalışan başına medyan değişim{' '}
          {money.format(summary.medianEmployeeDeltaMinor / 100)}; bir çalışandaki en yüksek düşüş{' '}
          {money.format(summary.maxNegativeDeltaMinor / 100)}.
        </p>
      </div>
    </div>
  );
}
