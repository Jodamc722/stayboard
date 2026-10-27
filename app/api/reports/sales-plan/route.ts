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
    let block: any = null
    let textBody = ''
    try {
      const r = await fetch(url)
      if (!r.ok) return NextResponse.json({ error: 'Could not read that file.' }, { status: 400 })
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length > 8 * 1024 * 1024) return NextResponse.json({ error: 'That file is too large to read (8MB max).' }, { status: 400 })
      if (/\.pdf(\?|$)/i.test(url)) {
        block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
      } else {
        textBody = buf.toString('utf8').slice(0, 120_000)
        // A spreadsheet saved as .xlsx is a zip, not text; it arrives here as mojibake.
        if (/\.(xlsx|xls|numbers)(\?|$)/i.test(url) || /^PK\x03\x04/.test(textBody)) {
          return NextResponse.json({ error: 'Export the projection as CSV or PDF and upload that — a spreadsheet file cannot be read directly.' }, { status: 400 })
        }
      }
    } catch { return NextResponse.json({ error: 'Could not read that file.' }, { status: 400 }) }

    const instruction = 'This is a revenue projection for a short-term rental property. Pull the table out of it EXACTLY as printed. Return STRICT JSON only: {"cols": [column headers left to right, usually months], "rows": [{"k": the row label, "cells": [one value per column, as printed including $ and % signs]}], "totals": {"k": the total row label, "cells": [...]} or null, "label": one short line naming what this projection is and the period it covers}. Rules: copy figures exactly as they appear, never recompute, never round, never fill a blank cell with an estimate. Every row must have exactly as many cells as there are cols; pad with "" where the document is blank. If the document contains no projection table you can read, return {"rows": []}.'
    const text = await anthropic({
      model: modelFor('reports'), max_tokens: 3000,
      system: 'You extract tables from documents for a sales deck. Output STRICT JSON only. You never invent a figure.',
      messages: [{ role: 'user', content: block ? [block, { type: 'text', text: instruction }] : [{ type: 'text', text: instruction + '\n\nThe file:\n' + textBody }] }],
    })
    const j = parseJson(text)
    if (!j || !Array.isArray(j.rows) || !j.rows.length) {
      return NextResponse.json({ error: 'No projection table could be read out of that file.' }, { status: 400 })
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
