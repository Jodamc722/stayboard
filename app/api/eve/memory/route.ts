// Eve's memory, exposed so Jon can READ AND DELETE everything she believes.
//
// This route is not optional polish. An agent that learns silently is a liability: if she picks up
// something wrong on Tuesday you need to find it and kill it on Wednesday, not discover it three
// weeks later inside a message to an owner. Every row she stores is visible and removable here.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveMemory, normKind, normScope, normWeight, MEMORY_KINDS, personSource, STAFF_MAX_WEIGHT } from '@/lib/eve/memory'
import { isSuperadmin } from '@/lib/access'
import { eveGate } from '../../agent/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  const db = supabaseAdmin()
  let q = db.from('eve_memory').select('*').order('weight', { ascending: false }).order('updated_at', { ascending: false }).limit(400)
  if (sp.get('kind')) q = q.eq('kind', normKind(sp.get('kind')))
  if (sp.get('scope')) q = q.eq('scope', normScope(sp.get('scope')))
  if (sp.get('include_superseded') !== '1') q = q.is('superseded_by', null)
  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, needsMigration: true, error: 'eve_memory not found — run migration 045.', memories: [] })
  const rows = data || []
  const byKind: Record<string, number> = {}
  for (const r of rows) byKind[(r as any).kind] = (byKind[(r as any).kind] || 0) + 1
  return NextResponse.json({ ok: true, kinds: MEMORY_KINDS, counts: byKind, total: rows.length, memories: rows })
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const db = supabaseAdmin()
  const actor = String(gate.access.email || '')
  const owner = isSuperadmin(actor)

  // JON'S WORDS ARE JON'S TO CHANGE (Jon, 2026-09-23 review). Any Eve user could delete or rewrite
  // a memory Jon wrote, or supersede it with their own. A row with source 'jon' can now only be
  // deleted, edited or superseded by the superadmin; everyone else gets a 403 and can raise it
  // with him instead.
  const jonOwned = async (id: string): Promise<boolean> => {
    if (owner || !id) return false
    const { data } = await db.from('eve_memory').select('source').eq('id', id).maybeSingle()
    return String((data as any)?.source || '') === 'jon'
  }
  const forbidden = () => NextResponse.json({ error: 'Only Jon can change or remove something Jon taught her.' }, { status: 403 })

  if (body?.op === 'delete') {
    const id = String(body?.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (await jonOwned(id)) return forbidden()
    const { error } = await db.from('eve_memory').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message.slice(0, 200) }, { status: 500 })
    return NextResponse.json({ ok: true, deleted: id })
  }

  if (body?.op === 'update') {
    const id = String(body?.id || '')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    if (await jonOwned(id)) return forbidden()
    const patch: any = { updated_at: new Date().toISOString() }
    if (body.text != null) patch.text = String(body.text).slice(0, 1000)
    if (body.why != null) patch.why = String(body.why).slice(0, 500) || null
    if (body.kind != null) patch.kind = normKind(body.kind)
    if (body.scope != null) patch.scope = normScope(body.scope)
    // A colleague's edit cannot lift a memory above the staff ceiling (Jon, 2026-09-23 review).
    if (body.weight != null) patch.weight = owner ? normWeight(body.weight) : Math.min(normWeight(body.weight), STAFF_MAX_WEIGHT)
    const { error } = await db.from('eve_memory').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message.slice(0, 200) }, { status: 500 })
    return NextResponse.json({ ok: true, updated: id })
  }

  // Default: a person teaching her something directly. Source 'jon' and a high default weight when
  // it is Jon, because a thing the owner typed on purpose outranks anything she inferred on her own.
  // Anyone else is filed as 'staff', capped at weight 6 (Jon, 2026-09-23 review).
  const supersedes = body?.supersedes ? String(body.supersedes) : null
  if (supersedes && await jonOwned(supersedes)) return forbidden()
  const who = personSource(actor, body?.weight != null ? body.weight : 8)
  const res = await saveMemory({
    text: body?.text, kind: body?.kind, why: body?.why, scope: body?.scope,
    weight: who.weight, maxWeight: who.source === 'staff' ? STAFF_MAX_WEIGHT : undefined,
    source: who.source, created_by: actor, supersedes,
  })
  if (!res.ok) return NextResponse.json({ error: res.error || 'could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, id: res.id })
}
