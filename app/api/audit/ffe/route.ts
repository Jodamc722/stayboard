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
import { roomsFor, totalItems, mergeChecklist, FFE_ROOMS, FFE_ACTIONS, BUYS, type FfeOverride } from '@/lib/ffe-checklist'
import { ffePortfolio, type FfeUnit } from '@/lib/ffe-portfolio'
import { isLiveStay } from '@/lib/stay-status'
import { unitCode, buildingCode, ownerCode, resolveCode } from '@/lib/ffe-links'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const str = (v: any) => (v == null ? '' : String(v))
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
/** A typed-in price. Blank stays blank — "not priced yet" and "free" are different facts. */
function estOf(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

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

/**
 * Progress per unit.
 *
 * PROGRESS IS NOW ROOMS, NOT ITEMS (Jon, 2026-08-14). The old number — "7/64 answered" — measured
 * how much of a survey had been filled in, which stopped meaning anything the moment the form became
 * an exception log. A unit with nothing wrong is finished at zero findings. What a person actually
 * wants to know is how much of the unit somebody has stood in, so the headline is rooms checked.
 *
 * `answered` stays alongside it, because the count of FINDINGS is still worth showing — it is just
 * no longer the progress bar.
 */
async function progress(db: any, ids: string[]) {
  const answered: Record<string, number> = {}
  const toOrder: Record<string, number> = {}
  const done: Record<string, string | null> = {}
  const roomsChecked: Record<string, number> = {}
  let setupRequired = false
  if (!ids.length) return { answered, toOrder, done, roomsChecked, setupRequired }
  try {
    const { data, error } = await db.from('ffe_answers').select('listing_id,answer').in('listing_id', ids).limit(20000)
    if (error && isMissingTable(error.message)) setupRequired = true
    for (const a of ((data || []) as any[])) {
      const id = String(a.listing_id)
      answered[id] = (answered[id] || 0) + 1
      if (BUYS.includes(str(a.answer))) toOrder[id] = (toOrder[id] || 0) + 1
    }
  } catch { setupRequired = true }
  try {
    const { data } = await db.from('ffe_unit_status').select('listing_id,completed_at').in('listing_id', ids).limit(3000)
    for (const s of ((data || []) as any[])) done[String(s.listing_id)] = s.completed_at || null
  } catch { /* optional */ }
  // Absent before migration 040 — every unit then reads zero rooms checked, which is true.
  try {
    const { data } = await db.from('ffe_room_status')
      .select('listing_id,checked_at').in('listing_id', ids).not('checked_at', 'is', null).limit(20000)
    for (const s of ((data || []) as any[])) {
      const id = String(s.listing_id)
      roomsChecked[id] = (roomsChecked[id] || 0) + 1
    }
  } catch { /* not migrated yet */ }
  return { answered, toOrder, done, roomsChecked, setupRequired }
}

const unitCard = (l: Lst, p: any, st: Record<string, string>, ov: FfeOverride[] = []) => ({
  id: l.id, name: l.name, bedrooms: l.bedrooms, building: l.building,
  ownerId: l.ownerId, ownerName: l.ownerName,
  code: unitCode(l.id),
  total: totalItems(l.bedrooms, ov),
  answered: p.answered[l.id] || 0,
  toOrder: p.toOrder[l.id] || 0,
  // What the progress bar reads from now.
  roomsTotal: mergeChecklist(l.bedrooms, ov).length,
  roomsChecked: p.roomsChecked[l.id] || 0,
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
    // ITEMS ADDED ON THIS UNIT'S WALK, which exist on no checklist anywhere (Jon, 2026-08-12:
    // "have a add button"). They are stored as ordinary answers carrying a title, so they order,
    // export and total exactly like a built-in — and they belong to THIS unit, not to all 230.
    const custom: Record<string, { key: string; en: string; es: string }[]> = {}
    try {
      const { data } = await db.from('ffe_answers')
        .select('room,item_key,title,answer,qty,note,spec,photo_url,replacement_url,replacement_photo,est_cost').eq('listing_id', l.id).limit(1000)
      const known = new Set<string>()
      for (const r of merged) for (const i of r.items) known.add(r.key + '::' + i.key)
      for (const a of ((data || []) as any[])) {
        const room = str(a.room), key = str(a.item_key), k = room + '::' + key
        answers[k] = {
          answer: str(a.answer), qty: a.qty ?? null, note: a.note ?? null, spec: a.spec ?? null,
          photoUrl: a.photo_url ?? null,
          replacementUrl: a.replacement_url ?? null,
          replacementPhoto: a.replacement_photo ?? null,
          estCost: a.est_cost ?? null,
        }
        if (!known.has(k) && str(a.title)) {
          (custom[room] = custom[room] || []).push({ key, en: str(a.title), es: str(a.title) })
        }
      }
    } catch { /* not migrated yet — form renders, saving will report the error */ }

    const withCustom = merged.map(r => custom[r.key]?.length
      ? { ...r, items: r.items.concat(custom[r.key].map(c => ({ ...c, extra: true }))) }
      : r)

    let unitNotes: string | null = null
    try {
      const { data } = await db.from('ffe_unit_status').select('notes').eq('listing_id', l.id).limit(1)
      unitNotes = (data || [])[0]?.notes ?? null
    } catch { /* the notes column arrives with migration 036 */ }

    // Which rooms somebody has already stood in. Empty before migration 040, which reads correctly
    // as "none checked yet" rather than breaking the form.
    let roomsChecked: string[] = []
    try {
      const { data } = await db.from('ffe_room_status')
        .select('room,checked_at').eq('listing_id', l.id).not('checked_at', 'is', null).limit(50)
      roomsChecked = ((data || []) as any[]).map(r => str(r.room))
    } catch { /* not migrated yet */ }

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
      checklist: withCustom,
      total: withCustom.reduce((a, r) => a + r.items.length, 0),
      answers,
      roomsChecked,
      unitNotes,
      // The sheet's own standing instructions, so the two that happen inside the unit are on the
      // screen where they happen rather than in a PDF nobody opens on a phone.
      actions: FFE_ACTIONS.filter(a => a.inUnit),
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

    // NOTES & MEASUREMENTS — the sheet's last section, and the only place the living-room
    // dimensions the rug order depends on can actually be written down.
    if (String(body.action || '') === 'notes') {
      const row = {
        listing_id: listingId,
        notes: str(body.notes).slice(0, 4000) || null,
        updated_at: new Date().toISOString(),
      }
      const { data: ex } = await db.from('ffe_unit_status').select('listing_id').eq('listing_id', listingId).limit(1)
      const r = ex && ex[0]
        ? await db.from('ffe_unit_status').update(row).eq('listing_id', listingId)
        : await db.from('ffe_unit_status').insert(row)
      if (r.error) return dbFail(r.error.message)
      return NextResponse.json({ ok: true })
    }

    // ADD AN ITEM THAT IS ON NO LIST (Jon, 2026-08-12: "have a add button"). It becomes an ordinary
    // answer on THIS unit, carrying its own title — so it prices, orders and exports like any other
    // line without changing what the other 229 units get asked.
    if (String(body.action || '') === 'addItem') {
      const room2 = str(body.room).slice(0, 40)
      const title = str(body.title).trim().slice(0, 120)
      if (!room2 || !title) return NextResponse.json({ error: 'room and a name are required' }, { status: 400 })
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28)
      if (!slug) return NextResponse.json({ error: 'could not make a key from that name' }, { status: 400 })
      // Namespaced so an added item can never collide with a built-in key in the same room.
      const key = 'x_' + slug
      const qty0 = Number(body.qty)
      const row = {
        listing_id: listingId, room: room2, item_key: key, title,
        answer: 'replace',
        qty: Number.isFinite(qty0) && qty0 > 0 ? Math.min(Math.round(qty0), 99) : 1,
        note: str(body.note).slice(0, 500) || null,
        updated_at: new Date().toISOString(),
      }
      const { data: ex } = await db.from('ffe_answers')
        .select('id').eq('listing_id', listingId).eq('room', room2).eq('item_key', key).limit(1)
      const r = ex && ex[0]
        ? await db.from('ffe_answers').update(row).eq('id', ex[0].id)
        : await db.from('ffe_answers').insert(row)
      if (r.error) return dbFail(r.error.message)
      return NextResponse.json({ ok: true, itemKey: key, title })
    }

    // ---- "I'VE CHECKED THIS ROOM" (Jon, 2026-08-14) ----
    //
    // The one tap that makes an exception log trustworthy. Without it an empty room means either
    // "I looked and it is fine" or "I never went in", and those are not the same answer to give an
    // owner. Toggleable, because a walker who taps it and then spots the cracked mirror needs to be
    // able to take it back, add the finding and check it again.
    if (String(body.action || '') === 'roomChecked') {
      const room1 = str(body.room).slice(0, 40)
      if (!room1) return NextResponse.json({ error: 'room required' }, { status: 400 })
      const on = body.done !== false
      const row = {
        listing_id: listingId, room: room1,
        checked_at: on ? new Date().toISOString() : null,
        checked_by: str(body.by).slice(0, 80) || null,
        updated_at: new Date().toISOString(),
      }
      const { data: ex } = await db.from('ffe_room_status')
        .select('listing_id').eq('listing_id', listingId).eq('room', room1).limit(1)
      const r = ex && ex[0]
        ? await db.from('ffe_room_status').update(row).eq('listing_id', listingId).eq('room', room1)
        : await db.from('ffe_room_status').insert(row)
      if (r.error) return dbFail(r.error.message)
      return NextResponse.json({ ok: true, room: room1, checkedAt: row.checked_at })
    }

    // ---- TAKE IT BACK (Jon, 2026-08-14: "can you create a delete option") ----
    //
    // Until now every tap on this form was permanent in one direction: you could change Replace to
    // Keep, but you could not say "I never meant to answer this at all". Those are different facts.
    // A unit with 43 of 44 items answered and one left blank is a walk in progress; the same unit
    // with that item marked Keep is a walk that made a claim about it. The counts, the owner's
    // list and the order all read the first one correctly and the second one wrongly.
    //
    // WHAT IT WILL NOT DO: clear an item that is already on an order. Once a line exists, somebody
    // has priced it and possibly sent it to an owner — deleting the answer underneath that would
    // leave a line nobody can trace back. Change the line on the order instead.
    if (String(body.action || '') === 'clearAnswer') {
      const room0 = str(body.room).slice(0, 40)
      const key0 = str(body.itemKey).slice(0, 40)
      if (!room0 || !key0) return NextResponse.json({ error: 'room and itemKey required' }, { status: 400 })

      try {
        const { data: onOrder } = await db.from('ffe_order_lines')
          .select('id,order_id').eq('listing_id', listingId).eq('room', room0).eq('item_key', key0).limit(1)
        if (onOrder && onOrder[0]) {
          return NextResponse.json({
            error: 'This one is already on an order — remove it from the order first, then it can be cleared here.',
          }, { status: 409 })
        }
      } catch { /* orders may not be migrated yet; nothing to protect */ }

      // Withdraw a fix this walk opened, on exactly the terms the answer-change path already uses:
      // only while it is still untouched by the office.
      try {
        const { data: fx } = await db.from('ffe_fixes')
          .select('id,status,est_cost,assigned_to,order_id,created_by')
          .eq('listing_id', listingId).eq('room', room0).eq('item_key', key0).limit(1)
        const f = (fx || [])[0]
        if (f && str(f.created_by) === 'walk' && str(f.status) === 'open'
          && f.est_cost == null && !f.assigned_to && !f.order_id) {
          await db.from('ffe_fixes').delete().eq('id', f.id)
        }
      } catch { /* fixes table may not exist yet */ }

      const del = await db.from('ffe_answers').delete()
        .eq('listing_id', listingId).eq('room', room0).eq('item_key', key0)
      if (del.error) return dbFail(del.error.message)
      return NextResponse.json({ ok: true, cleared: true })
    }

    const room = str(body.room).slice(0, 40)
    // ---- A TYPED FINDING NEEDS NO KEY (Jon, 2026-08-14: "you can say Replace TV or Fix Baseboards") ----
    //
    // Picking a suggestion chip sends the checklist's own key, so "nightstands" is the same thing in
    // every unit and groups on the order. Typing something the list never heard of sends only the
    // words, and the key is derived here. The x_ prefix keeps a typed item from ever colliding with
    // a built-in, and the numeric suffix lets one room hold two different findings that happen to
    // slug the same.
    let itemKey = str(body.itemKey).slice(0, 40)
    if (!itemKey && str(body.title).trim() && room) {
      const slug = str(body.title).trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'item'
      const base = 'x_' + slug
      const { data: taken } = await db.from('ffe_answers')
        .select('item_key').eq('listing_id', listingId).eq('room', room).like('item_key', base + '%').limit(50)
      const used = new Set(((taken || []) as any[]).map(r => str(r.item_key)))
      itemKey = base
      for (let n = 2; used.has(itemKey) && n < 50; n++) itemKey = base + '_' + n
    }
    if (!room || !itemKey) return NextResponse.json({ error: 'room and itemKey required' }, { status: 400 })
    const answer = str(body.answer)
    // FIX joined the list on 2026-08-12. It saves like any other answer and then routes itself to
    // the Fixes board below, because a repair is not a purchase and must never reach a quote.
    if (!['replace', 'add', 'fix', 'keep', 'na'].includes(answer)) return NextResponse.json({ error: 'bad answer' }, { status: 400 })
    const qtyN = Number(body.qty)
    const row = {
      listing_id: listingId, room, item_key: itemKey,
      title: str(body.title).slice(0, 120) || itemKey,
      answer,
      qty: Number.isFinite(qtyN) && qtyN > 0 ? Math.min(Math.round(qtyN), 99) : 1,
      note: str(body.note).slice(0, 500) || null,
      // The size / which-one answer, so "9x12" reaches the vendor instead of "area rug x1".
      ...('spec' in body ? { spec: str(body.spec).slice(0, 120) || null } : {}),
      // WHAT WE ARE ACTUALLY BUYING — the link and the rough price, captured in the unit where
      // somebody is standing in front of the thing rather than reconstructed at a desk later.
      ...('replacementUrl' in body
        ? { replacement_url: /^https?:\/\//i.test(str(body.replacementUrl).trim()) ? str(body.replacementUrl).trim().slice(0, 500) : null }
        : {}),
      ...('estCost' in body ? { est_cost: estOf(body.estCost) } : {}),
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

    // ---- FIX ROUTES ITSELF (Jon, 2026-08-12: "add, replace, or fix... the goal is to confirm what
    // needs to be fixed, replaced, or added") ----
    // Marking an item FIX opens a fix on the team board straight from the walk. Changing the answer
    // away from FIX withdraws it again — but ONLY if the office has not touched it yet: once a fix
    // has been costed, assigned or started, it is the team's, not the walk form's, to close.
    try {
      const l2 = all.find(x => x.id === listingId)
      const { data: fx } = await db.from('ffe_fixes')
        .select('id,status,est_cost,assigned_to,order_id,created_by')
        .eq('listing_id', listingId).eq('room', room).eq('item_key', itemKey).limit(1)
      const existing = (fx || [])[0]
      if (answer === 'fix') {
        const frow = {
          listing_id: listingId, unit_name: l2?.name || null, building: l2?.building || null,
          room, item_key: itemKey,
          title: row.title,
          note: row.note,
          status: 'open', created_by: 'walk', updated_at: row.updated_at,
        }
        if (existing) await db.from('ffe_fixes').update({ title: frow.title, note: frow.note, updated_at: frow.updated_at }).eq('id', existing.id)
        else await db.from('ffe_fixes').insert(frow)
      } else if (existing && str(existing.created_by) === 'walk' && str(existing.status) === 'open'
        && existing.est_cost == null && !existing.assigned_to && !existing.order_id) {
        await db.from('ffe_fixes').delete().eq('id', existing.id)
      }
    } catch { /* the fixes table may not exist yet — the answer itself is already saved */ }

    // The key matters to the caller now: a typed finding was given one here, and the form needs it
    // to address the row it just created for edits, photos and undo.
    return NextResponse.json({ ok: true, itemKey, title: row.title })
  } catch (e: any) {
    return dbFail(e?.message || e)
  }
}
