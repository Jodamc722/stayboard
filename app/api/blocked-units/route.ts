// BLOCKED UNITS — thin HTTP wrapper. The logic lives in lib/blocked-units so the morning briefs
// and this endpoint can never disagree about what "blocked" means (Jon, 2026-08-10).
//
// ?days=N   how far ahead to look (default 30, max 120)
// ?raw=1    admins only: the raw Guesty calendar days, for checking the shape by eye
// ?cached=1 the Today tile: the same report, at most 10 minutes old (the board itself reads live)
import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMultiCalendar } from '@/lib/guesty'
import { blockedUnits } from '@/lib/blocked-units'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

// The report walks Guesty's live multi-calendar. The Today tile re-read it every five minutes for
// every viewer to print one number; the tile asks for this copy instead. A failed walk throws, and
// a throw is never cached. The Blocked board does not pass ?cached, so it stays live.
const cachedBlocked = unstable_cache((days: number) => blockedUnits(days), ['blocked-units-report-v1'], { revalidate: 600 })

export async function GET(req: NextRequest) {
  // GATE MATCHES THE PAGE (2026-09-03): the page is granted under `blocked`; this answered under
  // `reports`, so a role given the tab but not Owner Reports got a page that failed to load.
  const gate = await requireLevel('blocked', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const days = Math.min(Math.max(Number(sp.get('days')) || 30, 1), 120)

  try {
    if (sp.get('raw')) {
      if (!gate.access || gate.access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
      const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
      const today = ymd(new Date())
      const to = new Date(today + 'T12:00:00'); to.setDate(to.getDate() + days)
      const { data } = await supabaseAdmin().from('guesty_listings').select('id').limit(60)
      const cal = await getMultiCalendar(((data || []) as any[]).map(l => String(l.id)), today, ymd(to))
      return NextResponse.json({ ok: true, sampled: cal.length, sample: cal.slice(0, 40).map(d => d.raw) })
    }
    const report = sp.get('cached') ? await cachedBlocked(days) : await blockedUnits(days)
    return NextResponse.json({ ok: true, ...report })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
