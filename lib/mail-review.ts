// EMAIL REVIEW (Jon, 2026-11-23). Forward, cc or bcc any email to jon+review@stay-hospitality.com and
// Lighthouse reads it with its attachments and answers the person who emailed it (when they are one of ours) and Jon, in the same conversation: what the
// email is, what each document is, and the steps needed. The rules are in lib/mail-review-rules.ts.
//
// The same mechanism as invoices by email (lib/clean-invoice-mail) and owner emails (lib/owner-mail):
// a plus-address on jon@, read through jon@'s own Google connection, answered from jon@. Every
// message is handled once, written down before the answer goes out.
//
// OFF until Jon turns it on (the switch is on My account). "Check now" runs one pass by hand.
import 'server-only'
import { accessTokenFor, forgetToken, sendGmail, type GmailAttachment } from './gmail-send'
import { getSetting, setSetting } from './app-settings'
import { anthropicMessages } from './anthropic-call'
import { textOf } from './anthropic-text'
import { modelPairFor } from './ai-models'
import { standingRulesForPrompt } from './eve/memory'
import { replySubject, type MailHeaders, type MailPart } from './clean-invoice-mail-rules'
import {
  REVIEW_ADDRESS, REVIEW_MAILBOX, reviewRecipients, MAX_REVIEWS_PER_DAY, EMPTY_REVIEW_STATE, REVIEW_PROMPT, cleanReviewState, skipReason, pickDocs, docKind, imageType, mailText,
  parseReview, reviewHtml, reviewLine, addressOf, threadText, isHeavy, realParts, MAX_ATTACH_BACK, type ReviewState, type Reviewed, type Review, type ThreadMsg,
} from './mail-review-rules'
import { xlsxCsv } from './xlsx-read'

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const STATE = 'mail_review'
const LOCK = 'mail_review_lock'
const QUERY = `{deliveredto:${REVIEW_ADDRESS} to:${REVIEW_ADDRESS} cc:${REVIEW_ADDRESS} bcc:${REVIEW_ADDRESS}} newer_than:7d`
const etDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export async function reviewState(): Promise<ReviewState> { return cleanReviewState(await getSetting<unknown>(STATE, EMPTY_REVIEW_STATE).catch(() => EMPTY_REVIEW_STATE)) }
async function save(s: ReviewState, by: string) { await setSetting(STATE, { ...s, handled: s.handled.slice(0, 300) }, by) }
export async function setReviewOn(on: boolean, by: string): Promise<ReviewState> { const s = await reviewState(); s.on = on; await save(s, by); return s }

