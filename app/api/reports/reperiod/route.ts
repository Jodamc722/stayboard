// Change an existing owner report's reporting period IN PLACE (P13).
// POST { id, from: YYYY-MM-DD, to: YYYY-MM-DD }
//
// Recomputes every period-dependent section (snapshot metrics + cards, month-by-month,
// per-listing breakdown) for the new window and writes it back to the SAME report row —
// same id, same /r/<code> share link. Nothing is minted, so a link already sent to an owner
// keeps working and simply shows the new window.
//
// Narrative copy (hero headline, AI sections, voices, projects, statement) is left alone:
// it's the operator's text, and silently rewriting it on a date tweak would be worse than
// leaving it for them to edit.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveScope, pullReservations, metricsFor, fmtK } from '@/lib/owner-report'
import { hasEditCookie } from '@/lib/edit-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
function nextMonthIso(iso: string): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  return (m >= 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0')) + '-01'
}
function monthLabel(iso: string): string {
  return new Date(iso.slice(0, 7) + '-15T12:00:00Z')
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase()
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !hasEditCookie()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id)
  const from = str(body?.from)
  const to = str(body?.to)
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return NextResponse.json({ error: 'id + from/to (YYYY-MM-DD, from ≤ to) required' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const { data } = await db.from('owner_reports').select('id, listing_ids, content').eq('id', id).limit(1)
  const rep = (data || [])[0] as any
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })

  const content: any = (rep.content && typeof rep.content === 'object') ? rep.content : {}
  // Same exclusion set the rest of the report already honours, so occupancy denominators match.
  const exclude: string[] = Array.isArray(content.excludeListings) ? content.excludeListings.map(String) : []
  const ids: string[] = (Array.isArray(rep.listing_ids) ? rep.listing_ids : [])
    .map((x: any) => String(x)).filter(Boolean)
    .filter((lid: string) => exclude.indexOf(lid) < 0)
    .slice(0, 80)
  if (!ids.length) return NextResponse.json({ error: 'this report has no listings to recompute' }, { status: 400 })

  const scope = await resolveScope(ids, [])
  const units = scope.listings.length
  const toExcl = nextDay(to)
  const resv = await pullReservations(scope.listings.map(l => l.id), from, toExcl)
  const period = metricsFor(resv, units, from, toExcl)

  // ---- snapshot: raw metrics drive every basis; card strings stay in sync as the fallback ----
  content.meta = Object.assign({}, content.meta, { periodStart: from, periodEnd: to, activeListings: units })
  content.snapshot = content.snapshot || {}
  content.snapshot.metrics = {
    accomNum: period.accomRevenue, accomGrossNum: period.accomGrossRevenue,
    cleaningNum: period.cleaningRevenue, feeNum: period.channelFees,
    occNights: period.occupiedNights, availNights: period.availableNights,
    reservations: period.reservations, units, occPct: period.occupancyPct,
  }
  const cardVal: Record<string, string> = {
    revenue: fmtK(period.accomRevenue),
    occupancy: period.occupancyPct + '%',
    adr: '$' + period.adr,
    revpar: '$' + period.revpar,
  }
  const cardGross: Record<string, string> = {
    revenue: fmtK(period.grossRevenue), adr: '$' + period.grossAdr, revpar: '$' + period.grossRevpar,
  }
  if (Array.isArray(content.snapshot.cards)) {
    content.snapshot.cards = content.snapshot.cards.map((c: any) => {
      const k = str(c?.key)
      if (!(k in cardVal)) return c
      const next = Object.assign({}, c, { value: cardVal[k] })
      if (k in cardGross) next.gross = cardGross[k]
      return next
    })
  }

  // ---- month-by-month (only surfaced when the new window spans 2+ calendar months) ----
  const byMonth: any[] = []
  let mIso = from.slice(0, 7) + '-01'
  for (let guard = 0; mIso <= to && guard < 36; guard++) {
    const mNext = nextMonthIso(mIso)
    const mFrom = mIso < from ? from : mIso
    const mToExcl = mNext > toExcl ? toExcl : mNext
    const mm = metricsFor(resv, units, mFrom, mToExcl)
    byMonth.push({
      label: monthLabel(mIso), monthIso: mIso,
      revenue: fmtK(mm.accomRevenue), grossRevenue: fmtK(mm.grossRevenue),
      occPct: mm.occupancyPct, adr: '$' + mm.adr, grossAdr: '$' + mm.grossAdr, revpar: '$' + mm.revpar,
    })
    mIso = mNext
  }
  if (byMonth.length >= 2) content.byMonth = byMonth
  else delete content.byMonth

  // ---- per-listing breakdown, if the report already has one ----
  if (Array.isArray(content.byListing) && content.byListing.length > 0) {
    const byId: Record<string, any[]> = {}
    for (const r of resv) { (byId[r.listing_id] = byId[r.listing_id] || []).push(r) }
    content.byListing = scope.listings.map(l => {
      const m = metricsFor(byId[l.id] || [], 1, from, toExcl)
      return {
        id: l.id, name: l.unit ? ('Unit ' + l.unit) : l.name, unit: l.unit || '',
        bedrooms: l.bedrooms, building: l.building || '',
        revenue: fmtK(m.accomRevenue), grossRevenue: fmtK(m.grossRevenue), occPct: m.occupancyPct,
        adr: '$' + m.adr, grossAdr: '$' + m.grossAdr, revpar: '$' + m.revpar, grossRevpar: '$' + m.grossRevpar,
        reservations: m.reservations, revNum: m.accomRevenue,
        accomNum: m.accomRevenue, grossNum: m.grossRevenue, accomGrossNum: m.accomGrossRevenue,
        cleaningNum: m.cleaningRevenue, feeNum: m.channelFees,
        occNights: m.occupiedNights, availNights: m.availableNights,
      }
    }).sort((a, b) => b.revNum - a.revNum)
  }

  const { error } = await db.from('owner_reports')
    .update({ content, period_start: from, period_end: to, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, from, to, units, content })
}
