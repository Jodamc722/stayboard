// Owner Report generator. POST { listingIds?, buildings?, periodStart, periodEnd, asOf?, title?,
// pacingUrl?, statementUrls?, heroImageUrl? }
// -> assembles all sections from the Supabase mirrors (deterministic math in lib/owner-report),
// runs ONE AI pass for narrative (headlines, quote picks, hearing/doing themes, project
// categorization) in the deck's voice, inserts an owner_reports row and returns { id, code }.
// Performance vs Plan is included ONLY when owner_budgets rows exist for the scope (17 West today).
// pacingUrl (PriceLabs PDF, uploaded via /api/guidebook/upload) is AI-parsed into the Pacing vs
// Market section; statementUrls (owner statement PDFs) into the Owner Statement section; both
// sections stay null when nothing is uploaded, so they simply don't render.
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

const DOC_MODEL = 'claude-sonnet-4-6'

async function fetchDocBlock(url: string): Promise<any | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) return null
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
  } catch { return null }
}

// PriceLabs pacing PDF -> Pacing vs Market rows (us vs comp set).
async function parsePacing(url: string, scopeLabel: string, periodLabel: string, ourOccPct?: number) {
  const block = await fetchDocBlock(url)
  if (!block) return null
  const text = await anthropic({
    model: DOC_MODEL, max_tokens: 900,
    system: 'You extract market-pacing figures from PriceLabs reports for an owner report. Output STRICT JSON only.',
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'This is a PriceLabs pacing/market report for the property "' + scopeLabel + '" (period: ' + periodLabel + '). Extract OUR property vs the market/comp set. CRITICAL chart-reading rules: in PriceLabs "Pacing vs Market" charts the legend maps each line - the "Your Occupancy"/"Your ADR"/"Your RevPAR" series (solid dark/black line) is OUR property, and the "Market ..." series (solid red line) is the comp set; dash-dot lines are last year - ignore them. Read each series at the most recent stay dates (at or after the "This Week" marker). Before answering, double-check you have NOT swapped the two: "ours" must come from the "Your ..." series only. Return JSON: {"subtitle": one line naming the pull window + comp set (e.g. "Jul 2026 pacing - vs PriceLabs ABB comp set (13 listings)"), "rows": [{"metric": "RevPAR"|"ADR"|"Occupancy", "ours": display value like "$265" or "82%", "comps": same format, "delta": signed advantage like "+56%" or "+25 pts" (negative if behind)}]}. Include only metrics actually present. If the document has no usable comparison, return {"rows": []}.' }] }],
  })
  const j = parseJson(text)
  if (!j || !Array.isArray(j.rows) || !j.rows.length) return null
  const rows = j.rows.slice(0, 4).map((r: any) => ({
    metric: str(r?.metric).slice(0, 20), ours: str(r?.ours).slice(0, 16), comps: str(r?.comps).slice(0, 16), delta: str(r?.delta).slice(0, 16),
  })).filter((r: any) => r.metric && r.ours)
  if (!rows.length) return null
  // Deterministic anti-swap: our own occupancy is authoritative, so if the parsed "ours" occupancy is
  // farther from it than the comp value is, PriceLabs' "Your"/"Market" lines were read backwards -> flip.
  const numOf = (s: any) => { const m = String(s == null ? '' : s).match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN }
  const flipDelta = (d: any) => { const s = String(d == null ? '' : d).trim(); if (/^[-−]/.test(s)) return '+' + s.replace(/^[-−]/, ''); if (/^\+/.test(s)) return '-' + s.replace(/^\+/, ''); return s }
  if (typeof ourOccPct === 'number' && ourOccPct > 0) {
    const occ = rows.find((r: any) => /occup/i.test(r.metric))
    if (occ) {
      const o = numOf(occ.ours), c = numOf(occ.comps)
      if (isFinite(o) && isFinite(c) && Math.abs(c - ourOccPct) < Math.abs(o - ourOccPct)) {
        for (const r of rows) { const t = r.ours; r.ours = r.comps; r.comps = t; r.delta = flipDelta(r.delta) }
      }
    }
  }
  const ahead = rows.every((r: any) => !String(r.delta).trim().startsWith('-') && !String(r.delta).trim().startsWith('−'))
  return {
    headline: ahead ? 'Ahead of the market across the board.' : 'How we stack up against the market.',
    subtitle: str(j.subtitle).slice(0, 140) || 'vs. PriceLabs comp set',
    rows,
  }
}

