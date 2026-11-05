// CLEANING INVOICES (Jon, 2026-11-05: "create a process for team to submit an invoice and it will
// review and ensure that it matches our cleans, and will flag if it does not").
//
// The office uploads the invoice a cleaning vendor sent (PDF, photo or spreadsheet). The model reads
// it into lines — date, unit, service, amount — and every line is checked against the housekeeping
// tasks Breezeway has for that unit (breezeway_tasks_sync):
//
//   match          a finished clean at that unit on that date
//   date_off       a finished clean at that unit, but a day either side of the date billed
//   not_done       a clean was scheduled there but never finished (cancelled / still open)
//   no_clean       no housekeeping task at that unit anywhere near that date
//   duplicate      the same clean billed twice — on this invoice, or on an earlier one
//   unknown_unit   the line names a unit we cannot find
//
// Plus the other way round: finished cleans at the invoice's units in its period that are not on it
// (shown, never flagged — under-billing is the vendor's problem to raise). Prices are NOT checked:
// Jon chose "only check the cleans". Nothing here is paid or sent anywhere; a person approves or
// disputes. Invoices live in app_settings (clean_invoice:<id> + an index) so no migration is needed.
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { anthropicMessages } from './anthropic-call'
import { textOf } from './anthropic-text'
import { modelPairFor } from './ai-models'
import { getSetting, setSetting } from './app-settings'
import { pageRows } from './db-page'

export type Verdict = 'match' | 'date_off' | 'not_done' | 'no_clean' | 'duplicate' | 'unknown_unit'
export const VERDICT_LABEL: Record<Verdict, string> = {
  match: 'Matches a clean', date_off: 'Clean on a different day', not_done: 'Clean not finished', no_clean: 'No clean on record', duplicate: 'Billed twice', unknown_unit: 'Unit not found',
}
export const FLAGGED: Verdict[] = ['date_off', 'not_done', 'no_clean', 'duplicate', 'unknown_unit']

export type InvLine = {
  n: number; date: string | null; unitText: string; service: string; qty: number; amount: number | null
  listingId: string | null; unit: string | null; verdict: Verdict; why: string
  clean: { taskId: string; date: string | null; status: string | null; name: string | null; cleaner: string | null; finishedAt: string | null; report: string | null } | null
  resolved?: { by: string; at: string; note: string } | null
}
export type Invoice = {
  id: string; vendor: string; number: string | null; invoiceDate: string | null; periodFrom: string | null; periodTo: string | null
  total: number | null; file: { path: string; name: string; type: string } | null
  lines: InvLine[]; unbilled: { taskId: string; date: string | null; unit: string; name: string | null; cleaner: string | null }[]
  status: 'review' | 'approved' | 'disputed'; note: string | null
  uploadedBy: string | null; uploadedAt: string; reviewedBy: string | null; reviewedAt: string | null; checkedAt: string
}
export type InvRow = Pick<Invoice, 'id' | 'vendor' | 'number' | 'invoiceDate' | 'periodFrom' | 'periodTo' | 'total' | 'status' | 'uploadedAt' | 'uploadedBy'> & { lines: number; flagged: number; flaggedAmount: number; matched: number; unbilled: number }

const KEY = (id: string) => 'clean_invoice:' + id
const INDEX = 'clean_invoices_index'
const BUCKET = 'agent-files'
const DATE = /^\d{4}-\d{2}-\d{2}$/
const str = (v: any) => (v == null ? '' : String(v)).trim()
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const etDay = (iso: string | null) => iso ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso)) : null
const DONE = /finish|complet|closed|approved/i
/** "Opal Works Opal Works" → "Opal Works": Breezeway sends a company as first + last name. */
const who = (n: string | null) => { const s = str(n); if (!s) return null; const h = s.split(' '); const k = h.length / 2; return h.length % 2 === 0 && h.slice(0, k).join(' ') === h.slice(k).join(' ') ? h.slice(0, k).join(' ') : s }

