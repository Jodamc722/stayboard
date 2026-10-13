// NEW UNIT INTAKE API (Jon, 2026-10-13: "create a place in properties to add new unit").
//
// GET                              → every intake, newest first, each with its gate and progress
// POST { action:'create', nickname, building }
// POST { action:'save',   id, data }            → merge answers (partial saves are normal)
// POST { action:'push',   id }                  → create in Guesty, then fill it in
// POST { action:'channel', id, channel, done }  → record the manual publish step
// POST { action:'golive', id }                  → isListed true on the channels it is connected to
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
import { gate, progress, createPayload, updatePayload, PUBLISH_CHANNELS, type Intake } from '@/lib/unit-intake'

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
    try {
      await guesty(`/listings/${encodeURIComponent(listingId)}`, 'PUT', updatePayload(cur.data))
    } catch (e: any) {
      fillError = String(e?.message || e)
      await sb.from('unit_intake').update({ push_error: fillError, updated_at: new Date().toISOString() }).eq('id', id)
    }
    const { data: out } = await sb.from('unit_intake').select('*').eq('id', id).maybeSingle()
    return NextResponse.json({ ok: true, listingId, fillError, row: out ? view(out) : null })
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
