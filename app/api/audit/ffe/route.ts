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
import { roomsFor, totalItems, mergeChecklist, FFE_ROOMS, type FfeOverride } from '@/lib/ffe-checklist'
import { ffePortfolio, type FfeUnit } from '@/lib/ffe-portfolio'
import { isLiveStay } from '@/lib/stay-status'
import { unitCode, buildingCode, ownerCode, resolveCode } from '@/lib/ffe-links'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const str = (v: any) => (v == null ? '' : String(v))
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

// TELL THE TRUTH WHEN THE TABLES ARE MISSING. Until migration 032 has been run, every save fails
// with a PostgREST schema-cache error, and the walker's phone showed "check your signal" — which
// sent people chasing a network problem that did not exist. This turns that one specific failure
// into a message that names the actual cause.
const isMissingTable = (msg: any) =>
  /schema cache|does not exist|relation .* does not exist/i.test(String(msg || ''))
const SETUP_MSG = 'FF&E storage is not set up yet — migration 032 has not been run on the database. Nothing you tap can save until it is.'
function dbFail(msg: any) {
  return isMissingTable(msg)
    ? NextResponse.json({ ok: false, setupRequired: true, error: SETUP_MSG }, { status: 503 })
    : NextResponse.json({ ok: false, error: String(msg) }, { status: 500 })
}

// The unit list lives in lib/ffe-portfolio.ts now — the order builder needs the same one, and two
// copies of "which units does this owner have" is two answers to that question.
type Lst = FfeUnit

/** The editable overlay on the built-in checklist. Absent table = empty overlay, never an error. */
async function checklistOverrides(db: any): Promise<FfeOverride[]> {
  try {
    const { data } = await db.from('ffe_checklist_items')
      .select('room,item_key,en,es,ask,hidden,sort').limit(2000)
    return (data || []) as FfeOverride[]
  } catch { return [] }
}

const portfolio = ffePortfolio

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
  let setupRequired = false
  if (!ids.length) return { answered, toOrder, done, setupRequired }
  try {
    const { data, error } = await db.from('ffe_answers').select('listing_id,answer').in('listing_id', ids).limit(20000)
    if (error && isMissingTable(error.message)) setupRequired = true
    for (const a of ((data || []) as any[])) {
      const id = String(a.listing_id)
      answered[id] = (answered[id] || 0) + 1
      if (['replace', 'add'].includes(str(a.answer))) toOrder[id] = (toOrder[id] || 0) + 1
    }
  } catch { setupRequired = true }
  try {
    const { data } = await db.from('ffe_unit_status').select('listing_id,completed_at').in('listing_id', ids).limit(3000)
    for (const s of ((data || []) as any[])) done[String(s.listing_id)] = s.completed_at || null
  } catch { /* optional */ }
  return { answered, toOrder, done, setupRequired }
}

