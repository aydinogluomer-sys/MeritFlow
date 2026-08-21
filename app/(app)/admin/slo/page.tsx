import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { hasPermission } from '@/lib/auth/rbac';
import { createClient } from '@/lib/supabase/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ENGINEERING-12 slice C — read-only SLO / operational-health dashboard (server component).
//
// ACCESS BOUNDARY: MeritFlow has NO 'organization_admin'/'super_admin' roles — roles are
// owner/admin/hr/finance/manager/employee/auditor, and admin routes gate on a PERMISSION, not a
// role name (CLAUDE.md: authz is server-side + RLS, permission read from the DB). This page uses
// the same gate as app/(app)/admin/members/page.tsx: `user.invite` (held by owner/admin only).
// So hr/finance/manager/employee/auditor are redirected to /unauthorized. RLS is the ultimate
// enforcement; this early check is defense-in-depth / UX. No client-side auth (no 'use client').

type Tone = 'green' | 'amber' | 'red' | 'grey';

const TONE_CLASS: Record<Tone, string> = {
  green: 'border-transparent bg-emerald-100 text-emerald-800',
  amber: 'border-transparent bg-amber-100 text-amber-900',
  red: 'border-transparent bg-red-100 text-red-800',
  grey: 'border-transparent bg-muted text-muted-foreground',
};

// Status is conveyed by TEXT (the label) as well as colour — never colour alone (WCAG 2.1 AA).
function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <Badge className={TONE_CLASS[tone]}>{children}</Badge>;
}

type HealthRow = {
  item: string;
  tone: Tone;
  status: string;
  lastVerified: string;
  evidence: string;
};

// Operator-maintained snapshot (updated by hand as evidence lands — see docs/runbooks/README.md).
const HEALTH_ROWS: HealthRow[] = [
  {
    item: 'Uptime monitörü',
    tone: 'grey',
    status: 'Yapılandırılmadı',
    lastVerified: '—',
    evidence: 'slo.md §6',
  },
  {
    item: 'Hata raporlama (Sentry)',
    tone: 'amber',
    status: 'Bekleniyor',
    lastVerified: '2026-08-17',
    evidence: 'docs/runbooks/ (abe0a36)',
  },
  {
    item: 'Yedek tatbikatı',
    tone: 'green',
    status: 'Tamamlandı',
    lastVerified: '2026-08-16',
    evidence: 'disaster-recovery.md §6',
  },
  {
    item: 'Kimlik rotasyon tatbikatı',
    tone: 'red',
    status: 'Yapılmadı',
    lastVerified: '—',
    evidence: 'rotation-evidence.md',
  },
  {
    item: 'Silme dry-run + hukuki',
    tone: 'red',
    status: 'Yapılmadı',
    lastVerified: '—',
    evidence: 'data-lifecycle.md §6',
  },
];

const RUNBOOKS: { name: string; doc: string }[] = [
  { name: 'Disaster Recovery', doc: 'docs/runbooks/disaster-recovery.md' },
  { name: 'Incident Response', doc: 'docs/runbooks/incident-response.md' },
  { name: 'SLO', doc: 'docs/runbooks/slo.md' },
  { name: 'Data Lifecycle', doc: 'docs/runbooks/data-lifecycle.md' },
  { name: 'Environments & Deploy', doc: 'docs/runbooks/environments-and-deploy.md' },
];

type ReconResult = { tone: Tone; label: string; detail: string };

