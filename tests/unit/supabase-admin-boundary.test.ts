import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Static guarantees for the service_role boundary (SI-11 / AD1). These do not import
// the admin module (which is `server-only`); they assert the source-level guards.
describe('service_role / admin client boundary (SI-11 / AD1)', () => {
  it('admin client is guarded by `import "server-only"` as its first statement', () => {
    const src = readFileSync(join(SRC, 'lib', 'supabase', 'admin.ts'), 'utf8');
    expect(src).toMatch(/^import 'server-only';/m);
  });

  it('browser client never references the admin client or the service-role key', () => {
    const src = readFileSync(join(SRC, 'lib', 'supabase', 'client.ts'), 'utf8');
    expect(src).not.toMatch(/admin/i);
    expect(src).not.toMatch(/SERVICE_ROLE/);
  });

  it('service-role key is never exposed via a NEXT_PUBLIC_ alias anywhere in src', () => {
    const guardFile = join('lib', 'env.ts'); // env.ts references it only to THROW.
    const offenders = walk(SRC)
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY'))
      .filter((f) => !f.endsWith(guardFile));
    expect(offenders).toEqual([]);
  });
});
