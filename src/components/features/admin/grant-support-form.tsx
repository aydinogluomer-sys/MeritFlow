'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/features/shared/error-state';
import { grantSupportAccess } from '@/app/actions/admin/grant-support-access';

/**
 * Grants time-bounded, scoped support access (D4). Collects a grantee (profile uuid),
 * a scope, a reason, and an expiry. The `datetime-local` value is `YYYY-MM-DDTHH:mm`
 * (no timezone) which does NOT satisfy the action's `z.string().datetime()`; it is
 * converted with `new Date(...).toISOString()` before the call. RLS + the DB enforce
 * support.grant and the expiry check; this form only collects. Errors surface inline.
 */
export function GrantSupportForm() {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const [granteeId, setGranteeId] = React.useState('');
  const [scope, setScope] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [expiresAtLocal, setExpiresAtLocal] = React.useState('');

  const validate = (): string | null => {
    if (granteeId.trim().length === 0) return 'Lütfen erişim verilecek kişinin kimliğini girin.';
    if (scope.trim().length === 0) return 'Kapsam zorunludur.';
    if (reason.trim().length < 5) return 'Gerekçe en az 5 karakter olmalıdır.';
    if (expiresAtLocal.trim().length === 0) return 'Bitiş zamanı zorunludur.';
    return null;
  };

  const handleSubmit = () => {
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    // datetime-local ("YYYY-MM-DDTHH:mm", no timezone) → ISO 8601 for z.string().datetime().
    const isoExpiresAt = new Date(expiresAtLocal).toISOString();

    startTransition(async () => {
      const result = await grantSupportAccess({
        granteeId: granteeId.trim(),
        scope: scope.trim(),
        reason: reason.trim(),
        expiresAt: isoExpiresAt,
      });
      if (!result.ok) {
        setError(`Erişim verilemedi (${result.error}).`);
        return;
      }
      setDone(true);
      setGranteeId('');
      setScope('');
      setReason('');
      setExpiresAtLocal('');
      router.refresh();
    });
  };

  const canSubmit = validate() === null && !isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className="flex flex-col gap-5"
      aria-busy={isPending}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="grant-grantee" className="text-sm font-medium">
          Erişim verilecek kişi (profil kimliği)
        </label>
        <input
          id="grant-grantee"
          type="text"
          value={granteeId}
          onChange={(e) => {
            setGranteeId(e.target.value);
            setDone(false);
          }}
          disabled={isPending}
          placeholder="00000000-0000-0000-0000-000000000000"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="grant-scope" className="text-sm font-medium">
          Kapsam
        </label>
        <input
          id="grant-scope"
          type="text"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          disabled={isPending}
          maxLength={500}
          placeholder="Örn. sadece görev geçmişi görüntüleme"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="grant-reason" className="text-sm font-medium">
          Gerekçe
        </label>
        <textarea
          id="grant-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={isPending}
          minLength={5}
          maxLength={1000}
          rows={3}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="grant-expires" className="text-sm font-medium">
          Bitiş zamanı
        </label>
        <input
          id="grant-expires"
          type="datetime-local"
          value={expiresAtLocal}
          onChange={(e) => setExpiresAtLocal(e.target.value)}
          disabled={isPending}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
        <p className="text-xs text-muted-foreground">
          Erişim bu zamanda sona erer. Süresi dolan erişim otomatik olarak geçersiz sayılır.
        </p>
      </div>

      {error ? <ErrorState message={error} /> : null}
      {done && !error ? (
        <p className="text-sm font-medium text-primary">Destek erişimi verildi.</p>
      ) : null}

      <div>
        <Button type="submit" disabled={!canSubmit}>
          {isPending ? 'Veriliyor…' : 'Erişim ver'}
        </Button>
      </div>
    </form>
  );
}
