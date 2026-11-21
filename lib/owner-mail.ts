// OWNER EMAILS IN LIGHTHOUSE (Jon, 2026-11-21: "add a BCC line that communicates with Lighthouse, so
// Lighthouse reads it … link convos to owners … when we respond to owner we can see it in Lighthouse").
//
// How it works, with nothing new to set up:
//   - The Lighthouse address is a plus-address on jon@: jon+lighthouse@stay-hospitality.com. Google
//     Workspace delivers plus-addresses to the base mailbox, so a BCC to it lands in jon@'s Gmail.
//   - jon@'s Google connection already holds gmail.readonly (lib/google-read), so Lighthouse searches
//     that mailbox for anything sent, copied or BCC'd to the Lighthouse address.
//   - It reads the WHOLE THREAD each time, so once a conversation has been BCC'd, the owner's replies
//     to jon@ and every later message in that thread show here too, without BCC'ing again.
//   - Each thread is matched to an owner by the email addresses on it (guesty_owners.email).
// Nothing is stored: the list is read live from Gmail and kept for three minutes.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { accessTokenFor } from './gmail-send'

export const LIGHTHOUSE_BCC = 'jon+lighthouse@stay-hospitality.com'
export const OWNER_MAILBOX = 'jon@stay-hospitality.com'
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'
const QUERY = `{deliveredto:${LIGHTHOUSE_BCC} to:${LIGHTHOUSE_BCC} cc:${LIGHTHOUSE_BCC} bcc:${LIGHTHOUSE_BCC}}`
/** Stay's own people: not the "other side" of a conversation. */
const OURS = /@(stay-hospitality\.com|staysoflo\.com)$|^guillermo\.?stayhospitality@gmail\.com$/i

export type MailPerson = { name: string; email: string }
export type MailMessage = { id: string; from: MailPerson; to: MailPerson[]; cc: MailPerson[]; at: string; snippet: string; fromUs: boolean; attachments: number }
export type MailThread = {
  id: string; subject: string; lastAt: string; count: number
  /** Everyone outside Stay on the thread. */
  others: MailPerson[]
  owners: { id: string; name: string }[]
  lastFromUs: boolean
  messages: MailMessage[]
  gmailUrl: string
}

