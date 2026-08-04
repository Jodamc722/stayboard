// CLAIM ITEMS — one damaged or stolen thing, evidenced on its own.
// The channels read a claim item by item; a bundled "kitchen damage $1,400" gets denied. So the
// item is a real row with its own photos, receipt and replacement link, and there is no cap at
// three the way the Asana form had.
//   POST   -> add an item (or replace the whole list with {items: [...]})
//   PATCH  -> update one item
//   DELETE -> remove one item (?itemId=)
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { num } from '@/lib/claims'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

function shape(b: any, claimId: string, position: number): Record<string, any> {
  const photos = Array.isArray(b.photo_urls)
    ? b.photo_urls.filter((x: any) => typeof x === 'string' && x).slice(0, 20)
    : []
  return {
    claim_id: claimId,
    position,
    description: str(b.description).trim() || null,
    condition_prior: str(b.condition_prior).trim() || null,
    age_text: str(b.age_text).trim() || null,
    cost: num(b.cost),
    replacement_url: str(b.replacement_url).trim() || null,
    receipt_url: str(b.receipt_url).trim() || null,
    photo_urls: photos,
    police_report: b.police_report === true,
    updated_at: new Date().toISOString(),
  }
}

async function guard(id: string) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) }
  const db = supabaseAdmin()
  const { data: claim } = await db.from('claims').select('id').eq('id', id).is('deleted_at', null).maybeSingle()
  if (!claim) return { err: NextResponse.json({ ok: false, error: 'Claim not found.' }, { status: 404 }) }
  return { db }
}

async function listItems(db: any, claimId: string) {
  const { data } = await db.from('claim_items').select('*').eq('claim_id', claimId).order('position', { ascending: true })
  return data || []
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if (g.err) return g.err
  const db = g.db as any
  try {
    const b = await req.json().catch(() => ({} as any))
    const existing = await listItems(db, params.id)
    let next = existing.length
    const rows = Array.isArray(b.items) ? b.items : [b]
    const payload = rows.slice(0, 50).map((r: any) => shape(r, params.id, next++))
    const { error } = await db.from('claim_items').insert(payload)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await db.from('claims').update({ updated_at: new Date().toISOString() }).eq('id', params.id)
    return NextResponse.json({ ok: true, items: await listItems(db, params.id) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if (g.err) return g.err
  const db = g.db as any
  try {
    const b = await req.json().catch(() => ({} as any))
    const itemId = str(b.itemId || b.id).trim()
    if (!itemId) return NextResponse.json({ ok: false, error: 'itemId is required.' }, { status: 400 })
    const { data: cur } = await db.from('claim_items').select('position').eq('id', itemId).eq('claim_id', params.id).maybeSingle()
    if (!cur) return NextResponse.json({ ok: false, error: 'Item not found on this claim.' }, { status: 404 })
    const row = shape(b, params.id, Number((cur as any).position) || 0)
    delete row.claim_id
    const { error } = await db.from('claim_items').update(row).eq('id', itemId)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    await db.from('claims').update({ updated_at: new Date().toISOString() }).eq('id', params.id)
    return NextResponse.json({ ok: true, items: await listItems(db, params.id) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id)
  if (g.err) return g.err
  const db = g.db as any
  const itemId = str(req.nextUrl.searchParams.get('itemId')).trim()
  if (!itemId) return NextResponse.json({ ok: false, error: 'itemId is required.' }, { status: 400 })
  const { error } = await db.from('claim_items').delete().eq('id', itemId).eq('claim_id', params.id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, items: await listItems(db, params.id) })
}
