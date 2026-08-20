-- =============================================================================
-- 0040_snapshot_approval_unlock.sql
-- Allow the one-time approval phase-transition on bonus_allocation_snapshots.
--
-- Context: bonus_allocation_snapshots.approved_at / approved_by were added as
-- "forward-compat (approval later phase)" in migration 0013.  The blanket
-- prevent_mutation() trigger blocked every UPDATE, making the snapshot
-- non-approvable and causing the Golden A E2E chain to fail at step A6.
--
-- Fix: Replace the blanket trigger with prevent_mutation_except_approval(),
-- which enforces full immutability for every column EXCEPT the one-time
-- null → non-null transition of (approved_at, approved_by).  An AFTER UPDATE
-- trigger also fires log_audit() so the approval is captured in audit_logs
-- (bonus approval is a critical mutation per the decision lock).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. New conditional-immutability trigger function
-- -----------------------------------------------------------------------------
create or replace function public.prevent_mutation_except_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- DELETE is never allowed on this table.
  if tg_op = 'DELETE' then
    raise exception 'append-only: DELETE on % is not permitted', tg_table_name
      using errcode = 'restrict_violation';
  end if;

  -- UPDATE: only the approval phase-transition (null → non-null) is allowed.
  if tg_op = 'UPDATE' then
    -- Reject any change to the immutable calculation columns.
    if (
      new.id                            is distinct from old.id            or
      new.organization_id               is distinct from old.organization_id or
      new.calculation_run_id            is distinct from old.calculation_run_id or
      new.bonus_period_id               is distinct from old.bonus_period_id or
      new.bonus_pool_id                 is distinct from old.bonus_pool_id  or
      new.policy_version_id             is distinct from old.policy_version_id or
      new.t_org                         is distinct from old.t_org          or
      new.top_up_applied                is distinct from old.top_up_applied  or
      new.undistributed_remainder_minor is distinct from old.undistributed_remainder_minor or
      new.calculation_metadata          is distinct from old.calculation_metadata or
      new.created_at                    is distinct from old.created_at
    ) then
      raise exception
        'append-only: UPDATE of immutable calculation fields on % is not permitted', tg_table_name
        using errcode = 'restrict_violation';
    end if;

    -- Reject re-approval (approved_at / approved_by may only be set once).
    if old.approved_at is not null and new.approved_at is distinct from old.approved_at then
      raise exception
        'append-only: approved_at on % may not be changed after being set', tg_table_name
        using errcode = 'restrict_violation';
    end if;
    if old.approved_by is not null and new.approved_by is distinct from old.approved_by then
      raise exception
        'append-only: approved_by on % may not be changed after being set', tg_table_name
        using errcode = 'restrict_violation';
    end if;

    return new;
  end if;

  return null;
end;
$$;

comment on function public.prevent_mutation_except_approval() is
  'Conditional immutability for bonus_allocation_snapshots: blocks DELETE and '
  'any UPDATE to the frozen calculation columns; allows the one-time null → '
  'non-null approval transition for (approved_at, approved_by).';

-- -----------------------------------------------------------------------------
-- 2. Replace the blanket append-only trigger with the conditional one
-- -----------------------------------------------------------------------------
drop trigger if exists trg_bonus_allocation_snapshots_append_only
  on public.bonus_allocation_snapshots;

create trigger trg_bonus_allocation_snapshots_immutable
  before update or delete on public.bonus_allocation_snapshots
  for each row execute function public.prevent_mutation_except_approval();

-- -----------------------------------------------------------------------------
-- 3. Add an AFTER UPDATE audit trigger so approval is captured in audit_logs
--    (bonus approval is a critical mutation per the decision lock).
-- -----------------------------------------------------------------------------
create trigger trg_audit_bonus_allocation_snapshots_approval
  after update on public.bonus_allocation_snapshots
  for each row execute function public.log_audit();
