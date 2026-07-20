// Estimated costs for order lines (session-auth). One AI pass fills details.est (USD per
// unit, integer) for every line in scope that has no estimate yet - Jon can override any
// price by hand afterwards. Estimates power the owner approval link totals.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const scope = String(body.scope || 'all')
  const db = supabaseAdmin()
  let listingIds: string[] | null = null
  if (scope.startsWith('u:')) listingIds = [scope.slice(2)]
  else if (scope.startsWith('b:')) {
    const { data: ls } = await db.from('guesty_listings').select('id').eq('building', scope.slice(2)).limit(300)
    listingIds = (ls || []).map((x: any) => String(x.id))
    if (!listingIds.length) return NextResponse.json({ ok: true, estimated: 0, note: 'no listings in building' })
  }
  let q = db.from('audit_items').select('id,title,note,room,details').in('kind', ['replace', 'add']).in('status', ['open', 'approved', 'ordered', 'arriving']).limit(500)
  if (listingIds) q = q.in('listing_id', listingIds)
  const { data: rows } = await q
  const need = (rows || []).filter((x: any) => x.title && !(x.details && Number(x.details.est) > 0)).slice(0, 60)
  if (!need.length) return NextResponse.json({ ok: true, estimated: 0 })
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'no ai key' }, { status: 503 })
  const SYS = 'You price furnishing, appliance and supply purchases for a short-term rental property manager in South Florida. For each item return est = a realistic mid-range price in whole USD for ONE unit of the item (never multiply by quantity). Use the note and room for context. STRICT JSON ONLY, no markdown: {"estimates":[{"id":"","est":0}]}'
  const payload = need.map((x: any) => ({ id: String(x.id), title: String(x.title || ''), note: String(x.note || '').slice(0, 160), room: String(x.room || '') }))
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-8', max_tokens: 3000, system: SYS, messages: [{ role: 'user', content: 'Items: ' + JSON.stringify(payload) }] }) })
    const j = await r.json()
    const text = j && j.content && j.content[0] && j.content[0].text ? String(j.content[0].text) : ''
    const m = text.match(/\{[\s\S]*\}/)
    const parsed = m ? JSON.parse(m[0]) : null
    const ests = (parsed && Array.isArray(parsed.estimates) ? parsed.estimates : [])
    const byId: Record<string, any> = {}
    for (const x of need) byId[String(x.id)] = x
    let n = 0
    for (const e of ests) {
      const it = byId[String(e.id)]
      const est = Math.round(Number(e.est))
      if (!it || !Number.isFinite(est) || est <= 0 || est > 100000) continue
      const d: any = (it.details && typeof it.details === 'object') ? { ...it.details } : {}
      d.est = est
      await db.from('audit_items').update({ details: d, updated_at: new Date().toISOString() }).eq('id', it.id)
      n++
    }
    return NextResponse.json({ ok: true, estimated: n })
  } catch { return NextResponse.json({ error: 'estimate failed' }, { status: 500 }) }
}
