-- Migration 0038 — ENGINEERING-14: update current_org() to read
-- x-meritflow-org-id from PostgREST request.headers (per-request,
-- transaction-scoped). Falls back to app.current_org GUC (backward compat),
-- then to first active membership. Header is advisory — membership is always
-- validated server-side; a false/missing header never elevates access.
-- SECURITY DEFINER + fixed search_path = '' preserved (§7A / ADR-014).

CREATE OR REPLACE FUNCTION public.current_org()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_headers_raw  text;
  v_header_org   text;
  v_claimed      uuid;
  v_result       uuid;
BEGIN
  -- 1. Try x-meritflow-org-id from PostgREST request.headers GUC.
  --    safe=true avoids error when GUC is absent (direct psql / migrations).
  v_headers_raw := current_setting('request.headers', true);
  IF v_headers_raw IS NOT NULL AND v_headers_raw <> '' THEN
    BEGIN
      v_header_org := (v_headers_raw::json) ->> 'x-meritflow-org-id';
    EXCEPTION WHEN others THEN
      v_header_org := NULL;   -- malformed JSON header → ignore
    END;

    IF v_header_org IS NOT NULL AND v_header_org <> '' THEN
      BEGIN
        v_claimed := v_header_org::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RETURN NULL;            -- malformed UUID → fail closed
      END;

      SELECT m.organization_id INTO v_result
        FROM public.memberships m
       WHERE m.profile_id     = auth.uid()
         AND m.organization_id = v_claimed
         AND m.status          = 'active'
       LIMIT 1;

      -- Header present but no membership → fail closed (no fallback).
      -- An explicit header is a deliberate org selection; silence ≠ elevation.
      RETURN v_result;
    END IF;
  END IF;

  -- 2. Backward compat: try app.current_org GUC (legacy path).
  BEGIN
    v_claimed := NULLIF(current_setting('app.current_org', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_claimed := NULL;
  END;

  IF v_claimed IS NOT NULL THEN
    SELECT m.organization_id INTO v_result
      FROM public.memberships m
     WHERE m.profile_id     = auth.uid()
       AND m.organization_id = v_claimed
       AND m.status          = 'active'
     LIMIT 1;
    RETURN v_result;
  END IF;

  -- 3. Fallback: first active membership (ordered by joined_at asc).
  --    Safe for single-org users. For multi-org without a header, this is
  --    the documented explicit fallback (ENGINEERING-14 spec §fallback).
  SELECT m.organization_id INTO v_result
    FROM public.memberships m
   WHERE m.profile_id = auth.uid()
     AND m.status     = 'active'
   ORDER BY m.joined_at ASC
   LIMIT 1;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.current_org() IS
  'Active org for session: reads x-meritflow-org-id from PostgREST '
  'request.headers (membership-validated; fail-closed when header present '
  'but no membership); falls back to app.current_org GUC; then first active '
  'membership. SECURITY DEFINER + fixed search_path (§7A / ENGINEERING-14).';
