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
//   moved          billed on the checkout day; the clean was moved and finished later (fine: same clean)
//   other_cleaner  the clean was finished by someone who is not this vendor
//
// Plus the other way round: finished cleans at the invoice's units in its period that are not on it
// (shown, never flagged — under-billing is the vendor's problem to raise). Prices are NOT checked:
// Jon chose "only check the cleans". Nothing here is paid or sent anywhere; a person approves or
// disputes. Invoices live in app_settings (clean_invoice:<id> + an index) so no migration is needed.
//
// TWO MODELS (Jon, 2026-11-25): the same vendor can bill per clean on one invoice and per hour on the
// next (Opal does both; Atlantic bills hours; Pro Bowl bills cleans). An HOURS invoice is checked
// against the hours each person punched in Homebase in the worked period, and its total against the
// rates. The rules for both are lib/clean-invoice-rules.ts.
import 'server-only'
import { randomBytes } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { anthropicMessages } from './anthropic-call'
import { textOf } from './anthropic-text'
import { modelPairFor } from './ai-models'
import { getSetting, setSetting } from './app-settings'
import { pageRows } from './db-page'
import { nameMatches, nameMatchesRoster } from './person-name'
import {
  VERDICT_LABEL, FLAGGED, isOk, isFlagged, vendorWords, isVendorName, judgeDatedLine, MOVE_DAYS, workedInPeriod, wholeWeeks, billedByPerson, judgeHours, judgeAmount, agencyFor,
  type Verdict, type InvoiceModel, type DocKind, type TaskLite, type HoursRow, type Punch,
} from './clean-invoice-rules'

export { VERDICT_LABEL, FLAGGED }
export type { Verdict, InvoiceModel }

/** The document is a time report or something else that is not an invoice: nothing is saved. */
export class NotAnInvoice extends Error { kind: DocKind; constructor(kind: DocKind, msg: string) { super(msg); this.kind = kind } }

export type InvLine = {
  n: number; date: string | null; unitText: string; service: string; qty: number; amount: number | null
  listingId: string | null; unit: string | null; verdict: Verdict; why: string
  clean: { taskId: string; date: string | null; status: string | null; name: string | null; cleaner: string | null; finishedAt: string | null; report: string | null } | null
  /** The money at stake on a flagged line when it is not the whole amount (two extra hours, not the person's week). */
  risk?: number | null
  resolved?: { by: string; at: string; note: string } | null
}
export type HoursRead = { people: HoursRow[]; summary: { label: string; hours: number; rate: number | null; amount: number | null; ot: boolean }[]; feePerHour: number | null }
export type Invoice = {
  id: string; vendor: string; number: string | null; invoiceDate: string | null; periodFrom: string | null; periodTo: string | null
  total: number | null; file: { path: string; name: string; type: string } | null
  /** How the vendor bills on this invoice. Missing on invoices read before 2026-11-25: per clean. */
  model?: InvoiceModel
  /** An hours invoice as it was read, kept so "Check again" can re-run against Homebase. */
  hoursRead?: HoursRead
  lines: InvLine[]; unbilled: { taskId: string; date: string | null; unit: string; name: string | null; cleaner: string | null }[]
  status: 'review' | 'approved' | 'disputed'; note: string | null
  uploadedBy: string | null; uploadedAt: string; reviewedBy: string | null; reviewedAt: string | null; checkedAt: string
}
export type InvRow = Pick<Invoice, 'id' | 'vendor' | 'number' | 'invoiceDate' | 'periodFrom' | 'periodTo' | 'total' | 'status' | 'uploadedAt' | 'uploadedBy' | 'model'> & { lines: number; flagged: number; flaggedAmount: number; matched: number; unbilled: number }

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
type Read = { kind: DocKind; vendor: string; number: string | null; invoiceDate: string | null; periodFrom: string | null; periodTo: string | null; total: number | null; lines: { date: string | null; unit: string; service: string; qty: number; amount: number | null }[]; hours: HoursRead }