const hdr = (m: any, name: string): string => String((m?.payload?.headers || []).find((h: any) => String(h.name).toLowerCase() === name.toLowerCase())?.value || '')
function people(v: string): MailPerson[] {
  const out: MailPerson[] = []
  // split on commas that are not inside quotes
  for (const part of v.match(/("[^"]*"|[^,])+/g) || []) {
    const m = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
    const email = (m ? m[2] : part).trim().toLowerCase()
    if (!/@/.test(email)) continue
    out.push({ name: (m ? m[1] : '').trim() || email.split('@')[0], email })
  }
  return out
}
const isOurs = (e: string) => OURS.test(e) || e === LIGHTHOUSE_BCC
function decode(s: string): string { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8') }
const unhtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim()
function bodyOf(payload: any): string {
  let plain = '', html = ''
  const walk = (p: any) => {
    if (!p) return
    if (p.mimeType === 'text/plain' && p.body?.data && !plain) plain = decode(p.body.data)
    else if (p.mimeType === 'text/html' && p.body?.data && !html) html = decode(p.body.data)
    for (const c of p.parts || []) walk(c)
  }
  walk(payload)
  const text = plain || unhtml(html)
  // the quoted history repeats every earlier message in the thread, which is already shown above it
  return text.split(/\n(?:On .{0,160}wrote:|-{2,} ?Original Message|From: .{0,120}\nSent: )/)[0].trim()
}
function attachmentsOf(payload: any): number { let n = 0; const walk = (p: any) => { if (!p) return; if (p.filename && p.body?.attachmentId) n++; for (const c of p.parts || []) walk(c) }; walk(payload); return n }

let CACHE: { at: number; threads: MailThread[]; error?: string } | null = null

async function ownersByEmail(): Promise<Map<string, { id: string; name: string }>> {
  const { data } = await supabaseAdmin().from('guesty_owners').select('id, full_name, email').limit(1000) // one row per owner, far fewer than 1,000
  const m = new Map<string, { id: string; name: string }>()
  for (const o of data || []) for (const e of String(o.email || '').split(/[,;\s]+/)) if (/@/.test(e)) m.set(e.trim().toLowerCase(), { id: String(o.id), name: String(o.full_name || e) })
  return m
}

export async function ownerThreads(force = false): Promise<{ threads: MailThread[]; error?: string; bcc: string; mailbox: string }> {
  const base = { bcc: LIGHTHOUSE_BCC, mailbox: OWNER_MAILBOX }
  if (!force && CACHE && Date.now() - CACHE.at < 3 * 60_000) return { ...base, threads: CACHE.threads, error: CACHE.error }
  const { token, error } = await accessTokenFor(OWNER_MAILBOX)
  if (!token) return { ...base, threads: [], error: error || 'No Google connection for ' + OWNER_MAILBOX }
  const H = { Authorization: `Bearer ${token}` }
  const ids: string[] = []
  let page = ''
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${GMAIL}/threads?maxResults=50&q=${encodeURIComponent(QUERY)}${page ? '&pageToken=' + page : ''}`, { headers: H, cache: 'no-store' })
    if (r.status === 403) return { ...base, threads: [], error: 'Lighthouse cannot read ' + OWNER_MAILBOX + ' yet: reconnect Google for that mailbox with the read permission (Settings → Integrations).' }
    if (!r.ok) return { ...base, threads: [], error: 'Gmail search failed (' + r.status + ')' }
    const j: any = await r.json()
    for (const t of j.threads || []) ids.push(String(t.id))
    page = j.nextPageToken || ''
    if (!page) break
  }
  const owners = await ownersByEmail()
  const threads: MailThread[] = []
  for (let i = 0; i < ids.length; i += 8) {
    const got = await Promise.all(ids.slice(i, i + 8).map(id => fetch(`${GMAIL}/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`, { headers: H, cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).catch(() => null)))
    for (const t of got) {
      if (!t?.messages?.length) continue
      const messages: MailMessage[] = (t.messages as any[]).filter(m => !(m.labelIds || []).includes('DRAFT')).map(m => {
        const from = people(hdr(m, 'From'))[0] || { name: '?', email: '' }
        return { id: String(m.id), from, to: people(hdr(m, 'To')), cc: people(hdr(m, 'Cc')), at: new Date(Number(m.internalDate)).toISOString(), snippet: String(m.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'), fromUs: isOurs(from.email), attachments: 0 }
      })
      if (!messages.length) continue
      const all = new Map<string, MailPerson>()
      for (const m of messages) for (const p of [m.from, ...m.to, ...m.cc]) if (p.email && !isOurs(p.email) && !all.has(p.email)) all.set(p.email, p)
      const linked = new Map<string, { id: string; name: string }>()
      for (const e of Array.from(all.keys())) { const o = owners.get(e); if (o) linked.set(o.id, o) }
      const last = messages[messages.length - 1]
      threads.push({
        id: String(t.id), subject: hdr(t.messages[0], 'Subject') || '(no subject)', lastAt: last.at, count: messages.length,
        others: Array.from(all.values()), owners: Array.from(linked.values()), lastFromUs: last.fromUs, messages,
        gmailUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(OWNER_MAILBOX)}#all/${t.id}`,
      })
    }
  }
  threads.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
  CACHE = { at: Date.now(), threads }
  return { ...base, threads }
}

/** One thread with every message's text, for reading it in Lighthouse. */
export async function ownerThreadBodies(threadId: string): Promise<{ id: string; body: string; attachments: number }[] | null> {
  // only threads that are on the Lighthouse list can be opened here: this is not a window into jon@'s whole mailbox
  const listed = await ownerThreads()
  if (!listed.threads.some(t => t.id === threadId)) return null
  const { token } = await accessTokenFor(OWNER_MAILBOX)
  if (!token) return null
  const r = await fetch(`${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!r.ok) return null
  const t: any = await r.json()
  return (t.messages || []).filter((m: any) => !(m.labelIds || []).includes('DRAFT')).map((m: any) => ({ id: String(m.id), body: bodyOf(m.payload), attachments: attachmentsOf(m.payload) }))
}
