// GARDEN REVENUE & DISTRIBUTION (lib/garden/revenue). GET ?from=&to=&ahead=&scope=all|garden|botanica  (&depth=1 → the in-depth report)
//                      also ch, rt, wing (| separated), los, lead ("min-max"), origin — the filter bar (lib/garden/segments parseFilter)
//   POST { refresh: true }        → read Cloudbeds now (lib/garden/revenue-share)
//   POST { share: 'status' | 'mint' | 'off' } → the passcode link for the revenue team (owner of Reports only)
//   POST { from, to }  → read that stretch (16 days at most) from Cloudbeds into the mirror, for a period
//                        before the hotel was connected (lib/garden/sync backfillReservations).
import { NextRequest, NextResponse } from 'next/server'
import { requireGarden } from '@/lib/garden/access'
import { gardenRevenue } from '@/lib/garden/revenue'
import { parseFilter } from '@/lib/garden/segments'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const D = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const gate = await requireGarden('reports', 'view')
  if (!gate.ok) return gate.res
  const sp = req.nextUrl.searchParams
  const sc = sp.get('scope'), scope = sc === 'garden' || sc === 'botanica' ? sc : 'all'
  const from = D.test(sp.get('from') || '') ? sp.get('from')! : undefined, to = D.test(sp.get('to') || '') ? sp.get('to')! : undefined
  const filter = parseFilter(sp)
  try {
    // ?nightly=1 → the night-by-night report for all three sides (lib/garden/nightly).
    if (sp.get('nightly')) { const { gardenNightly } = await import('@/lib/garden/nightly'); return NextResponse.json({ ok: true, ...(await gardenNightly()) }) }
    // ?depth=1 → the in-depth report for the period and scope (lib/garden/report-depth).
    if (sp.get('depth') && from && to) { const { gardenDepth } = await import('@/lib/garden/report-depth'); return NextResponse.json({ ok: true, ...(await gardenDepth(from, to >= from ? to : from, scope, filter)) }) }
    return NextResponse.json({ ok: true, ...(await gardenRevenue({ from, to, ahead: Number(sp.get('ahead')) || undefined, scope, filter })) })
  } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e) }) }
}

export async function POST(req: NextRequest) {
  const gate = await requireGarden('reports', 'view')
  if (!gate.ok) return gate.res
  const b: any = await req.json().catch(() => ({}))
  if (b?.refresh) { const { refreshFromCloudbeds } = await import('@/lib/garden/revenue-share'); return NextResponse.json(await refreshFromCloudbeds()) }
  if (b?.share) {
    // The link hands the hotel's revenue to people outside Lighthouse: only someone with full rights on Reports makes or ends it.
    const full = await requireGarden('reports', 'full')
    if (!full.ok) return NextResponse.json({ ok: false, error: 'Only a Reports owner can share this report.' }, { status: 403 })
    const S = await import('@/lib/garden/revenue-share')
    const who = (full as any).access?.email ? String((full as any).access.email) : null
    try {
      if (b.share === 'mint') { const m = await S.mintRevPasscode(who); return NextResponse.json({ ok: true, ...m, ...(await S.revLinkStatus()) }) }
      if (b.share === 'off') { await S.closeRevLink(); return NextResponse.json({ ok: true, ...(await S.revLinkStatus()) }) }
      await S.ensureRevLink(who)
      return NextResponse.json({ ok: true, ...(await S.revLinkStatus()) })
    } catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 }) }
  }
  const from = String(b?.from || ''), to = String(b?.to || '')
  if (!D.test(from) || !D.test(to) || to < from) return NextResponse.json({ ok: false, error: 'from and to (YYYY-MM-DD) required' }, { status: 400 })
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 16) return NextResponse.json({ ok: false, error: 'Ask for 16 days at most at a time.' }, { status: 400 })
  try { const { backfillReservations } = await import('@/lib/garden/sync'); return NextResponse.json({ ok: true, ...(await backfillReservations(from, to)) }) }
  catch (e: any) { return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 }) }
}
