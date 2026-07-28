import { NextRequest, NextResponse } from 'next/server'
import { syncBreezewayTasks } from '@/lib/breezeway-sync'
import { syncBreezewayComments } from '@/lib/breezeway-comment-sync'
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
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result, comments })
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
