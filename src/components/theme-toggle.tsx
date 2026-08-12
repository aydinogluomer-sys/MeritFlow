'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Light/dark theme toggle (Phase-UI-6, 6B). Uses only `next-themes` — no server-only
 * modules (boundary test #4). `resolvedTheme` reflects the active theme even when the
 * user is on `system`, so a single click always flips to the visible opposite.
 *
 * Hydration guard: `next-themes` cannot know the theme during SSR (it reads the DOM
 * class / localStorage on the client), so we render a stable placeholder until mounted
 * to avoid a hydration mismatch on the icon.
 */
export function ThemeToggle() {
  const [mounted, setMounted] = React.useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Stable, icon-less placeholder keeps sidebar layout identical pre/post hydration.
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Temayı değiştir"
        disabled
        className="shrink-0"
      >
        <span className="h-4 w-4" aria-hidden="true" />
      </Button>
    );
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
      title={isDark ? 'Açık tema' : 'Koyu tema'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="shrink-0"
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}
