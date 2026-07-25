-- =============================================================================
-- Migration 0010 — compensation_records (comp-sensitive) + masked audit  (Phase 3)
-- Refs: 14_DATA_DICTIONARY (compensation_records / audit_logs), 15_RLS_POLICY_MATRIX
--       (compensation_records §), 16 (SI-5/SI-6/SI-7/SI-16), ADR-018/ADR-012/ADR-006,
--       Decision Lock D7/D10/AD3/AD6. Phase 3 — compensation_records slice ONLY.
--
-- Scope: compensation_records table (cap basis / salary — most sensitive class),
-- its constraints, RLS (ENABLE + FORCE) + least-privilege grants + policies gated
-- on comp.read (HR/Finance only), a DELETE block (retention; supersede-only), a
-- MASKED write-audit trigger (SI-5 / AD3 — raw salary never lands in audit_logs),
-- and an audited + justified raw-read function read_compensation_record(reason).
--
-- comp.read already exists in the base seed (permissions + hr/finance mapping);
-- this migration adds NO permission. Cap basis is nullable → the pending_missing_
-- cap_basis flow (AD6) is a bonus-engine concern (out of scope here).
--
-- DELIBERATELY ABSENT (gated / later): v_finance_* views, bonus/cap consumption,
-- eligibility/proration math, any app/API/UI. No edits to 0001..0009 / existing
-- tests. Local dev/staging only — never production (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- mask_compensation(row_jsonb): return a masked summary of a compensation row —
-- non-sensitive keys kept; gross_salary_minor / cap_basis_minor / notes replaced
-- with '***masked***' (null cap_basis/notes stay null, which is non-sensitive
-- signal). Used by the audit trigger and the read-access audit so raw salary
-- NEVER lands in audit_logs (SI-5 / AD3). Pure/immutable.
-- -----------------------------------------------------------------------------
create or replace function public.mask_compensation(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p || jsonb_build_object(
    'gross_salary_minor', '***masked***',
    'cap_basis_minor', case when p->>'cap_basis_minor' is null then null else '***masked***' end,
    'notes',           case when p->>'notes' is null then null else '***masked***' end
  );
$$;

comment on function public.mask_compensation(jsonb) is
  'Masks compensation-sensitive fields (salary/cap basis/notes) for audit payloads (AD3/SI-5).';

revoke execute on function public.mask_compensation(jsonb) from public, anon;
grant execute on function public.mask_compensation(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- prevent_delete(): unconditional DELETE block (SECURITY DEFINER, blocks even
-- bypassrls roles). compensation_records is retained (supersede-only); hard
-- delete is a legal-review item (D10/retention). Distinct from prevent_mutation
-- (which blocks UPDATE too) because comp rows ARE updatable for supersede.
-- -----------------------------------------------------------------------------
create or replace function public.prevent_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'delete forbidden: % is retained (supersede only; deletion is a legal-review item)',
    tg_table_name using errcode = '23001';
end;
$$;

comment on function public.prevent_delete() is
  'Blocks DELETE on retention-protected tables (comp records: supersede-only, D10).';

-- -----------------------------------------------------------------------------
-- compensation_records (comp-sensitive — ADR-018). Cap basis source. One ACTIVE
-- record per (organization, employee); corrections = supersede (new row + old
-- marked superseded with effective_to). Salary stored as integer minor units.
-- -----------------------------------------------------------------------------
create table public.compensation_records (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  employee_id        uuid not null references public.profiles(id),
  gross_salary_minor bigint not null,
  currency           text not null default 'TRY',
  cap_basis_minor    bigint,                     -- optional; null → AD6 pending flow (bonus engine)
  effective_from     date not null,
  effective_to       date,                       -- null = active record
  status             text not null default 'active',
  notes              text,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint compensation_records_status_chk
    check (status in ('active', 'superseded')),
  constraint compensation_records_salary_pos_chk
    check (gross_salary_minor >= 0),
  constraint compensation_records_capbasis_pos_chk
    check (cap_basis_minor is null or cap_basis_minor >= 0),
  constraint compensation_records_currency_chk
    check (char_length(currency) = 3),
  constraint compensation_records_range_chk
    check (effective_to is null or effective_to > effective_from),
  -- active ⇔ no effective_to; superseded ⇔ has effective_to (coherent history)
  constraint compensation_records_active_consistency_chk
    check ((status = 'active' and effective_to is null)
        or (status = 'superseded' and effective_to is not null))
);

comment on table public.compensation_records is
  'Compensation-sensitive salary / cap basis (ADR-018). No direct raw SELECT: reads go ONLY '
  'through read_compensation_record() (comp.read/auditor + reason + masked access audit). '
  'INSERT/UPDATE gated on comp.read (HR/Finance). DELETE forbidden (supersede-only). Every write '
  'and every raw read is audited with a MASKED payload (AD3/D7/SI-5). Sensitivity: '
  'compensation-sensitive, personal-data.';

-- One active compensation record per (org, employee).
create unique index uq_comp_active_per_employee
  on public.compensation_records (organization_id, employee_id)
  where effective_to is null;

create index idx_comp_org_emp_eff
  on public.compensation_records (organization_id, employee_id, effective_from);

-- updated_at maintenance (mutable header; supersede transitions).
create trigger trg_comp_set_updated_at
  before update on public.compensation_records
  for each row execute function public.set_updated_at();

-- DELETE hard-blocked (retention; supersede-only). UPDATE stays allowed.
create trigger trg_comp_prevent_delete
  before delete on public.compensation_records
  for each row execute function public.prevent_delete();

-- -----------------------------------------------------------------------------
-- log_comp_audit(): MASKED audit for comp writes. Unlike the generic log_audit()
-- (which stores raw to_jsonb(row)), this writes only mask_compensation(...) into
-- before/after and sets is_sensitive = true, so raw salary NEVER lands in
-- audit_logs (SI-5 / AD3). Change-auditing per doc 14 (comp change → audit).
-- -----------------------------------------------------------------------------
create or replace function public.log_comp_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    organization_id, actor_id, action, target_type, target_id, before, after, is_sensitive
  )
  values (
    coalesce(new.organization_id, old.organization_id),
    auth.uid(),
    'compensation_records.' || lower(tg_op),
    'compensation_records',
    coalesce(new.id, old.id),
    case when tg_op = 'UPDATE' then public.mask_compensation(to_jsonb(old)) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then public.mask_compensation(to_jsonb(new)) else null end,
    true
  );
  return coalesce(new, old);
end;
$$;

comment on function public.log_comp_audit() is
  'Masked audit trigger for compensation_records writes (AD3/SI-5): raw salary never stored in audit_logs.';

create trigger trg_audit_compensation_records
  after insert or update on public.compensation_records
  for each row execute function public.log_comp_audit();

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
--   DIRECT RAW SELECT IS CLOSED (AD3/D7/SI-5): there is NO SELECT policy, and
--   authenticated has column SELECT only on `id` (the minimum needed to target a
--   row by primary key for a supersede UPDATE). The raw salary / cap basis / notes
--   columns are NOT selectable by any authenticated user, and no row is directly
--   SELECT-visible (RLS FORCE + no SELECT policy → 0 rows). ALL raw reads go through
--   read_compensation_record(employee, reason) — comp.read/auditor + non-empty
--   reason + masked access audit. So every raw compensation read is justified + audited.
--   INSERT/UPDATE: comp.read holders (HR/Finance) within current_org (WITH CHECK).
--   DELETE: no policy + no privilege + prevent_delete trigger (retention).
-- =============================================================================
alter table public.compensation_records enable row level security;
alter table public.compensation_records force row level security;
revoke all on public.compensation_records from anon, authenticated;
grant select (id) on public.compensation_records to authenticated;      -- id only (for UPDATE WHERE)
grant insert, update on public.compensation_records to authenticated;   -- NO delete, NO raw SELECT
grant all on public.compensation_records to service_role;

-- NO SELECT policy on purpose: direct SELECT yields no rows; the only read path is
-- the audited, justified read_compensation_record() function below.

create policy comp_insert on public.compensation_records
  for insert to authenticated
  with check (organization_id = public.current_org() and public.has_permission('comp.read'));

create policy comp_update on public.compensation_records
  for update to authenticated
  using (organization_id = public.current_org() and public.has_permission('comp.read'))
  with check (organization_id = public.current_org() and public.has_permission('comp.read'));
-- No DELETE policy (and no DELETE privilege); prevent_delete trigger is defense-in-depth.

-- -----------------------------------------------------------------------------
-- read_compensation_record(employee, reason): the AUDITED + JUSTIFIED raw-read
-- path (AD3). Authz: comp.read (HR/Finance) OR auditor (raw only with reason).
-- Requires a non-empty reason; writes a MASKED access audit row
-- (action = compensation_records.access, is_sensitive = true, reason) and returns
-- the active raw record within current_org (null if none / cross-tenant).
-- SECURITY DEFINER so it can audit + read regardless of RLS; org-anchored so it
-- cannot cross tenants. This is the ONLY raw-read path — direct table SELECT of
-- compensation is closed (no SELECT policy; salary columns not selectable), so
-- every raw compensation read requires a reason and is audited (AD3/D7/SI-5).
-- -----------------------------------------------------------------------------
create or replace function public.read_compensation_record(p_employee uuid, p_reason text)
returns public.compensation_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec public.compensation_records;
  v_org uuid := public.current_org();
begin
  if not (public.has_permission('comp.read') or public.has_role('auditor')) then
    raise exception 'forbidden: compensation access requires comp.read or auditor'
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason required for compensation access (AD3)'
      using errcode = '22023';
  end if;

  select * into v_rec
  from public.compensation_records c
  where c.employee_id = p_employee
    and c.organization_id = v_org
    and c.effective_to is null
  limit 1;

  insert into public.audit_logs (
    organization_id, actor_id, action, target_type, target_id, reason, is_sensitive, after
  )
  values (
    v_org, auth.uid(), 'compensation_records.access', 'compensation_records',
    p_employee, p_reason, true,
    case
      when v_rec.id is not null then public.mask_compensation(to_jsonb(v_rec))
      else jsonb_build_object('employee_id', p_employee, 'result', 'no_active_record')
    end
  );

  return v_rec;
end;
$$;

comment on function public.read_compensation_record(uuid, text) is
  'Audited + justified raw compensation read (AD3): comp.read/auditor + non-empty reason; '
  'writes a masked access audit row; returns the active record within current_org.';

revoke execute on function public.read_compensation_record(uuid, text) from public, anon;
grant execute on function public.read_compensation_record(uuid, text) to authenticated, service_role;