const PROMPT = `You read vendor invoices for a short-term rental company in South Florida. Vendors bill in one of two ways, and the same vendor can use both on different invoices. Return ONLY JSON:
{"kind": "per_clean"|"hours"|"timesheet"|"other", "vendor": string, "number": string|null, "invoiceDate": "YYYY-MM-DD"|null, "periodFrom": "YYYY-MM-DD"|null, "periodTo": "YYYY-MM-DD"|null, "total": number|null,
 "lines": [{"date": "YYYY-MM-DD"|null, "unit": string, "service": string, "qty": number, "amount": number|null}],
 "people": [{"name": string, "role": string|null, "market": string|null, "regHours": number, "otHours": number, "baseRate": number|null, "otRate": number|null, "amount": number|null}],
 "summary": [{"label": string, "hours": number, "rate": number|null, "amount": number|null, "ot": boolean}],
 "feePerHour": number|null}

KIND.
- "per_clean": the invoice bills cleans or services at named units or apartments (a unit and usually a date on each line).
- "hours": a staffing agency bills hours worked by the people it provides (regular and overtime hours at an hourly rate), whether it lists each employee, only totals by area, or both.
- "timesheet": a time report or payroll sheet with no invoice number and no amount due. It supports an invoice; it is not one.
- "other": anything else.

PER CLEAN → fill "lines", leave "people" and "summary" empty. One entry per billed clean or service line, in the order printed. "unit" is the unit / apartment / property exactly as written (e.g. "Capri 110", "101/2 Lucerne", "PT 1203"). If one printed line covers several units or dates, split it into one entry per unit and date. qty is how many cleans the line bills (default 1).

HOURS or TIMESHEET → leave "lines" empty.
- "people": one entry for every employee row anywhere in the document (a detail page after the invoice face counts). name as printed, first name then last name. role is the job printed (Housekeeper, Maintenance). market is the area heading the row sits under (Miami, Broward, Palm Beach). regHours and otHours as printed for that row (0 when blank). baseRate is the employee's hourly pay rate; otRate the overtime rate if printed. amount is the total billed for that row only when the document prints one. If the same person appears in two sections, give two entries.
- "summary": the billing rows on the invoice face when it bills totals instead of people (e.g. "Regular hours - Miami - $23.04", quantity 144.67, amount 3333.20 → {"label": "Housekeeping, regular hours, Miami", "hours": 144.67, "rate": 23.04, "amount": 3333.20, "ot": false}). Leave empty when the face lists the employees themselves.
- "feePerHour": the agency fee per hour when the document states one (e.g. "Agency fee is a flat $5.05/hr on all hours" → 5.05), else null.
- periodFrom and periodTo are the worked period or payroll period.

ALWAYS. Amounts and hours as plain numbers. Dates as YYYY-MM-DD (assume the invoice's year when a date has none). Skip subtotal, tax and total rows from the lists but put the grand total due in "total". Do not invent anything that is not on the document.`