// Graceful read of the last reconciliation run. `reconciliation_runs` does not exist yet
// (ENGINEERING-05 is a read-only verifier that does not persist runs to a table), so the query
// errors — we degrade to an amber "no record" state, never a 500.
async function readLastReconciliation(): Promise<ReconResult> {
  try {
    // `reconciliation_runs` intentionally does NOT exist (ENGINEERING-05 is a read-only verifier that
    // persists nothing). The typed client rejects unknown table names at compile time, so probe via
    // an untyped view of the client and degrade to the amber "no record" state on the runtime error.
    const supabase = (await createClient()) as unknown as SupabaseClient;
    const { data, error } = await supabase
      .from('reconciliation_runs')
      .select('ran_at, result')
      .order('ran_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return {
        tone: 'amber',
        label: 'Kayıt yok',
        detail: 'reconciliation_runs tablosu yok — ENGINEERING-05 verifier sonucu persist etmiyor.',
      };
    }
    const row = data as { ran_at: string; result: string };
    if (row.result === 'ok') {
      return {
        tone: 'green',
        label: 'Uyumlu',
        detail: `Son çalışma: ${new Date(row.ran_at).toISOString()}`,
      };
    }
    return {
      tone: 'red',
      label: 'Uyumsuzluk',
      detail: `Sonuç: ${row.result} · ${new Date(row.ran_at).toISOString()}`,
    };
  } catch {
    return { tone: 'amber', label: 'Kayıt yok', detail: 'Sorgu başarısız — kayıt bulunamadı.' };
  }
}

export default async function SloDashboardPage() {
  if (!(await hasPermission('user.invite'))) redirect('/unauthorized');

  const recon = await readLastReconciliation();

  return (
    <div className="flex flex-col gap-6">
      {/* Section 1 — header */}
      <div>
        <h1 className="text-2xl font-semibold">SLO Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Engineering-12 operational health — {new Date().toUTCString()}
        </p>
      </div>

      {/* Section 2 — SLI cards (2×2) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="h-full">
          <CardHeader>
            <CardTitle>Uptime / Erişilebilirlik</CardTitle>
            <CardDescription>Hedef: ≥ %99,5 (30 günlük yuvarlanan) — slo.md §2</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <StatusPill tone="grey">Harici izleme gerekli</StatusPill>
            <p className="text-xs text-muted-foreground">
              Kaynak: harici uptime monitörü — slo.md §6
            </p>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle>Hata oranı (5xx)</CardTitle>
            <CardDescription>Hedef: &lt; %0,5 sunucu isteği — slo.md §2</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusPill tone="grey">Veri kaynağı yapılandırılmadı</StatusPill>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle>p95 gecikme</CardTitle>
            <CardDescription>
              Hedef: &lt; 2 sn (performance.md bütçesi dahilinde) — slo.md §2
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StatusPill tone="grey">Veri kaynağı: Vercel Analytics</StatusPill>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader>
            <CardTitle>Son mutabakat (reconciliation) çalışması</CardTitle>
            <CardDescription>
              Finansal doğruluk: kritik uyumsuzluk olmamalı — slo.md §2 (ENGINEERING-05)
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <StatusPill tone={recon.tone}>{recon.label}</StatusPill>
            <p className="text-xs text-muted-foreground">{recon.detail}</p>
          </CardContent>
        </Card>
      </div>

      {/* Section 3 — operational health table */}
      <Card>
        <CardHeader>
          <CardTitle>Operasyonel sağlık</CardTitle>
          <CardDescription>
            ENGINEERING-12 DoD kanıt takibi (operatör tarafından güncellenir).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableCaption className="sr-only">Operasyonel sağlık durumu</TableCaption>
              <TableHeader>
                <TableRow className="bg-muted/50 text-xs text-muted-foreground">
                  <TableHead>Öğe</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Son doğrulama</TableHead>
                  <TableHead>Kanıt konumu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {HEALTH_ROWS.map((row) => (
                  <TableRow key={row.item}>
                    <TableCell>{row.item}</TableCell>
                    <TableCell>
                      <StatusPill tone={row.tone}>{row.status}</StatusPill>
                    </TableCell>
                    <TableCell className="tabular-nums">{row.lastVerified}</TableCell>
                    <TableCell className="text-muted-foreground">{row.evidence}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Section 4 — runbook references. The runbooks are repo markdown under docs/runbooks/
          (not app routes), so they are listed as references, not clickable /routes (which would
          404). */}
      <Card>
        <CardHeader>
          <CardTitle>Çalışma kitapları (runbooks)</CardTitle>
          <CardDescription>Operasyonel prosedürler — repo altında docs/runbooks/.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1 text-sm">
            {RUNBOOKS.map((rb) => (
              <li key={rb.doc} className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{rb.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{rb.doc}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
