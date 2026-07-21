// Owner statements from Guesty (P10). GET ?probe=1 is a READ-ONLY diagnostic that reports which Guesty
// owner/accounting/statement endpoints are reachable on this account (so we can wire the real pull to the
// right shape). Auth-guarded to a logged-in user. No writes, no side effects.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getToken } from '@/lib/guesty'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROOT = 'https://open-api.guesty.com'
const V1 = process.env.GUESTY_BASE_URL || ROOT + '/v1'

async function probe(label: string, url: string, token: string) {
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cache: 'no-store' })
    const text = await r.text()
    let sample: any = text
    try { sample = JSON.parse(text) } catch {}
    // Trim big/PII-heavy bodies: keep top-level keys + a shallow shape rather than full records.
    let shape: any = sample
    if (sample && typeof sample === 'object') {
      const top = Array.isArray(sample) ? { _array: true, len: sample.length, first: sample[0] } : sample
      shape = JSON.parse(JSON.stringify(top))
      const s = JSON.stringify(shape)
      if (s.length > 1500) shape = { keys: Object.keys(top || {}), note: 'truncated', head: s.slice(0, 1200) }
    } else {
      shape = String(sample).slice(0, 800)
    }
    return { label, url, status: r.status, shape }
  } catch (e: any) {
    return { label, url, status: 0, error: String(e?.message || e).slice(0, 300) }
  }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let token = ''
  try { token = await getToken() } catch (e: any) {
    return NextResponse.json({ error: 'guesty token failed: ' + String(e?.message || e).slice(0, 300) }, { status: 500 })
  }

  const results: any[] = []
  const owners = await probe('owners', `${V1}/owners?limit=10`, token)
  results.push(owners)

  // Extract a sample owner id from whatever shape /owners returned.
  let ownerId: string | null = null
  const s: any = owners.shape
  const arr = s?.results || s?.data || (s?._array ? [s.first] : (Array.isArray(s) ? s : null))
  if (Array.isArray(arr) && arr[0]) ownerId = arr[0]._id || arr[0].id || null
  results.push({ label: 'firstOwnerId', ownerId })

  if (ownerId) {
    results.push(await probe('owner-detail', `${V1}/owners/${ownerId}`, token))
    results.push(await probe('owner-documents', `${V1}/owners/${ownerId}/documents`, token))
    results.push(await probe('owner-statements', `${V1}/owners/${ownerId}/statements`, token))
  }
  results.push(await probe('owners-reservations', `${V1}/owners/reservations?limit=2`, token))
  results.push(await probe('accounting-journal', `${ROOT}/accounting-api/journal-entries?limit=2`, token))
  results.push(await probe('statements-v1', `${V1}/statements?limit=2`, token))

  return NextResponse.json({ ok: true, results })
}
