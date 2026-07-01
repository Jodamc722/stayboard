// Force-refresh the Turnover Schedule. Revalidates the 'schedule' cache tag so the next load recomputes
// from current Guesty reservations + Breezeway tasks. POST = the in-app Sync button (logged-in users).
// GET = Vercel cron (fires at 6am + noon ET, see vercel.json) so the schedule locks in the morning and
// re-runs at noon without anyone opening the page.
import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

async function doSync() {
  revalidateTag('schedule')
  return NextResponse.json({ ok: true, syncedAt: new Date().toISOString() })
}

// Cron (GET). If CRON_SECRET is set, require it; otherwise allow (Vercel cron calls are internal).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return doSync()
}

// In-app Sync button (POST) — logged-in users only.
export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  return doSync()
}
