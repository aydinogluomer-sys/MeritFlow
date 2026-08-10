-- =============================================================================
-- Migration 0030 — manual point override (two-person)                (Phase 5-b)
-- Refs: 14_DATA_DICTIONARY (point_ledger), 15_RLS_POLICY_MATRIX (point_ledger),
--       Decision Lock (manual adjustment = reason + audit + separate ledger entry;
--       point.override permission), CLAUDE.md (manual adjustment audit; append-only
--       ledger, correction = reversal). Builds on 0006 (has_permission/current_org),
--       0009 (point_ledger append-only + audit trigger), 0025 (audit-via-trigger
--       precedent: point_ledger.insert / target_type point_ledger; no log_audit(args)).
--
-- Scope (Phase 5-b ONLY): apply_manual_point_adjustment() — a SECURITY DEFINER,
-- server-only function that appends ONE manual_adjustment point_ledger row after a
-- two-person authorization check (caller + p_actor + p_second_approver all hold
-- point.override in the same org, or auth.uid() IS NULL trusted context). Distinct
-- approvers; non-zero delta; non-empty reason; employee + optional task validated
-- same-org. Audited by the existing point_ledger INSERT audit trigger.
--
-- NO SCHEMA CHANGE: reuses the manual_adjustment event_type + append-only + audit
-- machinery already in place (0009). No new table/column/constraint/permission (the
-- catalog stays 20). No edits to 0001..0029, the seed, docs, or app/src. Local
-- dev/staging only — never production (ADR-014).
-- =============================================================================

create function public.apply_manual_point_adjustment(
  p_organization_id  uuid,
  p_employee_id      uuid,
  p_points_delta     numeric,
  p_reason           text,
  p_actor            uuid,
  p_second_approver  uuid,
  p_task_id          uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_id uuid;
begin
  if auth.uid() is not null then
    if not public.has_permission('point.override') then
      raise exception 'caller lacks point.override permission' using errcode = '42501';
    end if;
    if public.current_org() <> p_organization_id then
      raise exception 'caller organization mismatch' using errcode = '42501';
    end if;
  end if;

  if auth.uid() is not null
     and not exists (
       select 1 from public.memberships m
       join public.role_permissions rp on rp.role_key = m.primary_role
       where m.profile_id = p_actor and m.organization_id = p_organization_id
         and m.status = 'active' and rp.permission_key = 'point.override')
  then
    raise exception 'permission denied for actor' using errcode = '42501';
  end if;

  if auth.uid() is not null
     and not exists (
       select 1 from public.memberships m
       join public.role_permissions rp on rp.role_key = m.primary_role
       where m.profile_id = p_second_approver and m.organization_id = p_organization_id
         and m.status = 'active' and rp.permission_key = 'point.override')
  then
    raise exception 'permission denied for second approver' using errcode = '42501';
  end if;

  if p_actor = p_second_approver then
    raise exception 'actor and second approver must be different' using errcode = '23514';
  end if;

  if p_points_delta is null or p_points_delta = 0 then
    raise exception 'points_delta must be non-zero' using errcode = '23514';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'reason must not be empty' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.team_memberships tm
    join public.teams t on t.id = tm.team_id
    where tm.profile_id = p_employee_id and t.organization_id = p_organization_id
  ) then
    raise exception 'employee not found in organization' using errcode = '23503';
  end if;

  if p_task_id is not null and not exists (
    select 1 from public.tasks where id = p_task_id and organization_id = p_organization_id
  ) then
    raise exception 'task not found in organization' using errcode = '23503';
  end if;

  insert into public.point_ledger (
    organization_id, employee_id, event_type,
    points_delta, reason, task_id, created_by, metadata
  ) values (
    p_organization_id, p_employee_id, 'manual_adjustment',
    p_points_delta, p_reason, p_task_id, p_actor,
    jsonb_build_object('second_approver', p_second_approver)
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

comment on function public.apply_manual_point_adjustment(uuid,uuid,numeric,text,uuid,uuid,uuid) is
  'Phase 5-b: two-person manual point override. Caller + p_actor + p_second_approver must all '
  'hold point.override in the same org (or auth.uid() IS NULL trusted context). Distinct approvers; '
  'non-zero delta; non-empty reason; employee + optional task same-org. Appends one '
  'manual_adjustment ledger row; audited by trigger. SECURITY DEFINER, server-only.';

revoke execute on function
  public.apply_manual_point_adjustment(uuid,uuid,numeric,text,uuid,uuid,uuid) from public, anon;
grant execute on function
  public.apply_manual_point_adjustment(uuid,uuid,numeric,text,uuid,uuid,uuid) to authenticated, service_role;
