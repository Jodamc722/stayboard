// Breezeway sync + connectivity probe. Logged-in users only. Needs BREEZEWAY_CLIENT_ID /
// BREEZEWAY_CLIENT_SECRET in Vercel env (request an account API key from Breezeway).
// Probe-first: verify the token + property list + Guesty mapping, THEN the full task sync is
// built on the verified response shapes (same pattern used for the Guesty integration).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { breezewayConfigured, getBreezewayToken, bzApi, mapBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function asArray(d: any): any[] {
  if (Array.isArray(d)) return d
  if (Array.isArray(d?.results)) return d.results
  if (Array.isArray(d?.data)) return d.data
  return []
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!breezewayConfigured()) {
    return NextResponse.json({ error: 'Breezeway not configured — add BREEZEWAY_CLIENT_ID and BREEZEWAY_CLIENT_SECRET in Vercel env, then retry.' }, { status: 503 })
  }

  const params = new URL(req.url).searchParams
  const probe = params.get('probe')

  try {
    // 1) Verify the token handshake.
    if (probe === 'token') {
      await getBreezewayToken(true)
      return NextResponse.json({ ok: true, message: 'Breezeway token acquired.' })
    }

    // 2) List properties + check how many carry a Guesty listing id (reference_property_id).
    if (probe === 'properties') {
      const r = await bzApi('/property?limit=100&page=1')
      if (!r.ok) return NextResponse.json({ error: `Breezeway ${r.status}: ${r.text.slice(0, 200)}` }, { status: 502 })
      const arr = asArray(r.data)
      const total = r.data?.total_results ?? r.data?.total ?? arr.length
      const mapped = arr.filter((p: any) => p?.reference_property_id).length
      const sample = arr.slice(0, 4).map((p: any) => ({ id: p?.id, name: p?.name, reference_property_id: p?.reference_property_id ?? null }))
      return NextResponse.json({ ok: true, totalProperties: total, returned: arr.length, mappedToGuesty: mapped, sampleKeys: arr[0] ? Object.keys(arr[0]) : [], sample })
    }

    // 3) Sample tasks for one property (pass &property=<reference_property_id or home_id>).
    if (probe === 'tasks') {
      const pid = params.get('property')
      if (!pid) return NextResponse.json({ error: 'Pass &property=<reference_property_id or home_id> (get one from ?probe=properties).' }, { status: 400 })
      const byHome = params.get('by') === 'home'
      const q = byHome ? `home_id=${encodeURIComponent(pid)}` : `reference_property_id=${encodeURIComponent(pid)}`
      const r = await bzApi(`/task/?${q}&limit=25&sort_by=created_at&sort_order=desc`)
      if (!r.ok) return NextResponse.json({ error: `Breezeway ${r.status}: ${r.text.slice(0, 200)}` }, { status: 502 })
      const arr = asArray(r.data)
      return NextResponse.json({ ok: true, count: arr.length, totalResults: r.data?.total_results ?? null, sampleKeys: arr[0] ? Object.keys(arr[0]) : [], sample: arr.slice(0, 3).map(mapBreezewayTask) })
    }

    // 4) People (cleaners / inspectors).
    if (probe === 'people') {
      const r = await bzApi('/people?limit=100')
      if (!r.ok) return NextResponse.json({ error: `Breezeway ${r.status}: ${r.text.slice(0, 200)}` }, { status: 502 })
      const arr = asArray(r.data)
      return NextResponse.json({ ok: true, count: arr.length, sample: arr.slice(0, 5).map((p: any) => ({ id: p?.id, name: p?.name, employee_code: p?.employee_code ?? null })) })
    }

    return NextResponse.json({
      error: 'Specify a probe first: ?probe=token, ?probe=properties, ?probe=people, or ?probe=tasks&property=ID. The full sync (into breezeway_properties / breezeway_people / breezeway_tasks) is wired up once these confirm the API shapes + Guesty mapping.',
    }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = POST
