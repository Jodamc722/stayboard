// DELIVERY PLAN data - the shareable placement list for the team receiving orders: every
// approved / ordered / arriving line with WHERE it goes (building -> unit -> room).
// Gated by the shared team password (same cookie as the vendor / front-desk boards).
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SHARE_COOKIE, shareCookieValid } from '@/lib/shareAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const authed = await shareCookieValid(cookies().get(SHARE_COOKIE)?.value)
  if (!authed) return NextResponse.json({ ok: false, needsPassword: true, error: 'Password required' }, { status: 401 })
  const db = supabaseAdmin()
  const [oi, ol] = await Promise.all([
    db.from('audit_items').select('id,listing_id,room,kind,title,qty,note,photo_url,status,details').in('kind', ['replace', 'add']).in('status', ['approved', 'ordered', 'arriving']).order('created_at', { ascending: false }).limit(2000),
    db.from('guesty_listings').select('id,nickname,title,building').limit(2000),
  ])
  const lm: Record<string, any> = {}
  for (const l of ol.data || []) lm[String(l.id)] = { name: l.nickname || l.title || 'Unit', building: l.building || '' }
  const items = (oi.data || []).map((x: any) => {
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
