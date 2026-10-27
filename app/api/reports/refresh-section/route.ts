// Re-derive ONE slide of a live owner report from source, in place.
// POST { id, section } -> { ok, section, label, content, summary }
//
// WHY (Jon, 2026-10-27): "on the most recent 17 West owner report, the budget slide — I
// accidentally deleted one of the months. Can we please have a refresh button on that... we
// should actually have refreshes on all of the slides. That way, if the data has changed, we can
// click refresh and then have it say, are you sure?"
//
// A report's figures are frozen at generate time so an owner's link keeps saying what we sent
// them. That is right until someone edits the slide by hand, or the mirror catches up with a
// late reservation — and then the only way back was to mint a whole new report and lose the
// /r/<code> link. This writes the recomputed section back to the SAME row: same id, same share
// link, every other slide untouched.
//
// WHAT A REFRESH REPLACES: the figures, rows and months of that one section, computed from the
// report's own scope, period and as-of date. WHAT IT KEEPS: the written copy — the section
// headline, its subtitle, and any note typed on a month. Numbers are ours; sentences are the
// operator's. The caller confirms before calling, because a hand-corrected figure on the
// refreshed section does not survive.
//
// Sections that have no source to re-derive from are refused by name rather than silently doing
// nothing: `pacing` is read off an uploaded PriceLabs PDF, and the written slides (verdict,
// voices, recs, projects) come out of the generator's AI pass.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  resolveScope, pullReservations, metricsFor, fmtK, monthsAhead, planSectionFor, etToday,
} from '@/lib/owner-report'
import { buildStatementSection } from '@/lib/statement-section'
import { basisTriple, isBasis, BASIS_NOTE, type Basis } from '@/lib/basis'
import { paceStatus } from '@/lib/pacing'
import { hasEditCookie } from '@/lib/edit-access'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
function nextMonthIso(iso: string): string {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  return (m >= 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0')) + '-01'
}
function monthLabel(iso: string): string {
  return new Date(iso.slice(0, 7) + '-15T12:00:00Z')
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase()
}

/** The slides a refresh can rebuild, and what each one is called on the deck. */
const LABEL: Record<string, string> = {
  snapshot: 'Snapshot',
  listings: 'By listing',
  plan: 'Budget',
  ahead: 'Looking ahead',
  statement: 'Owner statement',
}
/** Named refusals, so the UI can say why instead of showing a button that does nothing. */
const NO_SOURCE: Record<string, string> = {
  pacing: 'The pacing slide is read off an uploaded PriceLabs PDF — upload a new one to change it.',
  verdict: 'That slide is written, not computed — use Ask AI to rewrite it.',
  voices: 'Guest voices is written from the reviews by the AI pass — use Pull reviews, or Ask AI.',
  recs: 'That slide is written, not computed — use Ask AI to rewrite it.',
  projects: 'The work slide is written from the task log by the AI pass — use Ask AI to rewrite it.',
  projection: 'The projection comes from Money → Projections — rebuild it there.',
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('reports', 'edit')
  if (!gate.ok && !hasEditCookie()) return gate.res

  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id)
  const section = str(body?.section)
  if (!id || !section) return NextResponse.json({ error: 'id + section required' }, { status: 400 })
  if (NO_SOURCE[section]) return NextResponse.json({ error: NO_SOURCE[section] }, { status: 400 })
  if (!LABEL[section]) return NextResponse.json({ error: 'That slide cannot be refreshed.' }, { status: 400 })

  const db = supabaseAdmin()
  const { data } = await db.from('owner_reports')
    .select('id, listing_ids, scope_label, period_start, period_end, as_of, content').eq('id', id).limit(1)
  const rep = (data || [])[0] as any
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })

  const content: any = (rep.content && typeof rep.content === 'object') ? rep.content : {}
  const meta: any = content.meta || {}
  const from = str(meta.periodStart) || str(rep.period_start)
  const to = str(meta.periodEnd) || str(rep.period_end)
  const asOf = str(meta.asOf) || str(rep.as_of) || etToday()
  const scopeLabel = str(meta.scopeLabel) || str(rep.scope_label)

  // Same exclusion set the rest of the report honours, so occupancy denominators match.
  const exclude: string[] = Array.isArray(content.excludeListings) ? content.excludeListings.map(String) : []
  const ids: string[] = (Array.isArray(rep.listing_ids) ? rep.listing_ids : [])
    .map((x: any) => String(x)).filter(Boolean).filter((lid: string) => exclude.indexOf(lid) < 0).slice(0, 80)
  if (!ids.length) return NextResponse.json({ error: 'this report has no listings to recompute' }, { status: 400 })

  const scope = await resolveScope(ids, [])
  const listings = scope.listings
  const units = listings.length
  let summary = ''

  // ── THE BUDGET SLIDE ────────────────────────────────────────────────────────
  // The section Jon asked for. planSectionFor() is the generator's own builder, so a month he
  // deleted by hand comes back exactly as it was first written, with today's actuals in it.
  if (section === 'plan') {
    const buildings: string[] = []
    for (const l of listings) if (l.building && buildings.indexOf(l.building) < 0) buildings.push(l.building)
    const next = await planSectionFor(ids, buildings, asOf, units)
    if (!next || !next.months.length) {
      return NextResponse.json({ error: 'No budget rows for this scope — set the budget on Money → Budgets, then refresh.' }, { status: 400 })
    }
    const old: any = content.plan || {}
    // Copy survives the figures: a note typed on a month stays with that month, and an edited
    // headline stays on the slide.
    const noteOf: Record<string, string> = {}
    for (const m of (Array.isArray(old.months) ? old.months : [])) {
      const k = str(m?.label)
      if (k && str(m?.note) && !/^On the books so far/.test(str(m.note))) noteOf[k] = str(m.note)
    }
    content.plan = {
      headline: str(old.headline) || next.headline,
      subtitle: str(old.subtitle) || next.subtitle,
      months: next.months.map(m => (noteOf[m.label] ? { ...m, note: noteOf[m.label] } : m)),
      ...(old.view ? { view: old.view } : {}),
    }
    // TYPED-OVER FIGURES ON THIS SLIDE GO WITH THE FIGURES (2026-10-27). A refresh says the
    // numbers are rebuilt from source; an override sitting in front of one would quietly keep
    // printing the old answer over the new one. Only the figures are dropped — the slide's copy
    // (its title, the month notes, the live-month line) is keyed separately and stays. The
    // legacy plan_<monthIndex>_<rowIndex>_* keys are dropped too: those are from before
    // overrides were keyed by month and metric, and they belong to a position, not a row.
    if (content.ov && typeof content.ov === 'object') {
      for (const k of Object.keys(content.ov)) {
        if (/^plan_\d+_\d+_/.test(k) || /^plan_.+_(actual|delta|pct)$/.test(k)) delete content.ov[k]
      }
    }
    summary = next.months.length + ' budget month' + (next.months.length === 1 ? '' : 's')
      + ' rebuilt (' + next.months.map(m => m.label).join(', ') + ').'
  }

  // ── THE SNAPSHOT ───────────────────────────────────────────────────────────
  // Period metrics for the report's own window, in the basis the report is configured to show —
  // the same basisTriple() the renderer uses, so the persisted strings and the visible cards can
  // never report two different bases.
  if (section === 'snapshot') {
    const toExcl = nextDay(to)
    const resv = await pullReservations(ids, from, toExcl)
    const period = metricsFor(resv, units, from, toExcl)
    const snap = content.snapshot || (content.snapshot = {})
    snap.metrics = {
      accomNum: period.accomRevenue, accomGrossNum: period.accomGrossRevenue,
      cleaningNum: period.cleaningRevenue, feeNum: period.channelFees,
      occNights: period.occupiedNights, availNights: period.availableNights,
      reservations: period.reservations, units, occPct: period.occupancyPct,
    }
    const bCfg = content.basis || {}
    const primary: Basis = isBasis(bCfg.snapshotPrimary) ? bCfg.snapshotPrimary : (isBasis(bCfg.default) ? bCfg.default : 'netota')
    const raw = {
      accomNum: period.accomRevenue, accomGrossNum: period.accomGrossRevenue,
      cleaningNum: period.cleaningRevenue, feeNum: period.channelFees,
      occNights: period.occupiedNights, availNights: period.availableNights,
    }
    const shown = basisTriple(raw, primary), gross = basisTriple(raw, 'gross')
    const val: Record<string, string> = { revenue: fmtK(shown.revenue), occupancy: period.occupancyPct + '%', adr: '$' + shown.adr, revpar: '$' + shown.revpar }
    const grossVal: Record<string, string> = { revenue: fmtK(gross.revenue), adr: '$' + gross.adr, revpar: '$' + gross.revpar }
    const sub: Record<string, string> = {
      revenue: BASIS_NOTE[primary] + ' · Gross (incl. cleaning + channel fees): ' + grossVal.revenue,
      occupancy: 'Occupied ÷ available nights',
      adr: 'Accommodation ÷ occupied nights · Gross ADR: ' + grossVal.adr,
      revpar: 'Accommodation ÷ available nights · Gross RevPAR: ' + grossVal.revpar,
    }
    if (Array.isArray(snap.cards)) {
      snap.cards = snap.cards.map((card: any) => {
        const k = str(card?.key)
        if (!(k in val)) return card
        const nextCard = Object.assign({}, card, { value: val[k], sub: sub[k] })
        if (k in grossVal) nextCard.gross = grossVal[k]
        // A typed override on a card is the operator deliberately printing something else; a
        // refresh of the numbers behind it does not get to clear it.
        return nextCard
      })
    }
    // The month-by-month cards come off the same reservations, so they move together.
    const byMonth: any[] = []
    let mIso = from.slice(0, 7) + '-01'
    for (let guard = 0; mIso <= to && guard < 36; guard++) {
      const mNext = nextMonthIso(mIso)
      const mm = metricsFor(resv, units, mIso < from ? from : mIso, mNext > toExcl ? toExcl : mNext)
      byMonth.push({
        label: monthLabel(mIso), monthIso: mIso,
        revenue: fmtK(mm.accomRevenue), grossRevenue: fmtK(mm.grossRevenue),
        occPct: mm.occupancyPct, adr: '$' + mm.adr, grossAdr: '$' + mm.grossAdr, revpar: '$' + mm.revpar,
        accomNum: mm.accomRevenue, accomGrossNum: mm.accomGrossRevenue, cleaningNum: mm.cleaningRevenue,
        feeNum: mm.channelFees, occNights: mm.occupiedNights, availNights: mm.availableNights,
      })
      mIso = mNext
    }
    if (byMonth.length >= 2) content.byMonth = byMonth
    summary = 'Snapshot rebuilt for ' + from + ' → ' + to + ' — ' + period.occupancyPct + '% occupancy, '
      + fmtK(shown.revenue) + ' revenue, ' + period.reservations + ' reservations.'
  }

  // ── PER-LISTING ────────────────────────────────────────────────────────────
  if (section === 'listings') {
    const toExcl = nextDay(to)
    const resv = await pullReservations(ids, from, toExcl)
    const byId: Record<string, any[]> = {}
    for (const r of resv) { (byId[r.listing_id] = byId[r.listing_id] || []).push(r) }
    content.byListing = listings.map(l => {
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
    summary = content.byListing.length + ' listing' + (content.byListing.length === 1 ? '' : 's') + ' rebuilt for ' + from + ' → ' + to + '.'
  }

  // ── LOOKING AHEAD ──────────────────────────────────────────────────────────
  // On-the-books by stay month, as of today's mirror. The per-month notes are written copy and
  // follow their month across the refresh.
  if (section === 'ahead') {
    const mAhead = await monthsAhead(ids, asOf, units, 6)
    if (!mAhead.length) return NextResponse.json({ error: 'nothing on the books to recompute' }, { status: 400 })
    const aheadRaw = (m: any) => ({
      accomNum: m.accomRevenue, accomGrossNum: m.accomGrossRevenue, cleaningNum: m.cleaningRevenue,
      feeNum: m.channelFees, occNights: m.occupiedNights, availNights: m.availableNights,
    })
    const old: any = content.ahead || {}
    const noteOf: Record<string, string> = {}
    for (const m of (Array.isArray(old.months) ? old.months : [])) {
      const k = str(m?.label); if (k && str(m?.note)) noteOf[k] = str(m.note)
    }
    const cur = mAhead[1], nxt = mAhead[2]
    const asOfDay = Number(String(asOf).slice(8, 10)) || 1
    const nxt2 = asOfDay > 19 ? mAhead[3] : null
    const card = (x: any, ahead: number) => x ? {
      label: x.label.toUpperCase(),
      status: paceStatus(x.m.occupancyPct, ahead === 0, ahead || undefined),
      occPct: x.m.occupancyPct, adr: '$' + x.m.adr, revpar: '$' + x.m.revpar,
      note: noteOf[x.label.toUpperCase()] || '',
      ...aheadRaw(x.m),
    } : null
    content.ahead = {
      headline: str(old.headline) || 'On-the-books by stay month.',
      subtitle: str(old.subtitle) || 'On-the-books occupancy by stay month',
      months: [card(cur, 0), card(nxt, 1), card(nxt2, 2)].filter(Boolean),
      strip: mAhead.map(m => ({
        month: m.short, label: m.label, iso: m.iso, occPct: m.m.occupancyPct,
        adr: '$' + m.m.adr, revpar: '$' + m.m.revpar,
        grossAdr: '$' + m.m.grossAdr, grossRevpar: '$' + m.m.grossRevpar,
        reservations: m.m.reservations, ...aheadRaw(m.m),
      })),
    }
    summary = 'On-the-books rebuilt through ' + mAhead[mAhead.length - 1].label + '.'
  }

  // ── OWNER STATEMENT ────────────────────────────────────────────────────────
  // The generator was handed the statements by id from the picker, and those ids are not stored
  // on the report. The owner-months ARE — owner name plus period month — so the same statements
  // are found again from the section's own rows and re-aggregated through the ledger mirror.
  if (section === 'statement') {
    const old: any = content.statement || {}
    const months = Array.from(new Set((Array.isArray(old.months) ? old.months : []).map((m: any) => str(m?.month)).filter(Boolean)))
    const names = Array.from(new Set((Array.isArray(old.owners) ? old.owners : []).map((o: any) => str(o?.ownerName)).filter(Boolean)))
    if (!months.length) {
      return NextResponse.json({ error: 'This statement slide does not record which months it covers, so it cannot be refreshed — regenerate the report to change it.' }, { status: 400 })
    }
    let q = db.from('guesty_owner_statements').select('id, owner_name, period_month').in('period_month', months)
    if (names.length) q = q.in('owner_name', names)
    const { data: stmts } = await q
    const sids = ((stmts || []) as any[]).map(s => String(s.id)).filter(Boolean).slice(0, 60)
    if (!sids.length) {
      return NextResponse.json({ error: 'No owner statements found for ' + months.join(', ') + ' — run the owner-statement sync, then refresh.' }, { status: 400 })
    }
    const next = await buildStatementSection(sids, scopeLabel)
    if (!next) return NextResponse.json({ error: 'The owner ledger has nothing for those months yet — run the owner-statement sync, then refresh.' }, { status: 400 })
    content.statement = {
      ...next,
      headline: str(old.headline) || next.headline,
      subtitle: str(old.subtitle) || next.subtitle,
      note: str(old.note) || next.note,
    }
    summary = sids.length + ' statement' + (sids.length === 1 ? '' : 's') + ' re-aggregated across ' + months.join(', ') + '.'
  }

  const { error } = await db.from('owner_reports')
    .update({ content, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, section, label: LABEL[section], summary, content })
}
