// app/api/homebase/probe/route.ts
// One-time verification endpoint. Deploy with HOMEBASE_API_KEY set, then open
// /api/homebase/probe while signed in. It reports which endpoints answered and
// echoes ONE sample shift (name redacted) so we can confirm the field shapes
// against the real account — then wire the brief and delete this route.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
const BASE = process.env.HOMEBASE_BASE_URL || 'https://app.joinhomebase.com/api/public'

async function probe(path: string) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${process.env.HOMEBASE_API_KEY}`,
        Accept: 'application/vnd.homebase-v1+json',
      },
      cache: 'no-store',
    })
    const text = await r.text()
    let sample: any = null
    try {
      const j = JSON.parse(text)
      const a = Array.isArray(j) ? j : j?.data ?? j?.shifts ?? j?.locations ?? j?.employees
      sample = Array.isArray(a) && a[0]
        ? { count: a.length, keysOfFirst: Object.keys(a[0]) }
        : { topLevelKeys: Object.keys(j) }
    } catch { sample = { raw: text.slice(0, 120) } }
    return { status: r.status, sample }
  } catch (e: any) {
    return { error: String(e?.message || e) }
  }
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!process.env.HOMEBASE_API_KEY)
    return NextResponse.json({ error: 'HOMEBASE_API_KEY not set in this environment' })

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const locations = await probe('/locations')

  // Pull a location uuid out of whatever /locations returned, then probe shifts.
  let shifts: any = { skipped: 'no location uuid found' }
  try {
    const r = await fetch(`${BASE}/locations`, {
      headers: {
        Authorization: `Bearer ${process.env.HOMEBASE_API_KEY}`,
        Accept: 'application/vnd.homebase-v1+json',
      }, cache: 'no-store',
    })
    const j = await r.json()
    const a = Array.isArray(j) ? j : j?.data ?? j?.locations ?? []
    const uuid = a?.[0]?.uuid ?? a?.[0]?.id
    if (uuid)
      shifts = await probe(`/locations/${uuid}/shifts?start_date=${today}&end_date=${today}`)
  } catch (e: any) { shifts = { error: String(e?.message || e) } }

  return NextResponse.json({ ok: true, today, locations, shifts })
}
