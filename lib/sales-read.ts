// READ PROJECTIONS FROM ANYTHING (Jon, 2026-11-11: "upload a data sheet in any format and build a
// projection… scan [the website], build the room type list… projections per unit, manually or upload a
// deck at property level or unit level").
//
// Two readers, one answer shape (SalesRead):
//   readFile   — Excel (.xlsx), CSV/TSV/text, Word (.docx), PDF (a deck or a report), or a photo or
//                screenshot of a sheet. Spreadsheets and Word become text here; PDFs and images go to
//                the model as they are. The model returns the unit types it finds, with the figures
//                it can see: yearly gross (low/high), monthly figures, nightly rate, occupancy, size.
//   readWebsite — a building's own site: its name, area, address and the residence types it sells
//                (studio, one-bedroom, 2 bed + den…), with sizes. No revenue (a sales site has none).
// Scope: 'property' reads every unit type in the file; 'unit' reads the one named in `unit` (a unit
// type's own sheet or deck), so it can be uploaded against that floor plan alone.
// Nothing is invented: a figure the source does not show comes back empty, and the page asks for it.
import 'server-only'
import ExcelJS from 'exceljs'
import { anthropicMessages, textOf } from './anthropic-call'
import { modelPairFor } from './ai-models'
import { safeGet } from './safe-fetch'

export type ReadPlan = {
  name: string; sf?: string; beds?: number | null
  lo?: number | null; hi?: number | null
  /** Twelve monthly gross figures, January first, when the source has them. */
  months?: number[] | null
  nightlyLo?: number | null; nightlyHi?: number | null
  occLo?: number | null; occHi?: number | null
  note?: string
}
export type ReadComp = { name: string; market?: string; basis?: string; lo?: number | null; hi?: number | null; nightlyLo?: number | null; nightlyHi?: number | null; occLo?: number | null; occHi?: number | null }
export type SalesRead = { building?: string; area?: string; address?: string; website?: string; plans: ReadPlan[]; comps: ReadComp[]; summary: string }

export const READ_ACCEPT = '.xlsx,.xlsm,.csv,.tsv,.txt,.md,.json,.docx,.pdf,.png,.jpg,.jpeg,.webp'
export const READ_MAX = 20 * 1024 * 1024
const IMG: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
const ext = (n: string) => (String(n).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '')

async function sheetText(bytes: Uint8Array): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(bytes) as any)
  const out: string[] = []
  wb.eachSheet(ws => {
    out.push(`## Sheet: ${ws.name}`)
    let n = 0
    ws.eachRow({ includeEmpty: false }, row => {
      if (n++ > 400) return
      const vals = (row.values as any[]).slice(1).map(v => {
        if (v == null) return ''
        if (typeof v === 'object') return v.result != null ? String(v.result) : v.text != null ? String(v.text) : v.richText ? v.richText.map((x: any) => x.text).join('') : v instanceof Date ? v.toISOString().slice(0, 10) : ''
        return String(v)
      })
      out.push(vals.join('\t'))
    })
  })
  return out.join('\n').slice(0, 120_000)
}

const SYSTEM = `You read short-term rental projection material for a property manager's sales team: spreadsheets, revenue decks, CMA reports, pro formas, screenshots. Return JSON only, no prose, in exactly this shape:
{"building":string|null,"area":string|null,"address":string|null,"summary":string,
 "plans":[{"name":string,"sf":string|null,"beds":number|null,"lo":number|null,"hi":number|null,"months":number[12]|null,"nightlyLo":number|null,"nightlyHi":number|null,"occLo":number|null,"occHi":number|null,"note":string|null}],
 "comps":[{"name":string,"market":string|null,"basis":string|null,"lo":number|null,"hi":number|null,"nightlyLo":number|null,"nightlyHi":number|null,"occLo":number|null,"occHi":number|null}]}
Rules:
- "plans" are the unit types (floor plans / room types) of the property this material is about. "comps" are OTHER properties it compares against. If unsure, it is a plan.
- lo/hi are GROSS rental revenue per YEAR in dollars. A single figure: lo = hi. Monthly figures for a year: put them in "months" (January first) and set lo = hi = their sum unless the source gives a range. A monthly average only: multiply by 12.
- Occupancy in percent (70, not 0.7). Nightly rate in dollars.
- Never invent a number. If the source does not show it, null.
- Never include sale prices or unit costs.
- "summary": one sentence saying what the material is and what you found.`

