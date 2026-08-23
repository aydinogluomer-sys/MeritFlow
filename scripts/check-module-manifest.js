#!/usr/bin/env node
/**
 * ENGINEERING-29 — module manifest drift gate. Fails CI when src/modules/ and its manifest disagree,
 * so the docs (src/modules/README.md + module-manifest.json) can never silently rot as modules land.
 *
 * Rules:
 *   1 directory-not-in-manifest  — every folder under src/modules/ must be registered.
 *   2 placeholder-but-has-index  — a "placeholder" module that actually has index.ts (implemented,
 *                                  manifest not updated).
 *   3 implemented-but-no-index   — an "implemented" module with no index.ts (claim without code).
 *   4 stale-gitkeep              — an "implemented" module still carrying a placeholder .gitkeep.
 */
const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.join('src', 'modules');
const MANIFEST = path.join(MODULES_DIR, 'module-manifest.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const declared = new Set(manifest.modules.map((m) => m.name));

let errors = 0;
function fail(rule, mod) {
  console.error(`[E29-DRIFT] ${rule}: ${mod}`);
  errors += 1;
}

// RULE 1 — every module directory on disk must be registered in the manifest. (README.md and the
// manifest file itself are not directories, so they are skipped automatically.)
const dirs = fs
  .readdirSync(MODULES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
for (const dir of dirs) {
  if (!declared.has(dir)) fail('directory-not-in-manifest', dir);
}

// RULES 2/3/4 — reconcile each declared module's status with what is actually on disk.
for (const m of manifest.modules) {
  const hasIndex = fs.existsSync(path.join(MODULES_DIR, m.name, 'index.ts'));
  const hasGitkeep = fs.existsSync(path.join(MODULES_DIR, m.name, '.gitkeep'));

  if (m.status === 'placeholder' && hasIndex) fail('placeholder-but-has-index', m.name);
  if (m.status === 'implemented' && !hasIndex) fail('implemented-but-no-index', m.name);
  if (m.status === 'implemented' && hasGitkeep) fail('stale-gitkeep', m.name);
}

if (errors > 0) {
  console.error(
    `\nModule manifest DRIFT — ${errors} issue(s). Update src/modules/module-manifest.json (and README) or the code.`,
  );
  process.exit(1);
}
console.log(`Module manifest OK — ${manifest.modules.length} modules verified.`);
