// THE REVENUE REPORT BY LINK — the data behind /report/garden-revenue (lib/garden/revenue-share).
//   GET  ?from=&to=&ahead=&scope=&ch=&rt=&wing=&los=&lead=&origin=   (&depth=1 → the in-depth report and the views data)
//   POST { refresh: true }   read Cloudbeds now (at most once every three minutes)
// Opens on the link's own passcode (or a Lighthouse login). No guest names leave this route.
import { NextRequest, NextResponse } from 'next/server'
import { linkGate } from '@/lib/passcode-gate'
import { gardenRevenue } from '@/lib/garden/revenue'
import { parseFilter } from '@/lib/garden/segments'
import { REV_LINK, forLink, refreshFromCloudbeds } from '@/lib/garden/revenue-share'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const D = /^\d{4}-\d{2}-\d{2}$/
const MAX_DAYS = 800

export async function GET(req: NextRequest) {
  const gate = await linkGate(REV_LINK, { kinds: [REV_LINK] })
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const sc = sp.get('scope'), scope = sc === 'garden' || sc === 'botanica' ? sc : 'all'
  const from = D.test(sp.get('from') || '') ? sp.get('from')! : undefined, to = D.test(sp.get('to') || '') ? sp.get('to')! : undefined
  if (from && to && (Date.parse(to) - Date.parse(from)) / 86400000 > MAX_DAYS) return NextResponse.json({ ok: false, error: 'Pick a period of two years or less.' })
  const filter = parseFilter(sp)
  try {
    if (sp.get('depth') && from && to) { const { gardenDepth } = await import('@/lib/garden/report-depth'); return NextResponse.json(forLink({ ok: true, ...(await gardenDepth(from, to >= from ? to : from, scope, filter)) })) }
    return NextResponse.json(forLink({ ok: true, ...(await gardenRevenue({ from, to, ahead: Number(sp.get('ahead')) || undefined, scope, filter })) }))
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }) }
}

export async function POST(req: NextRequest) {
  const gate = await linkGate(REV_LINK, { kinds: [REV_LINK], touch: false })
  if (!gate.ok) return gate.res
  const b: any = await req.json().catch(() => ({}))
  if (!b?.refresh) return NextResponse.json({ ok: false, error: 'Nothing to do.' }, { status: 400 })
  return NextResponse.json(await refreshFromCloudbeds())
}
