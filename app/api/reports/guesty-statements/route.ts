// Owner statements from Guesty (P10). READ-ONLY diagnostic — reports which Guesty owner/accounting/
// statement endpoints are reachable and whether the management fee is derivable from /owners financials.
// Returns SANITIZED structure only (status codes, key names, booleans, a fee %) — no ids/emails/$ values.
// Auth-guarded to a logged-in user. No writes.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROOT = 'https://open-api.guesty.com'
const V1 = process.env.GUESTY_BASE_URL || ROOT + '/v1'

async function raw(url: string, token: string): Promise<{ status: number; json: any; text?: string }> {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
    const t = await r.text()
    let json: any = null
    try { json = JSON.parse(t) } catch {}
    return { status: r.status, json, text: json ? undefined : t.slice(0, 200) }
  } catch (e: any) { return { status: 0, json: null, text: String(e?.message || e).slice(0, 200) } }
}

function asArray(j: any): any[] {
  if (Array.isArray(j)) return j
  if (Array.isArray(j?.results)) return j.results
  if (Array.isArray(j?.data)) return j.data
  if (Array.isArray(j?.data?.owners)) return j.data.owners
  if (Array.isArray(j?.documents)) return j.documents
  if (Array.isArray(j?.statements)) return j.statements
  return []
}

// Sanitized endpoint summary: status + whether it returned a list + item field names (NO values).
async function endpoint(url: string, token: string) {
  const r = await raw(url, token)
  const arr = asArray(r.json)
  const itemKeys = arr[0] && typeof arr[0] === 'object' ? Object.keys(arr[0]).slice(0, 25) : (r.json && typeof r.json === 'object' ? Object.keys(r.json).slice(0, 15) : [])
  return { status: r.status, isList: arr.length > 0, count: arr.length, itemKeys, note: r.text }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let token = ''
  try { token = await getToken() } catch (e: any) {
    return NextResponse.json({ error: 'guesty token failed: ' + String(e?.message || e).slice(0, 200) }, { status: 500 })
  }

  const ownersRaw = await raw(`${V1}/owners?limit=10`, token)
  const owners = asArray(ownersRaw.json)
  const o0: any = owners[0] || null
  const ownerId: string | null = o0 ? (o0._id || o0.id || null) : null

  // Fee-derivability check from the owner revenue roll-up (no raw $ returned — just field names + a %).
  const rev: any = o0?.revenue || {}
  const num = (v: any) => { const n = Number(v); return isFinite(n) ? n : NaN }
  const gross = num(rev.accommodationFare)
  const net = num(rev.netRentalIncome ?? rev.netAccommodationFare)
  const payout = num(rev.hostPayout)
  const feeDerivable = isFinite(gross) && isFinite(net) && gross > 0 && net > 0 && net < gross
  const impliedFeePct = feeDerivable ? Math.round(((gross - net) / gross) * 100) : null

  const out: any = {
    ok: true,
    ownersEndpoint: { status: ownersRaw.status, count: owners.length, ownerKeys: o0 ? Object.keys(o0).slice(0, 30) : [] },
    ownerRevenueKeys: Object.keys(rev).slice(0, 30),
    feeCheck: { hasGross: isFinite(gross), hasNet: isFinite(net), hasHostPayout: isFinite(payout), feeDerivable, impliedFeePct },
    hasOwnerId: !!ownerId,
  }

  if (ownerId) {
    out.ownerDocuments = await endpoint(`${V1}/owners/${ownerId}/documents`, token)
    out.ownerStatements = await endpoint(`${V1}/owners/${ownerId}/statements`, token)
    out.ownerDetail = await endpoint(`${V1}/owners/${ownerId}`, token)
  }
  out.accountingJournal = await endpoint(`${ROOT}/accounting-api/journal-entries?limit=2`, token)
  out.ownerStatementsReport = await endpoint(`${V1}/owner-statements?limit=2`, token)

  return NextResponse.json(out)
}
