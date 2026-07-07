import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// Writes each guidebook's guest shareable link (/g/<id>) into the property-level
// "Guidebook" custom field in Guesty, per listing. Uses the dedicated
// /custom-fields endpoint so it only updates that one field.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const all = body?.all === true
  const bookIds: string[] = Array.isArray(body?.bookIds) ? body.bookIds.map((x: any) => String(x)) : []
  const sb = supabaseAdmin()

  const token = await getToken()
  if (!token) return NextResponse.json({ error: 'Guesty token unavailable - run a sync, then retry in a moment.' }, { status: 503 })

  const norm = (s: any) => String(s || '').trim().toLowerCase()
  const isGuidebook = (nm: any) => norm(nm) === 'guidebook' || /guide\s?book/i.test(String(nm || ''))
  const nameOf = (f: any) => String(f?.name || f?.displayName || f?.title || f?.label || f?.fieldName || f?.key || '')
  let fieldId = ''
  const available: string[] = []
  const __DBG__: any[] = []

  try {
    const { data: fields } = await sb.from('guesty_custom_fields').select('id, name')
    for (const f of (fields || [])) { if ((f as any)?.name) available.push(String((f as any).name)) }
    const gf = (fields || []).find((f: any) => isGuidebook(f?.name))
    if (gf) fieldId = String((gf as any).id)
  } catch {}

  if (!fieldId) {
    let acct = String(body?.accountId || process.env.GUESTY_ACCOUNT_ID || '')
    if (!acct) {
      try {
        const { data: anyL } = await sb.from('guesty_listings').select('raw').not('raw', 'is', null).limit(1).maybeSingle()
        const rw: any = (anyL as any)?.raw || {}
        acct = String(rw.accountId || rw.accountID || rw.account?._id || rw.account?.id || '')
      } catch {}
    }
    if (!acct) {
      for (const au of [BASE + '/accounts/me', BASE + '/accounts', BASE + '/accounts?limit=1']) {
        try {
          const ar = await fetch(au, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
          __DBG__.push({ url: au, status: ar.status })
          if (!ar.ok) continue
          const aj: any = await ar.json().catch(() => ({}))
          const one: any = Array.isArray(aj) ? aj[0] : (aj?.results?.[0] || aj?.data?.[0] || aj)
          const cand = String(one?._id || one?.id || one?.accountId || '')
          if (cand) { acct = cand; break }
        } catch {}
      }
    }
    const urls = [BASE + '/listings/custom-fields?limit=200', BASE + '/custom-fields?model=listing&limit=200', BASE + '/custom-fields?type=listing&limit=200', BASE + '/custom-fields?limit=200', BASE + '/accounts/' + acct + '/custom-fields?limit=200', BASE + '/reservations/custom-fields?limit=200']
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
        __DBG__.push({ url: u, status: r.status }); if (!r.ok) continue
        const j: any = await r.json().catch(() => ({}))
        const arr: any[] = Array.isArray(j) ? j : (j?.results || j?.data || j?.fields || [])
        if (__DBG__.length) __DBG__[__DBG__.length - 1].count = arr.length
        for (const f of arr) { const nm = nameOf(f); if (nm) available.push(nm) }
        const gf = arr.find((f: any) => isGuidebook(nameOf(f)))
        if (gf) { fieldId = String(gf._id || gf.id || gf.fieldId); break }
      } catch {}
    }
  }

  if (!fieldId) {
    return NextResponse.json({ error: 'No Guesty custom field named "Guidebook" found (checked synced table + live Guesty).', available: Array.from(new Set(available)), debug: __DBG__, acctSet: !!process.env.GUESTY_ACCOUNT_ID }, { status: 400 })
  }

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

  const origin = req.nextUrl.origin
  const results: any[] = []
  for (const b of rows) {
    const url = origin + '/g/' + b.id
    try {
      const r = await fetch(BASE + '/listings/' + encodeURIComponent(String(b.listing_id)) + '/custom-fields', {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
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
