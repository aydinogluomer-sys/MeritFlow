'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { createChangeRequest } from '@/app/actions/policy-impact/create-change-request';

// "New change request" form (§8.2: published → draft). Client component; createChangeRequest re-checks
// policy.manage server-side and the DB trigger enforces from=published / to=draft / same policy.
export interface PolicyOption {
  id: string;
  name: string;
}
export interface VersionOption {
  id: string;
  policyId: string;
  versionNo: number;
  status: string; // 'published' | 'draft'
}

export function CreateChangeRequestForm({
  policyOptions,
  versionOptions,
}: {
  policyOptions: PolicyOption[];
  versionOptions: VersionOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  const [policyId, setPolicyId] = React.useState('');
  const [fromVersionId, setFromVersionId] = React.useState('');
  const [toDraftVersionId, setToDraftVersionId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [allowRetroactive, setAllowRetroactive] = React.useState(false);

  const published = versionOptions.filter((v) => v.policyId === policyId && v.status === 'published');
  const drafts = versionOptions.filter((v) => v.policyId === policyId && v.status === 'draft');

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} disabled={policyOptions.length === 0}>
        Yeni değişiklik talebi
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-md border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!policyId || !fromVersionId || !toDraftVersionId) {
          setError('Politika, kaynak ve taslak sürüm seçilmelidir.');
          return;
        }
        if (reason.trim().length === 0) {
          setError('Gerekçe zorunludur.');
          return;
        }
        startTransition(async () => {
          const result = await createChangeRequest({
            scoringPolicyId: policyId,
            fromVersionId,
            toDraftVersionId,
            reason: reason.trim(),
            ...(effectiveDate ? { effectiveDate } : {}),
            allowRetroactive,
          });
          if (!result.ok) {
            setError(`Talep oluşturulamadı (${result.error}).`);
            toast.error(`Talep oluşturulamadı (${result.error}).`);
            return;
          }
          toast.success('Değişiklik talebi oluşturuldu.');
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="pci-policy" className="text-sm font-medium">Politika</label>
        <select
          id="pci-policy"
          value={policyId}
          onChange={(e) => {
            setPolicyId(e.target.value);
            setFromVersionId('');
            setToDraftVersionId('');
          }}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Politika seçin…</option>
          {policyOptions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="pci-from" className="text-sm font-medium">Kaynak (yayınlanmış)</label>
          <select
            id="pci-from"
            value={fromVersionId}
            onChange={(e) => setFromVersionId(e.target.value)}
            disabled={isPending || !policyId}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sürüm seçin…</option>
            {published.map((v) => (
              <option key={v.id} value={v.id}>v{v.versionNo}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pci-to" className="text-sm font-medium">Taslak</label>
          <select
            id="pci-to"
            value={toDraftVersionId}
            onChange={(e) => setToDraftVersionId(e.target.value)}
            disabled={isPending || !policyId}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sürüm seçin…</option>
            {drafts.map((v) => (
              <option key={v.id} value={v.id}>v{v.versionNo}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pci-reason" className="text-sm font-medium">Gerekçe</label>
        <textarea
          id="pci-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isPending}
          rows={3}
          maxLength={2000}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="pci-eff" className="text-sm font-medium">Yürürlük tarihi (ops.)</label>
          <input
            id="pci-eff"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={isPending}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={allowRetroactive}
            onChange={(e) => setAllowRetroactive(e.target.checked)}
            disabled={isPending}
          />
          Geriye dönük tarihe izin ver
        </label>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Oluşturuluyor…' : 'Oluştur'}
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}
