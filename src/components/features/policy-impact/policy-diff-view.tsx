import { DriverList, type Driver } from '@/components/intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import type { PolicyDiff, PolicyDiffEntry } from '@/modules/policy-change-impact';

// Presentational structural-diff view (§8.3, server-safe). Numeric "changed" entries render as a
// DriverList (signed impact = after − before); added/removed/non-numeric entries render as an
// accessible table. Nothing relies on colour.

const CATEGORY_LABEL: Record<string, string> = {
  metric: 'Metrik',
  weight: 'Ağırlık',
  threshold: 'Eşik',
  cap: 'Tavan',
  eligibility: 'Uygunluk',
  formula: 'Formül',
  rounding: 'Yuvarlama',
};

const CHANGE_LABEL: Record<string, string> = {
  added: 'Eklendi',
  removed: 'Kaldırıldı',
  changed: 'Değişti',
};

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A numeric changed entry → a driver whose signed impact is (after − before). */
function toDriver(e: PolicyDiffEntry): Driver | null {
  const before = asNumber(e.before);
  const after = asNumber(e.after);
  if (e.changeType !== 'changed' || before === null || after === null) return null;
  return { code: e.path, label: e.path, impact: after - before, value: after, threshold: before };
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

export function PolicyDiffView({ diff }: { diff: PolicyDiff }) {
  if (!diff.hasChanges) {
    return <EmptyState message="İki sürüm arasında yapısal fark yok." />;
  }

  const numericDrivers = diff.entries.map(toDriver).filter((d): d is Driver => d !== null);
  const structural = diff.entries.filter((e) => toDriver(e) === null);

  return (
    <div className="flex flex-col gap-6">
      {numericDrivers.length > 0 ? (
        <section aria-labelledby="diff-weights">
          <h3 id="diff-weights" className="mb-2 text-sm font-medium">
            Değişen ağırlık / eşik / tavan
          </h3>
          <DriverList drivers={numericDrivers} caption="Değişen sayısal politika alanları" />
        </section>
      ) : null}

      {structural.length > 0 ? (
        <section aria-labelledby="diff-structural">
          <h3 id="diff-structural" className="mb-2 text-sm font-medium">
            Eklenen / kaldırılan / diğer değişiklikler
          </h3>
          <table className="w-full text-sm">
            <caption className="sr-only">Yapısal politika farkları</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="py-1 pr-4 font-medium">Alan</th>
                <th scope="col" className="py-1 pr-4 font-medium">Kategori</th>
                <th scope="col" className="py-1 pr-4 font-medium">Değişim</th>
                <th scope="col" className="py-1 pr-4 font-medium">Önce</th>
                <th scope="col" className="py-1 font-medium">Sonra</th>
              </tr>
            </thead>
            <tbody>
              {structural.map((e) => (
                <tr key={`${e.path}:${e.changeType}`} className="border-t">
                  <th scope="row" className="py-1 pr-4 font-mono text-xs font-normal">{e.path}</th>
                  <td className="py-1 pr-4">{CATEGORY_LABEL[e.category] ?? e.category}</td>
                  <td className="py-1 pr-4">{CHANGE_LABEL[e.changeType] ?? e.changeType}</td>
                  <td className="py-1 pr-4 tabular-nums">{renderValue(e.before)}</td>
                  <td className="py-1 tabular-nums">{renderValue(e.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
