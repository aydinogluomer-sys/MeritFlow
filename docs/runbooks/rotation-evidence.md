# Credential Rotation Drill Evidence Log (ENGINEERING-12)

Records every credential-rotation drill for the ENGINEERING-12 DoD. The rotation **procedure**
(which credential, where it lives, how to rotate, how to confirm the old key is dead) is in
[incident-response.md](incident-response.md) §4. Rotation is not proven until a rotated key has
been used successfully **and** the old one confirmed dead.

Run `scripts/credential-rotation-drill.sh --apply` to generate a pre-filled evidence row. The
script never reads, logs, or echoes a secret value — it opens the Supabase/Sentry dashboard and
shells out to `gh secret set` / `vercel env add`, which consume the new value out of band.

```bash
STAGING_CONFIRMED=1 bash scripts/credential-rotation-drill.sh            # dry-run checklist (no action)
STAGING_CONFIRMED=1 bash scripts/credential-rotation-drill.sh --apply    # guided, step-by-step rotation
```

| Date | Operator | Credentials rotated | Old key confirmed dead | Notes |
| --- | --- | --- | --- | --- |
| _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

> **ENGINEERING-12 is not "done" for credential readiness until one row above is complete** with
> the old key confirmed dead (Y). The same drill row is also recorded in
> [incident-response.md](incident-response.md) §6 (the incident/drill evidence table).
