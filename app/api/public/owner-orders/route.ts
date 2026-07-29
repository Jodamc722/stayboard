// OWNER REVIEW SHEET - public API behind a signed link (the link IS the key, like audit links).
//
// This is deliberately richer than a price list. Owners say no to line items because nobody ever
// told them WHY, what the alternatives cost, or what happens if they do nothing - so every line
// carries: the walker's tag, the photos, the reason, the guest review behind it, how long the item
// has been flagged and how many times we have already repaired it, PRICE OPTIONS (like-for-like /
// upgrade / repair-only) instead of one take-it-or-leave-it number, and the cost of doing nothing.
//
// The decision is four-way, not two: Approve / I will supply / Not now / No. "I will supply" used to
// have nowhere to live and became a dropped thread; it now has three real states (send me a link /
// buying it myself / already ordered) plus a link and a note, and it writes straight back to the
// order desk so nothing is re-keyed.
//
// Nothing but this scope's order lines is exposed.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ownerOrderSigValid } from '@/lib/ownerShare'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LIVE_STATUS = ['open', 'approved', 'ordered', 'arriving', 'task_created', 'done', 'dismissed']

/** Same normalisation the desk uses to roll identical needs together. */
function nrm(x: any): string { return String(x || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() }

const STOP = ['the', 'and', 'for', 'with', 'new', 'unit', 'room', 'from', 'that', 'this', 'need', 'needs', 'each', 'set', 'per', 'one', 'two', 'add', 'replace', 'small', 'large', 'white', 'black']
/** Words worth searching a guest review for - long enough to be a real noun, not a filler. */
function keywords(title: string): string[] {
  const out: string[] = []
  const parts = nrm(title).split(' ')
  for (const w of parts) { if (w.length >= 4 && STOP.indexOf(w) < 0 && out.indexOf(w) < 0) out.push(w) }
  return out.slice(0, 4)
}

function money(n: any): number | null {
  const v = Math.round(Number(n))
  return Number.isFinite(v) && v > 0 ? v : null
}

async function scopeListings(db: any, scope: string): Promise<{ ids: string[]; label: string } | null> {
  if (scope.startsWith('u:')) {
    const id = scope.slice(2)
    const { data } = await db.from('guesty_listings').select('id,nickname,title').eq('id', id).limit(1)
    const row = data && data[0]
    return { ids: [id], label: row ? (row.nickname || row.title || 'Unit') : 'Unit' }
  }
  if (scope.startsWith('b:')) {
    const b = scope.slice(2)
    const { data } = await db.from('guesty_listings').select('id').eq('building', b).limit(300)
    const ids = (data || []).map((x: any) => String(x.id))
    return ids.length ? { ids, label: b } : null
  }
  if (scope.startsWith('m:')) {
    // Multi-listing (owner-scoped) share: an explicit set of listing ids.
    const want = scope.slice(2).split(',').map((x: string) => x.trim()).filter(Boolean).slice(0, 300)
    if (!want.length) return null
    const { data } = await db.from('guesty_listings').select('id,building').in('id', want).limit(300)
    const ids = (data || []).map((x: any) => String(x.id))
    const seen: Record<string, boolean> = {}
    const bset: string[] = []
    for (const x of data || []) { const b = String(x.building || ''); if (b && !seen[b]) { seen[b] = true; bset.push(b) } }
    const label = bset.length === 1 ? bset[0] : (bset.length ? bset.slice(0, 2).join(' + ') + (bset.length > 2 ? ' +' : '') : ids.length + ' units')
    return ids.length ? { ids, label } : null
  }
  return null
}

/** Price choices for a line. Falls back to the single estimate as like-for-like so a line that has
 *  never been through the owner-brief pass still renders sensibly. */
function optionsOf(d: any, est: number | null): { key: string; label: string; price: number | null; link: string; note: string }[] {
  const raw = d && Array.isArray(d.options) ? d.options : []
  const out: { key: string; label: string; price: number | null; link: string; note: string }[] = []
  for (const o of raw.slice(0, 4)) {
    if (!o) continue
    const key = String(o.key || 'like')
    out.push({ key, label: String(o.label || key).slice(0, 80), price: money(o.price), link: String(o.link || '').slice(0, 500), note: String(o.note || '').slice(0, 400) })
  }
  if (!out.length && est) out.push({ key: 'like', label: 'Like-for-like replacement', price: est, link: String((d && d.link) || '').slice(0, 500), note: '' })
  return out
}

export async function GET(req: NextRequest) {
  const s = String(req.nextUrl.searchParams.get('s') || '')
  const k = String(req.nextUrl.searchParams.get('k') || '')
  if (!ownerOrderSigValid(s, k)) return NextResponse.json({ error: 'invalid link' }, { status: 401 })
  const db = supabaseAdmin()
  const scope = await scopeListings(db, s)
  if (!scope) return NextResponse.json({ error: 'scope not found' }, { status: 404 })

  const [oi, ol, hist, revs, lab] = await Promise.all([
    db.from('audit_items').select('id,listing_id,room,kind,title,qty,note,photo_url,severity,status,details,created_at').in('kind', ['replace', 'add']).in('status', LIVE_STATUS).in('listing_id', scope.ids).order('created_at', { ascending: false }).limit(1000),
    db.from('guesty_listings').select('id,nickname,title,building').in('id', scope.ids).limit(300),
    // Everything ever flagged for these units - this is what turns "buy a new one" into
    // "we have already repaired this three times".
    db.from('audit_items').select('listing_id,kind,title,status,created_at').in('listing_id', scope.ids).in('kind', ['replace', 'add', 'maintenance']).order('created_at', { ascending: true }).limit(4000),
    db.from('guesty_reviews').select('listing_id,rating,content,created_at').in('listing_id', scope.ids).lte('rating', 4).order('created_at', { ascending: false }).limit(400),
    // Fix and Clean sit ALONGSIDE orders, not underneath them - they cost labour, not money, so they
    // never reach the buying desk. The owner still deserves to see them, priceless and decision-free,
    // so the property total reads as work-in-hand rather than a bill.
    db.from('audit_items').select('listing_id,room,kind,title,severity,created_at').in('kind', ['maintenance', 'clean']).in('status', ['open', 'task_created']).in('listing_id', scope.ids).order('created_at', { ascending: false }).limit(600),
  ])

  const lm: Record<string, { name: string; building: string }> = {}
  for (const l of ol.data || []) lm[String(l.id)] = { name: l.nickname || l.title || 'Unit', building: l.building || '' }

  // history keyed by listing + normalised title
  const hmap: Record<string, { first: string; repairs: number }> = {}
  for (const h of hist.data || []) {
    const t = nrm(h.title)
    if (!t) continue
    const key = String(h.listing_id) + '|' + t
    if (!hmap[key]) hmap[key] = { first: String(h.created_at || ''), repairs: 0 }
    if (String(h.kind) === 'maintenance') hmap[key].repairs++
  }

  const reviewRows = (revs.data || []).filter((r: any) => String(r.content || '').length > 20)

  // A line the DESK dismissed is gone; a line the OWNER declined stays, so they can see what they
  // said no to. Both live in status 'dismissed', so the owner's own answer is what tells them apart.
  const orderRows = (oi.data || []).filter((x: any) => String(x.status) !== 'dismissed' || (x.details && x.details.owner))

  const items = orderRows.map((x: any) => {
    const d = (x.details && typeof x.details === 'object') ? x.details : {}
    const est = money(d.est)
    const qty = Math.max(1, Number(x.qty) || 1)
    const lid = String(x.listing_id || '')
    const meta = lm[lid] || { name: 'Unit', building: '' }
    const urgent = String(x.severity || '') === 'high'
    const restock = !!d.restock
    const isRec = x.kind === 'add' && !restock && !urgent
    const photos: string[] = []
    if (x.photo_url) photos.push(String(x.photo_url))
    for (const p of (Array.isArray(d.photos) ? d.photos : [])) { const v = String(p || ''); if (v && photos.indexOf(v) < 0) photos.push(v) }

    const h = hmap[lid + '|' + nrm(x.title)] || null
    let months = 0
    if (h && h.first) { const ms = Date.now() - new Date(h.first).getTime(); months = Math.max(0, Math.floor(ms / (30 * 86400000))) }

    // The guest review behind the line, if there is one. A quote from a real stay is the single
    // most persuasive thing on the sheet - and the only one we do not have to argue for.
    let review: any = null
    const kws = keywords(x.title || '')
    if (kws.length) {
      for (const r of reviewRows) {
        if (String(r.listing_id) !== lid) continue
        const c = String(r.content || '').toLowerCase()
        let hit = ''
        for (const w of kws) { if (c.indexOf(w) >= 0) { hit = w; break } }
        if (!hit) continue
        // Trim to the sentence around the hit so the owner reads one line, not a whole review.
        const at = c.indexOf(hit)
        const from = Math.max(0, c.lastIndexOf('.', at) + 1)
        const endRaw = c.indexOf('.', at)
        const to = endRaw < 0 ? Math.min(c.length, at + 160) : Math.min(c.length, endRaw + 1)
        const quote = String(r.content).slice(from, to).trim().slice(0, 300)
        review = { quote: quote || String(r.content).slice(0, 200), rating: Number(r.rating) || null, date: String(r.created_at || '').slice(0, 10) }
        break
      }
    }

    const dn = d.doNothing && typeof d.doNothing === 'object' ? d.doNothing : null
    const dec = d.owner && typeof d.owner === 'object' ? d.owner : null

    return {
      id: x.id,
      listingId: lid,
      unit: meta.name,
      building: meta.building,
      room: x.room || '',
      kind: x.kind,
      tag: x.kind === 'add' ? (restock ? 'Restock' : 'Add') : 'Replace',
      recommendation: isRec,
      restock,
      urgent,
      title: x.title || '',
      qty,
      note: x.note || '',
      why: String(d.why || '').slice(0, 800),
      photos: photos.slice(0, 8),
      link: d.link ? String(d.link) : null,
      est,
      lineTotal: est ? est * qty : null,
      status: x.status,
      options: optionsOf(d, est),
      doNothing: dn ? { text: String(dn.text || '').slice(0, 600), cost: money(dn.cost) } : null,
      history: { months, repairs: h ? h.repairs : 0, flaggedAt: h ? String(h.first).slice(0, 10) : String(x.created_at || '').slice(0, 10) },
      review,
      decision: dec ? { choice: String(dec.choice || ''), supply: dec.supply ? String(dec.supply) : null, link: String(dec.link || ''), note: String(dec.note || ''), option: String(dec.option || ''), at: String(dec.at || '') } : null,
      questions: (Array.isArray(d.questions) ? d.questions : []).slice(-6).map((q: any) => ({ q: String((q && q.q) || '').slice(0, 600), at: String((q && q.at) || '') })),
      answers: (Array.isArray(d.answers) ? d.answers : []).slice(-6).map((a: any) => ({ a: String((a && a.a) || '').slice(0, 600), at: String((a && a.at) || '') })),
    }
  })

  const labour = (lab.data || []).map((x: any) => ({
    unit: (lm[String(x.listing_id)] || { name: 'Unit' }).name,
    room: x.room || '',
    kind: String(x.kind) === 'clean' ? 'Clean' : 'Fix',
    title: x.title || '',
    urgent: String(x.severity || '') === 'high',
  }))

  return NextResponse.json({ ok: true, label: scope.label, unitCount: scope.ids.length, items, labour })
}

const CHOICES = ['approve', 'supply', 'later', 'no']
const SUPPLY = ['link', 'self', 'ordered']

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const s = String(body.s || '')
  const k = String(body.k || '')
  if (!ownerOrderSigValid(s, k)) return NextResponse.json({ error: 'invalid link' }, { status: 401 })
  const itemId = String(body.itemId || '')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })
  const db = supabaseAdmin()
  const scope = await scopeListings(db, s)
  if (!scope) return NextResponse.json({ error: 'scope not found' }, { status: 404 })
  const { data: rows } = await db.from('audit_items').select('id,listing_id,kind,status,details').eq('id', itemId).limit(1)
  const item = rows && rows[0]
  if (!item || scope.ids.indexOf(String(item.listing_id)) < 0) return NextResponse.json({ error: 'item not in this order' }, { status: 404 })
  if (['replace', 'add'].indexOf(String(item.kind)) < 0) return NextResponse.json({ error: 'not an order line' }, { status: 400 })
  const d: any = (item.details && typeof item.details === 'object') ? { ...item.details } : {}
  const now = new Date().toISOString()

  // A question can be asked at any point in the line's life - it is a conversation, not a gate.
  if (String(body.action || '') === 'ask') {
    const q = String(body.q || '').trim().slice(0, 600)
    if (!q) return NextResponse.json({ error: 'empty question' }, { status: 400 })
    const list = Array.isArray(d.questions) ? d.questions.slice(-20) : []
    list.push({ q, at: now })
    d.questions = list
    const r = await db.from('audit_items').update({ details: d, updated_at: now }).eq('id', itemId)
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
    return NextResponse.json({ ok: true, asked: true })
  }

  // Decisions only stand while the line has not been bought yet - once it is ordered, changing
  // the answer here would silently contradict money already spent.
  if (['ordered', 'arriving', 'task_created', 'done'].indexOf(String(item.status)) >= 0) {
    return NextResponse.json({ ok: true, status: item.status, unchanged: true })
  }

  const legacy = String(body.action || '')
  const choice = String(body.choice || (legacy === 'decline' ? 'no' : legacy === 'approve' ? 'approve' : ''))
  if (CHOICES.indexOf(choice) < 0) return NextResponse.json({ error: 'choice must be approve, supply, later or no' }, { status: 400 })
  const supply = SUPPLY.indexOf(String(body.supply || '')) >= 0 ? String(body.supply) : null
  if (choice === 'supply' && !supply) return NextResponse.json({ error: 'supply state required' }, { status: 400 })

  d.owner = {
    choice,
    supply,
    link: String(body.link || '').slice(0, 500),
    note: String(body.note || '').slice(0, 600),
    option: String(body.option || '').slice(0, 40),
    at: now,
  }
  // If the owner picked a price option, that option's price becomes the line estimate so the desk
  // buys what was actually approved rather than the default.
  const picked = String(body.option || '')
  if (picked && Array.isArray(d.options)) {
    for (const o of d.options) { if (o && String(o.key) === picked && money(o.price)) { d.est = money(o.price); if (o.link) d.link = String(o.link).slice(0, 500) } }
  }

  // The approval ladder, mirrored so the desk needs no second source of truth.
  let status = String(item.status)
  if (choice === 'approve') { d.approval = 'owner_approved'; d.approvedBy = 'owner'; status = 'approved' }
  else if (choice === 'supply') { d.approval = 'owner_supply'; d.approvedBy = 'owner'; status = 'open' }
  else if (choice === 'later') { d.approval = 'owner_later'; d.approvedBy = 'owner'; status = 'open' }
  else { d.approval = 'declined'; d.approvedBy = 'owner'; status = 'dismissed' }

  const r = await db.from('audit_items').update({ details: d, status, updated_at: now }).eq('id', itemId)
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  return NextResponse.json({ ok: true, status, choice })
}
