'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { exportAudit } from '@/app/actions/audit/export-audit';

/**
 * Downloads the audit trail as CSV (Phase 10-A). Calls the `exportAudit` action,
 * turns the returned CSV string into a Blob, and triggers a client-side download.
 * Server-side authz (audit.read) and AD3 masking are enforced in the action; this
 * component only presents the result. Failures surface inline via {@link ErrorState}.
 */
export function ExportButton() {
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const handleExport = () => {
    setError(null);
    startTransition(async () => {
      const res = await exportAudit({});
      if (!res.ok) {
        setError(`Dışa aktarma başarısız (${res.error}).`);
        return;
      }

      const blob = new Blob([res.data.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'audit-export.csv';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={handleExport}
        disabled={isPending}
      >
        {isPending ? 'Hazırlanıyor…' : 'Denetim kaydını dışa aktar (CSV)'}
      </Button>
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}
