// INVOICES BY EMAIL (Jon, 2026-11-23). Email or cc an invoice to jon+invoices@stay-hospitality.com and
// Lighthouse reads the attachment, runs the same audit as an upload on /clean-invoices
// (lib/clean-invoices), and answers in the same conversation. The rules, and Jon's decisions on who
// is told what, are in lib/clean-invoice-mail-rules.ts.
//
// How it works, with nothing new to set up (the same mechanism as lib/owner-mail):
//   - The address is a plus-address on jon@, so the mail lands in jon@'s own inbox.
//   - jon@'s Google connection already holds gmail.readonly and gmail.send, so Lighthouse searches
//     that mailbox for mail sent or copied to the address, and replies from jon@.
//   - Every message is handled once: its Gmail id is written down before any reply goes out.
//
// OFF until someone with full access turns it on (the switch is on the Cleaning invoices page).
// "Check the mailbox now" on that page runs one pass by hand whether or not the switch is on.
import 'server-only'
import { accessTokenFor, sendGmail } from './gmail-send'
import { getSetting, setSetting } from './app-settings'
import { submitInvoice } from './clean-invoices'
import {
  INVOICE_ADDRESS, INVOICE_MAILBOX, REPLY_TAG, MAX_PER_DAY, EMPTY_STATE, cleanState, isTeam, isReply, addressOf, nameOf, skipReason, invoiceFiles, mediaTypeOf,
  headline, replySubject, teamReplyHtml, outsideReplyHtml, noFileHtml,
  type MailHeaders, type MailPart, type MailState, type Handled, type AuditResult,
} from './clean-invoice-mail-rules'

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const STATE = 'clean_invoice_mail'
const LOCK = 'clean_invoice_mail_lock'
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
const QUERY = `{deliveredto:${INVOICE_ADDRESS} to:${INVOICE_ADDRESS} cc:${INVOICE_ADDRESS}} newer_than:7d`
const etDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export async function mailState(): Promise<MailState> { return cleanState(await getSetting<unknown>(STATE, EMPTY_STATE).catch(() => EMPTY_STATE)) }
async function save(s: MailState, by: string) { await setSetting(STATE, { ...s, handled: s.handled.slice(0, 300) }, by) }
export async function setMailOn(on: boolean, by: string): Promise<MailState> { const s = await mailState(); s.on = on; await save(s, by); return s }

