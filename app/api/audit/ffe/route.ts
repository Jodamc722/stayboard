// FF&E AUDIT API — hub pages, unit forms and saving, all on derived share links.
//
// Jon, 2026-08-11: "it should not create a link, it should be created automatically... shareable
// property level / unit level, where they can go in and out of links, mark them complete... should
// also show if vacant or checkout today / checkin today... and should be organized by owner."
//
// Three shapes of GET, one POST:
//   ?hub=<code>     a building or an owner: every unit under it, with progress and today's status
//   ?code=<code>    one unit: the checklist scope, saved answers and where it belongs
//   ?index=1        signed in: the whole portfolio grouped by owner, with every share link
//   POST            public: save one answer, or mark a unit complete
//
// FF&E IS A PURCHASING LIST. It writes to ffe_answers / ffe_unit_status and nothing else — no
// Breezeway task, no work order, no maintenance cost. That separation is the point.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { roomsFor, totalItems } from '@/lib/ffe-checklist'
import { buildingOf } from '@/lib/segments'
import { ownerMap } from '@/lib/billing'
import { isLiveStay } from '@/lib/stay-status'
import { unitCode, buildingCode, ownerCode, resolveCode } from '@/lib/ffe-links'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const str = (v: any) => (v == null ? '' : String(v))
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

type Lst = { id: string; name: string; building: string; bedrooms: number | null; ownerId: string; ownerName: string }

const bedroomsOf = (l: any): number | null => {
  const b = l ? l.bedrooms : null
  if (typeof b === 'number') return b
  const n = parseFloat(str(b)); return Number.isFinite(n) ? n : null
}

