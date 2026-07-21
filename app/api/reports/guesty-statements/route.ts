// Owner statements from Guesty (P10). READ-ONLY diagnostic — scans owner DOCUMENTS across all owners to
// determine whether Guesty-generated statement PDFs are reachable via the public API, and re-checks whether
// the management fee is derivable from any owner's revenue roll-up.
// Returns SANITIZED aggregates only (counts, field names, booleans) — no ids/emails/urls/$ values.
// Auth-guarded to a logged-in user. No writes.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROOT = 'https://open-api.guesty.com'
const V1 = process.env.GUESTY_BASE_URL || ROOT + '/v1'

async function raw(url: string, token: string): Promise<{ status: number; json: any }> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
    const t = await r.text()
    let json: any = null
    try { json = JSON.parse(t) } catch {}
    return { status: r.status, json }
  } catch { return { status: 0, json: null } }
}

function asArray(j: any): any[] {
  if (Array.isArray(j)) return j
  if (Array.isArray(j?.results)) return j.results
  if (Array.isArray(j?.data)) return j.data
  if (Array.isArray(j?.data?.owners)) return j.data.owners
  if (Array.isArray(j?.documents)) return j.documents
  return []
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let token = ''
  try { token = await getToken() } catch (e: any) {
    return NextResponse.json({ error: 'guesty token failed: ' + String(e?.message || e).slice(0, 200) }, { status: 500 })
  }

  const ownersRaw = await raw(`${V1}/owners?limit=100`, token)
  const owners = asArray(ownersRaw.json)
  const ownerIds: string[] = owners.map((o: any) => o && (o._id || o.id)).filter(Boolean)

  // Revenue-derivability re-check across ALL owners (field names + a bool count only, no $).
  let ownersWithRevenue = 0
  const revenueKeys = new Set<string>()
  for (const o of owners) {
    const rev = (o && o.revenue) || null
    if (rev && typeof rev === 'object' && Object.keys(rev).length) { ownersWithRevenue++; Object.keys(rev).forEach(k => revenueKeys.add(k)) }
  }

  // Documents scan across owners (chunked to avoid rate limits).
  let ownersScanned = 0
  let ownersWithDocs = 0
  let totalDocs = 0
  const docKeys = new Set<string>()
  const urlishKeys = new Set<string>()
  let anyStatementLike = false
  let docStatus200 = 0
  const isUrlish = (k: string) => /url|link|file|download|path|s3|href|attachment/i.test(k)
  const looksStatement = (d: any) => {
    const hay = JSON.stringify({ n: d?.name, t: d?.type, c: d?.category, tt: d?.title, f: d?.fileName }).toLowerCase()
    return /statement|owner.?stmt|payout|remit/.test(hay)
  }

  const CHUNK = 8
  for (let i = 0; i < ownerIds.length; i += CHUNK) {
    const batch = ownerIds.slice(i, i + CHUNK)
    const results = await Promise.all(batch.map(id => raw(`${V1}/owners/${id}/documents?limit=25`, token)))
    for (const r of results) {
      ownersScanned++
      if (r.status === 200) docStatus200++
      const docs = asArray(r.json)
      if (docs.length) {
        ownersWithDocs++
        totalDocs += docs.length
        for (const d of docs) {
          if (d && typeof d === 'object') {
            Object.keys(d).forEach(k => { docKeys.add(k); if (isUrlish(k)) urlishKeys.add(k) })
            if (looksStatement(d)) anyStatementLike = true
          }
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ownersEndpointStatus: ownersRaw.status,
    ownerCount: owners.length,
    fee: { ownersWithRevenue, revenueKeys: Array.from(revenueKeys).slice(0, 30), derivable: ownersWithRevenue > 0 },
    documents: {
      endpointReachable: docStatus200 > 0,
      ownersScanned,
      ownersWithDocs,
      totalDocs,
      docFieldNames: Array.from(docKeys).slice(0, 40),
      downloadableFieldNames: Array.from(urlishKeys).slice(0, 20),
      anyStatementLike,
    },
  })
}
