// Attachments for ALREADY-GENERATED owner reports (P3.5).
// GET ?photos=<reportId>  -> photo pool for the hero picker: the live Guesty pictures of every
//                            listing in the report's scope (so Jon can pick from the listing
//                            instead of uploading).
// POST { reportId, kind: 'pacing' | 'statements', url | urls }
//   -> AI-parses the uploaded PDF(s) (same prompts as generate) and returns the section JSON;
//      the client patches it into the report content and saves via the normal PUT.
// Parse helpers duplicated from /api/reports/generate on purpose - keep both in sync.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { hasEditCookie } from '@/lib/edit-access'
import { resolveScope, pullTasks, weekBuckets, type ReportListing } from '@/lib/owner-report'
import { aiFetch } from '@/lib/ai-usage'
import { reconcilePacing, type OurTruth } from '@/lib/pacing-check'
import { requireLevel, requireUser } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DOC_MODEL = 'claude-sonnet-4-6'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function anthropic(payload: any): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const r = await aiFetch('reports', {
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

async function fetchDocBlock(url: string): Promise<any | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) return null
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
  } catch { return null }
}

async function parsePacing(url: string, scopeLabel: string, periodLabel: string, truth?: OurTruth) {
  const block = await fetchDocBlock(url)
  if (!block) return null
  const text = await anthropic({
    model: DOC_MODEL, max_tokens: 900,
    system: 'You extract market-pacing figures from PriceLabs reports for an owner report. Output STRICT JSON only.',
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'This is a PriceLabs pacing/market report for the property "' + scopeLabel + '" (period: ' + periodLabel + '). Extract OUR property vs the market/comp set. CRITICAL chart-reading rules: in PriceLabs "Pacing vs Market" charts the legend maps each line - the "Your Occupancy"/"Your ADR"/"Your RevPAR" series (solid dark/black line) is OUR property, and the "Market ..." series (solid red line) is the comp set; dash-dot lines are last year - ignore them. Read each series at the most recent stay dates (at or after the "This Week" marker). Before answering, double-check you have NOT swapped the two: "ours" must come from the "Your ..." series only. DO NOT report RevPAR - it is occupancy x ADR and we compute it ourselves; reading a third line off the chart is where this goes wrong. Report Occupancy and ADR only, and prefer a printed/labelled number over estimating the height of a line against the axis. If a value is not printed and you are estimating, still give your best read - but never invent a metric the document does not show. Return JSON: {"subtitle": one line naming the pull window + comp set (e.g. "Jul 2026 pacing - vs PriceLabs ABB comp set (13 listings)"), "rows": [{"metric": "RevPAR"|"ADR"|"Occupancy", "ours": display value like "$265" or "82%", "comps": same format, "delta": signed advantage like "+56%" or "+25 pts" (negative if behind)}]}. Include only metrics actually present. If the document has no usable comparison, return {"rows": []}.' }] }],
  })
  const j = parseJson(text)
  if (!j || !Array.isArray(j.rows) || !j.rows.length) return null
  const rows = j.rows.slice(0, 4).map((r: any) => ({
    metric: str(r?.metric).slice(0, 20), ours: str(r?.ours).slice(0, 16), comps: str(r?.comps).slice(0, 16), delta: str(r?.delta).slice(0, 16),
  })).filter((r: any) => r.metric && r.ours)
  if (!rows.length) return null
  // EVERY NUMBER ON THIS SLIDE IS RECONCILED BEFORE AN OWNER SEES IT (2026-09-22). The model
  // reads a chart; reconcilePacing checks the result against arithmetic and against our own
  // board, derives RevPAR rather than trusting a third eyeballed line, recomputes the deltas,
  // and drops anything that still cannot be true. See lib/pacing-check.ts for the 17WEST case
  // that forced this.
  const fixed = reconcilePacing(rows, truth || {})
  if (!fixed.rows.length) return null
  const ahead = fixed.ahead

  return {
    headline: ahead ? 'Ahead of the market across the board.' : 'How we stack up against the market.',
    subtitle: str(j.subtitle).slice(0, 140) || 'vs. PriceLabs comp set',
    rows: fixed.rows,
    notes: fixed.notes,
  }
}

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

