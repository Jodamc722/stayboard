import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel, requireAnyLevel, doorCodePolicy } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { otaLinksFrom } from '@/lib/ota-links'
import { pageRows } from '@/lib/db-page'
import { DOOR_CODE_FIELD_ID, RES_CODE_FIELD, isCodeFact, scrubStoredText } from '@/lib/eve/redact'
import { DOOR_CODE_ROOM_NAMES } from '@/lib/eve/door-code-rooms'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function getUser() {
  try { const supabase = createClient(); const { data } = await supabase.auth.getUser(); return data.user || null } catch { return null }
}

// DOOR CODES ARE NOT READ OFF THE FAQ DESK (Jon, 2026-09-29: codes are requested by Customer Service in
// #ccs-and-jon or #vr-customercareteam, "never in team channels with field team"; and every release is
// approved, except his own). Everyone who can open this desk — field team included — would see a unit's
// code fields ("Door code", "Building code", "Old code", "Program code", "17W Back Up code") and any code
// written into its other fields, notes, entries or how-tos. Now only someone set to Direct (Jon, and
// whoever he sets) sees them; everyone else sees where a code comes from.
//   - Facts are read-only (they come from Guesty; nothing here saves them back): hidden outright.
//   - Entries, drafts and how-tos are edited and saved from this desk, so they are masked on the way
//     out, and a save that still carries a mask is refused (POST) — a masked answer saved back would
//     erase the real one.
const CODE_HIDDEN = `Hidden — Customer Service requests door codes in ${DOOR_CODE_ROOM_NAMES}`
const MASKED = /\[redacted/i

type CfDef = { label: string; slug: string }

/** The unmasked how-to behind one the desk showed masked: same unit, same title, masks to what was sent. */
async function rawHowto(db: ReturnType<typeof supabaseAdmin>, listingId: string, title: string, masked: string): Promise<string | null> {
  if (!listingId || !title) return null
  // By title (or the item type a title-less item is shown under), newest first — not the oldest few
  // hundred items on a unit that has been walked many times.
  const cols = 'title,item_type,details,kind,note,created_at'
  const [byTitle, byType] = await Promise.all([
    db.from('audit_items').select(cols).eq('listing_id', listingId).eq('title', title).order('created_at', { ascending: false }).limit(50),
    db.from('audit_items').select(cols).eq('listing_id', listingId).eq('item_type', title).order('created_at', { ascending: false }).limit(50),
  ])
  for (const it of [...(((byTitle.data as any[]) || [])), ...(((byType.data as any[]) || []))]) {
    if (String(it.title || it.item_type || 'How-to') !== title) continue
    for (const cand of [it?.details?.howTo, it?.note]) {
      if (typeof cand === 'string' && cand && scrubStoredText(cand) === masked) return cand
    }
  }
  return null
}

function facts(raw: any, cfMap?: Record<string, CfDef>, codes: 'direct' | 'ask' | 'off' = 'off') {
  const hide = codes !== 'direct'
  const text = (v: any) => (hide ? scrubStoredText(v) : String(v))
  const out: { label: string; value: string }[] = []
  if (!raw || typeof raw !== 'object') return out
  const addr = raw.address
  const addrStr = addr ? (typeof addr === 'string' ? addr : (addr.full || [addr.street, addr.city, addr.state].filter(Boolean).join(', '))) : ''
  if (addrStr) out.push({ label: 'Address', value: String(addrStr) })
  if (raw.defaultCheckInTime) out.push({ label: 'Check-in', value: String(raw.defaultCheckInTime) })
  if (raw.defaultCheckOutTime) out.push({ label: 'Check-out', value: String(raw.defaultCheckOutTime) })
  if (raw.wifiName) out.push({ label: 'Wi-Fi network', value: String(raw.wifiName) })
  if (raw.wifiPassword) out.push({ label: 'Wi-Fi password', value: String(raw.wifiPassword) })
  const cfs = Array.isArray(raw.customFields) ? raw.customFields : []
  for (const it of cfs) {
    if (!it) continue
    const fid = String((it as any).fieldId || (it as any).field_id || ((it as any).field && ((it as any).field._id || (it as any).field.id)) || (it as any)._id || '')
    const def = cfMap && cfMap[fid]
    const label = def && def.label
    if (!label) continue
    let val: any = (it as any).value
    if (val == null || val === '') continue
    if (typeof val === 'object') { try { val = JSON.stringify(val) } catch { val = String(val) } }
    // The two code fields by id; any field whose name or slug says code; a lock, keypad or other way in
    // with a code-shaped value (lib/eve/redact.ts isCodeFact) — and a code written into any other text.
    if (hide && (fid === DOOR_CODE_FIELD_ID || fid === RES_CODE_FIELD || isCodeFact([label, def!.slug], val))) val = CODE_HIDDEN
    else val = text(val)
    out.push({ label: String(label).slice(0, 60), value: String(val).slice(0, 800) })
  }
  if (raw.propertyType) out.push({ label: 'Property type', value: String(raw.propertyType) })
  const bd = raw.bedrooms, ba = raw.bathrooms, acc = raw.accommodates
  const layout = [bd != null ? bd + ' BR' : '', ba != null ? ba + ' BA' : '', acc != null ? 'sleeps ' + acc : ''].filter(Boolean).join(' \u00b7 ')
  if (layout) out.push({ label: 'Layout', value: layout })
  const pd = raw.publicDescription
  if (pd && typeof pd === 'object') {
    if (pd.access) out.push({ label: 'Access', value: text(pd.access).slice(0, 800) })
    if (pd.transit) out.push({ label: 'Getting around', value: text(pd.transit).slice(0, 800) })
  }
  return out
}

export async function GET(req: NextRequest) {
  // NOT PUBLIC (2026-09-29). This answered with no check at all — the whole listing list, and per
  // listing the Wi-Fi password, the access notes and every Guesty custom field. Its only callers
  // are the FAQ desk on /faq and on the listing page, so it takes the same level those pages do:
  // view on the FAQ or on listings — and a vacation-rental login.
  const gate = await requireAnyLevel(['faq', 'listings'], 'view')
  if (!gate.ok) return gate.res
  if (!isVrLogin(gate.access)) return hotelOnlyRes()
  const db = supabaseAdmin()
  const listingId = req.nextUrl.searchParams.get('listingId') || ''
  if (!listingId) {
    const lr = await db.from('guesty_listings').select('id,nickname,title,building,status').limit(1000) // deliberate cap: one row per Guesty listing (~290, inactive included)
    const listings = (lr.data || []).filter((l: any) => !/inactive/i.test(String(l.status || ''))).map((l: any) => ({ id: String(l.id), name: l.nickname || l.title || 'Unit', building: l.building || '' }))
    listings.sort((a: any, b: any) => (a.building || '').localeCompare(b.building || '') || a.name.localeCompare(b.name))
    return NextResponse.json({ ok: true, listings })
  }
  const [lr, fr, ir, cfr] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,raw').eq('id', listingId).limit(1),
    db.from('listing_faq').select('*').eq('listing_id', listingId).order('created_at', { ascending: true }).limit(500),
    // Every audit item on the unit (re-walks add up), paged in capture order — not an unordered 1,000.
    pageRows((a, b) => db.from('audit_items').select('id,room,title,item_type,photo_url,details,kind,note').eq('listing_id', listingId).order('created_at').order('id').range(a, b)),
    // name + slug. It asked for a `display_name` column this table never got (migration 003 was never
    // applied), so the whole read failed and every Guesty custom field was silently missing from Facts.
    db.from('guesty_custom_fields').select('id,name,slug'),
  ])
  if (ir.truncated) console.error('[faq] audit items read incomplete for listing', listingId)
  if (cfr.error) console.error('[faq] custom field names unreadable', cfr.error.message)
  const lrow = lr.data && lr.data[0]
  const listing = lrow ? { id: String(lrow.id), name: lrow.nickname || lrow.title || 'Unit', building: lrow.building || '' } : { id: listingId, name: 'Unit', building: '' }
  const rawL: any = lrow ? lrow.raw : null
  // One implementation, shared with the listing page. The old version here built a Booking.com
  // URL from the channel id, which is never a valid Booking URL (theirs are slugs).
  const otaLinks = otaLinksFrom(rawL)
  const cfMap: Record<string, CfDef> = {}
  for (const f of (cfr.data || [])) cfMap[String((f as any).id)] = { label: String((f as any).name || ''), slug: String((f as any).slug || '') }
  const codes = doorCodePolicy(gate.access)
  const factList = lrow ? facts(lrow.raw, cfMap, codes) : []
  // Entries, drafts and how-tos: masked for anyone not set to Direct (and a masked save is refused, POST).
  const mask = (s: any) => (codes === 'direct' || s == null ? s : scrubStoredText(s))
  const rawFaq: any[] = fr.data || []
  const allFaq: any[] = rawFaq.map((e: any) => ({ ...e, question: mask(e.question), answer: mask(e.answer) }))
  const entries = allFaq.filter(e => e.status !== 'draft' && e.status !== 'dismissed')
  const drafts = allFaq.filter(e => e.status === 'draft')
  const promoted: Record<string, boolean> = {}
  for (const e of rawFaq) if (e.question) promoted[String(e.question).toLowerCase()] = true
  const howtos: any[] = []
  const highlights: any[] = []
  const keyDetails: any[] = []
  for (const it of ir.rows) {
    const d = (it as any).details || {}
    const q = it.title || it.item_type || 'How-to'
    if (d.howTo && !promoted[String(q).toLowerCase()]) howtos.push({ id: it.id, room: it.room, title: q, howTo: mask(d.howTo), photo_url: it.photo_url })
    if ((it as any).kind === 'faq' && !promoted[String(q).toLowerCase()]) howtos.push({ id: it.id, room: it.room, title: q, howTo: mask((it as any).note || d.howTo || ''), photo_url: it.photo_url })
    if (d.highlight) highlights.push({ id: it.id, room: it.room, title: it.title || it.item_type || 'Item', brand: d.brand || '', tier: d.tier || '', features: Array.isArray(d.features) ? d.features : [] })
    if (d.size) keyDetails.push({ item: it.title || it.item_type || 'Item', size: d.size, room: it.room })
  }
  return NextResponse.json({ ok: true, listing, facts: factList, entries, drafts, howtos, highlights, otaLinks, keyDetails })
}

