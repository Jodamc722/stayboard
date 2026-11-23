// INVOICES BY EMAIL — the rules, with nothing imported, so plain node can test them
// (lib/__tests__/clean-invoice-mail.test.mjs). The Gmail reading and sending is lib/clean-invoice-mail.ts.
//
// Jon, 2026-11-23: "The cleaning invoice audit that we can submit — create a shareable / cc email
// link that when emailed it runs the audit and responds to the person and shares discrepancies."
// His two decisions the same day:
//   - WHO GETS THE AUDIT BACK: the team only. Someone at Stay who emails an invoice gets the full
//     audit as a reply. An outside sender (a vendor) gets a short "received, under review" note, and
//     the audit goes to Jon in the same conversation. A vendor is never told "we dispute line 4" by a
//     machine: a person decides that, on the Cleaning invoices page.
//   - THE ADDRESS: jon+invoices@stay-hospitality.com. A plus-address lands in jon@'s own inbox with
//     nothing to set up, and Lighthouse already reads that mailbox (lib/owner-mail does the same with
//     jon+lighthouse@).

export const INVOICE_ADDRESS = 'jon+invoices@stay-hospitality.com'
export const INVOICE_MAILBOX = 'jon@stay-hospitality.com'
/** Our own replies start with this, and a message that starts with it is never read as an invoice. */
export const REPLY_TAG = 'Invoice check'

/** Stay's own people (the same test lib/owner-mail uses). */
const OURS = /@(stay-hospitality\.com|staysoflo\.com)$|^guillermo\.?stayhospitality@gmail\.com$/i
export const isTeam = (email: string): boolean => OURS.test(String(email || '').trim().toLowerCase())

export type MailHeaders = { from: string; to: string; cc: string; bcc?: string; deliveredTo: string; subject: string; autoSubmitted: string; precedence: string; messageId: string; references: string; inReplyTo: string }
export type MailPart = { filename: string; mimeType: string; size: number; attachmentId: string; inline: boolean }

/** "Ana Ruiz <ana@x.com>" → ana@x.com */
export function addressOf(v: string): string {
  const m = String(v || '').match(/<([^>]+)>/)
  return (m ? m[1] : String(v || '')).trim().toLowerCase()
}
export function nameOf(v: string): string {
  const m = String(v || '').match(/^\s*"?([^"<]*?)"?\s*</)
  return (m ? m[1] : '').trim()
}

/**
 * Was this message addressed, copied or delivered to the invoice address? Bcc counts: when Jon himself
 * blind-copies the address from his own mailbox, the copy Gmail keeps has no Delivered-To line and the
 * address is only on the Bcc line (found live 2026-11-23, his first forward was Bcc only).
 */
export function addressedToUs(h: MailHeaders, address = INVOICE_ADDRESS): boolean {
  const a = address.toLowerCase()
  return [h.to, h.cc, h.bcc, h.deliveredTo].some(v => String(v || '').toLowerCase().includes(a))
}

/**
 * Why a message is left alone, or '' when it should be read. The point of most of these is that the
 * robot never answers another robot: an out-of-office, a bounce, a mailing list, or its own reply.
 */
export function skipReason(h: MailHeaders, address = INVOICE_ADDRESS): string {
  const from = addressOf(h.from)
  if (!from || !/@/.test(from)) return 'no sender'
  if (!addressedToUs(h, address)) return 'not sent to the invoice address'
  if (from === address.toLowerCase()) return 'sent from the invoice address itself'
  if (new RegExp('^(re:\\s*)*' + REPLY_TAG, 'i').test(h.subject.trim())) return 'one of our own replies'
  if (/^(mailer-daemon|postmaster|no-?reply|donotreply|do-not-reply|bounce)/i.test(from.split('@')[0])) return 'an automatic sender'
  const auto = h.autoSubmitted.trim().toLowerCase()
  if (auto && auto !== 'no') return 'an automatic message'
  if (/bulk|list|junk|auto_reply/i.test(h.precedence)) return 'a list or automatic message'
  return ''
}

/**
 * A reply in a conversation the address is already on ("thanks, got it", reply-all). With no file on
 * it there is nothing to audit and nothing to say: it is left alone, so a thread never fills with
 * "no invoice file found" notes.
 */
export const isReply = (h: MailHeaders): boolean => !!h.inReplyTo.trim() || /^\s*re:/i.test(h.subject)

const INVOICE_FILE = /\.(pdf|png|jpe?g|webp|csv|tsv|txt)$/i
const INVOICE_TYPE = /^(application\/pdf|image\/(png|jpe?g|webp)|text\/(csv|plain|tab-separated-values))/i
/** Signature logos and tracking pixels are images too. A photo of an invoice is not 6 KB. */
const SMALL_IMAGE = 40 * 1024
export const MAX_FILE = 20 * 1024 * 1024
export const MAX_FILES_PER_MAIL = 4