// ── Reading the invoice ─────────────────────────────────────────────────────────────────────────
type Read = { vendor: string; number: string | null; invoiceDate: string | null; periodFrom: string | null; periodTo: string | null; total: number | null; lines: { date: string | null; unit: string; service: string; qty: number; amount: number | null }[] }

const PROMPT = `You read cleaning invoices for a short-term rental company in South Florida. Return ONLY JSON:
{"vendor": string, "number": string|null, "invoiceDate": "YYYY-MM-DD"|null, "periodFrom": "YYYY-MM-DD"|null, "periodTo": "YYYY-MM-DD"|null, "total": number|null,
 "lines": [{"date": "YYYY-MM-DD"|null, "unit": string, "service": string, "qty": number, "amount": number|null}]}
Rules: one entry per billed clean or service line, in the order printed. "unit" is the unit / apartment / property exactly as written (e.g. "Capri 110", "101/2 Lucerne", "PT 1203"). If one printed line covers several units or dates, split it into one entry per unit and date. qty is how many cleans the line bills (default 1). Amounts as plain numbers. Dates as YYYY-MM-DD (assume the invoice's year when a date has none). Skip subtotal, tax and total rows from "lines" but put the grand total in "total". Do not invent anything that is not on the document.`

export async function readInvoice(bytes: Uint8Array, mediaType: string, name: string): Promise<Read> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('AI not configured — add ANTHROPIC_API_KEY in Vercel.')
  let block: any
  if (/pdf/i.test(mediaType) || /\.pdf$/i.test(name)) block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } }
  else if (/^image\//i.test(mediaType)) block = { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') } }
  else block = { type: 'text', text: `Invoice file "${name}":\n\n` + Buffer.from(bytes).toString('utf8').slice(0, 120000) }
  const { model, fallback } = await modelPairFor('clean-invoice-read')
  const r = await anthropicMessages(key, { model, max_tokens: 16000, system: PROMPT, messages: [{ role: 'user', content: [block, { type: 'text', text: 'Read this invoice into the JSON.' }] }] }, fallback, 'clean-invoice-read')
  if (!r.ok) throw new Error(String(r.data?.error?.message || `reading failed (${r.status})`).slice(0, 300))
  const t = textOf(r.data)
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
  const d = (v: any) => DATE.test(str(v)) ? str(v) : null
  const n = (v: any) => v == null || v === '' || isNaN(Number(v)) ? null : Number(v)
  return {
    vendor: str(j.vendor) || 'Unknown vendor', number: str(j.number) || null, invoiceDate: d(j.invoiceDate), periodFrom: d(j.periodFrom), periodTo: d(j.periodTo), total: n(j.total),
    lines: (Array.isArray(j.lines) ? j.lines : []).map((l: any) => ({ date: d(l.date), unit: str(l.unit), service: str(l.service), qty: Math.max(1, Math.round(n(l.qty) || 1)), amount: n(l.amount) })).filter((l: any) => l.unit || l.date),
  }
}

// ── Finding the unit ────────────────────────────────────────────────────────────────────────────
type Listing = { id: string; name: string; building: string }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9/]+/g, ' ').replace(/\s+/g, ' ').trim()
/** The unit numbers in a string: "101/2", "1203", "4B". */
const numbersIn = (s: string) => Array.from(norm(s).matchAll(/\b(\d+[a-z]?(?:\/\d+)?)\b/g)).map(m => m[1])

export function findListing(text: string, listings: Listing[]): Listing | null {
  const t = norm(text)
  if (!t) return null
  const exact = listings.find(l => norm(l.name) === t)
  if (exact) return exact
  const nums = numbersIn(text)
  let best: { l: Listing; score: number } | null = null
  for (const l of listings) {
    const ln = norm(l.name), lb = norm(l.building)
    const lnums = numbersIn(l.name)
    let score = 0
    if (lb && (t.includes(lb) || lb.split(' ').some(w => w.length > 3 && t.includes(w)))) score += 2
    const numHit = nums.find(n => lnums.includes(n))
    if (numHit) score += numHit.includes('/') ? 4 : 3
    else if (nums.length && lnums.length) continue      // the invoice names a number that is not this unit's
    if (ln.includes(t) || t.includes(ln)) score += 3
    if (score >= 5 && (!best || score > best.score)) best = { l, score }
  }
  return best?.l || null
}

