// Read-only diagnostic: which Guesty owner / accounting endpoints does THIS account's
// token actually have? Accounting by Guesty (owner statements, journal entries) is a paid
// add-on, so the endpoints exist in the API docs but may 401/403/404 for a given account.
// This route calls each one with a tiny page size and reports the status plus a SHAPE
// summary — key names and counts, never the values — so we can see what's reachable
// without dumping owner PII into a browser tab.
//
// GET /api/guesty/owner-probe            — probe everything
// GET /api/guesty/owner-probe?sample=1   — also include one redacted sample row per endpoint
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getToken } from '@/lib/guesty'
import { hasEditCookie } from '@/lib/edit-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BASE = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'

// Field names we never echo back, even in sample mode.
const SECRET = /email|phone|ssn|tax|iban|account.?number|routing|address|token|password|secret/i

function shape(v: any, depth = 0): any {
  if (v == null) return null
  if (Array.isArray(v)) return depth > 2 ? '[...]' : { _array: v.length, _first: v.length ? shape(v[0], depth + 1) : null }
  if (typeof v === 'object') {
    if (depth > 2) return '{...}'
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).slice(0, 60)) out[k] = shape(v[k], depth + 1)
    return out
  }
  return typeof v
}

function redact(v: any, depth = 0): any {
  if (v == null || depth > 3) return v
  if (Array.isArray(v)) return v.slice(0, 1).map(x => redact(x, depth + 1))
  if (typeof v === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(v).slice(0, 60)) out[k] = SECRET.test(k) ? '<redacted>' : redact(v[k], depth + 1)
    return out
  }
  return v
}

// Like redact() but keeps whole arrays, for ?full=1 when we actually need the numbers
// rather than the shape. Still strips anything matching SECRET.
function redactAll(v: any, depth = 0): any {
  if (v == null || depth > 6) return v
  if (Array.isArray(v)) return v.slice(0, 500).map(x => redactAll(x, depth + 1))
  if (typeof v === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(v)) out[k] = SECRET.test(k) ? '<redacted>' : redactAll(v[k], depth + 1)
    return out
  }
  return v
}

async function probe(token: string, path: string): Promise<any> {
  const started = Date.now()
  try {
    const r = await fetch(BASE + path, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      cache: 'no-store',
    })
    const text = await r.text().catch(() => '')
    let json: any = null
    try { json = JSON.parse(text) } catch (_e) { /* non-JSON body */ }
    return {
      path,
      status: r.status,
      ok: r.ok,
      ms: Date.now() - started,
      // On failure the message is the useful part; on success the shape is.
      error: r.ok ? undefined : text.slice(0, 300),
      count: json && (typeof json.count === 'number' ? json.count
        : Array.isArray(json.results) ? json.results.length
        : Array.isArray(json.data) ? json.data.length
        : Array.isArray(json) ? json.length : undefined),
      shape: r.ok ? shape(json) : undefined,
      _raw: r.ok ? json : undefined,
    }
  } catch (e: any) {
    return { path, status: 0, ok: false, ms: Date.now() - started, error: String(e?.message || e).slice(0, 300) }
  }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !hasEditCookie()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const qs = new URL(req.url).searchParams
  const withSample = qs.get('sample') === '1'
  const withFull = qs.get('full') === '1'
  // ?path=/owners/statements%3FownerId%3D... — probe one or more explicit paths instead of the
  // default set. Read-only: this only ever issues GETs against the Guesty base URL. Newline- or
  // comma-separated for several at once. {owner} and {listing} expand to the ids resolved below.
  const custom = (qs.get('path') || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean)

  let token = ''
  try { token = await getToken() }
  catch (e: any) { return NextResponse.json({ error: 'guesty auth failed: ' + String(e?.message || e) }, { status: 500 }) }

  // A real listing id from the 906 building, so the financials probe is meaningful.
  const db = supabaseAdmin()
  const { data: ls } = await db.from('guesty_listings')
    .select('id, building, unit').ilike('building', '%906%').limit(1)
  const listingId = ls && ls[0] ? String((ls[0] as any).id) : ''

  if (custom.length) {
    // Resolve a real owner id first so {owner} placeholders work.
    const ow = await probe(token, '/owners?limit=5')
    const owList = ow?._raw?.results || ow?._raw?.data || ow?._raw
    const oid = Array.isArray(owList) && owList[0] ? String(owList[0]._id || owList[0].id || '') : ''
    const out: any[] = []
    for (const raw of custom) {
      const p = raw.split('{owner}').join(oid).split('{listing}').join(listingId)
      out.push(await probe(token, p.startsWith('/') ? p : '/' + p))
    }
    return NextResponse.json({
      ok: true,
      base: BASE,
      ownerProbed: oid || null,
      listingProbed: listingId || null,
      results: out.map(r => {
        const { _raw, ...rest } = r
        if (withFull && _raw) return { ...rest, data: redactAll(_raw) }
        return withSample && _raw ? { ...rest, sample: redact(_raw) } : rest
      }),
    })
  }

  const paths = [
    '/owners?limit=5',
    '/owners/statements?limit=5',
    '/journal-entries?limit=5',
    '/journal-entries/recognized?limit=5',
    '/channel-commission/account',
  ]
  if (listingId) {
    paths.push('/financials/listing/' + encodeURIComponent(listingId))
    paths.push('/listings/' + encodeURIComponent(listingId) + '/ownerships')
  }

  const results: any[] = []
  for (const p of paths) results.push(await probe(token, p))

  // If /owners worked, follow through to that owner's statements + ownerships, since several
  // of these endpoints are owner-scoped and only prove out with a real owner id.
  const ownersRes = results[0]
  const ownersList = ownersRes?._raw?.results || ownersRes?._raw?.data || ownersRes?._raw
  const ownerId = Array.isArray(ownersList) && ownersList[0] ? String(ownersList[0]._id || ownersList[0].id || '') : ''
  if (ownerId) {
    for (const p of [
      '/owners/' + ownerId + '/ownerships',
      '/owners/' + ownerId + '/reservations?limit=5',
      '/owners/statements?ownerId=' + ownerId + '&limit=5',
    ]) results.push(await probe(token, p))
  }

  return NextResponse.json({
    ok: true,
    base: BASE,
    listingProbed: listingId || null,
    ownerProbed: ownerId || null,
    reachable: results.filter(r => r.ok).map(r => r.path),
    blocked: results.filter(r => !r.ok).map(r => ({ path: r.path, status: r.status, error: r.error })),
    results: results.map(r => {
      const { _raw, ...rest } = r
      if (withFull && _raw) return { ...rest, data: redactAll(_raw) }
      return withSample && _raw ? { ...rest, sample: redact(_raw) } : rest
    }),
  })
}
