import { EmptyState } from '@/components/features/shared/empty-state';

// Presentational simplification candidates (§6.8, server-safe). ADVISORY ONLY — clearly framed as
// suggestions to review; there is NO auto-apply / delete control here (§26). Rendered table-first.
export interface CandidateView {
  code: string;
  kind: string;
  detail: string;
}

const KIND_LABEL: Record<string, string> = {
  duplicate_outcome: 'Aynı sonuç',
  unused_bucket: 'Kullanılmayan kova',
};

export function SimplificationCandidates({ candidates }: { candidates: CandidateView[] }) {
  if (candidates.length === 0) {
    return <EmptyState message="Sadeleştirme adayı bulunamadı." />;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Aşağıdaki adaylar yalnızca <strong>danışma amaçlıdır</strong>; otomatik olarak uygulanmaz,
        silinmez veya politikayı değiştirmez. İnceleyip elle karar verin.
      </p>
      <table className="w-full text-sm">
        <caption className="sr-only">Sadeleştirme adayları (danışma amaçlı)</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 pr-4 font-medium">Tür</th>
            <th scope="col" className="py-1 font-medium">Bulgu</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.code} className="border-t">
              <th scope="row" className="py-2 pr-4 font-normal">{KIND_LABEL[c.kind] ?? c.kind}</th>
              <td className="py-2">{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
