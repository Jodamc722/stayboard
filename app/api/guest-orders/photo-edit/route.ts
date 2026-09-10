// EDIT A PHOTO THAT IS ALREADY ON AN ITEM.
//
// POST { itemId, ops }  -> re-renders from the ORIGINAL upload and swaps in the result.
//
// Runs at 'edit' level like the rest of Inventory: the people who restock are the people who notice
// a photo looks wrong, and making them find an owner to fix it is how it stays wrong.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { renderPhoto, type PhotoOps } from '@/lib/photo-fix'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'guest-order-photos'

export async function POST(req: NextRequest) {
  const gate = await requireLevel('guest-orders', 'edit')
  if (!gate.ok) return gate.res
  const body = await req.json().catch(() => ({} as any))
  const itemId = String(body?.itemId || '')
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return NextResponse.json({ ok: false, error: 'bad item' }, { status: 400 })

  const db = supabaseAdmin()
  const { data } = await db.from('guest_order_catalog').select('id,sku,image_url,image_original').eq('id', itemId).limit(1)
  const item: any = (data || [])[0]
  if (!item) return NextResponse.json({ ok: false, error: 'that item is gone \u2014 reload' }, { status: 404 })
  // Older items were uploaded before the original was kept; their current image is the best we have.
  const source = String(item.image_original || item.image_url || '')
  if (!source) return NextResponse.json({ ok: false, error: 'there is no photo on this item yet' }, { status: 400 })

  let raw: Buffer
  try {
    const r = await fetch(source, { cache: 'no-store' })
    if (!r.ok) throw new Error('fetch ' + r.status)
    raw = Buffer.from(await r.arrayBuffer())
  } catch { return NextResponse.json({ ok: false, error: 'could not read the stored photo' }, { status: 502 }) }

  const o = body?.ops || {}
  const ops: PhotoOps = {
    smart: o.smart !== false,
    rotate: ([0, 90, 180, 270].indexOf(Number(o.rotate)) >= 0 ? Number(o.rotate) : 0) as PhotoOps['rotate'],
    zoom: Number(o.zoom) || 1,
    offsetX: Number(o.offsetX) || 0,
    offsetY: Number(o.offsetY) || 0,
    enhance: o.enhance !== false,
  }
  let out: Buffer
  try { out = await renderPhoto(raw, ops) } catch (e: any) { return NextResponse.json({ ok: false, error: 'could not render: ' + String(e?.message || e).slice(0, 120) }, { status: 500 }) }

  const sku = String(item.sku || 'item').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'item'
  const path = sku + '/' + Date.now().toString(36) + '.jpg'
  const up = await db.storage.from(BUCKET).upload(path, out, { contentType: 'image/jpeg', upsert: true })
  if (up.error) return NextResponse.json({ ok: false, error: 'upload failed: ' + up.error.message }, { status: 500 })
  const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl

  // Backfill the original for anything uploaded before we kept one, so the NEXT edit is lossless.
  const patch: Record<string, any> = { image_url: url }
  if (!item.image_original) patch.image_original = source
  const { error } = await db.from('guest_order_catalog').update(patch).eq('id', itemId)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, url })
}
