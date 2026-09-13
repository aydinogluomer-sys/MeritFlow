// Test helper (NOT a test file): a minimal in-memory Supabase query-builder fake that actually APPLIES
// eq / in / not-is-null / gte / lt / lte / order predicates to fixed row sets, and is awaitable
// ({ data, error }) or terminated with maybeSingle(). This lets the 8-A1 metric-executor + semantic
// -query-service tests exercise real period filtering / date-windowing / grouping without a database.
type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function builder(initial: Row[]) {
  let rows = [...initial];
  const b = {
    select: () => b,
    eq: (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return b;
    },
    in: (col: string, vals: unknown[]) => {
      const set = new Set(vals);
      rows = rows.filter((r) => set.has(r[col]));
      return b;
    },
    not: (col: string, op: string, val: unknown) => {
      if (op === 'is' && val === null) rows = rows.filter((r) => r[col] !== null && r[col] !== undefined);
      return b;
    },
    gte: (col: string, val: string | number) => {
      rows = rows.filter((r) => (r[col] as string | number) >= val);
      return b;
    },
    lt: (col: string, val: string | number) => {
      rows = rows.filter((r) => (r[col] as string | number) < val);
      return b;
    },
    lte: (col: string, val: string | number) => {
      rows = rows.filter((r) => (r[col] as string | number) <= val);
      return b;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      const dir = opts?.ascending === false ? -1 : 1;
      rows = [...rows].sort((x, y) => {
        const a = x[col] as string | number;
        const c = y[col] as string | number;
        return (a < c ? -1 : a > c ? 1 : 0) * dir;
      });
      return b;
    },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    // Awaitable: `await builder` resolves to { data: rows, error: null }.
    then: (resolve: (v: { data: Row[]; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null as null }).then(resolve, reject),
  };
  return b;
}

/** A fake SupabaseClient<Database>-shaped object whose .from(table) reads from the provided rows. */
export function fakeSupabase(tables: Tables) {
  return {
    from: (table: string) => builder(tables[table] ?? []),
  } as never;
}
