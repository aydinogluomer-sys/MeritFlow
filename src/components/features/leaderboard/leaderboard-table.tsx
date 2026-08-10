import * as React from 'react';
import { EmptyState } from '@/components/features/shared/empty-state';

const pointFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });

/** One ranked leaderboard row (aggregated task_approved points per employee). */
export type LeaderboardRow = {
  employeeId: string;
  name: string;
  totalPoints: number;
  /** Highlight the caller's own row. */
  isSelf?: boolean;
};

export interface LeaderboardTableProps {
  rows: LeaderboardRow[];
}

/**
 * Privacy-first ranked leaderboard (plain Tailwind). Rows are ordered by total approved
 * points (descending); ranks are dense (ties share a rank). Only rows the caller may see
 * under RLS are passed in — the caller's own row is highlighted. Read-only.
 */
export function LeaderboardTable({ rows }: LeaderboardTableProps) {
  if (rows.length === 0) {
    return <EmptyState message="Sıralama için henüz puan yok" />;
  }

  const ranked = [...rows].sort((a, b) => b.totalPoints - a.totalPoints);

  // Dense ranking: equal totals share a rank.
  let lastPoints: number | null = null;
  let lastRank = 0;

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Puan sıralaması</caption>
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-3 font-medium">
              Sıra
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Çalışan
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Toplam puan
            </th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((row, index) => {
            const rank = row.totalPoints === lastPoints ? lastRank : index + 1;
            lastPoints = row.totalPoints;
            lastRank = rank;
            return (
              <tr
                key={row.employeeId}
                className={`border-b last:border-0 ${
                  row.isSelf ? 'bg-primary/5 font-medium' : 'hover:bg-muted/30'
                }`}
              >
                <td className="px-4 py-3 tabular-nums">{rank}</td>
                <td className="px-4 py-3">
                  {row.name}
                  {row.isSelf ? (
                    <span className="ml-2 text-xs text-muted-foreground">(sen)</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {pointFormatter.format(row.totalPoints)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
