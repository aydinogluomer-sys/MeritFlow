import { MetricCard, DeltaBadge } from '@/components/intelligence';
import { EmptyState } from '@/components/features/shared/empty-state';
import type { VersionTrendEntry } from '@/modules/policy-complexity';

// Presentational debt badge + version trend (§6.10, server-safe). Higher debt is WORSE, so the delta
// badge uses higherIsBetter=false. Recharts is deferred — the trend is a table. Rows are labelled
// "tam" (static+runtime, full-v1) vs "statik" (static-only, static-v1) so a mixed-rule-set comparison
// across transitional versions is transparent (runtimeScore === null ⇒ static-only).
export function DebtTrend({ trend }: { trend: VersionTrendEntry[] }) {
  if (trend.length === 0) {
    return <EmptyState message="Bu politika için henüz bir borç değerlendirmesi yok." />;
  }
  const latest = trend[trend.length - 1]!;

  return (
    <div className="flex flex-col gap-4">
      <MetricCard
        label={`Politika borcu (v${latest.versionNo})`}
        value={latest.totalScore}
        delta={latest.deltaTotal}
        deltaHigherIsBetter={false}
        baseline={trend.length > 1 ? `v${trend[trend.length - 2]!.versionNo}` : undefined}
        definition="Toplam borç = statik karmaşıklık + çalışma-zamanı bakım yükü"
        status={latest.deltaTotal > 0 ? 'warning' : 'ok'}
        className="max-w-sm"
      />

      <section aria-labelledby="debt-trend-h">
        <h3 id="debt-trend-h" className="mb-2 text-sm font-medium">Sürüm eğilimi</h3>
        <table className="w-full text-sm">
          <caption className="sr-only">Politika sürümleri arası borç eğilimi</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="py-1 pr-4 font-medium">Sürüm</th>
              <th scope="col" className="py-1 pr-4 font-medium">Tür</th>
              <th scope="col" className="py-1 pr-4 font-medium">Statik</th>
              <th scope="col" className="py-1 pr-4 font-medium">Çalışma-zamanı</th>
              <th scope="col" className="py-1 pr-4 font-medium">Toplam</th>
              <th scope="col" className="py-1 font-medium">Değişim</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((t) => (
              <tr key={t.policyVersionId} className="border-t">
                <th scope="row" className="py-1 pr-4 font-normal tabular-nums">v{t.versionNo}</th>
                <td className="py-1 pr-4">{t.runtimeScore === null ? 'statik' : 'tam'}</td>
                <td className="py-1 pr-4 tabular-nums">{t.staticScore.toLocaleString('tr-TR')}</td>
                <td className="py-1 pr-4 tabular-nums">
                  {t.runtimeScore === null ? '—' : t.runtimeScore.toLocaleString('tr-TR')}
                </td>
                <td className="py-1 pr-4 tabular-nums">{t.totalScore.toLocaleString('tr-TR')}</td>
                <td className="py-1">
                  <DeltaBadge value={t.deltaTotal} higherIsBetter={false} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
