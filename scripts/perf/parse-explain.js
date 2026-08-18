#!/usr/bin/env node
// ENGINEERING-13 — EXPLAIN JSON parser for the perf gate.
//
// Reads the raw `psql -tAqc "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ..."` output from stdin
// (a JSON array; the plan is element [0]) and emits a single-line, machine-readable JSON object:
//
//   {"executionMs":3.21,"seqScans":[{"relation":"tasks","actualRows":14000}],"sharedHitBlocks":123}
//
// It NEVER silently returns 0: invalid JSON exits 2, a missing "Execution Time" exits 3. This
// replaces the old `printf ... | python3 - <<'PY'` heredoc, where Python read its program from
// stdin (the heredoc) and the piped plan was discarded — always yielding et=0 (false green).
//
// Pure Node.js built-ins; no dependencies.

function fail(code, msg) {
  process.stderr.write(`parse-explain: ${msg}\n`);
  process.exit(code);
}

function toInt(v) {
  const n = Number.parseInt(v ?? 0, 10);
  return Number.isNaN(n) ? 0 : n;
}

function main(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return fail(2, `invalid JSON: ${e.message}`);
  }

  // EXPLAIN FORMAT JSON returns an array; the plan is element [0].
  const root = Array.isArray(parsed) ? parsed[0] : parsed;

  if (!root || typeof root !== 'object' || !Object.prototype.hasOwnProperty.call(root, 'Execution Time')) {
    return fail(3, 'missing "Execution Time" in plan');
  }

  // Recursively collect every Seq Scan node in the plan tree (Plan.Plans[]).
  const seqScans = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node['Node Type'] === 'Seq Scan') {
      seqScans.push({ relation: node['Relation Name'] ?? '?', actualRows: toInt(node['Actual Rows']) });
    }
    const kids = node['Plans'];
    if (Array.isArray(kids)) for (const child of kids) walk(child);
  };
  walk(root['Plan']);

  // Largest offender first.
  seqScans.sort((a, b) => b.actualRows - a.actualRows);

  const sharedHitBlocks = toInt(root['Plan'] && root['Plan']['Shared Hit Blocks']);

  const out = { executionMs: root['Execution Time'], seqScans, sharedHitBlocks };
  process.stdout.write(JSON.stringify(out) + '\n');
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  data += chunk;
});
process.stdin.on('end', () => {
  main(data);
});
