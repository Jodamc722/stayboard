// AUTO ARRIVAL INSPECTIONS — cron runner + signed-in preview.
//
//   GET                → run: create + assign inspections for firing arrivals (cron or signed-in)
//   GET ?preview=1     → dry run: list what WOULD fire, touch nothing (signed-in)
//
// Runs hourly-ish via vercel.json; exactly-once is enforced by auto_inspections.reservation_id,
// so the schedule can be aggressive without ever double-tasking an inspector. See
// lib/auto-inspections.ts for the rules (big arrival / VIP / owner stay) and who gets assigned.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { runAutoInspections } from '@/lib/auto-inspections'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function signedIn(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return !!user
  } catch { return false }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const isCron = secret ? auth === 'Bearer ' + secret : (!!req.headers.get('x-vercel-cron') || auth === '')
  const sp = new URL(req.url).searchParams
  const preview = sp.get('preview') === '1'

  if (!isCron && !(await signedIn())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // A dry run from a stranger would leak reservation data; previews are for signed-in humans.
  if (preview && !(await signedIn()) && !isCron) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const out = await runAutoInspections({ dryRun: preview })
    return NextResponse.json(out)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
