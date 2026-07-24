// Breezeway property directory — so a glitch can be pushed to a BUILDING-level property
// (e.g. "Rustic Exterior" = the Rustic building) instead of the guest's unit. Read-only.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { bzApi, breezewayConfigured } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

let cache: { at: number; props: { id: number; name: string }[] } | null = null

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!breezewayConfigured()) return NextResponse.json({ ok: false, error: 'Breezeway not configured.' }, { status: 503 })
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return NextResponse.json({ ok: true, properties: cache.props, count: cache.props.length, cached: true })
  try {
    const props: { id: number; name: string }[] = []
    for (let page = 1; page <= 8; page++) {
      const r = await bzApi('/property?limit=100&page=' + page)
      if (!r.ok) break
      const results = Array.isArray(r.data?.results) ? r.data.results : []
      for (const p of results) { const nm = p && (p.name || p.display); if (p && p.id && nm) props.push({ id: Number(p.id), name: String(nm) }) }
      if (results.length < 100) break
    }
    props.sort((a, b) => a.name.localeCompare(b.name))
    cache = { at: Date.now(), props }
    return NextResponse.json({ ok: true, properties: props, count: props.length })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
