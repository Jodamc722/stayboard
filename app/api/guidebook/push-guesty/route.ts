import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// Writes each guidebook's public link (/g/<id>) into the Guesty "Guidebook"
// custom field, per listing. Uses the dedicated /custom-fields endpoint so it
// only updates that one field and never clobbers door codes or other fields.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const all = body?.all === true
  const bookIds: string[] = Array.isArray(body?.bookIds) ? body.bookIds.map((x: any) => String(x)) : []
  const sb = supabaseAdmin()

  const { data: fields } = await sb.from('guesty_custom_fields').select('id, name')
  const gf = (fields || []).find((f: any) => String(f?.name || '').trim().toLowerCase() === 'guidebook')
    || (fields || []).find((f: any) => /guide\s?book/i.test(String(f?.name || '')))
  if (!gf) return NextResponse.json({ error: 'No Guesty custom field named "Guidebook" found. Create it in Guesty, sync custom fields, then retry.', available: (fields || []).map((f: any) => f?.name).filter(Boolean) }, { status: 400 })
  const fieldId = String(gf.id)

  let q = sb.from('guidebooks').select('id, listing_id, listing_name, updated_at').not('sections', 'is', null).order('updated_at', { ascending: false }).limit(2000)
  if (!all && bookIds.length) q = q.in('id', bookIds)
  const { data: books } = await q
  const seen = new Set<string>()
  const rows = (books || []).filter((b: any) => {
    if (!b?.listing_id) return false
    const k = String(b.listing_id)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const { data: tok } = await sb.from('guesty_tokens').select('access_token, expires_at').eq('id', 'singleton').maybeSingle()
  const valid = tok?.access_token && (!tok.expires_at || new Date(tok.expires_at).getTime() > Date.now() + 30000)
  if (!valid) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry in a moment.' }, { status: 503 })

  const origin = req.nextUrl.origin
  const results: any[] = []
  for (const b of rows) {
    const url = origin + '/g/' + b.id
    try {
      const r = await fetch(BASE + '/listings/' + encodeURIComponent(String(b.listing_id)) + '/custom-fields', {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + tok!.access_token, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ customFields: [{ fieldId, value: url }] }),
      })
      const ok = r.ok
      const err = ok ? '' : (await r.text().catch(() => '')).slice(0, 200)
      results.push({ listingId: b.listing_id, name: b.listing_name, ok, status: r.status, error: err })
    } catch (e: any) {
      results.push({ listingId: b.listing_id, name: b.listing_name, ok: false, error: String(e?.message || e) })
    }
  }

  const pushed = results.filter((x) => x.ok).length
  return NextResponse.json({ ok: true, pushed, total: results.length, fieldId, results: results.slice(0, 60) })
}
