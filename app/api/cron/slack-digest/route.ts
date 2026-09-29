// MERGED (2026-09-28) into /api/cron/slack, which runs the morning digest engine on its 07:19 ET
// pass. This path has no cron line any more; it stays as a re-export of the Slack cron only because
// lib/eve/automations.ts still names it.
export { GET, POST } from '../slack/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
