// Push approved listing content to Guesty. PUT /listings/{id} with { title, publicDescription }.
// Only the human-approved fields are sent (Guesty merges partial publicDescription).
// Logged-in users only - the human approves each push in the UI. Mirrors the change into
// guesty_listings locally so StayBoard reflects it immediately.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { lintCopy, blocks, warns } from '@/lib/channel-lint'

export const dynamic = 'force-dynamic'
const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const SECTION_KEYS = ['summary', 'space', 'access', 'neighborhood', 'transit', 'notes']

export async function POST(req: NextRequest) {
  // This route WRITES LIVE OTA LISTING TEXT to Guesty. Until 2026-08-10 any signed-in user could
  // call it; now it needs edit on the optimizer, whatever the UI shows.
  const gate = await requireLevel('optimize', 'edit')
  if (!gate.ok) return gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })

  // Build the payload from approved fields only.
  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : undefined
  const inSections = (body?.publicDescription && typeof body.publicDescription === 'object') ? body.publicDescription : {}
  const publicDescription: Record<string, string> = {}
  for (const k of SECTION_KEYS) {
    if (typeof inSections[k] === 'string' && inSections[k].trim()) publicDescription[k] = String(inSections[k]).trim()
  }
  if (!title && Object.keys(publicDescription).length === 0) {
    return NextResponse.json({ error: 'Nothing approved to push.' }, { status: 400 })
  }
  // THE CHANNEL LINT (2026-11-02): anything Guesty or a channel would refuse stops here, with the reason,
  // instead of a 200 from Guesty and a listing that quietly never updated on Airbnb.
  const lint = lintCopy({ ...(title ? { title } : {}), ...publicDescription } as any)
  const stops = blocks(lint)
  if (stops.length && body?.force !== true) {
    return NextResponse.json({ error: stops.map(h => h.message).join(' '), lint, blocked: true }, { status: 400 })
  }

  const payload: any = {}
  if (title) payload.title = title
  if (Object.keys(publicDescription).length) payload.publicDescription = publicDescription

  const sb = supabaseAdmin()
  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30_000)
  if (!valid) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry in a moment.' }, { status: 503 })

  const r = await fetch(`${BASE}/listings/${encodeURIComponent(listingId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tok!.access_token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const respText = await r.text().catch(() => '')
  if (!r.ok) return NextResponse.json({ error: `Guesty ${r.status}: ${respText.slice(0, 240)}` }, { status: 502 })

  // Mirror locally so StayBoard reflects the change immediately.
  try {
    const { data: row } = await sb.from('guesty_listings').select('raw').eq('id', listingId).maybeSingle()
    const raw: any = (row?.raw && typeof row.raw === 'object') ? row.raw : {}
    const pub: any = (raw.publicDescription && typeof raw.publicDescription === 'object') ? raw.publicDescription : {}
    const mergedPub = { ...pub, ...publicDescription }
    const isRecreate = (body as any)?.recreate === true
    const newRaw = { ...raw, publicDescription: mergedPub, _lastOptimized: new Date().toISOString(), ...(isRecreate ? { _lastRecreated: new Date().toISOString() } : {}), ...(title ? { title } : {}) }
    const update: any = { raw: newRaw, last_optimized: new Date().toISOString(), ...(isRecreate ? { last_recreated: new Date().toISOString() } : {}) }
    if (title) update.title = title
    await sb.from('guesty_listings').update(update).eq('id', listingId)
  } catch { /* mirror is best-effort */ }

  return NextResponse.json({ ok: true, pushed: { title: title || null, sections: Object.keys(publicDescription) }, warnings: warns(lint).map(h => h.message) })
}
