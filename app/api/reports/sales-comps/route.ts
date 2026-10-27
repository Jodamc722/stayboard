// THE COMPARABLE LISTINGS, FROM A PASTE.
// POST { id, text } -> the comps slide's rows
//
// Nick gathers these off Airbnb by hand — eight or nine listings of the same size in the same
// building — and there is no comp feed in this system to do it for him. So the deck takes whatever
// shape that paste arrives in (a column of names and figures, a copied table, a few lines typed
// out) and turns it into the table the one-pager prints.
//
// IT READS, IT DOES NOT ESTIMATE. A listing with no occupancy printed beside it gets an empty
// occupancy cell, not a guess. These are numbers an owner can check against the live listing in
// the next browser tab, which is exactly why they are persuasive and exactly why inventing one
// would be the most expensive thing this route could do.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { aiFetch } from '@/lib/ai-usage'
import { modelFor } from '@/lib/ai-models'
import { hasEditCookie } from '@/lib/edit-access'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function POST(req: NextRequest) {
  const gate = await requireLevel('reports', 'edit')
  if (!gate.ok && !hasEditCookie()) return gate.res

  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id)
  const text = str(body?.text).slice(0, 20_000)
  if (!id || !text.trim()) return NextResponse.json({ error: 'id + text required' }, { status: 400 })

  const db = supabaseAdmin()
  const { data } = await db.from('owner_reports').select('id, content').eq('id', id).limit(1)
  const rep = (data || [])[0] as any
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })
  const content: any = (rep.content && typeof rep.content === 'object') ? rep.content : {}

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return NextResponse.json({ error: 'AI is not configured.' }, { status: 500 })
  let out: string | null = null
  try {
    const r = await aiFetch('reports', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelFor('reports'), max_tokens: 2500,
        system: 'You turn pasted short-term rental listing data into a table for a sales deck. Output STRICT JSON only. You never invent a figure.',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Below is a paste describing comparable short-term rental listings. Turn it into STRICT JSON: {"rows": [{"name": the listing title, "rev": estimated annual revenue exactly as printed (a range like "$96,491 – $120,018" if two figures are given), "rate": nightly rate as printed, "occ": occupancy as printed, "beds": bedrooms, "baths": bathrooms, "rating": guest rating}]}. Rules: copy every figure exactly as it appears, keep ranges as ranges, and leave a field as "" when the paste does not give it. Never estimate, never fill a blank, never add a listing that is not there. Keep the order of the paste.\n\nThe paste:\n' + text }] }],
      }),
    })
    const d: any = await r.json().catch(() => ({}))
    if (r.ok) out = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : null
  } catch { out = null }

  const m = out ? out.match(/\{[\s\S]*\}/) : null
  let j: any = null
  try { j = m ? JSON.parse(m[0]) : null } catch { j = null }
  if (!j || !Array.isArray(j.rows) || !j.rows.length) {
    return NextResponse.json({ error: 'No listings could be read out of that paste.' }, { status: 400 })
  }
  const rows = j.rows.slice(0, 12).map((r: any) => ({
    name: str(r?.name).slice(0, 120),
    rev: str(r?.rev).slice(0, 40),
    rate: str(r?.rate).slice(0, 20),
    occ: str(r?.occ).slice(0, 12),
    beds: str(r?.beds).slice(0, 8),
    baths: str(r?.baths).slice(0, 8),
    rating: str(r?.rating).slice(0, 8),
  })).filter((r: any) => r.name)
  if (!rows.length) return NextResponse.json({ error: 'No listings could be read out of that paste.' }, { status: 400 })

  const prev: any = content.comps || {}
  content.comps = { ...prev, rows }
  if (Array.isArray(content.omit)) content.omit = content.omit.filter((k: string) => k !== 'comps')
  const { error } = await db.from('owner_reports').update({ content, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, rows: rows.length, content })
}
