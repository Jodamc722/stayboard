// BLOCKED UNITS — thin HTTP wrapper. The logic lives in lib/blocked-units so the morning briefs
// and this endpoint can never disagree about what "blocked" means (Jon, 2026-08-10).
//
// ?days=N   how far ahead to look (default 30, max 120)
// ?raw=1    admins only: the raw Guesty calendar days, for checking the shape by eye
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMultiCalendar } from '@/lib/guesty'
import { blockedUnits } from '@/lib/blocked-units'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function GET(req: NextRequest) {
  const gate = await requireLevel('reports', 'view')
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
    const report = await blockedUnits(days)
    return NextResponse.json({ ok: true, ...report })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