const unitCard = (l: Lst, p: any, st: Record<string, string>, ov: FfeOverride[] = []) => ({
  id: l.id, name: l.name, bedrooms: l.bedrooms, building: l.building,
  ownerId: l.ownerId, ownerName: l.ownerName,
  code: unitCode(l.id),
  total: totalItems(l.bedrooms, ov),
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
      const [p, st, ov] = await Promise.all([progress(db, ids), todayStatus(db, ids), checklistOverrides(db)])
      const byOwner: Record<string, any> = {}
      for (const l of all) {
        const o = byOwner[l.ownerId] = byOwner[l.ownerId] || {
          ownerId: l.ownerId, ownerName: l.ownerName, code: ownerCode(l.ownerId), buildings: {} as any, units: [] as any[],
        }
        o.units.push(unitCard(l, p, st, ov))
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
      return NextResponse.json({ ok: true, owners, setupRequired: p.setupRequired, setupMessage: p.setupRequired ? SETUP_MSG : null })
    }

    // ---- CHECKLIST (signed in): the built-in list plus the overlay, for the editor tab ----
    if (sp.get('checklist')) {
      const s2 = createClient()
      const { data: u } = await s2.auth.getUser()
      if (!u.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      const ov = await checklistOverrides(db)
      return NextResponse.json({
        ok: true,
        rooms: FFE_ROOMS.map(r => ({
          key: r.key, en: r.en, es: r.es, minBedrooms: r.minBedrooms || null,
          items: r.items.map(i => ({ key: i.key, en: i.en, es: i.es, ask: i.ask || 'replace', builtin: true })),
        })),
        overrides: ov,
      })
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
        // resolveCode hands back the building name as it is stored ("Botanica"), while buildingCode
        // signs the lower-cased form — so this comparison has to lower BOTH sides or every building
        // hub comes back with zero units and the walker's Back link lands on an empty page.
        ? all.filter(l => l.building.toLowerCase() === String(scope.id).toLowerCase())
        : all.filter(l => l.ownerId === scope.id)
      const ids = units.map(l => l.id)
      const [p, st, ov] = await Promise.all([progress(db, ids), todayStatus(db, ids), checklistOverrides(db)])
      const cards = units.map(l => unitCard(l, p, st, ov))
      return NextResponse.json({
        ok: true,
        scope: {
          kind: scope.kind,
          name: scope.kind === 'building' ? (units[0]?.building || scope.id) : (units[0]?.ownerName || 'Owner'),
          code: hub,
        },
        units: cards,
        setupRequired: p.setupRequired,
        setupMessage: p.setupRequired ? SETUP_MSG : null,
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
    const [p, st, ov] = await Promise.all([progress(db, [l.id]), todayStatus(db, [l.id]), checklistOverrides(db)])
    const merged = mergeChecklist(l.bedrooms, ov)
    let answers: Record<string, any> = {}
    try {
      const { data } = await db.from('ffe_answers')
        .select('room,item_key,answer,qty,note,photo_url').eq('listing_id', l.id).limit(1000)
      for (const a of ((data || []) as any[])) {
        answers[str(a.room) + '::' + str(a.item_key)] = { answer: str(a.answer), qty: a.qty ?? null, note: a.note ?? null, photoUrl: a.photo_url ?? null }
      }
    } catch { /* not migrated yet — form renders, saving will report the error */ }
    return NextResponse.json({
      ok: true,
      unit: {
        name: l.name, building: l.building, bedrooms: l.bedrooms,
        ownerName: l.ownerName, today: st[l.id] || 'vacant',
        completedAt: p.done[l.id] || null,
      },
      setupRequired: p.setupRequired,
      setupMessage: p.setupRequired ? SETUP_MSG : null,
      // Where to go back to. The hub the walker most likely came from is the building.
      hub: { code: buildingCode(l.building), name: l.building },
      // The CHECKLIST ITSELF is sent down, not just the room keys — the phone renders whatever the
      // Checklist tab says, so an added item appears without a deploy.
      checklist: merged,
      total: merged.reduce((a, r) => a + r.items.length, 0),
      answers,
    })
  } catch (e: any) {
    return dbFail(e?.message || e)
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
      if (r.error) return dbFail(r.error.message)
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
      // Only overwrite the photo when the client actually sends one — re-answering an item must
      // not silently drop the picture already attached to it.
      ...(str(body.photoUrl) ? { photo_url: str(body.photoUrl).slice(0, 500) } : {}),
      updated_at: new Date().toISOString(),
    }
    const { data: ex } = await db.from('ffe_answers')
      .select('id').eq('listing_id', listingId).eq('room', room).eq('item_key', itemKey).limit(1)
    const r = ex && ex[0]
      ? await db.from('ffe_answers').update(row).eq('id', ex[0].id)
      : await db.from('ffe_answers').insert(row)
    if (r.error) return dbFail(r.error.message)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return dbFail(e?.message || e)
  }
}
