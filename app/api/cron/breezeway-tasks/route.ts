import { NextRequest, NextResponse } from 'next/server'
import { syncBreezewayTasks } from '@/lib/breezeway-sync'

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
  return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
}

export async function GET(req: NextRequest) {
  return run(req)
}

export async function POST(req: NextRequest) {
  return run(req)
}