async function fetchAnyBlock(url: string): Promise<any | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const ct = (r.headers.get('content-type') || '').toLowerCase()
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) return null
    if (ct.includes('pdf') || /\.pdf($|\?)/i.test(url)) return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
    const mt = ct.includes('png') || /\.png($|\?)/i.test(url) ? 'image/png' : (ct.includes('webp') || /\.webp($|\?)/i.test(url)) ? 'image/webp' : 'image/jpeg'
    return { type: 'image', source: { type: 'base64', media_type: mt, data: buf.toString('base64') } }
  } catch { return null }
}

async function parseCompleted(url: string, scopeLabel: string): Promise<{ category: string; items: string[] }[] | null> {
  const block = await fetchAnyBlock(url)
  if (!block) return null
  const text = await anthropic({
    model: DOC_MODEL, max_tokens: 900,
    system: 'You extract completed work items for a property owner report and sort them into type groups. Output STRICT JSON only.',
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'This document or photo describes work completed at "' + scopeLabel + '". Extract the completed work an owner would care about and SORT it into type groups. Use clear UPPERCASE type headings such as MAINTENANCE, REPAIRS, INSTALLS & REPLACEMENTS, DELIVERIES, DEEP CLEAN, INSPECTIONS (add others as needed). ALWAYS include maintenance / PM work (HVAC, plumbing, electrical, appliance, preventive maintenance). EXCLUDE routine departure/turnover cleans and unit strips (linen/trash walkthroughs). Return JSON: {"groups": [{"category": UPPERCASE type, "items": [concise lines, each <= 140 chars; prefix with the unit like "Unit 405: ..." when known, max 8 per group]}]}. Up to 6 groups.' }] }],
  })
  const j = parseJson(text)
  const isRoutineTurn = (s: any) => /(departure|turnover|\bturn\b|strip|walk\s?through|walkthrough|linen|\btrash\b)/i.test(String(s || ''))
  let groups = (Array.isArray(j?.groups) ? j.groups : []).map((g: any) => ({
    category: str(g?.category).toUpperCase().slice(0, 40) || 'COMPLETED WORK',
    items: (Array.isArray(g?.items) ? g.items : []).map((x: any) => str(x).slice(0, 140)).filter(Boolean).filter((x: string) => !isRoutineTurn(x)).slice(0, 8),
  })).filter((g: any) => g.items.length && !isRoutineTurn(g.category)).slice(0, 6)
  // Back-compat: if the model returned a flat items array, wrap it into one group.
  if (!groups.length && Array.isArray(j?.items)) {
    const items = j.items.map((x: any) => str(x).slice(0, 140)).filter(Boolean).filter((x: string) => !isRoutineTurn(x)).slice(0, 12)
    if (items.length) groups = [{ category: 'COMPLETED WORK', items }]
  }
  return groups.length ? groups : null
}

