# Lighthouse self-audit

`node scripts/audit/run.mjs` answers one question twice a day: **is something that used to work
quietly not working any more?**

It runs from a plain clone with no secrets and no npm dependencies, so it works identically on a
laptop, in GitHub Actions, and in an automated session.

```bash
node scripts/audit/run.mjs                    # static checks + live probes against production
node scripts/audit/run.mjs --no-live          # static only, no network
node scripts/audit/run.mjs --base https://... # probe a preview deployment
node scripts/audit/run.mjs --json r.json --md r.md
node scripts/audit/run.mjs --strict           # exit 1 when a NEW red finding appears
node scripts/audit/run.mjs --write-baseline   # accept the current amber backlog as known
```

## What it checks

**Static** (`checks.mjs`) — cron paths that Vercel will never fire because they carry a query
string; cron routes scheduled but missing, or present but never scheduled; cron routes with no
`CRON_SECRET` check; pages that forget `<Shell>` and therefore ship with no navigation; queries
capped at exactly 1000 rows where PostgREST cannot tell you it truncated; empty `catch` blocks
sitting directly after a database write; React hooks declared below an early return; duplicate
exported helpers in `lib/` with incompatible signatures; tables created without RLS; tables the
code reads that no migration creates; storage buckets served publicly that should be signed.

**Live** (`live.mjs`) — every gated page must answer `307 → /login`. A `5xx` is red because a
signed-in user would see an error screen. A `200` is *also* red, because middleware fails open
by design and a page serving content with no session is what that failure looks like. It then
calls the app's own sync watchdog: if the watchdog itself is down, no stalled feed is being
announced to anyone, and a frozen board looks exactly like a quiet day.

## The baseline

`baseline.json` holds the amber backlog that is already known about. The runner separates
**new**, **worse**, and **fixed** from that backlog so the daily report is short enough to read.

Red findings are **never** baselined. Something that is broken right now gets said out loud on
every single run until it is fixed.

To accept the current backlog after a cleanup pass: `node scripts/audit/run.mjs --no-live --write-baseline`.

## Adding a check

Add a function to `checks.mjs` returning `{ id, sev, area, title, detail, where[] }` and register
it in `STATIC_CHECKS`. Two rules:

1. **`id` must be stable across runs** — the baseline diff is keyed on it.
2. **Prefer a missed problem to a false alarm.** A check that cries wolf gets ignored, and then
   so does every check next to it.
