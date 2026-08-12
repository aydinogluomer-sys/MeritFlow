'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createOrganization } from '@/app/actions/onboarding/create-organization';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorState } from '@/components/features/shared/error-state';

/** Derive a slug from the org name: lowercase, spaces→hyphen, strip invalid chars,
 *  collapse repeats, clamp to 3–50 chars (matches the DB slug regex boundaries). */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 50);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onNameChange(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result = await createOrganization({ name, slug, displayName });

    if (result.ok) {
      router.push('/dashboard');
      return;
    }

    setLoading(false);
    if (result.error === 'slug_taken') {
      setError('Bu alan adı kullanımda. Lütfen farklı bir alan adı seçin.');
    } else if (result.error === 'VALIDATION_ERROR') {
      setError('Girdiğiniz bilgiler geçerli değil. Lütfen alanları kontrol edin.');
    } else {
      setError('Organizasyon oluşturulamadı. Lütfen tekrar deneyin.');
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Organizasyonunuzu oluşturun</CardTitle>
        <CardDescription>
          MeritFlow&apos;a başlamak için organizasyonunuzun temel bilgilerini girin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">Şirket adı</Label>
            <Input
              id="name"
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Örnek Teknoloji A.Ş."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slug">Alan adı (slug)</Label>
            <Input
              id="slug"
              required
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(slugify(event.target.value));
              }}
              placeholder="ornek-teknoloji"
              aria-describedby="slug-hint"
            />
            <p id="slug-hint" className="text-xs text-muted-foreground">
              Yalnızca küçük harf, rakam ve tire. 3–50 karakter.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">Adın</Label>
            <Input
              id="displayName"
              required
              minLength={1}
              maxLength={100}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Ad Soyad"
            />
          </div>

          {error ? <ErrorState message={error} /> : null}

          <Button
            type="submit"
            disabled={loading || name.length < 2 || slug.length < 3 || displayName.length < 1}
          >
            {loading ? 'Oluşturuluyor…' : 'Organizasyonu oluştur'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
