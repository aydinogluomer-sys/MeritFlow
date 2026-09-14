import * as React from 'react';

// Phase P4 (8-B1) — the accessible SOURCE OF TRUTH behind every chart (§19). A chart renders its SVG
// aria-hidden (decorative) and pairs it with this <table> inside a collapsible <details> so the exact
// plotted rows are always reachable by keyboard + screen reader, with tabular-nums and scoped headers.
// Presentational, Server-Component safe.
export interface DataTableColumn<Row> {
  key: string;
  header: string;
  /** Render a cell; numeric cells should be right-aligned + tabular. */
  cell: (row: Row) => React.ReactNode;
  /** First column becomes the row header (scope="row"). */
  rowHeader?: boolean;
  numeric?: boolean;
}

export interface ChartDataTableProps<Row> {
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  /** Disclosure summary label. */
  summary?: string;
}

export function ChartDataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  summary = 'Veri tablosu',
}: ChartDataTableProps<Row>) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">{summary}</summary>
      <table className="mt-2 w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-muted-foreground">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'py-1 text-right' : 'py-1 text-left'}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="border-b last:border-0">
              {columns.map((c) =>
                c.rowHeader ? (
                  <th key={c.key} scope="row" className="py-1 text-left font-normal">
                    {c.cell(row)}
                  </th>
                ) : (
                  <td key={c.key} className={c.numeric ? 'py-1 text-right tabular-nums' : 'py-1 text-left'}>
                    {c.cell(row)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