// ── Checking every line ─────────────────────────────────────────────────────────────────────────
type Task = { id: string; reference_property_id: string; scheduled_date: string | null; status: string | null; name: string | null; assignee_name: string | null; finished_by_name: string | null; finished_at: string | null; report_url: string | null }

export async function checkInvoice(read: Read, opts: { id: string; excludeId?: string } ): Promise<{ lines: InvLine[]; unbilled: Invoice['unbilled'] }> {
  const db = supabaseAdmin()
  const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building').limit(2000)
  const listings: Listing[] = ((ls || []) as any[]).map(l => ({ id: String(l.id), name: str(l.nickname || l.title), building: str(l.building) }))
  const matched = read.lines.map(l => findListing(l.unit, listings))
  const ids = Array.from(new Set(matched.filter(Boolean).map(l => l!.id)))

  const dates = read.lines.map(l => l.date).filter(Boolean) as string[]
  const from = addDays([read.periodFrom, ...dates].filter(Boolean).sort()[0] || addDays(new Date().toISOString().slice(0, 10), -45), -3)
  const to = addDays([read.periodTo, ...dates].filter(Boolean).sort().reverse()[0] || new Date().toISOString().slice(0, 10), 3)
  const tasks: Task[] = ids.length ? (await pageRows((a, b) => db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,scheduled_date,status,name,assignee_name,finished_by_name,finished_at,report_url')
    .eq('type_department', 'housekeeping').in('reference_property_id', ids).gte('scheduled_date', from).lte('scheduled_date', to)
    .order('scheduled_date').order('id').range(a, b), 10)).rows as any : []
  const byUnit = new Map<string, Task[]>()
  for (const t of tasks) { const k = String(t.reference_property_id); (byUnit.get(k) || byUnit.set(k, []).get(k)!).push(t) }

  // Cleans already billed on earlier invoices (any status but disputed lines that were resolved).
  const billedBefore = new Map<string, string>()
  for (const row of await listInvoices()) {
    if (row.id === opts.excludeId || row.id === opts.id) continue
    const inv = await getInvoice(row.id)
    for (const l of inv?.lines || []) if (l.clean && (l.verdict === 'match' || l.verdict === 'date_off')) billedBefore.set(l.clean.taskId, `${inv!.vendor}${inv!.number ? ' #' + inv!.number : ''}`)
  }

  const used = new Set<string>()
  const seen = new Map<string, number>()
  const out: InvLine[] = []
  const shape = (t: Task): InvLine['clean'] => ({ taskId: String(t.id), date: t.scheduled_date, status: t.status, name: t.name, cleaner: who(t.finished_by_name || t.assignee_name), finishedAt: t.finished_at, report: t.report_url })
  const dayOf = (t: Task) => etDay(t.finished_at) || t.scheduled_date
  read.lines.forEach((l, i) => {
    const lst = matched[i]
    for (let q = 0; q < l.qty; q++) {
      const base = { n: out.length + 1, date: l.date, unitText: l.unit, service: l.service, qty: 1, amount: l.amount == null ? null : Math.round((l.amount / l.qty) * 100) / 100, listingId: lst?.id || null, unit: lst?.name || null }
      if (!lst) { out.push({ ...base, verdict: 'unknown_unit', why: `No unit in Lighthouse matches “${l.unit}”.`, clean: null }); continue }
      const k = lst.id + '|' + (l.date || '')
      if (l.date && (seen.get(k) || 0) > 0 && !(byUnit.get(lst.id) || []).some(t => !used.has(String(t.id)) && dayOf(t) === l.date && DONE.test(String(t.status)))) {
        out.push({ ...base, verdict: 'duplicate', why: `${lst.name} on ${l.date} is already billed on this invoice, and there is only one clean that day.`, clean: null }); continue
      }
      seen.set(k, (seen.get(k) || 0) + 1)
      const cands = (byUnit.get(lst.id) || []).filter(t => !used.has(String(t.id)))
      const done = cands.filter(t => DONE.test(String(t.status)))
      const pick = (arr: Task[], d: string, w: number) => arr.find(t => dayOf(t) === d || t.scheduled_date === d) || (w ? arr.find(t => [addDays(d, -w), addDays(d, w)].includes(String(dayOf(t))) || [addDays(d, -w), addDays(d, w)].includes(String(t.scheduled_date))) : undefined)
      let t: Task | undefined, verdict: Verdict, why: string
      if (l.date) {
        t = pick(done, l.date, 0)
        if (t) { const by = who(t.finished_by_name || t.assignee_name); verdict = 'match'; why = (dayOf(t) === l.date ? `Finished ${dayOf(t)}` : `Scheduled ${t.scheduled_date}, finished ${dayOf(t)}`) + (by ? ' by ' + by : '') + '.' }
        else if ((t = pick(done, l.date, 1))) { verdict = 'date_off'; why = `Billed ${l.date}; the clean on record was ${dayOf(t)}.` }
        else if ((t = pick(cands, l.date, 1))) { verdict = 'not_done'; why = `A clean was scheduled ${t.scheduled_date} but is “${t.status || 'open'}”, not finished.` }
        else { verdict = 'no_clean'; why = `No housekeeping task at ${lst.name} on or around ${l.date}.` }
      } else {
        t = done.find(x => !read.periodFrom || ((dayOf(x) || '') >= read.periodFrom && (dayOf(x) || '') <= (read.periodTo || '9999')))
        if (t) { verdict = 'match'; why = `No date on the line; matched to the clean finished ${dayOf(t)}.` }
        else { verdict = 'no_clean'; why = `No date on the line, and no unbilled finished clean at ${lst.name} in the period.` }
      }
      if (t && (verdict === 'match' || verdict === 'date_off') && billedBefore.has(String(t.id))) {
        out.push({ ...base, verdict: 'duplicate', why: `This clean (${dayOf(t)}) was already billed on ${billedBefore.get(String(t.id))}.`, clean: shape(t) }); continue
      }
      if (t) used.add(String(t.id))
      out.push({ ...base, verdict: verdict!, why: why!, clean: t ? shape(t) : null })
    }
  })

  // Finished cleans at these units in the period that the invoice does not bill.
  const pf = read.periodFrom || dates.sort()[0] || from, pt = read.periodTo || dates.sort().reverse()[0] || to
  const unbilled = tasks.filter(t => DONE.test(String(t.status)) && !used.has(String(t.id)) && !billedBefore.has(String(t.id)) && (dayOf(t) || '') >= pf && (dayOf(t) || '') <= pt)
    .map(t => ({ taskId: String(t.id), date: dayOf(t), unit: listings.find(l => l.id === String(t.reference_property_id))?.name || String(t.reference_property_id), name: t.name, cleaner: who(t.finished_by_name || t.assignee_name) }))
  return { lines: out, unbilled }
}

