-- =============================================================================
-- Migration 0016 — anti_gaming_flags foundation  (Phase 3)
-- Refs: 08_ANTI_GAMING_MVP_SPEC, 14_DATA_DICTIONARY (anti_gaming_flags),
--       15_RLS_POLICY_MATRIX (anti_gaming_flags §132-138), 16 (§7 flag machine,
--       SI-6/SI-7), ADR-006 (audit), ADR-020, Decision Lock D5. Phase 3 slice ONLY.
--
-- Scope: the anti-gaming FLAG CONTAINER + human review lifecycle — NOT the rule
-- detection engine. Flags are STORED here (server-only INSERT by the future rule
-- engine); this slice provides the table + state machine + guarantees.
--
-- D5 (no automatic punishment): a confirmed flag must NOT produce any automatic
-- financial/penalty effect. Enforced BY CONSTRUCTION here:
--   * this table has NO FK, trigger or write path to point_ledger / bonus_ledger /
--     compensation_records / any bonus_* table — it is fully isolated;
--   * moving to 'confirmed' is an inert status UPDATE (only set_updated_at + the
--     transition validator + log_audit fire — none touch a financial table);
--   * there is NO financial-effect state in the enum (terminal = confirmed|dismissed);
--   * verified by a test asserting point_ledger / bonus_ledger row counts are
--     unchanged after confirming a flag.
-- Any financial effect is a SEPARATE human decision (manual_adjustment / dispute) in a
-- later phase — never a side effect of this table.
--
-- Authorization note: review (confirm/dismiss) is gated on `has_role('hr') OR
-- manages_team(team_of(subject_employee_id))` — NOT a `flag.review` permission. Adding
-- a new permission would change the seeded permission catalog count asserted by test
-- 0001 (permissions = 20), and 0001..0009 are not authorized to change.
--
-- DELIBERATELY ABSENT (gated / later): the rule DETECTION engine
-- (duplicate/tiny-split/same-reviewer/period-end detection), the self-approval hard
-- block (Phase 4 review layer — this slice only stores a `self_approval_attempt` trail
-- flag), anomaly_baselines / Z-score, notifications, any ledger/financial wiring,
-- automatic dispute creation, task/review/scoring/bonus engines, app/UI/API. No FK to
-- tasks (gated) or bonus tables. No edits to 0001..0015 / existing tests. Local
-- dev/staging only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- validate_flag_transition(): enforce the doc-16 §7 state machine + post-insert
-- identity immutability. On INSERT status must be 'open'. On UPDATE only
-- open→reviewing and reviewing→confirmed|dismissed are allowed; terminal statuses are
-- immutable. Compares NEW/OLD only (no table reads → no SECURITY DEFINER needed).
-- -----------------------------------------------------------------------------
create or replace function public.validate_flag_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'anti_gaming_flag must start in status open (got %)', new.status using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE: identity fields are immutable (set by the rule engine at creation).
  if new.organization_id    is distinct from old.organization_id
  or new.rule               is distinct from old.rule
  or new.subject_employee_id is distinct from old.subject_employee_id
  or new.related_task_id     is distinct from old.related_task_id
  or new.related_reviewer_id is distinct from old.related_reviewer_id
  or new.evidence            is distinct from old.evidence
  or new.created_at          is distinct from old.created_at then
    raise exception 'anti_gaming_flag identity (org/rule/subject/related/evidence/created_at) is immutable' using errcode = '23001';
  end if;

  if new.status = old.status then
    if old.status in ('confirmed', 'dismissed') then
      raise exception 'confirmed/dismissed anti_gaming_flag is immutable' using errcode = '23001';
    end if;
    return new;
  end if;

  if not (
       (old.status = 'open'      and new.status = 'reviewing')
    or (old.status = 'reviewing' and new.status in ('confirmed', 'dismissed'))
  ) then
    raise exception 'invalid anti_gaming_flag transition: % -> %', old.status, new.status using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.validate_flag_transition() is
  'Enforces the anti_gaming_flag state machine (doc 16 §7) + post-insert identity immutability.';