/** Every active unit with its building and owner — the one list everything else is derived from. */
async function portfolio(db: any): Promise<Lst[]> {
  const [{ data: ls }, owners] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,status,bedrooms:raw->>bedrooms').limit(2000),
    ownerMap().catch(() => ({ byListing: {} as any })),
  ])
  return ((ls || []) as any[])
    .filter(l => !DEAD.includes(str(l.status).toLowerCase()))
    .map(l => {
      const name = l.nickname || l.title || String(l.id)
      const own = (owners as any).byListing[String(l.id)]
      return {
        id: String(l.id), name,
        building: buildingOf(str(l.building), name) || 'Other',
        bedrooms: bedroomsOf(l),
        ownerId: own ? String(own.ownerId) : 'unassigned',
        ownerName: own ? String(own.ownerName) : 'Unassigned owner',
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}

/**
 * What is happening in each unit TODAY. A walker needs to know before they knock: an occupied unit
 * is not one to walk, a checkout is the best moment, and a check-in means finish before arrival.
 */
async function todayStatus(db: any, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!ids.length) return out
  const today = ymd(new Date())
  try {
    const { data } = await db.from('guesty_reservations')
      .select('listing_id,check_in,check_out,status')
      .in('listing_id', ids).lte('check_in', today).gte('check_out', today).limit(3000)
    for (const id of ids) out[id] = 'vacant'
    for (const r of ((data || []) as any[])) {
      if (!isLiveStay(r.status)) continue
      const id = String(r.listing_id)
      const ci = str(r.check_in).slice(0, 10), co = str(r.check_out).slice(0, 10)
      // Precedence matters: a same-day turn is a checkout AND a check-in, and the crew needs to
      // hear the tighter of the two.
      if (ci === today && co === today) out[id] = 'turn'
      else if (co === today) out[id] = out[id] === 'checkin' ? 'turn' : 'checkout'
      else if (ci === today) out[id] = out[id] === 'checkout' ? 'turn' : 'checkin'
      else if (ci < today && co > today) out[id] = 'occupied'
    }
  } catch { /* status is a nicety; the form still works without it */ }
  return out
}

/** Progress per unit, from the answers table. */
async function progress(db: any, ids: string[]) {
  const answered: Record<string, number> = {}
  const toOrder: Record<string, number> = {}
  const done: Record<string, string | null> = {}
  if (!ids.length) return { answered, toOrder, done }
  try {
    const { data } = await db.from('ffe_answers').select('listing_id,answer').in('listing_id', ids).limit(20000)
    for (const a of ((data || []) as any[])) {
      const id = String(a.listing_id)
      answered[id] = (answered[id] || 0) + 1
      if (['replace', 'add'].includes(str(a.answer))) toOrder[id] = (toOrder[id] || 0) + 1
    }
  } catch { /* table not migrated yet */ }
  try {
    const { data } = await db.from('ffe_unit_status').select('listing_id,completed_at').in('listing_id', ids).limit(3000)
    for (const s of ((data || []) as any[])) done[String(s.listing_id)] = s.completed_at || null
  } catch { /* optional */ }
  return { answered, toOrder, done }
}

const unitCard = (l: Lst, p: any, st: Record<string, string>) => ({
  id: l.id, name: l.name, bedrooms: l.bedrooms, building: l.building,
  ownerId: l.ownerId, ownerName: l.ownerName,
  code: unitCode(l.id),
  total: totalItems(l.bedrooms),
  answered: p.answered[l.id] || 0,
  toOrder: p.toOrder[l.id] || 0,
  completedAt: p.done[l.id] || null,
  today: st[l.id] || 'vacant',
})

export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const sp = req.nextUrl.searchParams
  try {
    const all = await portfolio(db)

    // ---- INDEX (signed in): the whole portfolio by owner, with every link already made ----
    if (sp.get('index')) {
      const s = createClient()
      const { data: u } = await s.auth.getUser()
      if (!u.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      const ids = all.map(l => l.id)
      const [p, st] = await Promise.all([progress(db, ids), todayStatus(db, ids)])
      const byOwner: Record<string, any> = {}
      for (const l of all) {
        const o = byOwner[l.ownerId] = byOwner[l.ownerId] || {
          ownerId: l.ownerId, ownerName: l.ownerName, code: ownerCode(l.ownerId), buildings: {} as any, units: [] as any[],
        }
        o.units.push(unitCard(l, p, st))
        o.buildings[l.building] = { building: l.building, code: buildingCode(l.building) }
      }
      const owners = Object.values(byOwner).map((o: any) => ({
        ...o,
        buildings: Object.values(o.buildings),
        total: o.units.reduce((a: number, x: any) => a + x.total, 0),
        answered: o.units.reduce((a: number, x: any) => a + x.answered, 0),
        toOrder: o.units.reduce((a: number, x: any) => a + x.toOrder, 0),
        complete: o.units.filter((x: any) => x.completedAt).length,
      })).sort((a: any, b: any) => b.units.length - a.units.length || a.ownerName.localeCompare(b.ownerName))
      return NextResponse.json({ ok: true, owners })
    }

    // ---- HUB (public): a building or an owner ----
    const hub = str(sp.get('hub')).trim()
    if (hub) {
      const scope = resolveCode(hub, {
        units: [], // a unit code is not a hub
        buildings: Array.from(new Set(all.map(l => l.building))),
        owners: Array.from(new Set(all.map(l => l.ownerId))),
      })
      if (!scope) return NextResponse.json({ error: 'link not found' }, { status: 404 })
      const units = scope.kind === 'building'
        ? all.filter(l => l.building.toLowerCase() === scope.id)
        : all.filter(l => l.ownerId === scope.id)
      const ids = units.map(l => l.id)
      const [p, st] = await Promise.all([progress(db, ids), todayStatus(db, ids)])
      const cards = units.map(l => unitCard(l, p, st))
      return NextResponse.json({
        ok: true,
        scope: {
          kind: scope.kind,
          name: scope.kind === 'building' ? (units[0]?.building || scope.id) : (units[0]?.ownerName || 'Owner'),
          code: hub,
        },
        units: cards,
        totals: {
          units: cards.length,
          total: cards.reduce((a, x) => a + x.total, 0),
          answered: cards.reduce((a, x) => a + x.answered, 0),
          toOrder: cards.reduce((a, x) => a + x.toOrder, 0),
          complete: cards.filter(x => x.completedAt).length,
        },
      })
    }

    // ---- UNIT (public) ----
    const code = str(sp.get('code')).trim()
    if (!code) return NextResponse.json({ error: 'link not found' }, { status: 404 })
    const scope = resolveCode(code, { units: all.map(l => l.id), buildings: [], owners: [] })
    if (!scope) return NextResponse.json({ error: 'link not found' }, { status: 404 })
    const l = all.find(x => x.id === scope.id) as Lst
    const [p, st] = await Promise.all([progress(db, [l.id]), todayStatus(db, [l.id])])
    let answers: Record<string, any> = {}
    try {
      const { data } = await db.from('ffe_answers')
        .select('room,item_key,answer,qty,note').eq('listing_id', l.id).limit(1000)
      for (const a of ((data || []) as any[])) {
        answers[str(a.room) + '::' + str(a.item_key)] = { answer: str(a.answer), qty: a.qty ?? null, note: a.note ?? null }
      }
    } catch { /* not migrated yet — form renders, saving will report the error */ }
    return NextResponse.json({
      ok: true,
      unit: {
        name: l.name, building: l.building, bedrooms: l.bedrooms,
        ownerName: l.ownerName, today: st[l.id] || 'vacant',
        completedAt: p.done[l.id] || null,
      },
      // Where to go back to. The hub the walker most likely came from is the building.
      hub: { code: buildingCode(l.building), name: l.building },
      rooms: roomsFor(l.bedrooms).map(r => r.key),
      total: totalItems(l.bedrooms),
      answers,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({} as any))
  try {
    const code = str(body.code).trim()
    if (!code) return NextResponse.json({ error: 'link not found' }, { status: 404 })
    const all = await portfolio(db)
    const scope = resolveCode(code, { units: all.map(l => l.id), buildings: [], owners: [] })
    if (!scope) return NextResponse.json({ error: 'link not found' }, { status: 404 })
    const listingId = scope.id

    // Mark the unit finished — a person's statement, not a computed one.
    if (String(body.action || '') === 'complete') {
      const done = body.done !== false
      const row = {
        listing_id: listingId,
        completed_at: done ? new Date().toISOString() : null,
        completed_by: str(body.by).slice(0, 80) || null,
        updated_at: new Date().toISOString(),
      }
      const { data: ex } = await db.from('ffe_unit_status').select('listing_id').eq('listing_id', listingId).limit(1)
      const r = ex && ex[0]
        ? await db.from('ffe_unit_status').update(row).eq('listing_id', listingId)
        : await db.from('ffe_unit_status').insert(row)
      if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
      return NextResponse.json({ ok: true, completedAt: row.completed_at })
    }

    const room = str(body.room).slice(0, 40)
    const itemKey = str(body.itemKey).slice(0, 40)
    if (!room || !itemKey) return NextResponse.json({ error: 'room and itemKey required' }, { status: 400 })
    const answer = str(body.answer)
    if (!['replace', 'add', 'keep', 'na'].includes(answer)) return NextResponse.json({ error: 'bad answer' }, { status: 400 })
    const qtyN = Number(body.qty)
    const row = {
      listing_id: listingId, room, item_key: itemKey,
      title: str(body.title).slice(0, 120) || itemKey,
      answer,
      qty: Number.isFinite(qtyN) && qtyN > 0 ? Math.min(Math.round(qtyN), 99) : 1,
      note: str(body.note).slice(0, 500) || null,
      updated_at: new Date().toISOString(),
    }
    const { data: ex } = await db.from('ffe_answers')
      .select('id').eq('listing_id', listingId).eq('room', room).eq('item_key', itemKey).limit(1)
    const r = ex && ex[0]
      ? await db.from('ffe_answers').update(row).eq('id', ex[0].id)
      : await db.from('ffe_answers').insert(row)
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