export async function reviewReady(): Promise<{ ready: boolean; why?: string }> {
  try {
    const { token, error } = await accessTokenFor(REVIEW_MAILBOX)
    if (!token) return { ready: false, why: `${REVIEW_MAILBOX} is not connected to Google${error ? ' (' + error + ')' : ''}.` }
    let r = await fetch(`${GMAIL}/messages?maxResults=1&q=${encodeURIComponent(QUERY)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    // A token held in memory keeps the permissions it was minted with: right after reading is allowed it
    // still answers 403 for up to 45 minutes. Forget it and ask once more before saying no.
    if (r.status === 403) { forgetToken(REVIEW_MAILBOX); const again = await accessTokenFor(REVIEW_MAILBOX); if (again.token) r = await fetch(`${GMAIL}/messages?maxResults=1&q=${encodeURIComponent(QUERY)}`, { headers: { Authorization: `Bearer ${again.token}` }, cache: 'no-store' }) }
    if (r.status === 403) return { ready: false, why: `Lighthouse is not allowed to read ${REVIEW_MAILBOX} yet.` }
    return r.ok ? { ready: true } : { ready: false, why: `Gmail answered ${r.status}.` }
  } catch (e: any) { return { ready: false, why: String(e?.message || e).slice(0, 160) } }
}

const hdr = (m: any, name: string): string => String((m?.payload?.headers || []).find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value || '')
function headersOf(m: any): MailHeaders {
  return { from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc'), bcc: hdr(m, 'Bcc'), deliveredTo: hdr(m, 'Delivered-To'), subject: hdr(m, 'Subject'), autoSubmitted: hdr(m, 'Auto-Submitted'), precedence: hdr(m, 'Precedence'), messageId: hdr(m, 'Message-ID') || hdr(m, 'Message-Id'), references: hdr(m, 'References'), inReplyTo: hdr(m, 'In-Reply-To') }
}
const b64 = (s: string) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const unhtml = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d|blockquote)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
function read(payload: any): { text: string; parts: MailPart[] } {
  let plain = '', html = ''
  const parts: MailPart[] = []
  const walk = (p: any) => {
    if (!p) return
    if (p.filename && p.body?.attachmentId) {
      const disp = String((p.headers || []).find((h: any) => String(h.name).toLowerCase() === 'content-disposition')?.value || '')
      const cid = (p.headers || []).some((h: any) => String(h.name).toLowerCase() === 'content-id')
      parts.push({ filename: String(p.filename), mimeType: String(p.mimeType || ''), size: Number(p.body.size) || 0, attachmentId: String(p.body.attachmentId), inline: /^inline/i.test(disp) || (cid && !/^attachment/i.test(disp)) })
    } else if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = b64(p.body.data).toString('utf8')
    else if (p.mimeType === 'text/html' && p.body?.data && !html) html = b64(p.body.data).toString('utf8')
    for (const c of p.parts || []) walk(c)
  }
  walk(payload)
  return { text: mailText(plain || unhtml(html)), parts }
}

/** One email → what it is, what the documents are, the steps. Throws with a plain reason on failure. */
async function reviewOne(h: MailHeaders, text: string, docs: { part: MailPart; bytes: Buffer }[], unread: { name: string; why: string }[], earlier = ''): Promise<Review> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('AI is not configured')
  const content: any[] = []
  for (const d of docs) {
    const k = docKind(d.part)
    content.push({ type: 'text', text: `Attached file "${d.part.filename}":` })
    if (k === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.bytes.toString('base64') } })
    else if (k === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: imageType(d.part), data: d.bytes.toString('base64') } })
    // Word and Excel files arrive here already turned into text (see asText below).
    else content.push({ type: 'text', text: d.bytes.toString('utf8').slice(0, 60000) })
  }
  if (earlier) content.push({ type: 'text', text: `EARLIER IN THIS CONVERSATION (background, oldest first):\n\n${earlier}` })
  content.push({ type: 'text', text: `THE EMAIL\nFrom: ${h.from}\nTo: ${h.to}${h.cc ? '\nCc: ' + h.cc : ''}\nSubject: ${h.subject}\n\n${text || '(no text in the body)'}`
    + (unread.length ? `\n\nAttached but not readable here (name only): ${unread.map(u => u.name).join(', ')}` : '')
    + `\n\nToday is ${etDay()}. Return the JSON.` })
  const rules = await standingRulesForPrompt(undefined, 25)
  const { model, fallback } = await modelPairFor('email-review')
  const r = await anthropicMessages(key, { model, max_tokens: 8000, system: REVIEW_PROMPT + (rules ? '\n\n' + rules : ''), messages: [{ role: 'user', content }] }, fallback, 'email-review')
  if (!r.ok) throw new Error(String(r.data?.error?.message || `the reader answered ${r.status}`).slice(0, 200))
  return parseReview(textOf(r.data))
}

/** A Word or Excel attachment as plain text, or null when it cannot be opened. Everything else unchanged. */
async function asText(part: MailPart, bytes: Buffer): Promise<Buffer | null> {
  const k = docKind(part)
  try {
    if (k === 'word') {
      const mammoth: any = await import('mammoth')
      const out = await (mammoth.default || mammoth).extractRawText({ buffer: bytes })
      const t = String(out?.value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
      return t ? Buffer.from(t, 'utf8') : null
    }
    if (k === 'sheet') { const csv = xlsxCsv(bytes, 300, 30); return csv ? Buffer.from(csv, 'utf8') : null }
  } catch { return null }
  return bytes
}

export type ReviewRun = { ok: boolean; ran: boolean; handled: Reviewed[]; waiting: number; error?: string; note?: string }

/** One pass over the mailbox. `force` is the button; `peek` reports what it would do and changes nothing. */
export async function scanReviewMail(opts: { force?: boolean; peek?: boolean; by?: string; budgetMs?: number } = {}): Promise<ReviewRun> {
  const by = opts.by || 'mail-review'
  const state = await reviewState()
  if (!state.on && !opts.force && !opts.peek) return { ok: true, ran: false, handled: [], waiting: 0, note: 'off' }
  const started = Date.now(), budget = opts.budgetMs ?? 200_000
  if (!opts.peek) {
    const lock = await getSetting<{ until?: number } | null>(LOCK, null).catch(() => null)
    if (lock?.until && lock.until > Date.now()) return { ok: true, ran: false, handled: [], waiting: 0, note: 'a pass is already running' }
    await setSetting(LOCK, { until: Date.now() + budget + 90_000 }, by)
  }
  const done: Reviewed[] = []
  let waiting = 0
  const fail = async (error: string): Promise<ReviewRun> => {
    if (!opts.peek) { state.lastRun = new Date().toISOString(); state.lastError = error; await save(state, by); await setSetting(LOCK, { until: 0 }, by) }
    return { ok: false, ran: true, handled: done, waiting, error }
  }
  try {
    const first = await accessTokenFor(REVIEW_MAILBOX)
    let token = first.token
    const error = first.error
    if (!token) return await fail(`${REVIEW_MAILBOX} is not connected to Google${error ? ' (' + error + ')' : ''}.`)
    const g = async (path: string) => fetch(GMAIL + path, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    let list = await g(`/messages?maxResults=25&q=${encodeURIComponent(QUERY)}`)
    if (list.status === 403) { forgetToken(REVIEW_MAILBOX); const again = await accessTokenFor(REVIEW_MAILBOX); if (again.token) { token = again.token; list = await g(`/messages?maxResults=25&q=${encodeURIComponent(QUERY)}`) } }
    if (list.status === 403) return await fail(`The Google connection for ${REVIEW_MAILBOX} cannot read mail. Allow reading on My account.`)
    if (!list.ok) return await fail(`Gmail search failed (${list.status}).`)
    const ids: string[] = ((await list.json().catch(() => ({} as any))).messages || []).map((m: any) => String(m.id))
    const seen = new Set(state.handled.map(h => h.id))
    const fresh = ids.filter(id => !seen.has(id)).reverse()
    waiting = fresh.length
    const today = etDay()
    if (state.day !== today) { state.day = today; state.count = 0 }

    for (const id of fresh) {
      if (Date.now() - started > budget * 0.6) break
      const r = await g(`/messages/${id}?format=full`)
      if (!r.ok) continue
      const m = await r.json()
      const h = headersOf(m)
      const from = addressOf(h.from)
      const rec: Reviewed = { id, at: new Date().toISOString(), from, subject: h.subject.slice(0, 160), line: '', replied: false }
      const skip = skipReason(h)
      const { text, parts } = read(m.payload)
      const { read: take, unread } = pickDocs(parts)
      if (opts.peek) { rec.line = skip ? 'would skip: ' + skip : `would review (${take.length} document${take.length === 1 ? '' : 's'} read, ${unread.length} named)`; done.push(rec); waiting--; continue }
      if (skip) { rec.line = 'left alone: ' + skip; state.handled.unshift(rec); done.push(rec); waiting--; await save(state, by); continue }
      if (state.count >= MAX_REVIEWS_PER_DAY) { state.lastError = `Stopped for today after ${MAX_REVIEWS_PER_DAY} emails; the rest are reviewed tomorrow.`; break }
      state.count++

      let review: Review | null = null, problem = ''
      // The files as they arrived, to send back on the answer ("attachments need to still be connected").
      const originals = new Map<string, Buffer>()
      try {
        const docs: { part: MailPart; bytes: Buffer }[] = []
        for (const p of take) {
          const a = await g(`/messages/${id}/attachments/${p.attachmentId}`)
          if (!a.ok) { unread.push({ name: p.filename, why: 'could not be fetched' }); continue }
          const original = b64((await a.json()).data)
          originals.set(p.attachmentId, original)
          const bytes = await asText(p, original)
          if (!bytes) { unread.push({ name: p.filename, why: 'could not be opened' }); continue }
          docs.push({ part: p, bytes })
        }
        // The rest of the conversation, for "review the chain": a forward quotes only the last message.
        let earlier = ''
        try {
          const t = m.threadId ? await g(`/threads/${m.threadId}?format=full`) : null
          if (t?.ok) {
            const mine = Number(m.internalDate) || Date.now()
            const msgs: ThreadMsg[] = (((await t.json()).messages || []) as any[])
              .filter(x => String(x.id) !== id && (Number(x.internalDate) || 0) <= mine)
              .sort((a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0))
              .map(x => ({ from: hdr(x, 'From'), date: hdr(x, 'Date').replace(/\s*[+-]\d{4}.*$/, ''), subject: hdr(x, 'Subject'), text: read(x.payload).text }))
            earlier = threadText(msgs)
          }
        } catch { /* the email itself is enough */ }
        try { review = await reviewOne(h, text, docs, unread, earlier) }
        catch (e: any) {
          // Usually too many pages at once. Read it again from the text files alone and say which
          // PDFs and photos were left out, rather than answer with nothing.
          const light = docs.filter(d => !isHeavy(docKind(d.part)))
          if (light.length === docs.length) throw e
          for (const d of docs) if (isHeavy(docKind(d.part))) unread.push({ name: d.part.filename, why: 'too much to read in one go with the rest' })
          review = await reviewOne(h, text, light, unread, earlier)
        }
      } catch (e: any) { problem = String(e?.message || e).slice(0, 200) }
      rec.line = review ? reviewLine(review) : 'could not be reviewed'
      if (problem) rec.error = problem
      // Written down BEFORE the answer is sent: a send that fails must not cause a second review.
      state.handled.unshift(rec); await save(state, by)

      // Every real file on the email goes back on the answer, read or not, while it fits.
      const files: GmailAttachment[] = []
      let back = 0, left = 0
      for (const p of realParts(parts)) {
        if (back + p.size > MAX_ATTACH_BACK) { left++; continue }
        let bytes = originals.get(p.attachmentId)
        if (!bytes) { try { const a = await g(`/messages/${id}/attachments/${p.attachmentId}`); if (a.ok) bytes = b64((await a.json()).data) } catch { /* counted below */ } }
        if (!bytes) { left++; continue }
        files.push({ filename: p.filename, content: bytes, contentType: (p.mimeType || 'application/octet-stream').split(';')[0] }); back += p.size
      }

      // TO THE PERSON WHO EMAILED IT, WITH JON COPIED (2026-11-25); to Jon alone when he sent it or
      // the sender is outside Stay. Never to anyone else on the email.
      const who = reviewRecipients(h.from)
      const answer = (attached: number, notAttached: number) => ({
        fromEmail: REVIEW_MAILBOX, to: who.to, cc: who.cc, subject: replySubject(h.subject), source: 'mail-review',
        html: reviewHtml(review || parseReview(''), { from: h.from, subject: h.subject, unread, error: problem || undefined, attached, notAttached, sentTo: who.sentTo }),
        threadId: String(m.threadId || ''), inReplyTo: h.messageId, references: (h.references + ' ' + h.messageId).trim(),
      })
      let s = await sendGmail({ ...answer(files.length, left), attachments: files, largeUpload: true })
      // An answer without the files beats no answer: if the big send is refused, send the words alone.
      if (!s.ok && files.length) s = await sendGmail(answer(0, files.length + left))
      rec.replied = s.ok; if (!s.ok) rec.error = s.error
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

/** Review one email again (the "Again" button): forget that it was handled, then run a pass. */
export async function redoReview(id: string, by: string): Promise<ReviewRun> {
  const s = await reviewState()
  const left = s.handled.filter(h => h.id !== id)
  if (left.length === s.handled.length) return { ok: false, ran: false, handled: [], waiting: 0, error: 'That email is no longer in the list.' }
  s.handled = left
  await save(s, by)
  return scanReviewMail({ force: true, by, budgetMs: 150_000 })
}

export { REVIEW_ADDRESS, REVIEW_MAILBOX }
