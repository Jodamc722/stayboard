// UNIT CALENDAR — which days a unit is OCCUPIED, so nobody schedules work into a guest's stay.
// GET ?listingId=...&from=YYYY-MM-DD&to=YYYY-MM-DD  ->  { days: [{date, occupied, checkIn, checkOut, guest}] }
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function ymd(d: Date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d) }
function addDays(s: string, n: number) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const isLive = (s: string) => /confirm|check/i.test(str(s))

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const sp = req.nextUrl.searchParams
    const listingId = str(sp.get('listingId'))
    if (!listingId) return NextResponse.json({ ok: true, days: [] })
    const today = ymd(new Date())
    const from = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('from'))) ? str(sp.get('from')) : addDays(today, -7)
    const to = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.get('to'))) ? str(sp.get('to')) : addDays(from, 75)
    const db = supabaseAdmin()
    const { data } = await db.from('guesty_reservations')
      .select('check_in,check_out,status,guest_name')
      .eq('listing_id', listingId).lte('check_in', to).gte('check_out', from).limit(400)
    const stays = ((data || []) as any[]).filter(r => isLive(r.status)).map(r => ({
      ci: str(r.check_in).slice(0, 10), co: str(r.check_out).slice(0, 10), guest: str(r.guest_name) || 'Guest',
    }))
    const days: any[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const inHouse = stays.find(s => s.ci <= d && d < s.co)
      const out = stays.find(s => s.co === d)
      const inn = stays.find(s => s.ci === d)
      days.push({
        date: d, occupied: !!inHouse, checkOut: !!out, checkIn: !!inn,
        guest: (inHouse && inHouse.guest) || (out && out.guest) || null,
      })
      if (days.length > 200) break
    }
    return NextResponse.json({ ok: true, listingId, from, to, today, days })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
