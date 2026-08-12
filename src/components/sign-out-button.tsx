'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

/**
 * Sign-out control. Behavior is identical regardless of `variant`:
 * Supabase client sign-out → redirect to /login → refresh (revalidate server session).
 * - 'text' (default): outline button labelled "Çıkış".
 * - 'icon': right-aligned ghost icon button (LogOut) for the sidebar profile block (2E).
 */
export function SignOutButton({ variant = 'text' }: { variant?: 'text' | 'icon' }) {
  const router = useRouter();

  async function onSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  if (variant === 'icon') {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={onSignOut}
        aria-label="Çıkış"
        title="Çıkış"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={onSignOut}>
      Çıkış
    </Button>
  );
}
