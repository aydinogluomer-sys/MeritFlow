-- =============================================================================
-- Migration 0017 — notifications foundation  (Phase 3)
-- Refs: 14_DATA_DICTIONARY (notifications §424-429), 15_RLS_POLICY_MATRIX
--       (notifications §139-142), 16 (notification column across the 9 machines;
--       OQ-DD-3 retention), ADR-020. Phase 3 slice ONLY.
--
-- Scope: the notification DELIVERY SINK — a per-recipient inbox row with an
-- unread→read lifecycle. This slice provides the TABLE + RLS + mark-read guard
-- ONLY. It does NOT emit notifications: no delivery engine, no email/push/realtime,
-- no auto-emit triggers from tasks/reviews/bonus/dispute/flag tables. Emission is
-- future feature/server work that inserts here via service_role.
--
-- Locked decisions (this slice):
--   A recipient can mark OWN notification read (unread→read, one-way).
--   B INSERT is server-only (service_role) — no authenticated INSERT.
--   C no client DELETE and NO prevent_delete trigger. Notifications are personal
--     data with a planned V1 TTL (§429, OQ-DD-3) — NOT a legal-retention surface.
--     prevent_delete would fire for service_role too and stamp a misleading
--     "legal-review item" message, blocking the future retention job. So DELETE is
--     simply ungranted to authenticated (RLS denies) while service_role may prune.
--   D read is RECIPIENT-ONLY. HR / Auditor / Manager / Finance / Support CANNOT
--     read another user's notifications (§426/§429 "RLS: yalnız recipient"). The
--     audit trail lives in audit_logs, not here.
--   E no `type` value-enum — only a non-empty CHECK (forward-compatible; the
--     emitting server validates the category).
--   No audit trigger (§429 audit: hayır; not in the critical-mutation list).
--   No new permission/role — RLS keys off current_org() + auth.uid() only, so the
--     seeded permission catalog (test 0001 = 20) is unchanged.
--
-- DELIBERATELY ABSENT (gated / later): delivery channels (email/push/web-socket),
-- notification preferences/settings, digest/batching, retention/TTL job (V1),
-- audit trigger, type value-enum, any FK to tasks/disputes/bonus/export (the
-- polymorphic reference is carried by `link`/`payload`, no FK), app/UI/API. No
-- edits to 0001..0016 / existing tests. Local dev/staging only (ADR-014).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- validate_notification_transition(): mark-read-only guard for UPDATE.
-- INSERT is unconstrained (server-only, trusted). On UPDATE the identity fields
-- (org/recipient/type/payload/link/created_at) are immutable; status is one-way
-- unread→read (read is terminal — read→unread rejected); the unread→read
-- transition server-stamps read_at (authoritative; ignores any client value).
-- Compares NEW/OLD only (no table reads → no SECURITY DEFINER needed).
-- -----------------------------------------------------------------------------
create or replace function public.validate_notification_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- UPDATE: identity fields are immutable after creation.
  if new.organization_id is distinct from old.organization_id
  or new.recipient_id    is distinct from old.recipient_id
  or new.type            is distinct from old.type
  or new.payload         is distinct from old.payload
  or new.link            is distinct from old.link
  or new.created_at      is distinct from old.created_at then
    raise exception 'notification identity (org/recipient/type/payload/link/created_at) is immutable' using errcode = '23001';
  end if;

  -- status is one-way: read is terminal, cannot be marked unread again.
  if old.status = 'read' and new.status = 'unread' then
    raise exception 'notification cannot be marked unread again (read is terminal)' using errcode = '23514';
  end if;

  -- On unread→read, server-stamp read_at (authoritative — ignore client value).
  if old.status = 'unread' and new.status = 'read' then
    new.read_at := now();
  end if;

  return new;
end;
$$;

comment on function public.validate_notification_transition() is
  'Notifications mark-read guard: identity immutable after insert; status one-way unread→read (read terminal); server-stamps read_at on unread→read.';

-- -----------------------------------------------------------------------------
-- notifications (per-recipient delivery sink). Personal data; recipient-only RLS.
-- Mutable only via unread→read (mark read). Server-only INSERT; no client DELETE.
-- -----------------------------------------------------------------------------
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id    uuid not null,                          -- profile_id (== auth.uid())
  type            text not null,                          -- category; no value-enum (E)
  payload         jsonb not null default '{}'::jsonb,     -- structured context
  link            text,                                   -- optional deep-link; NO FK (polymorphic)
  status          text not null default 'unread',
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint notifications_status_chk check (status in ('unread', 'read')),
  constraint notifications_type_nonempty_chk check (length(btrim(type)) > 0),
  constraint notifications_payload_object_chk check (jsonb_typeof(payload) = 'object'),
  -- read_at exists iff the notification is read.
  constraint notifications_read_consistency_chk check (
    case
      when status = 'read'   then read_at is not null
      else read_at is null
    end),
  -- Same-org recipient (SI-7): recipient must be a member of the same tenant.
  constraint notifications_recipient_org_fk
    foreign key (organization_id, recipient_id)
    references public.memberships (organization_id, profile_id)
);

comment on table public.notifications is
  'Per-recipient notification delivery sink (data dict §424-429). unread→read lifecycle; '
  'recipient-only RLS (HR/Auditor/Manager/Finance/Support excluded — §429); server-only INSERT '
  '(service_role); no client DELETE (retention/TTL is a V1 item, OQ-DD-3); no audit trigger; '
  'polymorphic reference via link/payload (no FK). Sensitivity: personal-data.';

-- Recipient inbox by unread/read state (§429) + recency scan per recipient.
create index idx_notifications_recipient_status on public.notifications (recipient_id, status);
create index idx_notifications_org_recipient_created on public.notifications (organization_id, recipient_id, created_at desc);

create trigger trg_notifications_set_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

create trigger trg_notifications_validate
  before insert or update on public.notifications
  for each row execute function public.validate_notification_transition();

-- NOTE: deliberately NO log_audit trigger (§429 audit: hayır) and NO prevent_delete
-- trigger (decision C — retention/TTL is a V1 item; service_role may prune).

-- =============================================================================
-- RLS (ENABLE + FORCE) + least-privilege grants + policies
-- Recipient-only: a user sees and marks read ONLY their own current-org rows.
-- INSERT is server-only (service_role). No client DELETE.
-- =============================================================================
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
revoke all on public.notifications from anon, authenticated;
grant select, update on public.notifications to authenticated;                     -- NO insert (server-only), NO delete
grant all on public.notifications to service_role;

create policy notifications_select on public.notifications
  for select to authenticated
  using (
    organization_id = public.current_org()
    and recipient_id = auth.uid()
  );

create policy notifications_update on public.notifications
  for update to authenticated
  using (
    organization_id = public.current_org()
    and recipient_id = auth.uid()
  )
  with check (
    organization_id = public.current_org()
    and recipient_id = auth.uid()
  );
-- No INSERT policy/privilege (server-only). No DELETE policy/privilege (retention → V1).