async function ask(content: any[], task: string): Promise<SalesRead> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('AI is not configured (ANTHROPIC_API_KEY).')
  const { model, fallback } = await modelPairFor('sales-read')
  const r = await anthropicMessages(key, { model, max_tokens: 8000, system: SYSTEM, messages: [{ role: 'user', content: [...content, { type: 'text', text: task }] }] }, fallback, 'sales-read')
  if (!r.ok) throw new Error(String(r.data?.error?.message || 'The reader failed (' + r.status + ')').slice(0, 300))
  const raw = textOf(r.data)
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('The reader returned nothing usable.')
  let j: any
  try { j = JSON.parse(m[0]) } catch { throw new Error('The reader returned something that is not a table of figures.') }
  const n = (v: any) => { const x = Number(String(v ?? '').replace(/[$,%\s]/g, '')); return Number.isFinite(x) && x > 0 ? x : null }
  const plans: ReadPlan[] = (Array.isArray(j.plans) ? j.plans : []).filter((p: any) => p && String(p.name || '').trim()).slice(0, 40).map((p: any) => {
    const months = Array.isArray(p.months) && p.months.length === 12 && p.months.every((x: any) => n(x) != null) ? p.months.map((x: any) => n(x)!) : null
    let lo = n(p.lo), hi = n(p.hi)
    if (months && !lo) { const s = months.reduce((a: number, b: number) => a + b, 0); lo = s; hi = hi || s }
    if (lo && !hi) hi = lo
    if (lo && hi && lo > hi) [lo, hi] = [hi, lo]
    let occLo = n(p.occLo), occHi = n(p.occHi)
    if (occLo && occLo <= 1) occLo = Math.round(occLo * 100)
    if (occHi && occHi <= 1) occHi = Math.round(occHi * 100)
    return { name: String(p.name).trim().slice(0, 60), sf: p.sf ? String(p.sf).slice(0, 40) : '', beds: n(p.beds), lo, hi, months, nightlyLo: n(p.nightlyLo), nightlyHi: n(p.nightlyHi), occLo, occHi: occHi || occLo, note: p.note ? String(p.note).slice(0, 200) : '' }
  })
  const comps: ReadComp[] = (Array.isArray(j.comps) ? j.comps : []).filter((c: any) => c && String(c.name || '').trim()).slice(0, 20).map((c: any) => ({
    name: String(c.name).trim().slice(0, 80), market: c.market ? String(c.market).slice(0, 60) : '', basis: c.basis ? String(c.basis).slice(0, 60) : '',
    lo: n(c.lo), hi: n(c.hi) || n(c.lo), nightlyLo: n(c.nightlyLo), nightlyHi: n(c.nightlyHi), occLo: n(c.occLo), occHi: n(c.occHi) || n(c.occLo),
  }))
  return { building: j.building || undefined, area: j.area || undefined, address: j.address || undefined, plans, comps, summary: String(j.summary || '').slice(0, 300) }
}

export async function readFile(file: File, scope: 'property' | 'unit', unit?: string): Promise<SalesRead> {
  const name = String(file.name || 'file')
  if (file.size > READ_MAX) throw new Error('Files up to 20MB.')
  const e = ext(name)
  const bytes = new Uint8Array(await file.arrayBuffer())
  let content: any[]
  if (e === 'xlsx' || e === 'xlsm') content = [{ type: 'text', text: `The spreadsheet "${name}", one line per row, cells separated by tabs:\n\n` + await sheetText(bytes) }]
  else if (['csv', 'tsv', 'txt', 'md', 'json'].includes(e)) content = [{ type: 'text', text: `The file "${name}":\n\n` + new TextDecoder().decode(bytes).slice(0, 120_000) }]
  else if (e === 'docx') { const mammoth: any = await import('mammoth'); const r = await mammoth.extractRawText({ buffer: Buffer.from(bytes) }); content = [{ type: 'text', text: `The document "${name}":\n\n` + String(r.value || '').slice(0, 120_000) }] }
  else if (e === 'pdf') content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } }]
  else if (IMG[e]) content = [{ type: 'image', source: { type: 'base64', media_type: IMG[e], data: Buffer.from(bytes).toString('base64') } }]
  else if (e === 'xls') throw new Error('Older .xls files cannot be read. Save it as .xlsx or CSV and upload again.')
  else throw new Error('That file type cannot be read. Excel, CSV, PDF, Word or a picture work.')
  const task = scope === 'unit'
    ? `This material is about ONE unit type${unit ? `, "${unit}"` : ''}. Return exactly one plan for it${unit ? ` named "${unit}"` : ''}, with the figures shown, plus any comparables.`
    : 'Return every unit type of the property this material is about, with the figures shown, and any comparables.'
  return ask(content, task)
}

export async function readText(text: string, scope: 'property' | 'unit', unit?: string): Promise<SalesRead> {
  return ask([{ type: 'text', text: 'Pasted material:\n\n' + String(text).slice(0, 120_000) }], scope === 'unit' ? `One unit type${unit ? `, "${unit}"` : ''}: return exactly one plan for it.` : 'Return every unit type with its figures, and any comparables.')
}

/** A building's own website: the residence types it sells, with sizes. Revenue is never on a sales site. */
export async function readWebsite(url: string): Promise<SalesRead> {
  const raw = /^https?:\/\//i.test(url) ? url : 'https://' + url
  const page = await safeGet(raw)
  const strip = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  let text = strip(page.text).slice(0, 40_000)
  // The residences or floor-plans page usually holds the unit types; follow up to two such links.
  const links = Array.from(new Set(Array.from(page.text.matchAll(/href=["']([^"'#]+)["']/gi)).map(m => m[1]).filter(h => /residen|floor|plan|unit|layout|availab/i.test(h)))).slice(0, 2)
  for (const h of links) {
    try { const sub = await safeGet(new URL(h, page.url).toString(), 1_200_000); text += '\n\n## ' + h + '\n' + strip(sub.text).slice(0, 30_000) } catch { /* one page is enough */ }
  }
  const r = await ask([{ type: 'text', text: `The website ${page.url}, as text:\n\n${text}` }],
    'This is a residential building\'s own website. Return the building name, the area (neighbourhood), the address if shown, and every residence type it offers as "plans" (for example Studio, 1 Bed, 1 Bed + Den, 2 Bed), with the interior size range in "sf" like "693 to 807 SF" and "beds". Revenue figures will not be on this site: leave lo, hi, months, nightly and occupancy null. No comps.')
  return { ...r, website: page.url, comps: [] }
}
