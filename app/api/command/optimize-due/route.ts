// LISTINGS DUE FOR OPTIMIZATION (Jon, 2026-10-01: "add optimize tasks — every listing should be
// optimized once every 6 months"). Every active listing whose last optimization (guesty_listings
// .last_optimized, stamped by the listing engine's copy / photo / hero pushes) is older than the
// cadence, or that has never been optimized — never first, then oldest.
import { NextResponse } from 'next/server'
import { requireVrUser } from '@/lib/vr-gate'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const OPTIMIZE_EVERY_DAYS = 182   // six months

export async function GET() {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  try {
    const { data, error } = await supabaseAdmin().from('guesty_listings')
      .select('id,nickname,title,building,status,last_optimized,lastRaw:raw->>_lastOptimized,listed:raw->>isListed')
      .limit(1000)
    if (error) throw error
    const now = Date.now()
    const rows = ((data || []) as any[])
      .filter(l => !/inactive|disabled|archived|deleted/i.test(String(l.status || '')) && String(l.listed) !== 'false')
      .map(l => {
        const iso = l.last_optimized || l.lastRaw || null
        const t = iso ? Date.parse(String(iso)) : NaN
        const days = Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null
        return { id: String(l.id), name: String(l.nickname || l.title || l.id), building: String(l.building || ''), lastOptimized: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null, days }
      })
      .filter(r => r.days == null || r.days >= OPTIMIZE_EVERY_DAYS)
      .sort((a, b) => (a.days == null ? -1 : b.days == null ? 1 : b.days - a.days))
    return NextResponse.json({ ok: true, everyDays: OPTIMIZE_EVERY_DAYS, due: rows.length, rows })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
}
