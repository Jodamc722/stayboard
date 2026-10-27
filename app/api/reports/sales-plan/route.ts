// THE PROJECTION SLIDE ON A SALES DECK.
// POST { id, source: 'model' | 'upload', listingIds?, url?, label? }
//
// Jon, 2026-10-27: "make it possible to upload projections and build them into the deck for the
// property." Two ways in, one shape out:
//
//   'model'   builds it from our own projection model (lib/projections) for listings we already
//             run — the same numbers the season projection report is made of.
//   'upload'  reads a projection someone else built. A PDF is handed to the model as a document;
//             a CSV or text file is read as text. Either way what comes back is a table, not
//             prose, and it is written into the deck as editable rows like everything else.
//
// WHAT THIS ROUTE WILL NOT DO is invent a number. If the file cannot be read, or carries no table
// the model can resolve into columns and rows, it says so and writes nothing. A projection slide
// filled with plausible-looking figures nobody can source is the single worst thing this deck
// could carry into a pitch.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { projectionSectionFor } from '@/lib/projections'
import { aiFetch } from '@/lib/ai-usage'
import { xlsxCsv } from '@/lib/xlsx-read'
import { modelFor } from '@/lib/ai-models'
import { hasEditCookie } from '@/lib/edit-access'
import { requireLevel } from '@/lib/access'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }
const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

