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
    const instruction = 'This document is a short-term rental revenue estimate for one property (usually a PriceLabs revenue estimate, sometimes a spreadsheet or a screenshot of one). Report ONLY figures printed in it. Return STRICT JSON: {"annualMid": number or null (the midpoint/expected annual revenue), "annualHigh": number or null (the top of the range, if the document gives one), "annualLow": number or null (the bottom, if given), "adr": number or null (average nightly rate), "occupancy": number or null (annual occupancy as a percent, 0-100), "months": [{"label": "JAN", "revenue": number or null, "adr": number or null, "occupancy": number or null}] (twelve entries in calendar order where the document shows a monthly breakdown; use null for any value it does not print), "unit": one short line naming the property/unit type if the document says, "label": one short line naming the source and period}. Rules: copy figures exactly, never recompute them, never fill a blank with an estimate, and never invent a month the document does not show. If the document is NOT a revenue estimate but does contain some other projection table, leave annualMid null and instead return {"cols": [column headers left to right], "rows": [{"k": row label, "cells": [one value per column, exactly as printed]}], "totals": {"k": label, "cells": [...]} or null} alongside it, every row padded to the same length as cols. If it contains neither, return {"annualMid": null, "months": [], "rows": []}.'
    const text = await anthropic({
      model: modelFor('reports'), max_tokens: 3000,
      system: 'You read revenue estimates and projections out of documents for a sales deck. Output STRICT JSON only. You never invent a figure, and you never recompute one.',
      messages: [{ role: 'user', content: block ? [block, { type: 'text', text: instruction }] : [{ type: 'text', text: instruction + '\n\nThe file:\n' + textBody }] }],
    })
    const j = parseJson(text)
    if (!j) return NextResponse.json({ error: 'No projection could be read out of that file.' }, { status: 400 })

    const n = (v: any): number | null => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null }
    const money = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
    const kk = (v: number) => (v >= 10_000 ? '$' + Math.round(v / 1000) + 'K' : '$' + Math.round(v).toLocaleString('en-US'))

    const mid = n(j.annualMid) || n(j.annualLow)
    const top = n(j.annualHigh)
    if (mid) {
      // THE SPLIT. uplift = top/mid − 1, shared evenly between rate and occupancy, so that
      // rate × occupancy reproduces the revenue uplift exactly: each gets √(1+uplift). With no
      // top-of-range figure there is no range, and the page prints one number rather than
      // inventing a second.
      const uplift = top && top > mid ? (top / mid) - 1 : 0
      const each = Math.sqrt(1 + uplift)
      const adr = n(j.adr)
      const occ = n(j.occupancy)
      // Occupancy is a percentage of a year and cannot be stretched past it. Capped at 95, which
      // is already higher than any real portfolio sustains.
      const occHigh = occ ? Math.min(95, occ * each) : null
      const annualHigh = top || mid
      const range = {
        annualLow: money(mid),
        annualHigh: money(annualHigh),
        monthlyLow: money(mid / 12),
        monthlyHigh: money(annualHigh / 12),
        rateLow: adr ? money(adr) : '',
        rateHigh: adr ? money(adr * each) : '',
        occLow: occ ? Math.round(occ) + '%' : '',
        occHigh: occHigh ? Math.round(occHigh) + '%' : '',
      }

      // The monthly bars follow the document's own seasonality. Where it prints revenue per month
      // we use it and scale the high end by the same uplift; where it prints only a share we
      // apportion the annual figure. A month the document does not show is not drawn.
      const rawMonths: any[] = Array.isArray(j.months) ? j.months.slice(0, 12) : []
      const sum = rawMonths.reduce((a, m) => a + (n(m?.revenue) || 0), 0)
      const months = rawMonths.map((m: any) => {
        const rev = n(m?.revenue)
        const base = rev != null ? (sum > 0 && Math.abs(sum - mid) / mid > 0.25 ? (rev / sum) * mid : rev) : null
        return {
          label: str(m?.label).slice(0, 4).toUpperCase(),
          base: base != null ? kk(base) : '',
          high: base != null ? kk(base * (1 + uplift)) : '',
          rate: n(m?.adr) != null ? money(Number(m.adr)) : '',
          occ: n(m?.occupancy) != null ? Math.round(Number(m.occupancy)) + '%' : '',
          baseNum: base != null ? Math.round(base) : undefined,
          highNum: base != null ? Math.round(base * (1 + uplift)) : undefined,
        }
      }).filter((m: any) => m.label)

      const prevPlan: any = content.plan || {}
      content.plan = {
        ...prevPlan,
        headline: str(prevPlan.headline) || 'Our projected range',
        subtitle: str(prevPlan.subtitle) || str(j.unit).slice(0, 80),
        body: str(prevPlan.body) || '',
        note: str(prevPlan.note) || '',
        source: str(body?.label) || str(j.label).slice(0, 120) || 'Market revenue estimate',
        range, months,
        cols: Array.isArray(prevPlan.cols) ? prevPlan.cols : [],
        rows: Array.isArray(prevPlan.rows) ? prevPlan.rows : [],
      }
      if (Array.isArray(content.omit)) content.omit = content.omit.filter((k: string) => k !== 'plan')
      const { error: errR } = await db.from('owner_reports').update({ content, updated_at: new Date().toISOString() }).eq('id', id)
      if (errR) return NextResponse.json({ error: errR.message }, { status: 500 })
      return NextResponse.json({ ok: true, source: content.plan.source, range, months: months.length, content })
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