// ── Storage ─────────────────────────────────────────────────────────────────────────────────────
export async function listInvoices(): Promise<InvRow[]> {
  const v = await getSetting<{ rows: InvRow[] } | null>(INDEX, null).catch(() => null)
  return Array.isArray(v?.rows) ? v!.rows : []
}
export async function getInvoice(id: string): Promise<Invoice | null> {
  return await getSetting<Invoice | null>(KEY(id), null).catch(() => null)
}
function rowOf(inv: Invoice): InvRow {
  const flagged = inv.lines.filter(l => FLAGGED.includes(l.verdict) && !l.resolved)
  return { id: inv.id, vendor: inv.vendor, number: inv.number, invoiceDate: inv.invoiceDate, periodFrom: inv.periodFrom, periodTo: inv.periodTo, total: inv.total, status: inv.status, uploadedAt: inv.uploadedAt, uploadedBy: inv.uploadedBy,
    lines: inv.lines.length, flagged: flagged.length, flaggedAmount: Math.round(flagged.reduce((a, l) => a + (l.amount || 0), 0) * 100) / 100, matched: inv.lines.filter(l => l.verdict === 'match').length, unbilled: inv.unbilled.length }
}
export async function saveInvoice(inv: Invoice): Promise<InvRow> {
  await setSetting(KEY(inv.id), inv, inv.reviewedBy || inv.uploadedBy || 'clean-invoices')
  const rows = (await listInvoices()).filter(r => r.id !== inv.id)
  const row = rowOf(inv)
  rows.unshift(row)
  rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  await setSetting(INDEX, { rows: rows.slice(0, 500) }, 'clean-invoices')
  return row
}
export async function removeInvoice(id: string): Promise<void> {
  const rows = (await listInvoices()).filter(r => r.id !== id)
  await setSetting(INDEX, { rows }, 'clean-invoices')
  await supabaseAdmin().from('app_settings').delete().eq('key', KEY(id))
}

