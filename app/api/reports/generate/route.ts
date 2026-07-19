// Owner Report generator. POST { listingIds?, buildings?, periodStart, periodEnd, asOf?, title? }
// -> assembles all sections from the Supabase mirrors (deterministic math in lib/owner-report),
// runs ONE AI pass for narrative (headlines, quote picks, hearing/doing themes, project
// categorization) in the deck's voice, inserts an owner_reports row and returns { id, code }.
// Performance vs Plan is included ONLY when owner_budgets rows exist for the scope (17 West today).
// Pacing vs Market + Owner Statement sections are added later via uploads (P3) — null here.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  resolveScope, pullReservations, metricsFor, fmtK, ytdStats, monthsAhead,
  pullBudgets, pullReviews, pullTasks, weekBuckets, makeCode, etToday,
} from '@/lib/owner-report'
import type { ReportContent, ReportListing } from '@/lib/owner-report'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MODEL = 'claude-opus-4-8'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function prettyDate(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

async function anthropic(payload: any): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) return null
    return Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : null
  } catch { return null }
}

function parseJson(text: string | null): any | null {
  if (!text) return null
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingIds: string[] = Array.isArray(body?.listingIds) ? body.listingIds.map((x: any) => String(x)).filter(Boolean) : []
  const buildings: string[] = Array.isArray(body?.buildings) ? body.buildings.map((x: any) => String(x)).filter(Boolean) : []
  const periodStart = str(body?.periodStart)
  const periodEnd = str(body?.periodEnd)
  const asOf = str(body?.asOf) || etToday()
  const theme = str(body?.theme) || 'capri'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd) {
    return NextResponse.json({ error: 'periodStart/periodEnd (YYYY-MM-DD) required' }, { status: 400 })
  }
  if (!listingIds.length && !buildings.length) {
    return NextResponse.json({ error: 'listingIds or buildings required' }, { status: 400 })
  }

  // ---- scope ----
  const scope = await resolveScope(listingIds, buildings)
  const listings = scope.listings
  if (!listings.length) return NextResponse.json({ error: 'no active listings matched the scope' }, { status: 400 })
  const ids = listings.map(l => l.id)
  const byId: Record<string, ReportListing> = {}
  for (const l of listings) byId[l.id] = l
  const units = listings.length
  const scopeLabel = str(body?.scopeLabel) || scope.scopeLabel

  // ---- period metrics ----
  const toExcl = addDaysIso(periodEnd, 1)
  const resv = await pullReservations(ids, periodStart, toExcl)
  const period = metricsFor(resv, units, periodStart, toExcl)
  const daysRemaining = asOf >= periodStart && asOf <= periodEnd ? Math.max(0, Math.round((Date.parse(periodEnd + 'T00:00:00Z') - Date.parse(asOf + 'T00:00:00Z')) / 86_400_000)) : 0

  // ---- YTD + months ahead ----
  const ytd = await ytdStats(ids, asOf, units)
  const mAhead = await monthsAhead(ids, asOf, units, 6) // [prev, current, +1..+5]

  // ---- budgets (Performance vs Plan only if rows exist) ----
  const scopeBuildings: string[] = []
  for (const l of listings) if (scopeBuildings.indexOf(l.building) < 0) scopeBuildings.push(l.building)
  const planMonthIsos = mAhead.slice(0, 3).map(m => m.iso) // prev-2? deck shows 2 closed + in-month; we have prev + current from mAhead
  // widen: include the month before prev for a 3-month view
  const prevPrev = mAhead[0] ? addDaysIso(mAhead[0].iso, -1).slice(0, 7) + '-01' : null
  const wantIsos = (prevPrev ? [prevPrev] : []).concat(planMonthIsos)
  const budgets = await pullBudgets(scopeBuildings, wantIsos)

  let plan: ReportContent['plan'] = null
  if (Object.keys(budgets).length > 0) {
    const monthsOut: { label: string; status: string; rows: { metric: string; actual: string; budget: string; delta: string; good: boolean }[]; note: string }[] = []
    const candidates: { iso: string; endExcl: string }[] = []
    if (prevPrev) candidates.push({ iso: prevPrev, endExcl: mAhead[0].iso })
    candidates.push({ iso: mAhead[0].iso, endExcl: mAhead[1].iso })
    candidates.push({ iso: mAhead[1].iso, endExcl: addDaysIso(mAhead[2] ? mAhead[2].iso : mAhead[1].iso, 0) })
    for (const c of candidates) {
      const b = budgets[c.iso]
      if (!b) continue
      const mresv = await pullReservations(ids, c.iso, c.endExcl)
      const mm = metricsFor(mresv, units, c.iso, c.endExcl)
      const inMonth = asOf >= c.iso && asOf < c.endExcl
      const rows: { metric: string; actual: string; budget: string; delta: string; good: boolean }[] = []
      if (b.occupancy_pct != null) {
        const d = mm.occupancyPct - Number(b.occupancy_pct)
        rows.push({ metric: 'Occupancy', actual: mm.occupancyPct + '%', budget: 'vs ' + Math.round(Number(b.occupancy_pct)) + '%', delta: (d >= 0 ? '+' : '−') + Math.abs(Math.round(d)) + ' pts', good: d >= 0 })
      }
      if (b.adr != null) {
        const d = mm.grossAdr - Number(b.adr)
        rows.push({ metric: 'ADR', actual: '$' + mm.grossAdr, budget: 'vs $' + Math.round(Number(b.adr)), delta: (d >= 0 ? '+$' : '−$') + Math.abs(Math.round(d)), good: d >= 0 })
      }
      if (b.revpar != null) {
        const d = mm.grossRevpar - Number(b.revpar)
        rows.push({ metric: 'RevPAR', actual: '$' + mm.grossRevpar, budget: 'vs $' + Math.round(Number(b.revpar)), delta: (d >= 0 ? '+$' : '−$') + Math.abs(Math.round(d)), good: d >= 0 })
      }
      if (b.gross_revenue != null) {
        const d = mm.grossRevenue - Number(b.gross_revenue)
        rows.push({ metric: 'Gross Rev', actual: fmtK(mm.grossRevenue), budget: 'vs ' + fmtK(Number(b.gross_revenue)), delta: (d >= 0 ? '+' : '−') + fmtK(Math.abs(Math.round(d))).replace('$', '$'), good: d >= 0 })
      }
      if (!rows.length) continue
      const mLabel = new Date(c.iso.slice(0, 7) + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase()
      monthsOut.push({ label: mLabel, status: inMonth ? 'IN MONTH' : 'CLOSED', rows, note: '' })
    }
    if (monthsOut.length) {
      plan = { headline: 'Tracking against the ' + asOf.slice(0, 4) + ' budget.', subtitle: '', months: monthsOut }
    }
  }

  // ---- reviews + tasks ----
  const reviewFrom = addDaysIso(periodStart, -14) // small lookback so a slow review week still fills the section
  const reviews = await pullReviews(ids, reviewFrom, asOf)
  const tasks = await pullTasks(ids, byId, periodStart, periodEnd)
  const buckets = weekBuckets(periodStart, periodEnd)

  // ---- AI narrative pass (single call; template fallback) ----
  const goodReviews = reviews.filter(r => (r.rating == null || r.rating >= 4.2) && r.content && r.content.length > 15).slice(0, 30)
  const reviewLines = goodReviews.map((r, i) => {
    const l = r.listing_id ? byId[r.listing_id] : undefined
    const unit = l ? (l.unit || l.name) : ''
    const br = l && l.bedrooms != null ? l.bedrooms + 'BR' : ''
    return i + ' | ' + (r.guest_name || 'Guest') + ' | Unit ' + unit + ' | ' + br + ' | rating ' + (r.rating == null ? '?' : r.rating) + ' | ' + r.content.slice(0, 260)
  }).join('\n')
  const taskLines = tasks.completed.slice(0, 120).map(t => t.date + ' | Unit ' + t.unit + ' | ' + t.name + (t.department ? ' [' + t.department + ']' : '')).join('\n')
  const openLines = tasks.open.slice(0, 30).map(t => t.date + ' | Unit ' + t.unit + ' | ' + t.name).join('\n')

  const factBlock = [
    'Property: ' + scopeLabel,
    'Period: ' + prettyDate(periodStart) + ' to ' + prettyDate(periodEnd) + ', as of ' + prettyDate(asOf) + (daysRemaining ? ' (' + daysRemaining + ' days remaining)' : ''),
    'Active listings: ' + units,
    'Accommodation revenue: ' + fmtK(period.accomRevenue) + ' | Gross (incl cleaning): ' + fmtK(period.grossRevenue),
    'Occupancy: ' + period.occupancyPct + '% | ADR: $' + period.adr + ' (gross $' + period.grossAdr + ') | RevPAR: $' + period.revpar,
    'Months ahead (OTB occupancy): ' + mAhead.map(m => m.short + ' ' + m.m.occupancyPct + '%').join(', '),
  ].join('\n')

  const sys = 'You write owner-report copy for Stay Hospitality, a Florida short-term-rental operator. Voice: data-forward, confident, zero fluff, short declarative sentences. Never admit fault or liability, never mention pests/bed bugs/security incidents, never disparage a guest. Output STRICT JSON only, no markdown.'
  const prompt = 'FACTS:\n' + factBlock
    + '\n\nRECENT GUEST REVIEWS (index | guest | unit | BR | rating | text):\n' + (reviewLines || '(none)')
    + '\n\nCOMPLETED WORK (date | unit | task):\n' + (taskLines || '(none)')
    + '\n\nOPEN ITEMS (date | unit | task):\n' + (openLines || '(none)')
    + '\n\nWEEK BUCKETS: ' + buckets.map(b => b.label).join(' ; ')
    + '\n\nReturn JSON with exactly these keys:\n'
    + '{"heroHeadline": one punchy sentence on the period, '
    + '"snapshotHeadline": one short sentence, '
    + '"aheadHeadline": one short sentence on pickup/pacing, '
    + '"aheadNotes": {"current": 1-2 sentences on the current month, "next": 1-2 sentences on next month}, '
    + '"quotes": [up to 4 objects {"i": review index number, "text": lightly trimmed quote max 220 chars}] pick the most specific, credible, positive quotes across DIFFERENT units, '
    + '"themes": [2-3 objects {"title": short theme name like "Communication - a highlight", "body": 1 sentence on what guests are saying, "action": 1 sentence on what we are doing}], '
    + '"projectWeeks": [one object per week bucket {"label": the bucket label EXACTLY as given, "groups": [{"category": UPPERCASE grouping like "DEEP CLEAN + PM" or "REPAIRS + MAINTENANCE" or "COMMON AREAS", "items": [concise task lines, merge duplicates, max 6 per group]}]}], '
    + '"tracking": [up to 3 objects {"title": short item title, "body": 1 sentence status} from open items worth telling an owner about], '
    + '"planNotes": [optional, one short sentence per budget month in order]}'

  const aiText = await anthropic({
    model: MODEL, max_tokens: 3000,
    system: sys,
    messages: [{ role: 'user', content: prompt }],
  })
  const ai = parseJson(aiText) || {}

  // ---- assemble content ----
  const quotes: { text: string; guest: string; unit: string; br: string }[] = []
  const aiQuotes: any[] = Array.isArray(ai.quotes) ? ai.quotes : []
  for (const q of aiQuotes.slice(0, 4)) {
    const src = goodReviews[Number(q?.i)]
    if (!src) continue
    const l = src.listing_id ? byId[src.listing_id] : undefined
    quotes.push({
      text: str(q?.text || src.content).slice(0, 240),
      guest: (src.guest_name || 'Guest').toUpperCase(),
      unit: l ? 'Unit ' + (l.unit || l.name) : '',
      br: l && l.bedrooms != null ? l.bedrooms + 'BR' : '',
    })
  }
  if (!quotes.length) {
    for (const src of goodReviews.slice(0, 4)) {
      const l = src.listing_id ? byId[src.listing_id] : undefined
      quotes.push({ text: src.content.slice(0, 240), guest: (src.guest_name || 'Guest').toUpperCase(), unit: l ? 'Unit ' + (l.unit || l.name) : '', br: l && l.bedrooms != null ? l.bedrooms + 'BR' : '' })
    }
  }

  const weeks: { label: string; groups: { category: string; items: string[] }[] }[] = []
  const aiWeeks: any[] = Array.isArray(ai.projectWeeks) ? ai.projectWeeks : []
  for (const b of buckets) {
    const match = aiWeeks.find((w: any) => str(w?.label).trim() === b.label)
    if (match && Array.isArray(match.groups) && match.groups.length) {
      weeks.push({
        label: b.label,
        groups: match.groups.slice(0, 5).map((g: any) => ({
          category: str(g?.category).toUpperCase().slice(0, 40) || 'WORK COMPLETED',
          items: (Array.isArray(g?.items) ? g.items : []).map((x: any) => str(x).slice(0, 140)).filter(Boolean).slice(0, 6),
        })).filter((g: any) => g.items.length),
      })
    } else {
      const inWeek = tasks.completed.filter(t => t.date >= b.start && t.date <= b.endIncl)
      const byDept: Record<string, string[]> = {}
      for (const t of inWeek.slice(0, 24)) {
        const k = (t.department || 'work completed').toUpperCase()
        ;(byDept[k] = byDept[k] || []).push(('Unit ' + t.unit + ' — ' + t.name).slice(0, 140))
      }
      weeks.push({ label: b.label, groups: Object.keys(byDept).map(k => ({ category: k, items: byDept[k].slice(0, 6) })) })
    }
  }

  const themes: { title: string; body: string; action: string }[] = (Array.isArray(ai.themes) ? ai.themes : []).slice(0, 3).map((t: any) => ({
    title: str(t?.title).slice(0, 80), body: str(t?.body).slice(0, 200), action: str(t?.action).slice(0, 200),
  })).filter((t: any) => t.title)

  const tracking: { title: string; body: string }[] = (Array.isArray(ai.tracking) ? ai.tracking : []).slice(0, 3).map((t: any) => ({
    title: str(t?.title).slice(0, 80), body: str(t?.body).slice(0, 200),
  })).filter((t: any) => t.title)

  if (plan && Array.isArray(ai.planNotes)) {
    for (let i = 0; i < plan.months.length; i++) plan.months[i].note = str(ai.planNotes[i]).slice(0, 200)
  }

  const cur = mAhead[1]; const nxt = mAhead[2]
  const content: ReportContent = {
    meta: {
      scopeLabel, periodStart, periodEnd, asOf,
      activeListings: units, daysRemaining, generatedAt: new Date().toISOString(),
    },
    hero: {
      eyebrow: prettyDate(asOf).toUpperCase(),
      title: scopeLabel,
      headline: str(ai.heroHeadline) || (period.occupancyPct + '% on the books with ' + fmtK(period.accomRevenue) + ' in accommodation revenue.'),
      preparedFor: 'Prepared for the owners of ' + scopeLabel,
      dateLabel: 'OWNER REVIEW',
      heroImage: null,
    },
    snapshot: {
      headline: str(ai.snapshotHeadline) || 'Where the period stands today.',
      subtitle: 'On-the-books as of ' + prettyDate(asOf) + '  ·  ' + units + ' active listings' + (daysRemaining ? '  ·  ' + daysRemaining + ' days remaining' : ''),
      cards: [
        { key: 'revenue', label: 'REVENUE', value: fmtK(period.accomRevenue), sub: 'Accommodation only · Gross (incl. cleaning): ' + fmtK(period.grossRevenue) },
        { key: 'occupancy', label: 'OCCUPANCY', value: period.occupancyPct + '%', sub: 'Occupied ÷ available nights' },
        { key: 'adr', label: 'ADR', value: '$' + period.adr, sub: 'Accommodation ÷ occupied nights · Gross ADR: $' + period.grossAdr },
        { key: 'revpar', label: 'REVPAR', value: '$' + period.revpar, sub: 'Accommodation ÷ available nights' },
      ],
      ytd: ytd.reservations > 0 ? {
        text: ytd.reservations + ' reservations booked YTD with an average stay of ' + ytd.avgStay + ' nights and a ' + ytd.avgWindow + '-day booking window.',
        stats: [
          { value: ytd.occupancyPct + '%', label: 'OCCUPANCY' },
          { value: ytd.avgStay + ' d', label: 'AVG STAY' },
          { value: ytd.avgWindow + ' d', label: 'BOOK WINDOW' },
        ],
      } : null,
    },
    pacing: null,
    plan,
    statement: null,
    ahead: {
      headline: str(ai.aheadHeadline) || 'On-the-books by stay month.',
      subtitle: 'On-the-books occupancy by stay month, as of ' + prettyDate(asOf),
      months: [
        cur ? { label: cur.label.toUpperCase(), status: 'IN MONTH', occPct: cur.m.occupancyPct, adr: '$' + cur.m.adr, revpar: '$' + cur.m.revpar, note: str(ai.aheadNotes?.current).slice(0, 260) } : null,
        nxt ? { label: nxt.label.toUpperCase(), status: 'BUILDING', occPct: nxt.m.occupancyPct, adr: '$' + nxt.m.adr, revpar: '$' + nxt.m.revpar, note: str(ai.aheadNotes?.next).slice(0, 260) } : null,
      ].filter(Boolean) as any,
      strip: mAhead.map(m => ({ month: m.short, occPct: m.m.occupancyPct })),
    },
    voices: {
      headline: "What guests said — and what we're addressing.",
      subtitle: 'Highlights from recent reviews  ·  Plus the themes we’re acting on',
      quotes, themes,
    },
    projects: {
      headline: 'Recent work at ' + scopeLabel + '.',
      subtitle: 'Completed work by reporting period  ·  plus open items we’re tracking',
      weeks, tracking,
    },
    omit: [],
  }

  const code = makeCode()
  const db = supabaseAdmin()
  const title = str(body?.title) || (scopeLabel + ' — Owner Review — ' + prettyDate(asOf))
  const { data: ins, error } = await db.from('owner_reports').insert({
    code, title, scope_label: scopeLabel, listing_ids: ids,
    period_start: periodStart, period_end: periodEnd, as_of: asOf,
    theme, status: 'draft', content, created_by: user.email || null,
  }).select('id, code').limit(1)
  if (error) return NextResponse.json({ error: error.message + ' (run supabase/migrations/011_owner_reports.sql first?)' }, { status: 500 })
  return NextResponse.json({ ok: true, id: (ins || [])[0]?.id, code, aiUsed: !!aiText })
}