export async function readInvoice(bytes: Uint8Array, mediaType: string, name: string): Promise<Read> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('AI not configured — add ANTHROPIC_API_KEY in Vercel.')
  let block: any
  if (/pdf/i.test(mediaType) || /\.pdf$/i.test(name)) block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(bytes).toString('base64') } }
  else if (/^image\//i.test(mediaType)) block = { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') } }
  else block = { type: 'text', text: `Invoice file "${name}":\n\n` + Buffer.from(bytes).toString('utf8').slice(0, 120000) }
  const { model, fallback } = await modelPairFor('clean-invoice-read')
  const r = await anthropicMessages(key, { model, max_tokens: 16000, system: PROMPT, messages: [{ role: 'user', content: [block, { type: 'text', text: 'Read this document into the JSON.' }] }] }, fallback, 'clean-invoice-read')
  if (!r.ok) throw new Error(String(r.data?.error?.message || `reading failed (${r.status})`).slice(0, 300))
  const t = textOf(r.data)
  const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
  const d = (v: any) => DATE.test(str(v)) ? str(v) : null
  const n = (v: any) => v == null || v === '' || isNaN(Number(v)) ? null : Number(v)
  const lines = (Array.isArray(j.lines) ? j.lines : []).map((l: any) => ({ date: d(l.date), unit: str(l.unit), service: str(l.service), qty: Math.max(1, Math.round(n(l.qty) || 1)), amount: n(l.amount) })).filter((l: any) => l.unit || l.date)
  const people: HoursRow[] = (Array.isArray(j.people) ? j.people : []).map((p: any) => ({ name: str(p.name), role: str(p.role) || null, market: str(p.market) || null, regHours: n(p.regHours) || 0, otHours: n(p.otHours) || 0, baseRate: n(p.baseRate), otRate: n(p.otRate), amount: n(p.amount) })).filter((p: HoursRow) => p.name)
  const summary = (Array.isArray(j.summary) ? j.summary : []).map((x: any) => ({ label: str(x.label), hours: n(x.hours) || 0, rate: n(x.rate), amount: n(x.amount), ot: x.ot === true })).filter((x: any) => x.label)
  // What the model called it, checked against what it actually found: a document with people and no
  // unit lines is an hours document whatever word came back, and the other way round.
  let kind: DocKind = ['per_clean', 'hours', 'timesheet', 'other'].includes(str(j.kind)) ? str(j.kind) as DocKind : 'other'
  if (kind !== 'timesheet') { if ((people.length || summary.length) && !lines.length) kind = 'hours'; else if (lines.length && !people.length && !summary.length) kind = 'per_clean' }
  return {
    kind, vendor: str(j.vendor) || 'Unknown vendor', number: str(j.number) || null, invoiceDate: d(j.invoiceDate), periodFrom: d(j.periodFrom), periodTo: d(j.periodTo), total: n(j.total),
    lines, hours: { people, summary, feePerHour: n(j.feePerHour) },
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

// ── Checking every line: per clean ──────────────────────────────────────────────────────────────
type Task = { id: string; reference_property_id: string; scheduled_date: string | null; status: string | null; name: string | null; assignee_name: string | null; finished_by_name: string | null; finished_at: string | null; report_url: string | null }
type Checked = { lines: InvLine[]; unbilled: Invoice['unbilled'] }
const NOT_A_STAY = /cancel|declin|inquiry|expired|closed/i

export async function checkInvoice(read: Read, opts: { id: string; excludeId?: string } ): Promise<Checked> {
  const db = supabaseAdmin()
  const { data: ls } = await db.from('guesty_listings').select('id,nickname,title,building').limit(2000)
  const listings: Listing[] = ((ls || []) as any[]).map(l => ({ id: String(l.id), name: str(l.nickname || l.title), building: str(l.building) }))
  const matched = read.lines.map(l => findListing(l.unit, listings))
  const ids = Array.from(new Set(matched.filter(Boolean).map(l => l!.id)))

  const dates = read.lines.map(l => l.date).filter(Boolean) as string[]
  const from = addDays([read.periodFrom, ...dates].filter(Boolean).sort()[0] || addDays(new Date().toISOString().slice(0, 10), -45), -3)
  // A moved clean lands after the day it was billed on: look a week and a bit past the last line.
  const to = addDays([read.periodTo, ...dates].filter(Boolean).sort().reverse()[0] || new Date().toISOString().slice(0, 10), MOVE_DAYS + 3)
  const tasks: Task[] = ids.length ? (await pageRows((a, b) => db.from('breezeway_tasks_sync')
    .select('id,reference_property_id,scheduled_date,status,name,assignee_name,finished_by_name,finished_at,report_url')
    .eq('type_department', 'housekeeping').in('reference_property_id', ids).gte('scheduled_date', from).lte('scheduled_date', to)
    .order('scheduled_date').order('id').range(a, b), 10)).rows as any : []
  const byUnit = new Map<string, Task[]>()
  for (const t of tasks) { const k = String(t.reference_property_id); (byUnit.get(k) || byUnit.set(k, []).get(k)!).push(t) }

  // The stays at these units: a clean billed on a checkout day may have been moved to a later day.
  const outs = new Map<string, string[]>(), ins = new Map<string, string[]>()
  if (ids.length) {
    try {
      const { rows } = await pageRows<any>((a, b) => db.from('guesty_reservations').select('id,listing_id,check_in,check_out,status')
        .in('listing_id', ids).gte('check_out', from).lte('check_in', to).order('check_out').order('id').range(a, b), 10)
      for (const r of rows) {
        if (NOT_A_STAY.test(str(r.status))) continue
        const k = String(r.listing_id), o = str(r.check_out).slice(0, 10), i = str(r.check_in).slice(0, 10)
        if (DATE.test(o)) (outs.get(k) || outs.set(k, []).get(k)!).push(o)
        if (DATE.test(i)) (ins.get(k) || ins.set(k, []).get(k)!).push(i)
      }
    } catch { /* without the stays a moved clean reads as "different day" or "no clean", as before */ }
  }

  // Cleans already billed on earlier invoices (any status but disputed lines that were resolved).
  const billedBefore = new Map<string, string>()
  for (const row of await listInvoices()) {
    if (row.id === opts.excludeId || row.id === opts.id || row.model === 'hours') continue
    const inv = await getInvoice(row.id)
    for (const l of inv?.lines || []) if (l.clean && (isOk(l.verdict) || l.verdict === 'date_off' || l.verdict === 'other_cleaner')) billedBefore.set(l.clean.taskId, `${inv!.vendor}${inv!.number ? ' #' + inv!.number : ''}`)
  }

  // Is this vendor a name in Breezeway at all? Opal is ("Opal Works Opal Works"). When it is, a clean
  // finished by somebody else is not this vendor's clean, and the cleans it did not bill are its own.
  const words = vendorWords(read.vendor)
  const theirs = (t: Task) => isVendorName(t.finished_by_name, words) || isVendorName(t.assignee_name, words)
  const vendorInBreezeway = words.length > 0 && tasks.some(theirs)

  const used = new Set<string>()
  const seen = new Map<string, number>()
  const out: InvLine[] = []
  const shape = (t: Task): InvLine['clean'] => ({ taskId: String(t.id), date: t.scheduled_date, status: t.status, name: t.name, cleaner: who(t.finished_by_name || t.assignee_name), finishedAt: t.finished_at, report: t.report_url })
  const dayOf = (t: Task) => etDay(t.finished_at) || t.scheduled_date
  const lite = (t: Task): TaskLite => ({ id: String(t.id), day: dayOf(t), scheduled: t.scheduled_date, done: DONE.test(String(t.status)), status: t.status, by: who(t.finished_by_name || t.assignee_name) })
  read.lines.forEach((l, i) => {
    const lst = matched[i]
    for (let q = 0; q < l.qty; q++) {
      const base = { n: out.length + 1, date: l.date, unitText: l.unit, service: l.service, qty: 1, amount: l.amount == null ? null : Math.round((l.amount / l.qty) * 100) / 100, listingId: lst?.id || null, unit: lst?.name || null }
      if (!lst) { out.push({ ...base, verdict: 'unknown_unit', why: `No unit in Lighthouse matches “${l.unit}”.`, clean: null }); continue }
      const k = lst.id + '|' + (l.date || '')
      const cands = (byUnit.get(lst.id) || []).filter(t => !used.has(String(t.id)))
      let t: Task | undefined, verdict: Verdict, why: string
      if (l.date) {
        const j = judgeDatedLine(l.date, lst.name, cands.map(lite), outs.get(lst.id) || [], ins.get(lst.id) || [])
        // The same unit and day a second time, with no second clean to give it: billed twice.
        if ((seen.get(k) || 0) > 0 && !isOk(j.verdict)) {
          out.push({ ...base, verdict: 'duplicate', why: `${lst.name} on ${l.date} is already billed on this invoice, and there is only one clean for it.`, clean: null }); continue
        }
        t = j.taskId ? cands.find(x => String(x.id) === j.taskId) : undefined
        verdict = j.verdict; why = j.why
      } else {
        const done = cands.filter(x => DONE.test(String(x.status)))
        t = done.find(x => !read.periodFrom || ((dayOf(x) || '') >= read.periodFrom && (dayOf(x) || '') <= (read.periodTo || '9999')))
        if (t) { verdict = 'match'; why = `No date on the line; matched to the clean finished ${dayOf(t)}.` }
        else { verdict = 'no_clean'; why = `No date on the line, and no unbilled finished clean at ${lst.name} in the period.` }
      }
      seen.set(k, (seen.get(k) || 0) + 1)
      const paid = t && (isOk(verdict) || verdict === 'date_off')
      if (t && paid && billedBefore.has(String(t.id))) {
        out.push({ ...base, verdict: 'duplicate', why: `This clean (${dayOf(t)}) was already billed on ${billedBefore.get(String(t.id))}.`, clean: shape(t) }); continue
      }
      if (t && paid) used.add(String(t.id))
      // Moved to someone else: the clean happened, but this vendor did not do it.
      if (t && isOk(verdict) && vendorInBreezeway && !theirs(t)) {
        const by = who(t.finished_by_name || t.assignee_name)
        verdict = 'other_cleaner'; why = `The clean at ${lst.name} (${dayOf(t)}) was ${by ? 'finished by ' + by : 'not assigned to this vendor'}, not ${read.vendor}.`
      }
      out.push({ ...base, verdict, why, clean: t ? shape(t) : null })
    }
  })

  // Finished cleans at these units in the period that the invoice does not bill (the vendor's own, when we can tell).
  const pf = read.periodFrom || dates.sort()[0] || from, pt = read.periodTo || dates.sort().reverse()[0] || to
  const unbilled = tasks.filter(t => DONE.test(String(t.status)) && !used.has(String(t.id)) && !billedBefore.has(String(t.id)) && (dayOf(t) || '') >= pf && (dayOf(t) || '') <= pt && (!vendorInBreezeway || theirs(t)))
    .map(t => ({ taskId: String(t.id), date: dayOf(t), unit: listings.find(l => l.id === String(t.reference_property_id))?.name || String(t.reference_property_id), name: t.name, cleaner: who(t.finished_by_name || t.assignee_name) }))
  return { lines: out, unbilled }
}

// ── Checking every line: hours, against Homebase ────────────────────────────────────────────────
const hh = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const niceDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const pkey = (s: string) => str(s).toLowerCase().replace(/[^a-z]+/g, ' ').trim()

export async function checkHours(read: Pick<Read, 'vendor' | 'number' | 'periodFrom' | 'periodTo' | 'total'> & { hours: HoursRead }, opts: { id: string; excludeId?: string }): Promise<Checked> {
  const people = billedByPerson(read.hours.people)
  const lines: InvLine[] = []
  const line = (unitText: string, service: string, amount: number | null, verdict: Verdict, why: string, extra: Partial<InvLine> = {}): InvLine =>
    ({ n: lines.length + 1, date: null, unitText, service, qty: 1, amount, listingId: null, unit: null, verdict, why, clean: null, ...extra })
  const said = (p: { where: string; reg: number; ot: number; baseRate: number | null }) => `${p.where ? p.where + ' · ' : ''}${hh(p.reg)} regular${p.ot > 0 ? ' + ' + hh(p.ot) + ' overtime' : ''}${p.baseRate ? ' at $' + hh(p.baseRate) : ''}`
  const allUnchecked = (why: string): Checked => {
    for (const p of people) lines.push(line(p.name, said(p), p.amount, 'unchecked', why))
    if (!people.length) lines.push(line('Hours billed', read.hours.summary.map(x => x.label).join('; ').slice(0, 200), read.total, 'unchecked', why))
    return { lines, unbilled: [] }
  }

  const today = new Date().toISOString().slice(0, 10)
  const from = read.periodFrom, to = read.periodTo && read.periodTo > today ? today : read.periodTo
  if (!from || !to || to < from) return allUnchecked('The invoice shows no worked period, so there are no days to look up in Homebase.')
  const period = `${niceDay(from)} to ${niceDay(to)}`

  let cards: Punch[]
  try {
    const { getTimecardsAudited } = await import('./homebase-labor')
    const tc = await getTimecardsAudited(from, to)
    if (!tc.complete) return allUnchecked(`Homebase did not return every week of ${period} just now. Use “Check again” in a minute.`)
    cards = tc.cards.map(c => ({ name: c.name, date: c.date, hours: c.hours }))
  } catch (e: any) { return allUnchecked(`Homebase could not be read (${str(e?.message || e).slice(0, 120)}). Use “Check again” in a minute.`) }

  const { getAgencies, staffByName, resolveStaff } = await import('./staffing')
  const [agencies, index] = await Promise.all([getAgencies(true), staffByName()])
  const agency = agencyFor(read.vendor, agencies)
  const labelOf = (key: string | null | undefined) => agencies.find(a => a.key === key)?.label || str(key)
  const byName = new Map<string, Punch[]>()
  for (const c of cards) (byName.get(c.name) || byName.set(c.name, []).get(c.name)!).push(c)
  const punched = Array.from(byName.keys())
  const weekly = wholeWeeks(from, to)
  const setFee = agency && agency.fee_per_hour > 0 ? agency.fee_per_hour : 0
  const fee = setFee || (read.hours.feePerHour && read.hours.feePerHour > 0 ? read.hours.feePerHour : 0)

  // The same person and days on an earlier invoice from this vendor: billed twice.
  const before = new Map<string, string>()
  for (const row of await listInvoices()) {
    if (row.id === opts.excludeId || row.id === opts.id || row.model !== 'hours') continue
    if (!row.periodFrom || !row.periodTo || row.periodTo < from || row.periodFrom > to) continue
    const inv = await getInvoice(row.id)
    if (!inv || !agencyFor(inv.vendor, agency ? [agency] : []) && pkey(inv.vendor) !== pkey(read.vendor)) continue
    for (const l of inv.lines) if (l.unit && (isOk(l.verdict) || l.verdict === 'hours_over' || l.verdict === 'ot_off')) before.set(l.unit, `${inv.vendor}${inv.number ? ' #' + inv.number : ''}`)
  }

  const matchedNames = new Set<string>()
  for (const p of people) {
    const rec = resolveStaff(p.name, index)
    const hb = nameMatchesRoster(p.name, punched) || (rec ? punched.find(n => nameMatches(n, rec.name)) || null : null)
    const worked = hb ? workedInPeriod(byName.get(hb) || [], from, to) : null
    const rate = p.baseRate ? p.baseRate + fee : null
    const otRate = p.baseRate ? (p.otRate || p.baseRate * 1.5) + fee : null
    const amount = p.amount != null ? p.amount : (rate && otRate ? Math.round((p.reg * rate + p.ot * otRate) * 100) / 100 : null)
    if (hb) matchedNames.add(hb)
    if (hb && before.has(hb)) { lines.push(line(p.name, said(p), amount, 'duplicate', `${hb}'s hours for these days are already on ${before.get(hb)}.`, { unit: hb })); continue }
    const j = judgeHours({ reg: p.reg, ot: p.ot }, worked, { known: !!hb || !!rec, weekly, period, rate, otRate })
    // Whose list the person is on in Lighthouse, said only when it disagrees with who is billing.
    const tag = agency && rec && rec.agency !== agency.key ? (rec.agency ? ` Lighthouse lists this person under ${labelOf(rec.agency)}, not ${agency.label}.` : ` Lighthouse has no agency set for this person.`) : ''
    lines.push(line(p.name, said(p), amount, j.verdict, j.why + tag, { unit: hb || rec?.name || null, risk: j.risk }))
  }

  const tagged = agency ? Object.values(index).filter(s => s.active !== false && s.agency === agency.key).map(s => s.name) : []
  const theirPunches = (name: string) => punched.filter(n => nameMatches(n, name))
  if (!people.length) {
    // The invoice bills totals only: compare the total with everyone Lighthouse has under this agency.
    const billedH = Math.round(read.hours.summary.reduce((a, x) => a + (x.hours || 0), 0) * 100) / 100
    const what = read.hours.summary.map(x => x.label).join('; ').slice(0, 200)
    if (!agency) lines.push(line('Hours billed', what, read.total, 'unchecked', `The invoice lists no employees, and ${read.vendor} is not one of the agencies set up in Lighthouse, so there is nobody to look up in Homebase.`))
    else {
      const names = Array.from(new Set(tagged.flatMap(theirPunches)))
      const w = workedInPeriod(names.flatMap(n => byName.get(n) || []).map(c => ({ ...c })), from, to, 1e9)
      const diff = Math.round((billedH - w.total) * 100) / 100
      const who2 = `the ${names.length} ${agency.label} ${names.length === 1 ? 'person' : 'people'} in Lighthouse`
      if (diff > 0.5) lines.push(line('Hours billed', what, read.total, 'hours_over', `Billed ${hh(billedH)}h in ${period}; Homebase shows ${hh(w.total)}h for ${who2} (${hh(diff)}h more than worked). The invoice lists no employees, so this is the total only.`))
      else if (diff < -0.5) lines.push(line('Hours billed', what, read.total, 'hours_under', `Billed ${hh(billedH)}h in ${period}; Homebase shows ${hh(w.total)}h for ${who2}. The invoice lists no employees, so this is the total only.`))
      else lines.push(line('Hours billed', what, read.total, 'hours_match', `Billed ${hh(billedH)}h; Homebase shows ${hh(w.total)}h for ${who2} in ${period}.`))
    }
  } else {
    // The money: the hours as billed, at base pay, time and a half, and the agency's fee an hour.
    const billedTotal = read.total != null ? read.total : (people.every(p => p.amount != null) ? Math.round(people.reduce((a, p) => a + (p.amount || 0), 0) * 100) / 100 : null)
    const j = judgeAmount(billedTotal, people, fee, setFee ? `the fee set for ${agency!.label} in Lighthouse` : 'the fee printed on the invoice')
    if (j) lines.push(line('Invoice total', 'The hours on the invoice at the rates', billedTotal, j.verdict, j.why, { risk: j.risk }))
    else lines.push(line('Invoice total', 'The hours on the invoice at the rates', billedTotal, 'unchecked', fee
      ? 'The total was not checked: a pay rate is missing for someone on the invoice.'
      : `The total was not checked against the rates: no fee per hour is set for ${agency ? agency.label : 'this agency'} in Lighthouse (Users, Staffing) and none is printed on the invoice.`))
  }

  // People Lighthouse has under this agency who punched in the period and are not on the invoice.
  const unbilled: Invoice['unbilled'] = []
  if (people.length) for (const name of tagged) {
    const theirs = theirPunches(name)
    if (!theirs.length || theirs.some(n => matchedNames.has(n))) continue
    const w = workedInPeriod(theirs.flatMap(n => byName.get(n) || []), from, to)
    if (w.total > 0) unbilled.push({ taskId: 'hb:' + name, date: null, unit: name, name: `${hh(w.total)}h in Homebase`, cleaner: null })
  }
  return { lines, unbilled }
}

// ── Storage ─────────────────────────────────────────────────────────────────────────────────────
export async function listInvoices(): Promise<InvRow[]> {
  const v = await getSetting<{ rows: InvRow[] } | null>(INDEX, null).catch(() => null)
  return Array.isArray(v?.rows) ? v!.rows : []
}
export async function getInvoice(id: string): Promise<Invoice | null> {
  return await getSetting<Invoice | null>(KEY(id), null).catch(() => null)
}
/** What a flagged line puts at stake: the part in question when it is known, else the line's amount. */
const atStake = (l: InvLine) => (l.risk != null ? l.risk : l.amount) || 0
function rowOf(inv: Invoice): InvRow {
  const flagged = inv.lines.filter(l => isFlagged(l.verdict) && !l.resolved)
  return { id: inv.id, vendor: inv.vendor, number: inv.number, invoiceDate: inv.invoiceDate, periodFrom: inv.periodFrom, periodTo: inv.periodTo, total: inv.total, status: inv.status, uploadedAt: inv.uploadedAt, uploadedBy: inv.uploadedBy, model: inv.model || 'per_clean',
    lines: inv.lines.length, flagged: flagged.length, flaggedAmount: Math.round(flagged.reduce((a, l) => a + atStake(l), 0) * 100) / 100, matched: inv.lines.filter(l => isOk(l.verdict)).length, unbilled: inv.unbilled.length }
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

/** The right check for how the document bills. */
async function checkRead(read: Read, opts: { id: string; excludeId?: string }): Promise<Checked & { model: InvoiceModel }> {
  if (read.kind === 'hours') return { ...(await checkHours(read, opts)), model: 'hours' }
  return { ...(await checkInvoice(read, opts)), model: 'per_clean' }
}

/** Read → check → store the file → save. A time report is not an invoice: it throws NotAnInvoice and nothing is saved. */
export async function submitInvoice(file: File, who: string | null, override: { vendor?: string; periodFrom?: string; periodTo?: string } = {}): Promise<Invoice> {
  const id = randomBytes(6).toString('hex')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/octet-stream')
  const read = await readInvoice(bytes, type, file.name)
  if (read.kind === 'timesheet') throw new NotAnInvoice('timesheet', 'This is a time report, not an invoice, so it was not audited. The hours on the invoice it came with are checked against Homebase directly.')
  if (override.vendor) read.vendor = override.vendor
  if (override.periodFrom && DATE.test(override.periodFrom)) read.periodFrom = override.periodFrom
  if (override.periodTo && DATE.test(override.periodTo)) read.periodTo = override.periodTo
  const path = `clean-invoices/${id}/${file.name.replace(/[^\w.\-]+/g, '_')}`
  const up = await supabaseAdmin().storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: true })
  const { lines, unbilled, model } = await checkRead(read, { id })
  const now = new Date().toISOString()
  const inv: Invoice = { id, vendor: read.vendor, number: read.number, invoiceDate: read.invoiceDate, periodFrom: read.periodFrom, periodTo: read.periodTo, total: read.total,
    file: up.error ? null : { path, name: file.name, type }, model, ...(model === 'hours' ? { hoursRead: read.hours } : {}),
    lines, unbilled, status: 'review', note: null, uploadedBy: who, uploadedAt: now, reviewedBy: null, reviewedAt: null, checkedAt: now }
  await saveInvoice(inv)
  return inv
}

/** Flags a person cleared stay cleared when the line still reads the same and is still flagged. */
function keepResolved(old: InvLine[], lines: InvLine[]) {
  for (const l of lines) {
    const was = old.find(o => o.resolved && o.unitText === l.unitText && o.date === l.date && o.service === l.service)
    if (was && isFlagged(l.verdict)) l.resolved = was.resolved
  }
}

/** Re-run the check (cleans or punches may have changed since). */
export async function recheckInvoice(id: string): Promise<Invoice | null> {
  const inv = await getInvoice(id)
  if (!inv) return null
  const base = { vendor: inv.vendor, number: inv.number, invoiceDate: inv.invoiceDate, periodFrom: inv.periodFrom, periodTo: inv.periodTo, total: inv.total }
  const read: Read = inv.model === 'hours' && inv.hoursRead
    ? { ...base, kind: 'hours', lines: [], hours: inv.hoursRead }
    : { ...base, kind: 'per_clean', lines: inv.lines.map(l => ({ date: l.date, unit: l.unitText, service: l.service, qty: 1, amount: l.amount })), hours: { people: [], summary: [], feePerHour: null } }
  const { lines, unbilled } = await checkRead(read, { id, excludeId: id })
  keepResolved(inv.lines, lines)
  inv.lines = lines; inv.unbilled = unbilled; inv.checkedAt = new Date().toISOString()
  await saveInvoice(inv)
  return inv
}

/**
 * Read the stored file again and check it afresh. For an invoice that was read before Lighthouse
 * knew its kind (an hours invoice read as cleans), or one the reading got wrong.
 */
export async function rereadInvoice(id: string): Promise<Invoice | null> {
  const inv = await getInvoice(id)
  if (!inv) return null
  if (!inv.file) throw new Error('The original file was not kept for this invoice. Upload it again.')
  const dl = await supabaseAdmin().storage.from(BUCKET).download(inv.file.path)
  if (dl.error || !dl.data) throw new Error('The original file could not be opened: ' + str(dl.error?.message || 'not found'))
  const read = await readInvoice(new Uint8Array(await dl.data.arrayBuffer()), inv.file.type, inv.file.name)
  if (read.kind === 'timesheet') throw new NotAnInvoice('timesheet', 'Read again, this is a time report, not an invoice.')
  const { lines, unbilled, model } = await checkRead(read, { id, excludeId: id })
  keepResolved(inv.lines, lines)
  Object.assign(inv, { vendor: read.vendor, number: read.number, invoiceDate: read.invoiceDate, periodFrom: read.periodFrom, periodTo: read.periodTo, total: read.total, model, lines, unbilled, checkedAt: new Date().toISOString() })
  if (model === 'hours') inv.hoursRead = read.hours; else delete inv.hoursRead
  await saveInvoice(inv)
  return inv
}

export async function fileUrl(inv: Invoice): Promise<string | null> {
  if (!inv.file) return null
  const s = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(inv.file.path, 600)
  return s.data?.signedUrl || null
}