// WHY THE READ FAILED IS WORTH SAYING OUT LOUD (2026-10-27). The first live upload of a real
// projection came back "No projection could be read out of that file", which sent me looking at
// the PDF when the call might never have left the building: aiFetch returns a 429 with a reason
// when the AI budget's hard stop is on, and swallowing that reads as a bad document. Every failure
// now carries why, because "the file is wrong" and "we are over budget" need different answers.
async function anthropic(payload: any): Promise<{ text: string | null; why: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { text: null, why: 'AI is not configured on this environment.' }
  try {
    const r = await aiFetch('reports', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const d: any = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = str(d?.error?.message) || ('the AI call returned ' + r.status)
      return { text: null, why: r.status === 429 ? ('AI budget: ' + msg) : ('AI error: ' + msg) }
    }
    const text = Array.isArray(d?.content) ? d.content.map((x: any) => x?.text || '').join('').trim() : ''
    return { text: text || null, why: text ? '' : 'the AI returned nothing' }
  } catch (e: any) {
    return { text: null, why: 'AI call failed: ' + String(e?.message || e).slice(0, 120) }
  }
}
function parseJson(text: string | null): any | null {
  if (!text) return null
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export async function POST(req: NextRequest) {
  const gate = await requireLevel('reports', 'edit')
  if (!gate.ok && !hasEditCookie()) return gate.res

  const body = await req.json().catch(() => ({} as any))
  const id = str(body?.id)
  const source = str(body?.source) === 'upload' ? 'upload' : 'model'
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseAdmin()
  const { data } = await db.from('owner_reports').select('id, listing_ids, content').eq('id', id).limit(1)
  const rep = (data || [])[0] as any
  if (!rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })
  const content: any = (rep.content && typeof rep.content === 'object') ? rep.content : {}

  let cols: string[] = []
  let rows: { k: string; cells: string[] }[] = []
  let totals: { k: string; cells: string[] } | undefined
  let sourceLabel = ''

  if (source === 'model') {
    const ids: string[] = (Array.isArray(body?.listingIds) && body.listingIds.length
      ? body.listingIds
      : (Array.isArray(rep.listing_ids) ? rep.listing_ids : [])).map(String).filter(Boolean).slice(0, 80)
    if (!ids.length) return NextResponse.json({ error: 'This deck has no property on it — pick the listings to project, or upload a projection instead.' }, { status: 400 })
    const proj = await projectionSectionFor(ids)
    if (!proj) return NextResponse.json({ error: 'No projection data for those listings yet — open Money → Projections first.' }, { status: 400 })
    cols = proj.monthLabels
    // ONE ROW PER UNIT, NET TO THE OWNER. The model also knows gross and the management split; a
    // prospect's question is what lands in their account, so that is the figure on the slide and
    // the rest stays where it can be explained.
    rows = proj.units.map(u => ({ k: u.name, cells: u.months.map(n => money0(n)) }))
    totals = { k: 'Net to owner', cells: proj.byMonth.map(n => money0(n)) }
    sourceLabel = 'Our projection model · ' + proj.monthLabels[0] + ' – ' + proj.monthLabels[proj.monthLabels.length - 1]
  } else {
    const url = str(body?.url)
    if (!url) return NextResponse.json({ error: 'Upload a projection file first.' }, { status: 400 })
    // ANY FILE TYPE (Jon, 2026-10-27: "a place to upload a projections PDF or any file type, reads
    // it and makes it beautiful"). A PDF and an image go to the model as what they are, because a
    // projection is very often a screenshot or a scan. Everything else is turned into text first:
    // a spreadsheet through lib/xlsx-lite, a Word file through mammoth, and anything else read as
    // UTF-8. What the model never receives is raw binary dressed up as text — that is how you get
    // a confidently invented table out of mojibake.
    let block: any = null
    let textBody = ''
    try {
      const r = await fetch(url)
      if (!r.ok) return NextResponse.json({ error: 'Could not read that file.' }, { status: 400 })
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 12 * 1024 * 1024) return NextResponse.json({ error: 'That file is too large to read (12MB max).' }, { status: 400 })
      const ext = (/\.([a-z0-9]+)(?:\?|$)/i.exec(url) || [])[1]?.toLowerCase() || ''
      const isPdf = ext === 'pdf' || buf.subarray(0, 4).toString('latin1') === '%PDF'
      const isZip = buf.subarray(0, 2).toString('latin1') === 'PK'
      const IMG: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

      if (isPdf) {
        block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
      } else if (IMG[ext]) {
        block = { type: 'image', source: { type: 'base64', media_type: IMG[ext], data: buf.toString('base64') } }
      } else if (isZip) {
        // Both .xlsx and .docx are zipped XML; try the spreadsheet first, then the document.
        const csv = xlsxCsv(buf)
        if (csv) {
          textBody = csv.slice(0, 120_000)
        } else {
          try {
            const mammoth = await import('mammoth')
            const out = await mammoth.extractRawText({ buffer: buf })
            textBody = String(out?.value || '').slice(0, 120_000)
          } catch { textBody = '' }
          if (!textBody.trim()) {
            return NextResponse.json({ error: 'That file could not be read. Export it as CSV, PDF or an image and upload that.' }, { status: 400 })
          }
        }
      } else {
        textBody = buf.toString('utf8').slice(0, 120_000)
        // Binary pretending to be text: more than a few control bytes and we are guessing.
        const junk = (textBody.slice(0, 4000).match(/[\u0000-\u0008\u000e-\u001f]/g) || []).length
        if (junk > 20 || !textBody.trim()) {
          return NextResponse.json({ error: 'That file could not be read as text. Export it as CSV, PDF or an image and upload that.' }, { status: 400 })
        }
      }
    } catch { return NextResponse.json({ error: 'Could not read that file.' }, { status: 400 }) }

    // WHAT WE ASK THE MODEL FOR, AND WHAT WE WORK OUT OURSELVES.
    //
    // It reads the document and reports only what is printed on it. The range, the rate and
    // occupancy spread and the monthly split are then DERIVED here, by Jon's own rule — "the
    // range runs from the PriceLabs midpoint to its top-of-range figure, with the uplift split
    // between nightly rate and occupancy" — so the arithmetic is the same on every projection and
    // can be checked, rather than being whatever the model felt like that afternoon.
    // WHAT WE ASK FOR, AND WHAT WE WORK OUT OURSELVES.
    //
    // Two kinds of document arrive here and both are handled by one read: a finished Stay revenue
    // projection (every figure is printed on it, so there is nothing to derive) and a raw market
    // estimate from PriceLabs (a midpoint and a top of range, from which the rest follows). The
    // model reports only what is printed; anything missing is derived below by Jon's own rule, so
    // the arithmetic is identical on every projection and can be checked.
    const instruction = 'This document is a short-term rental revenue projection or market revenue estimate for one property. Report ONLY what is printed on it — never compute, never estimate, never fill a blank. Return STRICT JSON:\n'
      + '{"title": the property/unit heading, "subtitle": the line under it (address, bedrooms, size, floor), "preparedFor": who it says it is prepared for,\n'
      + ' "annualLow": number or null, "annualHigh": number or null (the projected annual revenue range; if only one annual figure is given put it in annualLow),\n'
      + ' "annualSub": the small line under the annual figure, "monthlyLow": number or null, "monthlyHigh": number or null,\n'
      + ' "rateLow": number or null, "rateHigh": number or null, "rateSub": the small line under the nightly rate,\n'
      + ' "occLow": number or null, "occHigh": number or null (occupancy percents, 0-100),\n'
      + ' "months": [{"label": "JAN", "base": number or null, "high": number or null, "rate": number or null, "occ": number or null}] in calendar order, only for months the document shows,\n'
      + ' "season": [{"label": "In season (Dec-Mar)", "rate": "as printed", "occ": "as printed", "perMonth": "as printed", "total": "as printed"}] ONLY if the document has a season summary table, else [],\n'
      + ' "comps": [{"name": the listing or location, "rev": estimated annual revenue exactly as printed including any range, "rate": nightly rate, "occ": occupancy, "beds": bedrooms, "baths": bathrooms, "rating": guest rating, "sleeps": sleeps}] for the comparable listings table, each field "" where that column is not on the page,\n'
      + ' "compsLabel": the heading of the comparable table\'s first column (e.g. "Listing" or "Location"),\n'
      + ' "footnote": any line about figures being fully ramped or about event nights,\n'
      + ' "label": one short line naming the source and period}\n'
      + 'If the document contains no projection at all, return {"annualLow": null, "months": [], "comps": []}.'
    const read = await anthropic({
      model: modelFor('reports'), max_tokens: 4000,
      system: 'You read revenue projections out of documents for a sales deck. Output STRICT JSON only. You never invent a figure and you never recompute one.',
      messages: [{ role: 'user', content: block ? [block, { type: 'text', text: instruction }] : [{ type: 'text', text: instruction + '\n\nThe file:\n' + textBody }] }],
    })
    const j = parseJson(read.text)
    if (!j) {
      return NextResponse.json({
        error: read.why ? ('Could not read that file \u2014 ' + read.why) : 'No projection could be read out of that file.',
      }, { status: read.why.startsWith('AI budget') ? 429 : 400 })
    }

    const n = (v: any): number | null => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null }
    const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
    const kk = (v: number) => (v >= 10_000 ? '$' + Math.round(v / 1000) + 'K' : v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'K' : '$' + Math.round(v).toLocaleString('en-US'))

    const lo = n(j.annualLow)
    if (lo) {
      // THE RANGE. A finished projection prints both ends and we use them. A market estimate
      // prints a midpoint and a top, and the uplift between them is split evenly between nightly
      // rate and occupancy — each taking the square root, so rate x occupancy reproduces the
      // revenue uplift exactly. Occupancy is capped at 95: a percentage of a year cannot be
      // stretched past one. With no second figure there is no range, and the page prints one
      // number rather than inventing a second.
      const hi = n(j.annualHigh) && Number(j.annualHigh) > lo ? Number(j.annualHigh) : lo
      const uplift = hi > lo ? (hi / lo) - 1 : 0
      const each = Math.sqrt(1 + uplift)
      const rLo = n(j.rateLow), rHi = n(j.rateHigh)
      const oLo = n(j.occLow), oHi = n(j.occHigh)
      const mLo = n(j.monthlyLow), mHi = n(j.monthlyHigh)
      const range = {
        annualLow: money(lo),
        annualHigh: money(hi),
        monthlyLow: money(mLo || lo / 12),
        monthlyHigh: money(mHi || hi / 12),
        rateLow: rLo ? money(rLo) : '',
        rateHigh: rLo ? money(rHi && rHi > rLo ? rHi : rLo * each) : '',
        occLow: oLo ? Math.round(oLo) + '%' : '',
        occHigh: oLo ? Math.round(oHi && oHi > oLo ? oHi : Math.min(95, oLo * each)) + '%' : '',
        annualSub: str(j.annualSub).slice(0, 80),
        rateSub: str(j.rateSub).slice(0, 80),
      }

      // The monthly bars are the document's own. Where it prints a high end we use it; where it
      // prints only a base we scale by the same uplift. A month the document does not show is not
      // drawn, and a monthly series that plainly does not add up to the annual figure is
      // apportioned to it rather than contradicting the band above it.
      const rawMonths: any[] = Array.isArray(j.months) ? j.months.slice(0, 12) : []
      const sumBase = rawMonths.reduce((a, m) => a + (n(m?.base) || 0), 0)
      const scale = sumBase > 0 && Math.abs(sumBase - lo) / lo > 0.25 ? lo / sumBase : 1
      const months = rawMonths.map((m: any) => {
        const base = n(m?.base) != null ? Number(m.base) * scale : null
        const high = n(m?.high) != null ? Number(m.high) * scale : (base != null ? base * (1 + uplift) : null)
        return {
          label: str(m?.label).slice(0, 4).toUpperCase(),
          base: base != null ? kk(base) : '',
          high: high != null ? kk(high) : '',
          rate: n(m?.rate) != null ? money(Number(m.rate)) : '',
          occ: n(m?.occ) != null ? Math.round(Number(m.occ)) + '%' : '',
          baseNum: base != null ? Math.round(base) : undefined,
          highNum: high != null ? Math.round(high) : undefined,
        }
      }).filter((m: any) => m.label)

      const season = (Array.isArray(j.season) ? j.season : []).slice(0, 3).map((r: any) => ({
        label: str(r?.label).slice(0, 40), rate: str(r?.rate).slice(0, 24),
        occ: str(r?.occ).slice(0, 20), perMonth: str(r?.perMonth).slice(0, 24), total: str(r?.total).slice(0, 28),
      })).filter((r: any) => r.label)

      const comps = (Array.isArray(j.comps) ? j.comps : []).slice(0, 12).map((r: any) => ({
        name: str(r?.name).slice(0, 120), rev: str(r?.rev).slice(0, 40), rate: str(r?.rate).slice(0, 20),
        occ: str(r?.occ).slice(0, 12), beds: str(r?.beds).slice(0, 10), baths: str(r?.baths).slice(0, 10),
        rating: str(r?.rating).slice(0, 8), sleeps: str(r?.sleeps).slice(0, 8),
      })).filter((r: any) => r.name)

      const prevPlan: any = content.plan || {}
      content.plan = {
        ...prevPlan,
        headline: str(prevPlan.headline) || 'Our projected range',
        subtitle: str(prevPlan.subtitle) || str(j.title).slice(0, 90),
        body: str(prevPlan.body) || '',
        // The fully-ramped line is the document's own where it has one, because it is the sentence
        // that stops an owner reading the number as a year-one promise.
        note: str(j.footnote).slice(0, 300) || str(prevPlan.note) || '',
        source: str(body?.label) || str(j.label).slice(0, 120) || 'Revenue projection',
        range, months, season,
        cols: Array.isArray(prevPlan.cols) ? prevPlan.cols : [],
        rows: Array.isArray(prevPlan.rows) ? prevPlan.rows : [],
      }
      if (comps.length) {
        const prevC: any = content.comps || {}
        content.comps = { ...prevC, rows: comps, label: str(j.compsLabel).slice(0, 30) || str(prevC.label) || 'Listing' }
        if (Array.isArray(content.omit)) content.omit = content.omit.filter((k: string) => k !== 'comps')
      }
      if (Array.isArray(content.omit)) content.omit = content.omit.filter((k: string) => k !== 'plan')
      const { error: errR } = await db.from('owner_reports').update({ content, updated_at: new Date().toISOString() }).eq('id', id)
      if (errR) return NextResponse.json({ error: errR.message }, { status: 500 })
      return NextResponse.json({ ok: true, source: content.plan.source, range, months: months.length, season: season.length, comps: comps.length, content })
    }

    // Not a revenue estimate we could read as a range — fall back to the generic table, which is
    // still the right answer for a projection someone built in a spreadsheet of their own.
    if (!Array.isArray(j.rows) || !j.rows.length) {
      return NextResponse.json({ error: 'No projection could be read out of that file.' }, { status: 400 })
    }
    cols = (Array.isArray(j.cols) ? j.cols : []).map((x: any) => str(x).slice(0, 24)).slice(0, 14)
    rows = j.rows.slice(0, 30).map((r: any) => ({
      k: str(r?.k).slice(0, 60),
      cells: (Array.isArray(r?.cells) ? r.cells : []).map((x: any) => str(x).slice(0, 18)).slice(0, cols.length || 14),
    })).filter((r: any) => r.k || r.cells.some((c: string) => c))
    if (j.totals && str(j.totals.k)) {
      totals = { k: str(j.totals.k).slice(0, 60), cells: (Array.isArray(j.totals.cells) ? j.totals.cells : []).map((x: any) => str(x).slice(0, 18)).slice(0, cols.length || 14) }
    }
    sourceLabel = str(j.label).slice(0, 120) || 'Uploaded projection'
    if (!rows.length) return NextResponse.json({ error: 'No projection table could be read out of that file.' }, { status: 400 })
  }

  const prev: any = content.plan || {}
  content.plan = {
    ...prev,
    headline: str(prev.headline) || 'What your property could do',
    subtitle: str(prev.subtitle) || '',
    body: str(prev.body) || '',
    note: str(prev.note) || '',
    source: str(body?.label) || sourceLabel,
    cols, rows, ...(totals ? { totals } : {}),
  }
  // A projection that was pulled is a projection meant to be seen.
  if (Array.isArray(content.omit)) content.omit = content.omit.filter((k: string) => k !== 'plan')

  const { error } = await db.from('owner_reports').update({ content, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, source: content.plan.source, rows: rows.length, content })
}
