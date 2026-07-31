import { NextRequest, NextResponse } from 'next/server'
import { syncBreezewayTasks } from '@/lib/breezeway-sync'
import { syncBreezewayComments } from '@/lib/breezeway-comment-sync'
import { autoCreateGlitches } from '@/lib/glitch-auto'
import { runBehindAlert } from '@/lib/ops-behind'
import { revalidateTag } from 'next/cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Scheduled refresh of the Breezeway task mirror (assignees) so the scheduler
// stays current without waiting on webhooks. Wired to a Vercel cron in
// vercel.json (every 2 hours). If CRON_SECRET is set, requires the matching
// bearer token (Vercel sends it automatically); otherwise runs open so the
// cron works without extra configuration.
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }
  const result = await syncBreezewayTasks(250000)
  // Field replies written inside Breezeway come back into the app threads and notify whoever
  // is following that task. Best effort - a comment failure must never fail the task mirror.
  let comments: any = null
  try { comments = await syncBreezewayComments(120) } catch (e) { comments = { error: String((e as any)?.message || e).slice(0, 120) } }
  try { revalidateTag('schedule') } catch {}
  // The mirror is now fresh, so this is the right moment to ask "are the cleans running behind?"
  // and tell the ops team once (see lib/ops-behind.ts for the clock rule and the once-a-day gate).
  // Best effort - an alert failure must never fail the task mirror.
  let alert: any = null
  try { alert = await runBehindAlert() } catch (e) { alert = { error: String((e as any)?.message || e).slice(0, 120) } }
  // Guest-reported tasks logged in Breezeway become glitch cards automatically (see lib/glitch-auto)
  // so the board reflects reality without double entry. Best effort - never fails the mirror.
  let autoGlitches: any = null
  try { autoGlitches = await autoCreateGlitches() } catch (e) { autoGlitches = { error: String((e as any)?.message || e).slice(0, 120) } }
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result, comments, alert, autoGlitches })
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
