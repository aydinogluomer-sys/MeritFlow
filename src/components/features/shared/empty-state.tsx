'use client';

import type * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  message: string;
  /** Optional contextual glyph, rendered large above the message. */
  icon?: LucideIcon;
  className?: string;
  children?: React.ReactNode;
}

/**
 * Presentational empty state (mandated empty states). Renders a calm, centered
 * message for empty result sets, e.g. `<EmptyState message="Henüz görev yok" />`.
 * A soft fade-in is applied via {@link AnimatePresence} (respects reduced motion).
 * When an `icon` is provided it renders large and muted above the message.
 */
export function EmptyState({ message, icon: Icon, className, children }: EmptyStateProps) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-10 text-center',
          className,
        )}
      >
        {Icon ? <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" /> : null}
        <p className="text-sm text-muted-foreground">{message}</p>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
