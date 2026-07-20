// Attachments for ALREADY-GENERATED owner reports (P3.5).
// GET ?photos=<reportId>  -> photo pool for the hero picker: the live Guesty pictures of every
//                            listing in the report's scope (so Jon can pick from the listing
//                            instead of uploading).
// POST { reportId, kind: 'pacing' | 'statements', url | urls }
//   -> AI-parses the uploaded PDF(s) (same prompts as generate) and returns the section JSON;
//      the client patches it into the report content and saves via the normal PUT.
// Parse helpers duplicated from /api/reports/generate on purpose - keep both in sync.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { hasEditCookie } from '@/lib/edit-access'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DOC_MODEL = 'claude-sonnet-4-6'

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

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

async function fetchDocBlock(url: string): Promise<any | null> {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > 8 * 1024 * 1024) return null
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
  } catch { return null }
}

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

async function parseCompleted(url: string, scopeLabel: string): Promise<string[] | null> {
  const block = await fetchAnyBlock(url)
  if (!block) return null
  const text = await anthropic({
    model: DOC_MODEL, max_tokens: 700,
    system: 'You extract a concise list of completed work items for a property owner report. Output STRICT JSON only.',
    messages: [{ role: 'user', content: [block, { type: 'text', text: 'This document or photo describes work completed at "' + scopeLabel + '". Extract the completed work as a short list an owner would care about (repairs, installs, replacements, projects, deliveries, inspections). EXCLUDE routine departure/turnover cleans and unit strips (linen/trash walkthroughs). Return JSON: {"items": [up to 12 concise lines, each <= 140 chars; prefix with the unit like "Unit 405: ..." when the unit is known]}.' }] }],
  })
  const j = parseJson(text)
  const items = (Array.isArray(j?.items) ? j.items : []).map((x: any) => str(x).slice(0, 140)).filter(Boolean).slice(0, 12)
  return items.length ? items : null
}

async function loadReport(id: string) {
  const db = supabaseAdmin()
  const { data } = await db.from('owner_reports').select('id, scope_label, listing_ids, period_start, period_end, content').eq('id', id).limit(1)
  return (data || [])[0] as any || null
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !hasEditCookie()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !hasEditCookie()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const reportId = str(body?.reportId)
  const kind = str(body?.kind)
  if (!reportId || (kind !== 'pacing' && kind !== 'statements' && kind !== 'completed')) {
    return NextResponse.json({ error: 'reportId + kind (pacing|statements|completed) required' }, { status: 400 })
  }
  const rep = await loadReport(reportId)
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })
  const scopeLabel = str(rep.scope_label) || 'the property'
  if (kind === 'completed') {
    const url = str(body?.url)
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })
    const items = await parseCompleted(url, scopeLabel)
    if (!items) return NextResponse.json({ error: 'Could not read work items from that file.' }, { status: 422 })
    return NextResponse.json({ ok: true, items })
  }
  if (kind === 'pacing') {
    const url = str(body?.url)
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })
    const periodLabel = str(rep.period_start) + ' to ' + str(rep.period_end)
    const occCard = (((rep.content || {}).snapshot || {}).cards || []).find((c: any) => c && (String(c.key) === 'occupancy' || /occup/i.test(String(c.label))))
    const ourOccPct = occCard ? Number(String(occCard.value).replace(/[^\d.]/g, '')) : undefined
    const section = await parsePacing(url, scopeLabel, periodLabel, ourOccPct && ourOccPct > 0 ? ourOccPct : undefined)
    if (!section) return NextResponse.json({ error: 'Could not read a market comparison out of that PDF.' }, { status: 422 })
    return NextResponse.json({ ok: true, section })
  }
  const urls: string[] = Array.isArray(body?.urls) ? body.urls.filter((u: any) => typeof u === 'string' && u).slice(0, 4) : []
  if (!urls.length) return NextResponse.json({ error: 'urls required' }, { status: 400 })
  const section = await parseStatements(urls, scopeLabel)
  if (!section) return NextResponse.json({ error: 'Could not summarize those statement PDFs.' }, { status: 422 })
  return NextResponse.json({ ok: true, section })
}
