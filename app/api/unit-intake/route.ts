// NEW UNIT INTAKE API (Jon, 2026-10-13: "create a place in properties to add new unit").
//
// GET                              → every intake, newest first, each with its gate and progress
// POST { action:'create', nickname, building }
// POST { action:'save',   id, data }            → merge answers (partial saves are normal)
// POST { action:'push',   id }                  → create in Guesty, then fill it in
// POST { action:'channel', id, channel, done }  → record the manual publish step
// POST { action:'golive', id }                  → isListed true on the channels it is connected to
// POST { action:'write',  id }                  → PROPOSE listing copy from the answered facts
// POST { action:'photos', id }                  → send the uploaded photos to the Guesty listing
// POST { action:'photoEdit', id, index, caption?, move?, remove? }
// POST { action:'delete', id }
//
// THE PUSH IS TWO CALLS, NOT ONE. POST /listings takes only nickname, address.full and the base
// price; everything else is rejected there and accepted on the PUT that follows. If the PUT fails
// the listing still exists — so the id is written to our row before the PUT runs, and a failed
// fill-in leaves a resumable row rather than an orphan in Guesty nobody knows about.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { getToken } from '@/lib/guesty'
import { gate, progress, createPayload, updatePayload, photosPayload, facts, COPY_KEYS, PUBLISH_CHANNELS, type Intake } from '@/lib/unit-intake'
import { anthropicMessages } from '@/lib/anthropic-call'
import { modelFor } from '@/lib/ai-models'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()