-- -----------------------------------------------------------------------------
-- anti_gaming_flags (deterministic rule flags — D5). Confidential.
-- Mutable review lifecycle; DELETE forbidden. ISOLATED from all financial tables.
-- -----------------------------------------------------------------------------
create table public.anti_gaming_flags (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  rule                text not null,
  subject_employee_id uuid not null,
  status              text not null default 'open',
  related_task_id     uuid,                                 -- NO FK (tasks gated — polymorphic)
  related_reviewer_id uuid,
  evidence            jsonb not null default '{}'::jsonb,   -- deterministic rule evidence (+ any period context)
  reviewed_by         uuid,
  review_note         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint anti_gaming_flags_rule_chk check (rule in
    ('duplicate_task', 'tiny_task_splitting', 'same_reviewer_concentration',
     'period_end_spike', 'self_approval_attempt')),
  constraint anti_gaming_flags_status_chk check (status in ('open', 'reviewing', 'confirmed', 'dismissed')),
  -- Review fields exist iff the flag is confirmed/dismissed.
  constraint anti_gaming_flags_review_consistency_chk check (
    case
      when status in ('confirmed', 'dismissed') then reviewed_by is not null and review_note is not null
      else reviewed_by is null and review_note is null
    end),
  -- A reviewer cannot review a flag about themselves.
  constraint anti_gaming_flags_reviewer_not_subject_chk
    check (reviewed_by is null or reviewed_by <> subject_employee_id),
  -- Same-org actors (SI-7). NOTE: no FK to tasks/bonus/comp tables (D5 isolation).
  constraint anti_gaming_flags_subject_org_fk
    foreign key (organization_id, subject_employee_id)
    references public.memberships (organization_id, profile_id),
  constraint anti_gaming_flags_reviewer_org_fk
    foreign key (organization_id, related_reviewer_id)
    references public.memberships (organization_id, profile_id),
  constraint anti_gaming_flags_reviewed_by_org_fk
    foreign key (organization_id, reviewed_by)
    references public.memberships (organization_id, profile_id)
);

comment on table public.anti_gaming_flags is
  'Deterministic anti-gaming flags (D5): 5 rules; state machine open→reviewing→confirmed|dismissed (doc 16 §7). '
  'Human-in-the-loop; a confirmed flag has NO automatic financial/penalty effect (isolated — no FK/trigger to '
  'point_ledger/bonus_ledger/compensation/bonus_* tables). Server-only INSERT (rule engine); confirm/dismiss by '
  'HR or the subject''s team manager; DELETE forbidden; audited. RLS read: subject-own + own-team Manager + HR + '
  'Auditor (Finance/Support excluded). Sensitivity: confidential.';

create index idx_anti_gaming_flags_org_status on public.anti_gaming_flags (organization_id, status);
create index idx_anti_gaming_flags_subject on public.anti_gaming_flags (subject_employee_id);

create trigger trg_anti_gaming_flags_set_updated_at
  before update on public.anti_gaming_flags
  for each row execute function public.set_updated_at();

create trigger trg_anti_gaming_flags_validate
  before insert or update on public.anti_gaming_flags
  for each row execute function public.validate_flag_transition();

create trigger trg_anti_gaming_flags_prevent_delete
  before delete on public.anti_gaming_flags
  for each row execute function public.prevent_delete();

create trigger trg_audit_anti_gaming_flags
  after insert or update on public.anti_gaming_flags
  for each row execute function public.log_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
-- INSERT is server-only (the rule engine, trusted). Review (confirm/dismiss) is by HR
-- or the subject's own-team Manager. Read: subject-own + own-team Manager + HR + Auditor.
-- =============================================================================
alter table public.anti_gaming_flags enable row level security;
alter table public.anti_gaming_flags force row level security;
revoke all on public.anti_gaming_flags from anon, authenticated;
grant select, update on public.anti_gaming_flags to authenticated;                -- NO insert (server-only), NO delete
grant all on public.anti_gaming_flags to service_role;

create policy anti_gaming_flags_select on public.anti_gaming_flags
  for select to authenticated
  using (
    organization_id = public.current_org()
    and (subject_employee_id = auth.uid()
         or public.has_role('hr')
         or public.has_role('auditor')
         or public.manages_team(public.team_of(subject_employee_id)))
  );

create policy anti_gaming_flags_update on public.anti_gaming_flags
  for update to authenticated
  using (
    organization_id = public.current_org()
    and (public.has_role('hr') or public.manages_team(public.team_of(subject_employee_id)))
  )
  with check (
    organization_id = public.current_org()
    and (public.has_role('hr') or public.manages_team(public.team_of(subject_employee_id)))
    -- the recorded reviewer must be the actual actor (audit integrity)
    and (reviewed_by is null or reviewed_by = auth.uid())
  );
-- No INSERT policy/privilege (server-only). No DELETE policy/privilege (retention).
