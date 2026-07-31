import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Liveness + best-effort DB connectivity probe. Never throws; RLS may return no rows
// for an anonymous caller — that still proves connectivity (no network error).
export async function GET() {
  let db: 'up' | 'unknown' = 'unknown';
  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from('organizations')
      .select('id', { head: true, count: 'exact' });
    db = error ? 'unknown' : 'up';
  } catch {
    db = 'unknown';
  }

  return NextResponse.json({
    status: 'ok',
    service: 'meritflow',
    db,
    time: new Date().toISOString(),
  });
}