// Owner statement PDFs -> summarized Statement items (owner-safe, figures only).
async function parseStatements(urls: string[], scopeLabel: string) {
  const blocks: any[] = []
  for (const u of urls.slice(0, 4)) {
    const b = await fetchDocBlock(u)
    if (b) blocks.push(b)
  }
  if (!blocks.length) return null
  const text = await anthropic({
    model: DOC_MODEL, max_tokens: 1200,
    system: 'You summarize owner statements for a property-management owner report. Data-forward, zero fluff, never speculate. Output STRICT JSON only.',
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text: 'These are owner statement(s) for "' + scopeLabel + '". For EACH document return one item. JSON: {"items": [{"title": short label like "June 2026 Owner Statement", "summary": 1-2 sentences with the key figures - gross rent collected, total expenses/management fees, and the net owner payout, using exact numbers from the document}]}.' }] }],
  })
  const j = parseJson(text)
  const items = (Array.isArray(j?.items) ? j.items : []).slice(0, 4).map((it: any) => ({
    title: str(it?.title).slice(0, 90), summary: str(it?.summary).slice(0, 400), url: null,
  })).filter((it: any) => it.title && it.summary)
  if (!items.length) return null
  return { headline: 'Owner statement summary.', items }
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
  const pacingUrl = str(body?.pacingUrl)
  const statementUrls: string[] = Array.isArray(body?.statementUrls) ? body.statementUrls.filter((u: any) => typeof u === 'string' && u).slice(0, 4) : []
  const heroImageUrl = str(body?.heroImageUrl)
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
    const candidates: { iso: string; endExcl: string; pacing?: boolean }[] = []
    if (prevPrev) candidates.push({ iso: prevPrev, endExcl: mAhead[0].iso })
    candidates.push({ iso: mAhead[0].iso, endExcl: mAhead[1].iso })
    candidates.push({ iso: mAhead[1].iso, endExcl: addDaysIso(mAhead[2] ? mAhead[2].iso : mAhead[1].iso, 0) })
    // Forward "PACING" card: next month's on-the-books pace vs its budget (only appears if a budget row exists).
    if (mAhead[2]) candidates.push({ iso: mAhead[2].iso, endExcl: mAhead[3] ? mAhead[3].iso : addDaysIso(mAhead[2].iso, 31), pacing: true })
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
      const status = inMonth ? 'IN MONTH' : (c.pacing ? 'PACING' : 'CLOSED')
      const note = c.pacing ? 'On the books so far — these numbers build as the month fills in.' : ''
      monthsOut.push({ label: mLabel, status, rows, note })
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

  // ---- uploaded docs (optional): PriceLabs pacing + owner statements ----
  const periodLabel = prettyDate(periodStart) + ' - ' + prettyDate(periodEnd)
  const [pacingSection, statementSection] = await Promise.all([
    pacingUrl ? parsePacing(pacingUrl, scopeLabel, periodLabel, period.occupancyPct) : Promise.resolve(null),
    statementUrls.length ? parseStatements(statementUrls, scopeLabel) : Promise.resolve(null),
  ])

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
    'Accommodation revenue: ' + fmtK(period.accomRevenue) + ' | Gross (incl cleaning + channel fees): ' + fmtK(period.grossRevenue),
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
    + '"aheadNotes": {"current": 1-2 sentences on the current month, "next": 1-2 sentences on next month, "third": 1-2 sentences on the month after next (only used when included)}, '
    + '"quotes": [up to 4 objects {"i": review index number, "text": lightly trimmed quote max 220 chars}] pick the most specific, credible, positive quotes across DIFFERENT units, '
    + '"themes": [2-3 objects {"title": short theme name like "Communication - a highlight", "body": 1 sentence on what guests are saying, "action": 1 sentence on what we are doing}], '
    + '"projectWeeks": [one object per week bucket {"label": the bucket label EXACTLY as given, "groups": [{"category": UPPERCASE grouping like "DEEP CLEAN + PM" or "REPAIRS + MAINTENANCE" or "COMMON AREAS", "items": [concise task lines, merge duplicates, max 6 per group]}]}] -- EXCLUDE routine departure/turnover cleans and unit strips (linen/trash walkthroughs); ALWAYS include Maintenance-department work (HVAC, plumbing, electrical, appliance, preventive maintenance); include repairs, maintenance, installs & replacements, deliveries, deep cleans, inspections and real projects an owner cares about, '
    + '"tracking": [up to 3 objects {"title": short item title, "body": 1 sentence status} from open items worth telling an owner about], '
    + '"planNotes": {optional, one entry PER BUDGET MONTH keyed by the month name in UPPERCASE (e.g. "MAY", "JUNE", "JULY"), value = one short sentence about THAT month only}}'

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

  // Routine turn work (departure/turnover cleans, unit strips, linen/trash walkthroughs) does not belong on an owner report.
  const isRoutineTurn = (s: string | null | undefined) => /(departure|turnover|\bturn\b|strip|walk\s?through|walkthrough|linen|\btrash\b)/i.test(s || '')
  const weeks: { label: string; groups: { category: string; items: string[] }[] }[] = []
  const aiWeeks: any[] = Array.isArray(ai.projectWeeks) ? ai.projectWeeks : []
  for (const b of buckets) {
    const match = aiWeeks.find((w: any) => str(w?.label).trim() === b.label)
    if (match && Array.isArray(match.groups) && match.groups.length) {
      weeks.push({
        label: b.label,
        groups: match.groups.slice(0, 5).map((g: any) => ({
          category: str(g?.category).toUpperCase().slice(0, 40) || 'WORK COMPLETED',
          items: (Array.isArray(g?.items) ? g.items : []).map((x: any) => str(x).slice(0, 140)).filter(Boolean).filter((x: string) => !isRoutineTurn(x)).slice(0, 6),
        })).filter((g: any) => g.items.length && !isRoutineTurn(g.category)),
      })
    } else {
      const inWeek = tasks.completed.filter(t => t.date >= b.start && t.date <= b.endIncl && !isRoutineTurn(t.department) && !isRoutineTurn(t.name))
      const byDept: Record<string, string[]> = {}
      for (const t of inWeek.slice(0, 24)) {
        const k = (t.department || 'work completed').toUpperCase()
        ;(byDept[k] = byDept[k] || []).push(('Unit ' + t.unit + ' — ' + t.name).slice(0, 140))
      }
      weeks.push({ label: b.label, groups: Object.keys(byDept).map(k => ({ category: k, items: byDept[k].slice(0, 6) })) })
    }
  }

  // Maintenance backstop: an owner report must surface real Maintenance-department work. If a week has no
  // maintenance/repairs group at all (the AI dropped it), inject the completed maintenance tasks for that week.
  // Only fires when maintenance is entirely absent, so it never duplicates work the AI already grouped. Routine
  // turns (departure/turnover cleans, strips) stay excluded.
  for (let wi = 0; wi < weeks.length && wi < buckets.length; wi++) {
    if (weeks[wi].groups.some(g => /maint|repair|hvac|plumb/i.test(g.category))) continue
    const b = buckets[wi]
    const maint = tasks.completed.filter(t => t.date >= b.start && t.date <= b.endIncl && /maint/i.test(t.department || '') && !isRoutineTurn(t.name) && !isRoutineTurn(t.department))
    if (!maint.length) continue
    const seen = new Set<string>()
    for (const g of weeks[wi].groups) for (const it of g.items) seen.add(it.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    const fresh: string[] = []
    for (const t of maint) { const line = ('Unit ' + t.unit + ' — ' + t.name).slice(0, 140); const k = line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (!seen.has(k)) { seen.add(k); fresh.push(line) } }
    if (fresh.length) weeks[wi].groups.push({ category: 'MAINTENANCE', items: fresh.slice(0, 8) })
  }

  const themes: { title: string; body: string; action: string }[] = (Array.isArray(ai.themes) ? ai.themes : []).slice(0, 3).map((t: any) => ({
    title: str(t?.title).slice(0, 80), body: str(t?.body).slice(0, 200), action: str(t?.action).slice(0, 200),
  })).filter((t: any) => t.title)

  const tracking: { title: string; body: string }[] = (Array.isArray(ai.tracking) ? ai.tracking : []).slice(0, 3).map((t: any) => ({
    title: str(t?.title).slice(0, 80), body: str(t?.body).slice(0, 200),
  })).filter((t: any) => t.title)

  if (plan && ai.planNotes && typeof ai.planNotes === 'object' && !Array.isArray(ai.planNotes)) {
    for (let i = 0; i < plan.months.length; i++) {
      // Keep the on-the-books note on the PACING card; the AI can't see it's a forward month and may
      // mislabel it as closed actuals, so it only annotates closed / in-month cards.
      if (plan.months[i].status === 'PACING') continue
      const note = ai.planNotes[plan.months[i].label]
      if (note) plan.months[i].note = str(note).slice(0, 200)
    }
  }

  const cur = mAhead[1]; const nxt = mAhead[2]
  // Once we're past the 19th of the current month, look one further month ahead (3rd card).
  const asOfDay = Number(String(asOf).slice(8, 10)) || 1
  const nxt2 = asOfDay > 19 ? mAhead[3] : null

  // Month-by-month breakdown (powers the "view by month" toggle). Reuses the period reservations; each
  // calendar month in the period gets its own metrics. Only surfaced when the period spans 2+ months.
  const byMonth: { label: string; monthIso: string; revenue: string; grossRevenue: string; occPct: number; adr: string; grossAdr: string; revpar: string }[] = []
  {
    const nextMonthIso = (iso: string) => { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)); return (m >= 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0')) + '-01' }
    let mIso = periodStart.slice(0, 7) + '-01'
    let guard = 0
    while (mIso <= periodEnd && guard++ < 36) {
      const mNext = nextMonthIso(mIso)
      const mFrom = mIso < periodStart ? periodStart : mIso
      const mToExcl = mNext > toExcl ? toExcl : mNext
      const mm = metricsFor(resv, units, mFrom, mToExcl)
      const label = new Date(mIso.slice(0, 7) + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase()
      byMonth.push({ label, monthIso: mIso, revenue: fmtK(mm.accomRevenue), grossRevenue: fmtK(mm.grossRevenue), occPct: mm.occupancyPct, adr: '$' + mm.adr, grossAdr: '$' + mm.grossAdr, revpar: '$' + mm.revpar })
      mIso = mNext
    }
  }

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
      heroImage: heroImageUrl || null,
    },
    snapshot: {
      headline: str(ai.snapshotHeadline) || 'Where the period stands today.',
      subtitle: 'On-the-books as of ' + prettyDate(asOf) + '  ·  ' + units + ' active listings' + (daysRemaining ? '  ·  ' + daysRemaining + ' days remaining' : ''),
      cards: [
        { key: 'revenue', label: 'REVENUE', value: fmtK(period.accomRevenue), sub: 'Net accommodation payout · Gross (incl. cleaning + channel fees): ' + fmtK(period.grossRevenue), gross: fmtK(period.grossRevenue) },
        { key: 'occupancy', label: 'OCCUPANCY', value: period.occupancyPct + '%', sub: 'Occupied ÷ available nights' },
        { key: 'adr', label: 'ADR', value: '$' + period.adr, sub: 'Accommodation ÷ occupied nights · Gross ADR: $' + period.grossAdr, gross: '$' + period.grossAdr },
        { key: 'revpar', label: 'REVPAR', value: '$' + period.revpar, sub: 'Accommodation ÷ available nights · Gross RevPAR: $' + period.grossRevpar, gross: '$' + period.grossRevpar },
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
    pacing: pacingSection,
    plan,
    statement: statementSection,
    ahead: {
      headline: str(ai.aheadHeadline) || 'On-the-books by stay month.',
      subtitle: 'On-the-books occupancy by stay month, as of ' + prettyDate(asOf),
      months: [
        cur ? { label: cur.label.toUpperCase(), status: 'IN MONTH', occPct: cur.m.occupancyPct, adr: '$' + cur.m.adr, revpar: '$' + cur.m.revpar, note: str(ai.aheadNotes?.current).slice(0, 260) } : null,
        nxt ? { label: nxt.label.toUpperCase(), status: 'BUILDING', occPct: nxt.m.occupancyPct, adr: '$' + nxt.m.adr, revpar: '$' + nxt.m.revpar, note: str(ai.aheadNotes?.next).slice(0, 260) } : null,
        nxt2 ? { label: nxt2.label.toUpperCase(), status: 'BUILDING', occPct: nxt2.m.occupancyPct, adr: '$' + nxt2.m.adr, revpar: '$' + nxt2.m.revpar, note: str(ai.aheadNotes?.third).slice(0, 260) } : null,
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
    byMonth: byMonth.length >= 2 ? byMonth : undefined,
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
