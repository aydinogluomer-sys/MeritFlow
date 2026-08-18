#!/usr/bin/env node
// ENGINEERING-13 — percentile calculator for the perf gate.
//
// Reads newline-separated timing numbers from stdin and emits: "p50=X p95=Y p99=Z" (2 decimals).
// Empty lines and non-numeric lines are ignored; if NO valid number remains (empty input, or all
// NaN/non-numeric) it exits 1 with a stderr message — it NEVER silently prints 0.00.
//
// Percentile: for p in 0..100 on a sorted array of length n,
//   index = clamp(ceil(p/100 * n) - 1, 0, n-1)
// which reproduces the formula the old inline Python used.
//
// Pure Node.js built-ins; no dependencies.

function fail(msg) {
  process.stderr.write(`calc-percentiles: ${msg}\n`);
  process.exit(1);
}

function main(text) {
  const xs = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (xs.length === 0) return fail('no valid numeric input');

  const n = xs.length;
  const pc = (p) => xs[Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))];

  process.stdout.write(`p50=${pc(50).toFixed(2)} p95=${pc(95).toFixed(2)} p99=${pc(99).toFixed(2)}\n`);
}

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  data += chunk;
});
process.stdin.on('end', () => {
  main(data);
});
