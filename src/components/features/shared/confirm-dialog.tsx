'use client';

import * as React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

export interface ConfirmDialogProps {
  /** Text of the button that opens the dialog. */
  triggerLabel: string;
  /** Dialog heading. */
  title: string;
  /** Optional supporting description shown under the title. */
  description?: string;
  /** Label of the confirm button (defaults to "Onayla"). */
  confirmLabel?: string;
  /** Label of the cancel button (defaults to "Vazgeç"). */
  cancelLabel?: string;
  /** Invoked when the user confirms. */
  onConfirm: () => void;
  /** Visual style of the trigger button. */
  triggerVariant?: ButtonProps['variant'];
  /** Visual style of the confirm button. */
  confirmVariant?: ButtonProps['variant'];
  /** Disable the trigger (e.g. while a mutation is pending). */
  disabled?: boolean;
}

/**
 * Reusable, accessible confirm/cancel modal built on a native `<dialog>`.
 * Generic: dangerous actions pass their handler via `onConfirm`. Keyboard/ESC
 * dismissible; focus is trapped by the native modal dialog.
 */
export function ConfirmDialog({
  triggerLabel,
  title,
  description,
  confirmLabel = 'Onayla',
  cancelLabel = 'Vazgeç',
  onConfirm,
  triggerVariant = 'outline',
  confirmVariant = 'default',
  disabled = false,
}: ConfirmDialogProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  const open = () => dialogRef.current?.showModal();
  const close = () => dialogRef.current?.close();

  const handleConfirm = () => {
    close();
    onConfirm();
  };

  return (
    <>
      <Button type="button" variant={triggerVariant} onClick={open} disabled={disabled}>
        {triggerLabel}
      </Button>

      <dialog
        ref={dialogRef}
        className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-lg backdrop:bg-black/40"
        aria-labelledby="confirm-dialog-title"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 id="confirm-dialog-title" className="font-semibold leading-none tracking-tight">
              {title}
            </h2>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              {cancelLabel}
            </Button>
            <Button type="button" variant={confirmVariant} onClick={handleConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
