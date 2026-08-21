import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { load } from 'js-yaml';

// ENGINEERING-22 (§11) — pins the DB surface manifest + access-intent matrix. The CI gate
// (scripts/audit-db-surface.sh) proves every migration surface item is CLASSIFIED; these tests pin
// the manifest's shape and the security-critical access cells (comp D2, rate-limit server-only).

const FINANCIAL_CLASSES = new Set([
  'compensation_sensitive',
  'financial',
  'catalog',
  'operational',
  'audit_log',
  'admin',
]);

const APP_ROLES = ['owner', 'hr', 'manager', 'finance', 'auditor', 'employee', 'support', 'anon'];

type TableEntry = { rls_enabled: boolean; rls_forced: boolean; financial_class: string };
type Surface = {
  version: string;
  tables: Record<string, TableEntry>;
  views: Record<string, { financial_class: string }>;
  security_definer_functions: Record<string, { category: string }>;
};
type Cell = { read: boolean | string; write: boolean };
type AccessMatrix = {
  version: string;
  roles: string[];
  matrix: Record<string, Record<string, Cell>>;
};

function readYaml<T>(relPath: string): T {
  return load(readFileSync(join(process.cwd(), relPath), 'utf8')) as T;
}

const surface = readYaml<Surface>('security/db-surface.yml');
const access = readYaml<AccessMatrix>('security/access-matrix.yml');

/** Type-safe access cell lookup (throws if the table/role row is missing). */
function cell(table: string, role: string): Cell {
  const row = access.matrix[table];
  if (!row) throw new Error(`access-matrix has no row for ${table}`);
  const c = row[role];
  if (!c) throw new Error(`access-matrix ${table} has no cell for role ${role}`);
  return c;
}

describe('db-surface.yml', () => {
  it('1. parses and has the required top-level schema keys', () => {
    expect(surface.version).toBeDefined();
    expect(surface.tables).toBeTypeOf('object');
    expect(surface.views).toBeTypeOf('object');
    expect(surface.security_definer_functions).toBeTypeOf('object');
    // Sanity on the known surface size (35 tables + 2 views + 53 definer funcs).
    expect(Object.keys(surface.tables)).toHaveLength(35);
    expect(Object.keys(surface.views)).toHaveLength(2);
    expect(Object.keys(surface.security_definer_functions)).toHaveLength(53);
  });

  it('2. every table has rls_enabled=true and rls_forced=true (RLS-less table = forbidden)', () => {
    for (const [name, entry] of Object.entries(surface.tables)) {
      expect(entry.rls_enabled, `${name}.rls_enabled`).toBe(true);
      expect(entry.rls_forced, `${name}.rls_forced`).toBe(true);
    }
  });

  it('3. every financial_class value is in the enum (tables + views)', () => {
    for (const [name, entry] of Object.entries(surface.tables)) {
      expect(FINANCIAL_CLASSES.has(entry.financial_class), `${name}: ${entry.financial_class}`).toBe(
        true,
      );
    }
    for (const [name, entry] of Object.entries(surface.views)) {
      expect(FINANCIAL_CLASSES.has(entry.financial_class), `${name}: ${entry.financial_class}`).toBe(
        true,
      );
    }
  });
});

describe('access-matrix.yml', () => {
  it('4. parses and defines the full role set', () => {
    expect(access.version).toBeDefined();
    for (const role of [...APP_ROLES, 'trusted_server']) {
      expect(access.roles, `roles missing ${role}`).toContain(role);
    }
    expect(access.matrix).toBeTypeOf('object');
  });

  it('5. compensation_records: employee.read is false (D2 — employees cannot see compensation)', () => {
    expect(cell('compensation_records', 'employee').read).toBe(false);
    // AD3 corollary: HR/Finance only read a masked summary, never raw.
    expect(cell('compensation_records', 'hr').read).toBe('masked');
    expect(cell('compensation_records', 'finance').read).toBe('masked');
  });

  it('6. rate_limit_counters: all application roles false; only trusted_server may access', () => {
    for (const role of APP_ROLES) {
      expect(cell('rate_limit_counters', role).read, `${role}.read`).toBe(false);
      expect(cell('rate_limit_counters', role).write, `${role}.write`).toBe(false);
    }
    expect(cell('rate_limit_counters', 'trusted_server').read).toBe(true);
    expect(cell('rate_limit_counters', 'trusted_server').write).toBe(true);
  });
});