export async function POST(req: NextRequest) {
  // Roles+levels write gate (2026-08-04): below-edit access on 'faq' is rejected here,
  // whatever the UI shows. requireLevel also covers the signed-out 401.
  const __gate = await requireLevel('faq', 'edit')
  if (!__gate.ok) return __gate.res
  const db = supabaseAdmin()
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const action = String(body.action || '')
  // Approving a how-to that was shown masked: the desk sends back what it was shown, so the real text
  // is taken from the audit item itself (the same unit, the same title, the text that masks to what was
  // sent) — approving never needs anyone to retype a code, and never saves the mask.
  if (action === 'approveHowto' && typeof body.answer === 'string' && MASKED.test(body.answer)) {
    const raw = await rawHowto(db, String(body.listingId || ''), String(body.question || ''), body.answer)
    if (raw) body.answer = raw
  }
  // A MASKED ANSWER IS NEVER SAVED BACK (2026-09-29). Anyone not set to Direct sees codes in entries,
  // drafts and how-tos as "[redacted]" (GET); saving that text would overwrite the real answer with the
  // mask. So it is refused, and the fix is the right one anyway: a door code does not belong in an FAQ.
  if (['question', 'answer'].some(k => typeof body[k] === 'string' && MASKED.test(body[k]))) {
    return NextResponse.json({ error: 'That text still has a hidden door code in it ([redacted]). Take the code out — door codes do not go in FAQ answers — and save again.' }, { status: 400 })
  }
  if (action === 'addEntry' || action === 'approveHowto') {
    const listingId = String(body.listingId || '')
    if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
    const row = {
      listing_id: listingId,
      category: String(body.category || '').slice(0, 80) || null,
      question: String(body.question || '').slice(0, 300) || null,
      answer: String(body.answer || '').slice(0, 4000) || null,
      photo_url: String(body.photoUrl || '').slice(0, 500) || null,
      source: action === 'approveHowto' ? 'audit' : 'manual',
      status: 'published',
      created_by: user.email || null,
    }
    const ins = await db.from('listing_faq').insert(row).select('*').limit(1)
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
    // What comes back is masked like the GET for anyone not set to Direct — an approved how-to is saved
    // with its real text (rawHowto), and the response must not be the way to read it.
    const saved: any = ins.data && ins.data[0]
    const direct = doorCodePolicy(__gate.access) === 'direct'
    return NextResponse.json({ ok: true, entry: saved && !direct ? { ...saved, question: saved.question == null ? saved.question : scrubStoredText(saved.question), answer: saved.answer == null ? saved.answer : scrubStoredText(saved.answer) } : saved })
  }
  if (action === 'approveDraft' || action === 'dismissDraft') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const patch: any = { status: action === 'approveDraft' ? 'published' : 'dismissed', updated_at: new Date().toISOString() }
    if (action === 'approveDraft') {
      if (body.question != null) patch.question = String(body.question).slice(0, 300)
      if (body.answer != null) patch.answer = String(body.answer).slice(0, 4000)
    }
    const up = await db.from('listing_faq').update(patch).eq('id', id)
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (action === 'updateEntry') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const patch: any = { updated_at: new Date().toISOString() }
    if (body.question != null) patch.question = String(body.question).slice(0, 300)
    if (body.answer != null) patch.answer = String(body.answer).slice(0, 4000)
    if (body.category != null) patch.category = String(body.category).slice(0, 80)
    const up = await db.from('listing_faq').update(patch).eq('id', id)
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  if (action === 'deleteEntry') {
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const del = await db.from('listing_faq').delete().eq('id', id)
    if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
