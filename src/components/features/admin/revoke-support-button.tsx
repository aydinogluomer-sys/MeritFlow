'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ErrorState } from '@/components/features/shared/error-state';
import { ConfirmDialog } from '@/components/features/shared/confirm-dialog';
import { revokeSupportAccess } from '@/app/actions/admin/revoke-support-access';

export interface RevokeSupportButtonProps {
  grantId: string;
}

/**
 * Revokes an active support access grant behind {@link ConfirmDialog}. Calls the
 * `revokeSupportAccess` action (RLS enforces support.grant; the 0005 trigger audits the
 * update). On success refreshes the list; errors surface inline.
 */
export function RevokeSupportButton({ grantId }: RevokeSupportButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const handleRevoke = () => {
    setError(null);
    startTransition(async () => {
      const result = await revokeSupportAccess({ grantId });
      if (!result.ok) {
        setError(`Erişim iptal edilemedi (${result.error}).`);
        toast.error(`Erişim iptal edilemedi (${result.error}).`);
        return;
      }
      toast.success('Erişim iptal edildi.');
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {error ? <ErrorState message={error} /> : null}
      <ConfirmDialog
        triggerLabel={isPending ? 'İptal ediliyor…' : 'İptal et'}
        triggerVariant="outline"
        confirmVariant="destructive"
        title="Bu destek erişimi iptal edilsin mi?"
        description="Erişim hemen sona erer ve bu işlem denetim kaydı üretir."
        confirmLabel="İptal et"
        disabled={isPending}
        onConfirm={handleRevoke}
      />
    </div>
  );
}