/** The attachments worth reading as invoices, largest first, at most four. */
export function invoiceFiles(parts: MailPart[]): { take: MailPart[]; left: number } {
  const ok = parts.filter(p => {
    if (!p.attachmentId || !p.filename) return false
    if (!(INVOICE_FILE.test(p.filename) || INVOICE_TYPE.test(p.mimeType))) return false
    if (p.size > MAX_FILE) return false
    const image = /^image\//i.test(p.mimeType) || /\.(png|jpe?g|webp)$/i.test(p.filename)
    if (image && (p.inline || p.size < SMALL_IMAGE)) return false
    return true
  }).sort((a, b) => b.size - a.size)
  return { take: ok.slice(0, MAX_FILES_PER_MAIL), left: Math.max(0, ok.length - MAX_FILES_PER_MAIL) }
}

/** The media type to read a file as, when the mail program only said "application/octet-stream". */
export function mediaTypeOf(p: { filename: string; mimeType: string }): string {
  if (INVOICE_TYPE.test(p.mimeType)) return p.mimeType.split(';')[0].trim().toLowerCase()
  const f = p.filename.toLowerCase()
  if (f.endsWith('.pdf')) return 'application/pdf'
  if (f.endsWith('.png')) return 'image/png'
  if (/\.jpe?g$/.test(f)) return 'image/jpeg'
  if (f.endsWith('.webp')) return 'image/webp'
  return 'text/plain'
}

// ── What the reply says ─────────────────────────────────────────────────────────────────────────
export type Verdict = 'match' | 'date_off' | 'not_done' | 'no_clean' | 'duplicate' | 'unknown_unit'
const LABEL: Record<Verdict, string> = { match: 'Matches a clean', date_off: 'Clean on a different day', not_done: 'Clean not finished', no_clean: 'No clean on record', duplicate: 'Billed twice', unknown_unit: 'Unit not found' }
const FLAGGED: Verdict[] = ['date_off', 'not_done', 'no_clean', 'duplicate', 'unknown_unit']
export type AuditLine = { n: number; date: string | null; unitText: string; unit: string | null; service: string; amount: number | null; verdict: Verdict; why: string; resolved?: unknown }
export type AuditInvoice = { id: string; vendor: string; number: string | null; periodFrom: string | null; periodTo: string | null; invoiceDate: string | null; total: number | null; lines: AuditLine[]; unbilled: unknown[]; fileName?: string }
export type AuditResult = { file: string; invoice?: AuditInvoice; error?: string }

