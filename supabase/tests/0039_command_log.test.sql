-- =============================================================================
-- pgTAP — ENGINEERING-15 command_log idempotency guard (migration 0039)
-- Run: supabase test db   (dev/staging local; never production)
-- Refs: migration 0039, command-meta.ts catalog, CLAUDE.md (DB is the ultimate guard)
--
-- Whole file runs in a transaction and is rolled back; seed data is assumed present.
-- Known seed UUID: org A = a0000000-0000-0000-0000-000000000001.
-- Runs in the privileged (bypassrls) test role — direct command_log inserts + the
-- SECURITY DEFINER claim_command() are exercised without RLS getting in the way.
-- =============================================================================
begin;
select no_plan();

-- claim_command(): first call true (first execution), duplicate false, new id true.
select is(
  public.claim_command('a0000000-0000-0000-0000-000000000001', 'op_test',
                       '11111111-1111-1111-1111-111111111111'::uuid),
  true, 'claim_command first call → true (first execution)'
);
select is(
  public.claim_command('a0000000-0000-0000-0000-000000000001', 'op_test',
                       '11111111-1111-1111-1111-111111111111'::uuid),
  false, 'claim_command duplicate (same org/op/commandId) → false'
);
select is(
  public.claim_command('a0000000-0000-0000-0000-000000000001', 'op_test',
                       '22222222-2222-2222-2222-222222222222'::uuid),
  true, 'claim_command different commandId → true (independent operation)'
);

-- Ultimate guard: the unique constraint itself rejects a duplicate direct insert.
select lives_ok(
  $$ insert into public.command_log (organization_id, operation_type, command_id)
     values ('a0000000-0000-0000-0000-000000000001', 'op_dup',
             '33333333-3333-3333-3333-333333333333') $$,
  'first command_log insert succeeds'
);
select throws_ok(
  $$ insert into public.command_log (organization_id, operation_type, command_id)
     values ('a0000000-0000-0000-0000-000000000001', 'op_dup',
             '33333333-3333-3333-3333-333333333333') $$,
  '23505',
  'duplicate key value violates unique constraint "command_log_idem_uq"',
  'command_log (org, op, commandId) unique constraint rejects a duplicate (the ultimate guard)'
);

select * from finish();
rollback;