async function guesty(path: string, method: 'POST' | 'PUT', body: any) {
  const token = await getToken()
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const text = await r.text().catch(() => '')
  if (!r.ok) throw new Error(`Guesty ${method} ${path} ${r.status}: ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { return {} }
}

/** Photos go up in one call; Guesty fetches each URL itself. */
async function pushPhotos(data: Record<string, any>, listingId: string): Promise<number> {
  const pics = photosPayload(data)
  if (!pics.length) return 0
  await guesty(`/properties-api/property-photos/property-photos/${encodeURIComponent(listingId)}`, 'POST', pics)
  return pics.length
}

const view = (row: any) => {
  const data = (row.data && typeof row.data === 'object') ? row.data : {}
  return { ...row, data, channels: (row.channels && typeof row.channels === 'object') ? row.channels : {}, gate: gate(data), progress: progress(data) }
}

export async function GET() {
  const g = await requireLevel('buildings', 'view')
  if (!g.ok) return g.res
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('unit_intake').select('*').order('updated_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rows: (data || []).map(view), channels: PUBLISH_CHANNELS })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('buildings', 'edit')
  if (!g.ok) return g.res
  const me = g.access.email || ''
  const body = await req.json().catch(() => ({}))
  const action = str(body.action)
  const id = str(body.id)
  const sb = supabaseAdmin()

  if (action === 'create') {
    const nickname = str(body.nickname)
    if (!nickname) return NextResponse.json({ error: 'A nickname is required — it is the name on every board.' }, { status: 400 })
    const building = str(body.building) || null
    const { data, error } = await sb.from('unit_intake')
      .insert({ nickname, building, created_by: me, data: { nickname, building: building || '', currency: 'USD', country: 'United States' } })
      .select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, row: view(data) })
  }

  if (!id) return NextResponse.json({ error: 'No unit given.' }, { status: 400 })
  const { data: row, error: readErr } = await sb.from('unit_intake').select('*').eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'No such unit.' }, { status: 404 })
  const cur: Intake = view(row)

  if (action === 'save') {
    const patch = (body.data && typeof body.data === 'object') ? body.data : {}
    const data = { ...cur.data, ...patch }
    // The nickname and building live in their own columns too, because every list and every
    // search reads them and digging into jsonb for a name nobody can sort by is a false economy.
    const upd: any = { data, updated_at: new Date().toISOString() }
    if (str(data.nickname)) upd.nickname = str(data.nickname)
    if ('building' in data) upd.building = str(data.building) || null
    // A row that already passes the gate says so, so the list can show what is waiting on a push
    // rather than what is waiting on an answer. Pushed and live are not walked back by an edit.
    if (cur.status === 'draft' || cur.status === 'ready') upd.status = gate(data).blockers.length ? 'draft' : 'ready'
    const { data: out, error } = await sb.from('unit_intake').update(upd).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, row: view(out) })
  }

  if (action === 'delete') {
    if (cur.listing_id) return NextResponse.json({ error: 'This one already exists in Guesty — deleting the intake here would not remove it there. Unlist it in Guesty instead.' }, { status: 400 })
    const { error } = await sb.from('unit_intake').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: id })
  }

  if (action === 'channel') {
    const channel = str(body.channel)
    if (!PUBLISH_CHANNELS.some(c => c.key === channel)) return NextResponse.json({ error: 'Unknown channel.' }, { status: 400 })
    const channels = { ...cur.channels, [channel]: body.done ? { done: true, by: me, at: new Date().toISOString() } : { done: false } }
    const { data: out, error } = await sb.from('unit_intake').update({ channels, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, row: view(out) })
  }

  if (action === 'photoEdit') {
    const photos: any[] = Array.isArray(cur.data.photos) ? [...cur.data.photos] : []
    const i = Number(body.index)
    if (!Number.isInteger(i) || i < 0 || i >= photos.length) return NextResponse.json({ error: 'No such photo.' }, { status: 400 })
    if (body.remove) photos.splice(i, 1)
    else if (body.move === 'up' || body.move === 'down') {
      const j = body.move === 'up' ? i - 1 : i + 1
      if (j >= 0 && j < photos.length) { const t = photos[i]; photos[i] = photos[j]; photos[j] = t }
    } else if (typeof body.caption === 'string') {
      photos[i] = { ...photos[i], caption: body.caption.slice(0, 200) }
    }
    const data = { ...cur.data, photos }
    const { data: out, error } = await sb.from('unit_intake').update({ data, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, row: view(out) })
  }

  if (action === 'photos') {
    if (!cur.listing_id) return NextResponse.json({ error: 'Not in Guesty yet.' }, { status: 400 })
    try {
      const n = await pushPhotos(cur.data, cur.listing_id)
      if (!n) return NextResponse.json({ error: 'No photos to send.' }, { status: 400 })
      return NextResponse.json({ ok: true, sent: n })
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message || e) }, { status: 502 })
    }
  }

  // WRITE THE COPY. Proposes only — nothing is saved until somebody accepts it, because a model
  // that writes straight into a live listing is a model nobody checks. The facts come from the
  // intake and ONLY from the intake: the prompt forbids adding anything that is not in them, which
  // is what stops a studio in Brickell acquiring a rooftop pool it does not have.
  if (action === 'write') {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return NextResponse.json({ error: 'No Anthropic key configured.' }, { status: 503 })
    const known = facts(cur.data)
    if (known.split('\n').filter(Boolean).length < 5) {
      return NextResponse.json({ error: 'Answer more of the unit, rates and access questions first — there is not enough here to write from.' }, { status: 400 })
    }
    const prompt = `You are writing the listing copy for a short-term rental managed by Stay Hospitality in South Florida.

RULES THAT NEVER BEND:
- Use ONLY the facts below. Never add an amenity, a view, a walking distance, a landmark or a number that is not stated. If you do not know it, do not say it.
- No superlatives you cannot support, no "stunning", no "nestled", no exclamation marks, no emoji, no em dashes.
- Plain, concrete, specific. A guest is deciding between this and four others.
- The title is a HARD maximum of 50 characters.
- House rules: state the real ones implied by the facts (check-in and check-out times, occupancy, pets if a pet fee exists, minimum stay). Do not invent policies.

FACTS:
${known}

Reply with strict minified JSON only, no prose:
{"title":"","summary":"","space":"","access":"","neighborhood":"","rules":""}
summary: 2-3 sentences, what it is and who it suits.
space: the layout and what is in it.
access: what the guest can use, in the unit and in the building.
neighborhood: only what the city and address support. If you know nothing specific, keep it to one honest line.
rules: short lines, one per rule.`
    try {
      const r = await anthropicMessages(key, {
        model: await modelFor('listing-copy'),
        max_tokens: 2000,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }, undefined, 'unit-intake-copy')
      if (!r.ok) return NextResponse.json({ error: `Model said ${r.status}.` }, { status: 502 })
      const text = (r.data?.content || []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text || '')).join('').trim()
      const m = text.match(/\{[\s\S]*\}/)
      if (!m) return NextResponse.json({ error: 'The model did not return usable copy.' }, { status: 502 })
      const parsed = JSON.parse(m[0])
      const draft: Record<string, string> = {}
      for (const k of COPY_KEYS) if (typeof parsed[k] === 'string' && parsed[k].trim()) draft[k] = parsed[k].trim()
      if (draft.title && draft.title.length > 50) draft.title = draft.title.slice(0, 50).trim()
      if (!Object.keys(draft).length) return NextResponse.json({ error: 'The model returned nothing usable.' }, { status: 502 })
      return NextResponse.json({ ok: true, draft })
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message || e) }, { status: 502 })
    }
  }

  if (action === 'push') {
    if (cur.listing_id) return NextResponse.json({ error: 'Already in Guesty.' }, { status: 400 })
    const { blockers } = gate(cur.data)
    if (blockers.length) return NextResponse.json({ error: `Not ready: ${blockers.join(', ')}.` }, { status: 400 })
    let listingId = ''
    try {
      const created: any = await guesty('/listings', 'POST', createPayload(cur.data))
      listingId = str(created?._id || created?.id)
      if (!listingId) throw new Error('Guesty created the listing but returned no id.')
    } catch (e: any) {
      await sb.from('unit_intake').update({ push_error: String(e?.message || e), updated_at: new Date().toISOString() }).eq('id', id)
      return NextResponse.json({ error: String(e?.message || e) }, { status: 502 })
    }
    // Written BEFORE the fill-in, so a PUT that fails leaves a row we can resume instead of a
    // listing in Guesty that nothing here knows about.
    await sb.from('unit_intake').update({ listing_id: listingId, status: 'pushed', pushed_at: new Date().toISOString(), push_error: null, updated_at: new Date().toISOString() }).eq('id', id)
    let fillError: string | null = null
    let photosSent = 0
    try {
      await guesty(`/listings/${encodeURIComponent(listingId)}`, 'PUT', updatePayload(cur.data))
    } catch (e: any) {
      fillError = String(e?.message || e)
    }
    // Photos are their own call and their own failure: a listing with text and no photos is worth
    // more than no listing at all, so one failing does not roll back the other.
    try {
      photosSent = await pushPhotos(cur.data, listingId)
    } catch (e: any) {
      fillError = [fillError, `photos: ${String(e?.message || e)}`].filter(Boolean).join(' · ')
    }
    if (fillError) await sb.from('unit_intake').update({ push_error: fillError, updated_at: new Date().toISOString() }).eq('id', id)
    const { data: out } = await sb.from('unit_intake').select('*').eq('id', id).maybeSingle()
    return NextResponse.json({ ok: true, listingId, fillError, photosSent, row: out ? view(out) : null })
  }

  if (action === 'fill') {
    if (!cur.listing_id) return NextResponse.json({ error: 'Not in Guesty yet.' }, { status: 400 })
    try {
      await guesty(`/listings/${encodeURIComponent(cur.listing_id)}`, 'PUT', updatePayload(cur.data))
    } catch (e: any) {
      await sb.from('unit_intake').update({ push_error: String(e?.message || e), updated_at: new Date().toISOString() }).eq('id', id)
      return NextResponse.json({ error: String(e?.message || e) }, { status: 502 })
    }
    const { data: out } = await sb.from('unit_intake').update({ push_error: null, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
    return NextResponse.json({ ok: true, row: view(out) })
  }

  if (action === 'golive') {
    if (!cur.listing_id) return NextResponse.json({ error: 'Not in Guesty yet.' }, { status: 400 })
    try {
      await guesty(`/listings/${encodeURIComponent(cur.listing_id)}`, 'PUT', { isListed: true })
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message || e) }, { status: 502 })
    }
    const { data: out, error } = await sb.from('unit_intake')
      .update({ status: 'live', live_at: new Date().toISOString(), push_error: null, updated_at: new Date().toISOString() })
      .eq('id', id).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, row: view(out) })
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 })
}
