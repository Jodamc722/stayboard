# Ship 31 — 2026-08-31 — System-check truth + Billing speed

Both files build-verified (tsc --noEmit + next build green) against main @ 70c0c22.

| File here | Goes to (repo path) | What changed |
|---|---|---|
| billing.ts | lib/billing.ts | /api/billing speed: parallel month pulls, parallel detail chunks, 6h roster cache |
| route.ts | app/api/settings/system-check/route.ts | Health screen stops crying wolf: Slack/email/Homebase tested the way the app actually connects; stale Guesty auth incident hidden; review-gap rows only red when >24h behind |

## Fastest ship (2 minutes, two commits)
1. Open https://github.com/Jodamc722/stayboard/upload/main/lib — drag in **billing.ts** — Commit changes
2. Open https://github.com/Jodamc722/stayboard/upload/main/app/api/settings/system-check — drag in **route.ts** — Commit changes
Vercel deploys automatically (~90s). Then reload Users & admin → the health screen: Slack, email, Homebase, Guesty-auth and the review-gap rows should be green; only CRON_SECRET (and possibly Vrbo) stay red.

## Better: let Claude push next time
This session could not push because the repo isn't attached to it. Add the GitHub repo Jodamc722/stayboard as a source/connection for Claude sessions in this project — then "git push" works directly and no browser dance is ever needed again.