const hdr = (m: any, name: string): string => String((m?.payload?.headers || []).find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value || '')
function headersOf(m: any): MailHeaders {
  return { from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc'), deliveredTo: hdr(m, 'Delivered-To'), subject: hdr(m, 'Subject'), autoSubmitted: hdr(m, 'Auto-Submitted'), precedence: hdr(m, 'Precedence'), messageId: hdr(m, 'Message-ID') || hdr(m, 'Message-Id'), references: hdr(m, 'References'), inReplyTo: hdr(m, 'In-Reply-To') }
}
function partsOf(payload: any): MailPart[] {
  const out: MailPart[] = []
  const walk = (p: any) => {
    if (!p) return
    if (p.filename && p.body?.attachmentId) {
      const disp = String((p.headers || []).find((h: any) => String(h.name).toLowerCase() === 'content-disposition')?.value || '')
      const cid = (p.headers || []).some((h: any) => String(h.name).toLowerCase() === 'content-id')
      out.push({ filename: String(p.filename), mimeType: String(p.mimeType || ''), size: Number(p.body.size) || 0, attachmentId: String(p.body.attachmentId), inline: /^inline/i.test(disp) || (cid && !/^attachment/i.test(disp)) })
    }
    for (const c of p.parts || []) walk(c)
  }
  walk(payload)
  return out
}
/** People on the To and Cc lines who are at Stay, other than the mailbox itself. */
function teamOn(h: MailHeaders): string[] {
  const all = (h.to + ',' + h.cc).split(',').map(addressOf).filter(e => /@/.test(e))
  return Array.from(new Set(all.filter(e => isTeam(e) && e !== INVOICE_ADDRESS && e !== INVOICE_MAILBOX)))
}

export type ScanResult = { ok: boolean; ran: boolean; handled: Handled[]; waiting: number; error?: string; note?: string }

/**
 * One pass over the mailbox. `force` is the button on the page: it runs even when the switch is off.
 * `peek` reads and reports what it would do, and changes nothing (no audit, no reply, nothing saved).
 */
export async function scanInvoiceMail(opts: { force?: boolean; peek?: boolean; by?: string; budgetMs?: number } = {}): Promise<ScanResult> {
  const by = opts.by || 'invoice-mail'
  const state = await mailState()
  if (!state.on && !opts.force && !opts.peek) return { ok: true, ran: false, handled: [], waiting: 0, note: 'off' }
  const started = Date.now(), budget = opts.budgetMs ?? 200_000

  // One pass at a time: the schedule and the button could otherwise read the same message twice.
  if (!opts.peek) {
    const lock = await getSetting<{ until?: number } | null>(LOCK, null).catch(() => null)
    if (lock?.until && lock.until > Date.now()) return { ok: true, ran: false, handled: [], waiting: 0, note: 'a pass is already running' }
    await setSetting(LOCK, { until: Date.now() + budget + 90_000 }, by)
  }
  const done: Handled[] = []
  let waiting = 0
  const fail = async (error: string): Promise<ScanResult> => {
    if (!opts.peek) { state.lastRun = new Date().toISOString(); state.lastError = error; await save(state, by); await setSetting(LOCK, { until: 0 }, by) }
    return { ok: false, ran: true, handled: done, waiting, error }
  }
  try {
    const { token, error } = await accessTokenFor(INVOICE_MAILBOX)
    if (!token) return await fail(`${INVOICE_MAILBOX} is not connected to Google${error ? ' (' + error + ')' : ''}.`)
    const g = async (path: string) => fetch(GMAIL + path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const list = await g(`/messages?maxResults=25&q=${encodeURIComponent(QUERY)}`)
    if (list.status === 403) return await fail(`The Google connection for ${INVOICE_MAILBOX} cannot read mail. Reconnect Google on My account and allow reading.`)
    if (!list.ok) return await fail(`Gmail search failed (${list.status}).`)
    const ids: string[] = ((await list.json().catch(() => ({} as any))).messages || []).map((m: any) => String(m.id))
    const seen = new Set(state.handled.map(h => h.id))
    const fresh = ids.filter(id => !seen.has(id)).reverse()          // oldest first
    waiting = fresh.length
    const today = etDay()
    if (state.day !== today) { state.day = today; state.count = 0 }

    for (const id of fresh) {
      if (Date.now() - started > budget * 0.6) break                 // a read can take a minute: leave room to finish it
      const r = await g(`/messages/${id}?format=full`)
      if (!r.ok) continue
      const m = await r.json()
      const h = headersOf(m)
      const from = addressOf(h.from), team = isTeam(from)
      const rec: Handled = { id, at: new Date().toISOString(), from, subject: h.subject.slice(0, 160), team, invoices: [], headline: '', replied: false }
      const skip = skipReason(h)
      const { take, left } = invoiceFiles(partsOf(m.payload))
      if (opts.peek) { rec.headline = skip ? 'would skip: ' + skip : take.length ? `would read ${take.length} file${take.length === 1 ? '' : 's'}: ${take.map(t => t.filename).join(', ')}` : 'no invoice file attached'; done.push(rec); waiting--; continue }

      if (skip) { rec.headline = 'left alone: ' + skip; state.handled.unshift(rec); done.push(rec); waiting--; await save(state, by); continue }
      const thread = { threadId: String(m.threadId || ''), inReplyTo: h.messageId, references: (h.references + ' ' + h.messageId).trim() }
      const subject = replySubject(h.subject)

      if (!take.length) {
        const reply = isReply(h)
        rec.headline = reply ? 'left alone: a reply with no file on it' : 'no invoice file attached'
        state.handled.unshift(rec); await save(state, by)
        if (team && !reply) { const s = await sendGmail({ fromEmail: INVOICE_MAILBOX, to: [from], subject, html: noFileHtml(), source: 'invoice-mail', ...thread }); rec.replied = s.ok; if (!s.ok) rec.error = s.error; await save(state, by) }
        done.push(rec); waiting--; continue
      }
      if (state.count >= MAX_PER_DAY) { state.lastError = `Stopped for today after ${MAX_PER_DAY} emails; the rest are read tomorrow.`; break }
      state.count++

      const results: AuditResult[] = []
      for (const p of take) {
        try {
          const a = await g(`/messages/${id}/attachments/${p.attachmentId}`)
          if (!a.ok) throw new Error(`could not fetch the attachment (${a.status})`)
          const data = String((await a.json()).data || '').replace(/-/g, '+').replace(/_/g, '/')
          const bytes = Buffer.from(data, 'base64')
          const file = new File([new Uint8Array(bytes)], p.filename, { type: mediaTypeOf(p) })
          const inv = await submitInvoice(file, 'email · ' + from)
          results.push({ file: p.filename, invoice: inv })
          rec.invoices.push(inv.id)
        } catch (e: any) { results.push({ file: p.filename, error: String(e?.message || e).slice(0, 200) }) }
      }
      rec.headline = headline(results)
      // Written down BEFORE anything is sent: a reply that fails must not cause a second audit.
      state.handled.unshift(rec); await save(state, by)

      if (team) {
        const s = await sendGmail({ fromEmail: INVOICE_MAILBOX, to: [from], subject, html: teamReplyHtml(results, APP_URL, { skipped: left }), source: 'invoice-mail', ...thread })
        rec.replied = s.ok; if (!s.ok) rec.error = s.error
      } else {
        // The audit goes to Jon (and anyone at Stay the sender wrote to), never to the outside sender.
        const s1 = await sendGmail({ fromEmail: INVOICE_MAILBOX, to: [INVOICE_MAILBOX], cc: teamOn(h), subject: `${REPLY_TAG}: ${subject.replace(/^Re:\s*/i, '')}`, html: teamReplyHtml(results, APP_URL, { forOutside: { name: nameOf(h.from), email: from }, skipped: left }), source: 'invoice-mail', ...thread })
        const s2 = results.some(x => x.invoice)
          ? await sendGmail({ fromEmail: INVOICE_MAILBOX, to: [from], subject, html: outsideReplyHtml(results), source: 'invoice-mail', ...thread })
          : { ok: true as const, error: undefined as string | undefined }
        rec.replied = s1.ok && s2.ok; if (!rec.replied) rec.error = s1.error || s2.error
      }
      await save(state, by)
      done.push(rec); waiting--
    }
    if (opts.peek) return { ok: true, ran: true, handled: done, waiting: Math.max(0, waiting) }
    state.lastRun = new Date().toISOString()
    if (!/Stopped for today/.test(state.lastError || '')) state.lastError = done.find(d => d.error)?.error || null
    await save(state, by)
    await setSetting(LOCK, { until: 0 }, by)
    return { ok: true, ran: true, handled: done, waiting: Math.max(0, waiting) }
  } catch (e: any) {
    return await fail(String(e?.message || e).slice(0, 300))
  }
}

export { INVOICE_ADDRESS, INVOICE_MAILBOX }
