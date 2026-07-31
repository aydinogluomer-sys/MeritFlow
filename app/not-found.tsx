import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Sayfa bulunamadı</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Aradığınız sayfa taşınmış veya hiç var olmamış olabilir.
      </p>
      <Button asChild>
        <Link href="/dashboard">Panoya dön</Link>
      </Button>
    </main>
  );
}