// Same grouping as parseCompleted, but from typed notes (no file). Powers the Recent Work "auto-fill" prompt.
async function parseCompletedText(notes: string, scopeLabel: string): Promise<{ category: string; items: string[] }[] | null> {
  const text = await anthropic({
    model: DOC_MODEL, max_tokens: 900,
    system: 'You turn a property manager\'s rough notes about completed work into a clean owner-report list, sorted into type groups. Output STRICT JSON only.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'These are rough notes about work completed at "' + scopeLabel + '":\n\n' + notes.slice(0, 4000) + '\n\nRewrite them as concise, owner-facing completed-work items and SORT into type groups. Use clear UPPERCASE type headings such as MAINTENANCE, REPAIRS, INSTALLS & REPLACEMENTS, DELIVERIES, DEEP CLEAN, INSPECTIONS (add others as needed). ALWAYS include maintenance / PM work. EXCLUDE routine departure/turnover cleans and unit strips (linen/trash walkthroughs). Keep the unit number when given (prefix "Unit 405: ..."). Return JSON: {"groups": [{"category": UPPERCASE type, "items": [concise lines, each <= 140 chars, max 8 per group]}]}. Up to 6 groups.' }] }],
  })
  const j = parseJson(text)
  const isRoutineTurn = (s: any) => /(departure|turnover|\bturn\b|strip|walk\s?through|walkthrough|linen|\btrash\b)/i.test(String(s || ''))
  const groups = (Array.isArray(j?.groups) ? j.groups : []).map((g: any) => ({
    category: str(g?.category).toUpperCase().slice(0, 40) || 'COMPLETED WORK',
    items: (Array.isArray(g?.items) ? g.items : []).map((x: any) => str(x).slice(0, 140)).filter(Boolean).filter((x: string) => !isRoutineTurn(x)).slice(0, 8),
  })).filter((g: any) => g.items.length && !isRoutineTurn(g.category)).slice(0, 6)
  return groups.length ? groups : null
}

// Re-pull the latest Breezeway completed work for the report's period and rebuild the grouped weeks (deterministic,
// no AI): grouped by department, routine departure/turnover cleans excluded, maintenance always surfaced.
async function refreshWork(rep: any): Promise<{ label: string; groups: { category: string; items: string[] }[] }[]> {
  const ids: string[] = (Array.isArray(rep.listing_ids) ? rep.listing_ids : []).map((x: any) => String(x)).filter(Boolean).slice(0, 40)
  const scope = await resolveScope(ids, [])
  const byId: Record<string, ReportListing> = {}
  for (const l of scope.listings) byId[l.id] = l
  const from = str(rep.period_start).slice(0, 10), to = str(rep.period_end).slice(0, 10)
  const tasks = await pullTasks(scope.listings.map(l => l.id), byId, from, to)
  const isRoutineTurn = (s: any) => /(departure|turnover|\bturn\b|strip|walk\s?through|walkthrough|linen|\btrash\b)/i.test(String(s || ''))
  const buckets = weekBuckets(from, to)
  const weeks: { label: string; groups: { category: string; items: string[] }[] }[] = []
  for (const b of buckets) {
    const inWeek = tasks.completed.filter(t => t.date >= b.start && t.date <= b.endIncl && !isRoutineTurn(t.department) && !isRoutineTurn(t.name))
    const byDept: Record<string, string[]> = {}
    for (const t of inWeek.slice(0, 24)) {
      const k = (t.department || 'WORK COMPLETED').toUpperCase()
      ;(byDept[k] = byDept[k] || []).push(('Unit ' + t.unit + ' — ' + t.name).slice(0, 140))
    }
    const groups = Object.keys(byDept).map(k => ({ category: k, items: byDept[k].slice(0, 8) }))
    if (groups.length) weeks.push({ label: b.label, groups })
  }
  return weeks
}

async function loadReport(id: string) {
  const db = supabaseAdmin()
  const { data } = await db.from('owner_reports').select('id, scope_label, listing_ids, period_start, period_end, content').eq('id', id).limit(1)
  return (data || [])[0] as any || null
}

