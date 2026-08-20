import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestTask, runReconciliation } from './helpers/db-admin';

// ENGINEERING-17 Golden B — dispute → resolution → invariants clean. HYBRID: the dispute
// prerequisite is created via service role (the app has no task-page "open dispute" UI, and the
// resolve form only renders at status='under_review' — reached via assign-reviewer), then HR
// RESOLVES through the UI. Ends with a clean reconciliation.

const ORG_A = 'a0000000-0000-0000-0000-000000000001';
const TEAM_ALPHA = 'a0000000-0000-0000-0000-0000000000f1';
const MGR_ID = 'a0000000-0000-0000-0000-0000000000a5';
const EMP_ALPHA_ID = 'a0000000-0000-0000-0000-0000000000a7';
const HR_ID = 'a0000000-0000-0000-0000-0000000000a3';

let taskId: string;
let disputeId: string;

async function authedClient(email: string): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Golden B setup: missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw new Error(`Golden B setup auth failed for ${email}: ${error.message}`);
  return client;
}

test.describe.serial('Golden B — dispute chain', () => {
  test.beforeAll(async () => {
    taskId = await createTestTask({
      organizationId: ORG_A,
      teamId: TEAM_ALPHA,
      createdBy: MGR_ID,
      assignedTo: EMP_ALPHA_ID,
      title: `E2E Golden B — ${Date.now()}`,
      status: 'submitted',
    });

    // Insert the dispute at 'open' (state-machine entry), then assign a reviewer → 'under_review'
    // so the HR resolve form renders (mirrors the seed's dispute path; reviewer ≠ complainant/owner).
    const employee = await authedClient('emp-alpha-a@acme.test');
    const { data: opened, error } = await employee
      .from('disputes')
      .insert({
        organization_id: ORG_A,
        complainant_id: EMP_ALPHA_ID,
        dispute_type: 'unfair_rejection',
        target_type: 'task',
        target_id: taskId,
        status: 'open',
        decision_owner_id: MGR_ID,
        opened_at: new Date().toISOString(),
        due_at: new Date(Date.now() + 5 * 864e5).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(`Golden B setup: ${error.message}`);
    disputeId = (opened as { id: string }).id;

    const hr = await authedClient('hr-a@acme.test');
    await hr
      .from('disputes')
      .update({ status: 'under_review', assigned_reviewer_id: HR_ID })
      .eq('id', disputeId)
      .eq('status', 'open');
  });

  test('B1 — the complainant can view their dispute', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/emp-user.json' });
    const page = await ctx.newPage();
    await page.goto(`/disputes/${disputeId}`);
    // The dispute detail heading is the (Turkish) dispute-type label — the complainant can read it.
    await expect(page.getByRole('heading', { name: 'Haksız ret' })).toBeVisible({ timeout: 10_000 });

    const { data } = await adminClient()
      .from('disputes')
      .select('status')
      .eq('id', disputeId)
      .single();
    expect(data?.status).toBe('under_review');
    await ctx.close();
  });

  test('B2 — HR resolves the dispute (accepted) via UI', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth/hr-user.json' });
    const page = await ctx.newPage();
    await page.goto(`/disputes/${disputeId}`);
    // Resolve form (status=under_review). Karar defaults to 'Kabul et' (accepted); note ≥ 5 chars.
    await page.getByLabel('Karar notu').fill('İtiraz haklı görüldü; puan gözden geçirilecek.');
    await page.getByRole('button', { name: 'İtirazı sonuçlandır' }).click();

    await expect(async () => {
      const { data } = await adminClient()
        .from('disputes')
        .select('status, resolution')
        .eq('id', disputeId)
        .single();
      expect(data?.status).toBe('resolved');
      expect(data?.resolution).toBe('accepted');
    }).toPass({ timeout: 15_000, intervals: [1_000] });
    await ctx.close();
  });

  test('B3 — reconciliation clean after dispute resolution', async () => {
    const result = await runReconciliation(ORG_A);
    expect(result.criticalFindings).toHaveLength(0);
  });
});