const esc = (s: unknown) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const money = (n: number | null | undefined) => n == null ? '' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (s?: string | null) => s ? new Date(s.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''

export function tally(inv: AuditInvoice): { lines: number; matched: number; flagged: number; flaggedAmount: number; unbilled: number } {
  const fl = inv.lines.filter(l => FLAGGED.includes(l.verdict) && !l.resolved)
  return { lines: inv.lines.length, matched: inv.lines.filter(l => l.verdict === 'match').length, flagged: fl.length, flaggedAmount: Math.round(fl.reduce((a, l) => a + (l.amount || 0), 0) * 100) / 100, unbilled: inv.unbilled.length }
}

/** One line for the subject and the top of the mail: "3 of 41 lines do not match ($420.00)". */
export function headline(results: AuditResult[]): string {
  const read = results.filter(r => r.invoice).map(r => tally(r.invoice!))
  const failed = results.filter(r => !r.invoice).length
  if (!read.length) return failed ? 'could not be read' : 'no invoice file found'
  const lines = read.reduce((a, t) => a + t.lines, 0), flagged = read.reduce((a, t) => a + t.flagged, 0)
  const amt = Math.round(read.reduce((a, t) => a + t.flaggedAmount, 0) * 100) / 100
  const base = flagged === 0 ? `all ${lines} line${lines === 1 ? '' : 's'} match a clean` : `${flagged} of ${lines} line${lines === 1 ? '' : 's'} ${flagged === 1 ? 'does' : 'do'} not match${amt ? ' (' + money(amt) + ')' : ''}`
  return base + (failed ? `; ${failed} file${failed === 1 ? '' : 's'} could not be read` : '')
}

export function replySubject(original: string): string {
  const s = String(original || '').replace(/^\s*((re|fwd?):\s*)+/i, '').trim()
  return `Re: ${s || 'Invoice'}`
}

const P = 'margin:0 0 12px;font:14px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1a'
const TD = 'padding:6px 10px;border-bottom:1px solid #e9e7e1;font:13px/1.4 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1c1c1a;vertical-align:top'
const TH = 'padding:6px 10px;border-bottom:1px solid #d9d6cd;font:11px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b6a65;text-align:left;text-transform:uppercase;letter-spacing:.04em'

/** The full audit, for someone at Stay. `base` is the app's address, for the link to each invoice. */
export function teamReplyHtml(results: AuditResult[], base: string, opts: { forOutside?: { name: string; email: string }; skipped?: number } = {}): string {
  let h = ''
  if (opts.forOutside) h += `<p style="${P}"><b>${esc(opts.forOutside.name || opts.forOutside.email)}</b> (${esc(opts.forOutside.email)}) emailed this to the invoice address. They were sent a short note that it was received and is being reviewed; nothing below went to them.</p>`
  h += `<p style="${P}"><b>${esc(REPLY_TAG)}: ${esc(headline(results))}.</b></p>`
  for (const r of results) {
    if (!r.invoice) { h += `<p style="${P}"><b>${esc(r.file)}</b>: could not be read${r.error ? ' (' + esc(r.error) + ')' : ''}. Upload it on the Cleaning invoices page to try again.</p>`; continue }
    const inv = r.invoice, t = tally(inv)
    const period = inv.periodFrom || inv.periodTo ? `${day(inv.periodFrom)} to ${day(inv.periodTo)}` : day(inv.invoiceDate)
    h += `<p style="${P}"><b>${esc(inv.vendor)}${inv.number ? ' #' + esc(inv.number) : ''}</b>${period ? ' · ' + esc(period) : ''}${inv.total != null ? ' · ' + money(inv.total) : ''}<br>`
      + `${t.lines} line${t.lines === 1 ? '' : 's'} read · ${t.matched} match a clean · ${t.flagged} flagged${t.flaggedAmount ? ' (' + money(t.flaggedAmount) + ')' : ''}`
      + (t.unbilled ? ` · ${t.unbilled} finished clean${t.unbilled === 1 ? '' : 's'} in the period not on the invoice` : '')
      + `<br><a href="${esc(base)}/clean-invoices?id=${esc(inv.id)}">Open it in Lighthouse</a> to approve, dispute or clear a line.</p>`
    const fl = inv.lines.filter(l => FLAGGED.includes(l.verdict) && !l.resolved)
    if (!fl.length) continue
    h += `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;width:100%;max-width:760px"><tr>${['#', 'Date', 'Unit on the invoice', 'Amount', 'What is wrong'].map(x => `<th style="${TH}">${x}</th>`).join('')}</tr>`
    for (const l of fl.slice(0, 60)) {
      h += `<tr><td style="${TD}">${l.n}</td><td style="${TD};white-space:nowrap">${esc(day(l.date) || 'no date')}</td><td style="${TD}">${esc(l.unitText)}${l.unit && l.unit !== l.unitText ? `<br><span style="color:#6b6a65">${esc(l.unit)}</span>` : ''}</td>`
        + `<td style="${TD};white-space:nowrap">${esc(money(l.amount))}</td><td style="${TD}"><b>${esc(LABEL[l.verdict])}</b><br><span style="color:#6b6a65">${esc(l.why)}</span></td></tr>`
    }
    h += `</table>`
    if (fl.length > 60) h += `<p style="${P}">${fl.length - 60} more flagged lines are on the page.</p>`
  }
  if (opts.skipped) h += `<p style="${P}">${opts.skipped} more attachment${opts.skipped === 1 ? ' was' : 's were'} not read (four per email). Send ${opts.skipped === 1 ? 'it' : 'them'} in another email.</p>`
  h += `<p style="${P};color:#6b6a65;font-size:12.5px">Only the cleans are checked, not the prices: a line matches when Breezeway shows a finished clean at that unit on that date. Nothing has been approved, disputed or paid.</p>`
  return h
}

/** The short note an outside sender gets. It says nothing about what the audit found. */
export function outsideReplyHtml(results: AuditResult[]): string {
  const n = results.filter(r => r.invoice).length
  const what = n > 1 ? `your ${n} invoices` : 'your invoice'
  return `<p style="${P}">Thank you. We received ${what} and our team is reviewing ${n > 1 ? 'them' : 'it'} against our cleaning records. We will be in touch if we have any questions.</p>`
    + `<p style="${P}">Stay Hospitality</p>`
}

/** When a team member emails the address with nothing readable attached. */
export function noFileHtml(): string {
  return `<p style="${P}"><b>${esc(REPLY_TAG)}: no invoice file found.</b></p><p style="${P}">Attach the invoice as a PDF, a photo (PNG or JPG) or a CSV and send it again. Excel files are not read; save as PDF or CSV first.</p>`
}

// ── What has been handled ───────────────────────────────────────────────────────────────────────
export type Handled = { id: string; at: string; from: string; subject: string; team: boolean; invoices: string[]; headline: string; replied: boolean; error?: string }
export type MailState = { on: boolean; handled: Handled[]; lastRun: string | null; lastError: string | null; day: string; count: number }
export const EMPTY_STATE: MailState = { on: false, handled: [], lastRun: null, lastError: null, day: '', count: 0 }
/** A ceiling on what one day of email can cost: each invoice is a model read. */
export const MAX_PER_DAY = 25
export function cleanState(v: unknown): MailState {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<MailState>
  return { on: !!s.on, handled: Array.isArray(s.handled) ? s.handled.slice(0, 300) : [], lastRun: s.lastRun || null, lastError: s.lastError || null, day: String(s.day || ''), count: Number(s.count) || 0 }
}
