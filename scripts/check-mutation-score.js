#!/usr/bin/env node
/**
 * ENGINEERING-21 (§10) — mutation-score regression gate. Reads the Stryker JSON report and the
 * committed baseline, and fails (exit 1) if any gated scope dropped below its recorded floor.
 *
 * NOTE: the Stryker JSON report (mutation-testing-elements schema) does NOT carry a pre-computed
 * per-file `mutationScore`; it lists `files[path].mutants[]` with a `status` each. So the score is
 * derived here the same way Stryker/Dashboard do:
 *   detected = killed + timeout;  valid = detected + survived + noCoverage
 *   mutationScore = detected / valid * 100   (invalid statuses — compile/runtime error, ignored —
 *   are excluded from the denominator; 0 valid mutants => score 0).
 */
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join('reports', 'mutation', 'report.json');
const BASELINE_PATH = 'mutation-baseline.json';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Mutation score (0..100) for one file report, from its mutant statuses. */
function scoreOf(fileReport) {
  let killed = 0;
  let timeout = 0;
  let survived = 0;
  let noCoverage = 0;
  for (const m of fileReport.mutants ?? []) {
    switch (m.status) {
      case 'Killed':
        killed += 1;
        break;
      case 'Timeout':
        timeout += 1;
        break;
      case 'Survived':
        survived += 1;
        break;
      case 'NoCoverage':
        noCoverage += 1;
        break;
      default:
        break; // Ignored / CompileError / RuntimeError / Pending — excluded from the denominator.
    }
  }
  const detected = killed + timeout;
  const valid = detected + survived + noCoverage;
  return valid === 0 ? 0 : (detected / valid) * 100;
}

/** Find a file report by exact key, else by a key that ends with the scope path (path-separator agnostic). */
function findFileReport(files, scopeFile) {
  if (files[scopeFile]) return files[scopeFile];
  const norm = scopeFile.replace(/\\/g, '/');
  const key = Object.keys(files).find((k) => k.replace(/\\/g, '/').endsWith(norm));
  return key ? files[key] : null;
}

function main() {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error(`MISSING: ${REPORT_PATH} not found — run 'npm run test:mutation' first.`);
    process.exit(1);
  }
  const report = readJson(REPORT_PATH);
  const baseline = readJson(BASELINE_PATH);
  const files = report.files ?? {};

  let failed = false;
  for (const [name, scope] of Object.entries(baseline.scopes)) {
    const fileReport = findFileReport(files, scope.file);
    if (!fileReport) {
      console.error(`✗ ${name}: ${scope.file} not in mutation report`);
      failed = true;
      continue;
    }
    const score = scoreOf(fileReport);
    const ok = score >= scope.minScore;
    console.log(`${ok ? '✓' : '✗'} ${name}: ${score.toFixed(1)} (min ${scope.minScore})`);
    if (!ok) failed = true;
  }

  if (failed) {
    console.error('\nMutation score regression — a gated scope fell below its baseline floor.');
    process.exit(1);
  }
  console.log('\nMutation baseline OK.');
}

main();
