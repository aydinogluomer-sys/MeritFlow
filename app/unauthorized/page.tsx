import Link from 'next/link';
import { Button } from '@/components/ui/button';

// Friendly, leak-free 403 (no data, no reason detail).
export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Erişim yok</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Bu alanı görüntüleme yetkin bulunmuyor. Yanlışlıkla buraya geldiysen yöneticinle
        iletişime geçebilirsin.
      </p>
      <Button asChild variant="outline">
        <Link href="/dashboard">Panoya dön</Link>
      </Button>
    </main>
  );
}
