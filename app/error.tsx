'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

// Global error boundary (mandated error state — leak-free, no stack shown to users).
export default function Error({ reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // Errors are captured by Sentry via instrumentation when a DSN is configured.
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Bir şeyler ters gitti</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Beklenmeyen bir hata oluştu. Tekrar deneyebilir veya biraz sonra geri dönebilirsiniz.
      </p>
      <Button onClick={reset}>Tekrar dene</Button>
    </main>
  );
}