export async function GET(req: NextRequest) {
  const gate = await requireUser()
  if (!gate.ok && !hasEditCookie()) return gate.res
  const user = gate.access.user
  const sp = new URL(req.url).searchParams
  const reportId = str(sp.get('photos'))
  if (!reportId) return NextResponse.json({ error: 'photos=<reportId> required' }, { status: 400 })
  const rep = await loadReport(reportId)
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })
  const ids: string[] = (Array.isArray(rep.listing_ids) ? rep.listing_ids : []).map((x: any) => String(x)).filter(Boolean).slice(0, 40)
  if (!ids.length) return NextResponse.json({ ok: true, photos: [] })
  const db = supabaseAdmin()
  const { data } = await db.from('guesty_listings').select('id, title, pictures:raw->pictures').in('id', ids)
  const photos: { url: string; thumb: string; listing: string }[] = []
  for (const row of (data || []) as any[]) {
    const pics: any[] = Array.isArray(row?.pictures) ? row.pictures : []
    for (const p of pics) {
      const full = p && (p.original || p.large || p.thumbnail)
      const thumb = p && (p.thumbnail || p.large || p.original)
      if (full) photos.push({ url: String(full), thumb: String(thumb || full), listing: str(row?.title) })
      if (photos.length >= 150) break
    }
    if (photos.length >= 150) break
  }
  return NextResponse.json({ ok: true, photos })
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('reports', 'edit')
  if (!gate.ok && !hasEditCookie()) return gate.res
  const user = gate.access.user
  const body = await req.json().catch(() => ({} as any))
  const reportId = str(body?.reportId)
  const kind = str(body?.kind)
  if (!reportId || (kind !== 'pacing' && kind !== 'statements' && kind !== 'completed' && kind !== 'refresh-work')) {
    return NextResponse.json({ error: 'reportId + kind (pacing|statements|completed|refresh-work) required' }, { status: 400 })
  }
  const rep = await loadReport(reportId)
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })
  const scopeLabel = str(rep.scope_label) || 'the property'
  if (kind === 'refresh-work') {
    const weeks = await refreshWork(rep)
    return NextResponse.json({ ok: true, weeks })
  }
  if (kind === 'completed') {
    const notes = str(body?.text)
    const url = str(body?.url)
    if (!url && !notes.trim()) return NextResponse.json({ error: 'url or text required' }, { status: 400 })
    const groups = notes.trim() ? await parseCompletedText(notes, scopeLabel) : await parseCompleted(url, scopeLabel)
    if (!groups) return NextResponse.json({ error: 'Could not read work items from that ' + (notes.trim() ? 'note.' : 'file.') }, { status: 422 })
    // groups[] is the grouped-by-type shape; items[] stays for older clients.
    const items = groups.flatMap(g => g.items)
    return NextResponse.json({ ok: true, groups, items })
  }
  if (kind === 'pacing') {
    const url = str(body?.url)
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })
    const periodLabel = str(rep.period_start) + ' to ' + str(rep.period_end)
    // OUR OWN BOARD IS THE ANCHOR. The snapshot cards were computed from Guesty by this app and
    // foot against each other (occupancy x ADR = RevPAR); the PDF is an outside reading of a
    // chart. Hand all three over so a swapped series or a misread line is caught deterministically.
    const cards: any[] = (((rep.content || {}).snapshot || {}).cards || [])
    const card = (k: string, re: RegExp) => cards.find((c: any) => c && (String(c.key) === k || re.test(String(c.label))))
    const num = (c: any) => { if (!c) return undefined; const n = Number(String(c.value).replace(/[^\d.]/g, '')); return isFinite(n) && n > 0 ? n : undefined }
    const truth = {
      occPct: num(card('occupancy', /occup/i)),
      adr: num(card('adr', /\badr\b/i)),
      revpar: num(card('revpar', /revpar/i)),
    }
    const section = await parsePacing(url, scopeLabel, periodLabel, truth)
    if (!section) return NextResponse.json({ error: 'Could not read a market comparison out of that PDF.' }, { status: 422 })
    return NextResponse.json({ ok: true, section })
  }
  const urls: string[] = Array.isArray(body?.urls) ? body.urls.filter((u: any) => typeof u === 'string' && u).slice(0, 4) : []
  if (!urls.length) return NextResponse.json({ error: 'urls required' }, { status: 400 })
  const section = await parseStatements(urls, scopeLabel)
  if (!section) return NextResponse.json({ error: 'Could not summarize those statement PDFs.' }, { status: 422 })
  return NextResponse.json({ ok: true, section })
}
