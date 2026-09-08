// WHAT CAN A PROJECT BE ABOUT? — one search over the four things a project attaches to.
//
// Jon, 2026-09-08: "assign it to a building or a unit. A building is a collective of units. A unit
// is a unit. Attach it to a reservation or an owner — make it smart enough to use actual Guesty
// data." So no free text: every result here IS a Guesty row, and the picker never lets you type a
// name that isn't one.
//
// One query string, four result kinds, each shaped for the decision the picker is making:
//   building     — name + how many units, so "Arya" reads as "Arya · 34 units"
//   listing      — the unit, with its building so two "1206"s are tellable apart
//   reservation  — guest, dates, code, status — live from Guesty; this is a stay, not a string
//   owner        — name + how many units they hold
//
// Members and view-level, same as the board: you can only attach things to a project you can see,
// and the search itself names units and guests, so it is not open to anyone below that.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isLiveStay } from '@/lib/stay-status'

export const dynamic = 'force-dynamic'

const str = (v: any) => (typeof v === 'string' ? v.trim() : '')
const like = (q: string) => '%' + q.replace(/[%_]/g, ' ') + '%'

export type Hit =
  | { kind: 'building'; id: string; label: string; sub: string; unitIds: string[] }
  | { kind: 'listing'; id: string; label: string; sub: string; building: string | null }
  | { kind: 'reservation'; id: string; label: string; sub: string; listingId: string; checkIn: string; checkOut: string; status: string }
  | { kind: 'owner'; id: string; label: string; sub: string; unitIds: string[] }

export async function GET(req: NextRequest) {
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const q = str(req.nextUrl.searchParams.get('q')).slice(0, 80)
  if (q.length < 2) return NextResponse.json({ ok: true, hits: [] })
  const db = supabaseAdmin()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

  try {
    // Listings once, and buildings are derived from them — a building is not a row anywhere in
    // Guesty, it is the set of listings that share a `building` value. That IS the data model
    // Jon described, so deriving it here keeps the picker honest to what the board and the
    // day sheet already treat as a building.
    const [lRes, rRes, oRes] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title,building,status').limit(2000),
      db.from('guesty_reservations')
        .select('id,listing_id,listing_name,guest_name,check_in,check_out,status,confirmation_code')
        .or(`guest_name.ilike.${like(q)},confirmation_code.ilike.${like(q)},listing_name.ilike.${like(q)}`)
        .gte('check_out', new Date(Date.now() - 60 * 86400000).toLocaleDateString('en-CA'))
        .order('check_in', { ascending: false }).limit(40),
      db.from('guesty_owners').select('id,full_name,email,listing_ids')
        .or(`full_name.ilike.${like(q)},email.ilike.${like(q)}`).limit(20),
    ])
    for (const r of [lRes, rRes, oRes]) if (r.error) return NextResponse.json({ ok: false, error: r.error.message }, { status: 500 })

    const needle = q.toLowerCase()
    const listings = ((lRes.data || []) as any[]).filter(l => !/inactive|archived/i.test(String(l.status || '')))
    const nameOf = (l: any) => String(l.nickname || l.title || 'Unit')

    // Buildings: group active listings by building, match on the building name.
    const byBuilding: Record<string, string[]> = {}
    for (const l of listings) {
      const b = str(l.building)
      if (!b) continue
      ;(byBuilding[b] = byBuilding[b] || []).push(String(l.id))
    }
    const buildings: Hit[] = Object.keys(byBuilding)
      .filter(b => b.toLowerCase().includes(needle))
      .sort((a, b) => byBuilding[b].length - byBuilding[a].length)
      .slice(0, 6)
      .map(b => ({ kind: 'building', id: b, label: b, sub: `${byBuilding[b].length} unit${byBuilding[b].length === 1 ? '' : 's'}`, unitIds: byBuilding[b] }))

    const units: Hit[] = listings
      .filter(l => nameOf(l).toLowerCase().includes(needle))
      .slice(0, 12)
      .map(l => ({ kind: 'listing', id: String(l.id), label: nameOf(l), sub: str(l.building) || 'No building', building: str(l.building) || null }))

    const lname: Record<string, string> = {}
    for (const l of listings) lname[String(l.id)] = nameOf(l)

    const reservations: Hit[] = ((rRes.data || []) as any[])
      .filter(r => isLiveStay(r.status))
      .slice(0, 10)
      .map(r => {
        const ci = String(r.check_in || '').slice(0, 10), co = String(r.check_out || '').slice(0, 10)
        const when = ci <= today && co > today ? 'in-house now' : ci > today ? `arrives ${ci}` : `left ${co}`
        return {
          kind: 'reservation', id: String(r.id),
          label: String(r.guest_name || 'Guest'),
          sub: `${lname[String(r.listing_id)] || r.listing_name || 'Unit'} · ${ci} → ${co} · ${when}${r.confirmation_code ? ' · ' + r.confirmation_code : ''}`,
          listingId: String(r.listing_id), checkIn: ci, checkOut: co, status: String(r.status || ''),
        }
      })

    const owners: Hit[] = ((oRes.data || []) as any[]).slice(0, 8).map(o => {
      const ids: string[] = Array.isArray(o.listing_ids) ? o.listing_ids.map(String) : []
      return { kind: 'owner', id: String(o.id), label: String(o.full_name || o.email || 'Owner'), sub: `${ids.length} unit${ids.length === 1 ? '' : 's'}${o.email ? ' · ' + o.email : ''}`, unitIds: ids }
    })

    return NextResponse.json({ ok: true, hits: [...buildings, ...units, ...reservations, ...owners] })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
