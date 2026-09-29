// DELIVERY PLAN data - the shareable placement list for the team receiving orders: every
// approved / ordered / arriving line with WHERE it goes (building -> unit -> room).
// Gated by the shared team password (same cookie as the vendor / front-desk boards).
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { linkGate } from '@/lib/passcode-gate'
import { pageRows } from '@/lib/db-page'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const gate = await linkGate('delivery', { kinds: ['delivery'] })
  if (!gate.ok) return gate.res
  const db = supabaseAdmin()
  // Every line in flight, paged (was one read capped at 1,000): past that, the OLDEST approved lines —
  // the ones most likely arriving now — fell off the end of the newest-first list.
  const [oi, ol] = await Promise.all([
    pageRows((a, b) => db.from('audit_items').select('id,listing_id,room,kind,title,qty,note,photo_url,status,details').in('kind', ['replace', 'add']).in('status', ['approved', 'ordered', 'arriving']).order('created_at', { ascending: false }).order('id').range(a, b)),
    db.from('guesty_listings').select('id,nickname,title,building').limit(1000), // deliberate cap: one row per listing, ~290
  ])
  if (oi.truncated) console.error('public/delivery: order-line read stopped early — the list may be short')
  const lm: Record<string, any> = {}
  for (const l of ol.data || []) lm[String(l.id)] = { name: l.nickname || l.title || 'Unit', building: l.building || '' }
  const items = (oi.rows as any[]).map((x: any) => {
    const lid = String(x.listing_id || '')
    const meta = lm[lid]
    return {
      id: x.id,
      unit: meta ? meta.name : (lid.indexOf(':') >= 0 ? lid.split(':').slice(1).join(':') : lid),
      building: meta ? meta.building : '',
      room: x.room || '',
      kind: x.kind,
      title: x.title || '',
      qty: Number(x.qty) || 1,
      note: x.note || '',
      photo: x.photo_url || null,
      link: x.details && x.details.link ? String(x.details.link) : null,
      status: x.status,
    }
  })
  return NextResponse.json({ ok: true, items, generatedAt: new Date().toISOString() })
}