/** Upload → read → check → save. */
export async function submitInvoice(file: File, who: string | null, override: { vendor?: string; periodFrom?: string; periodTo?: string } = {}): Promise<Invoice> {
  const id = randomBytes(6).toString('hex')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream')
  const path = `clean-invoices/${id}/${file.name.replace(/[^\w.\-]+/g, '_')}`
  const up = await supabaseAdmin().storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: true })
  const read = await readInvoice(bytes, type, file.name)
  if (override.vendor) read.vendor = override.vendor
  if (override.periodFrom && DATE.test(override.periodFrom)) read.periodFrom = override.periodFrom
  if (override.periodTo && DATE.test(override.periodTo)) read.periodTo = override.periodTo
  const { lines, unbilled } = await checkInvoice(read, { id })
  const now = new Date().toISOString()
  const inv: Invoice = { id, vendor: read.vendor, number: read.number, invoiceDate: read.invoiceDate, periodFrom: read.periodFrom, periodTo: read.periodTo, total: read.total,
    file: up.error ? null : { path, name: file.name, type }, lines, unbilled, status: 'review', note: null, uploadedBy: who, uploadedAt: now, reviewedBy: null, reviewedAt: null, checkedAt: now }
  await saveInvoice(inv)
  return inv
}

/** Re-run the check (cleans may have synced since): keeps resolutions on lines that still read the same. */
export async function recheckInvoice(id: string): Promise<Invoice | null> {
  const inv = await getInvoice(id)
  if (!inv) return null
  const read: Read = { vendor: inv.vendor, number: inv.number, invoiceDate: inv.invoiceDate, periodFrom: inv.periodFrom, periodTo: inv.periodTo, total: inv.total,
    lines: inv.lines.map(l => ({ date: l.date, unit: l.unitText, service: l.service, qty: 1, amount: l.amount })) }
  const { lines, unbilled } = await checkInvoice(read, { id, excludeId: id })
  lines.forEach((l, i) => { const old = inv.lines[i]; if (old?.resolved && old.unitText === l.unitText && old.date === l.date && FLAGGED.includes(l.verdict)) l.resolved = old.resolved })
  inv.lines = lines; inv.unbilled = unbilled; inv.checkedAt = new Date().toISOString()
  await saveInvoice(inv)
  return inv
}

export async function fileUrl(inv: Invoice): Promise<string | null> {
  if (!inv.file) return null
  const s = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(inv.file.path, 600)
  return s.data?.signedUrl || null
}
