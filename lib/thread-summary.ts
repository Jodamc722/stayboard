// WHAT IS GOING ON IN THIS THREAD (Jon, 2026-11-12: "have summary in the right, so we can get idea of whats going
// on"). A few lines at the top of the booking pane, written for the teammate who is about to pick the thread up:
// the situation now, the points that matter (asks, problems, promises, decisions), and the next step.
//
// It is written from the thread (guest, team and internal notes; Guesty templates left out), the booking and any
// open glitch — and cached against the thread's last message, so it is written once per change, not per look.
// Cache: app_settings `thread_summaries` (no migration), newest 400 threads.
import 'server-only'
import { createHash } from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { getSettingFresh, setSetting } from './app-settings'
import { plainText, isMachineName } from './message-text'
import { etDay, stayPhase } from './inbox-queue'

export type ThreadSummary = {
  headline: string
  status: 'waiting_on_us' | 'waiting_on_guest' | 'resolved' | 'fyi'
  points: string[]
  next: string
  /** When it was written, and over how many messages. */
  at: string
  over: number
}
type Store = Record<string, { sig: string; s: ThreadSummary }>
const KEY = 'thread_summaries'
const NOTE_MODULES = new Set(['log', 'note', 'notes', 'internal', 'internal_note'])
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

const SYSTEM = `You brief a guest-communications teammate at Stay Hospitality (short-term rentals, South Florida) who is about to pick up a guest thread. Read the thread and say what is going on NOW.

Return ONLY JSON: {"headline": "...", "status": "waiting_on_us" | "waiting_on_guest" | "resolved" | "fyi", "points": ["..."], "next": "..."}
- headline: the situation in one line, at most 14 words. Lead with what matters ("Wants early check-in Friday; we said we'd confirm by noon").
- status: waiting_on_us if the guest's last real message needs something from us; waiting_on_guest if we asked and they have not answered; resolved if the matter is closed; fyi if nothing is pending.
- points: at most 4 short bullets — open asks, problems reported, what we promised (and whether it was done), decisions made, anything unusual (refund talk, review threats, damage, extra guests, parking). Skip pleasantries and template content.
- next: one concrete next step for our team, or "" if none.
Plain words. Only what the thread and facts say — never guess. Never include door codes, Wi-Fi passwords, card or payment details.`

function sigOf(rows: any[]): string {
  const last = rows[0]
  return createHash('sha1').update(rows.length + '|' + str(last?.sent_at) + '|' + str(last?.body).slice(0, 80)).digest('hex').slice(0, 16)
}

export async function threadSummary(conversationId: string, opts: { refresh?: boolean; cachedOnly?: boolean } = {}): Promise<{ ok: boolean; summary?: ThreadSummary | null; fresh?: boolean; error?: string }> {
  const id = str(conversationId).trim()
  if (!id) return { ok: false, error: 'Which conversation?' }
  const db = supabaseAdmin()
  const [{ data: conv }, { data: msgs }] = await Promise.all([
    db.from('guesty_conversations').select('id,reservation_id,channel,guest_name').eq('id', id).maybeSingle(),
    db.from('guesty_messages').select('sender,sender_name,body,sent_at,module,is_automated').eq('conversation_id', id).order('sent_at', { ascending: false }).limit(60),
  ])
  const rows = ((msgs as any[]) || []).filter(m => str(m.body).trim())
  if (!rows.length) return { ok: true, summary: null }
  const sig = sigOf(rows)
  const store = await getSettingFresh<Store>(KEY, {}).catch(() => ({} as Store))
  const hit = store && store[id]
  if (hit && hit.sig === sig && !opts.refresh) return { ok: true, summary: hit.s, fresh: false }
  if (opts.cachedOnly) return { ok: true, summary: hit ? hit.s : null, fresh: false }

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'AI is not configured.' }

  // Guest, team and notes; the automated templates are long and say nothing about THIS stay.
  const real = rows.filter(m => {
    const mod = str(m.module).toLowerCase()
    if (NOTE_MODULES.has(mod)) return true
    if (m.sender === 'guest') return true
    if (m.sender !== 'host') return false
    return m.is_automated !== true && !isMachineName(m.sender_name)
  }).slice(0, 40).reverse()
  const lines = real.map(m => {
    const who = NOTE_MODULES.has(str(m.module).toLowerCase()) ? 'NOTE' : m.sender === 'guest' ? 'GUEST' : 'US'
    const when = new Date(str(m.sent_at)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
    return `[${when}] ${who}: ${plainText(str(m.body)).replace(/\s+/g, ' ').slice(0, 450)}`
  })
  if (!lines.length) return { ok: true, summary: null }

  let facts = `Channel: ${str(conv?.channel)}. Guest: ${str(conv?.guest_name)}.`
  if (conv?.reservation_id) {
    const [{ data: r }, { data: gl }] = await Promise.all([
      db.from('guesty_reservations').select('listing_name,check_in,check_out,nights,status').eq('id', conv.reservation_id).maybeSingle(),
      db.from('glitches').select('overview,status').eq('reservation_id', conv.reservation_id).limit(5),
    ])
    if (r) {
      const today = etDay(Date.now())
      const phase = stayPhase({ checkIn: str((r as any).check_in).slice(0, 10), checkOut: str((r as any).check_out).slice(0, 10), status: str((r as any).status) }, today)
      facts += ` Unit: ${str((r as any).listing_name)}. Stay ${str((r as any).check_in).slice(0, 10)} to ${str((r as any).check_out).slice(0, 10)}, status ${str((r as any).status)}; today is ${today} (${phase}).`
    }
    const open = ((gl as any[]) || []).filter(g => !/closed|resolved|done/i.test(str(g.status)))
    if (open.length) facts += ' Open glitches: ' + open.map(g => str(g.overview).slice(0, 120)).join('; ') + '.'
  }

  const { modelPairFor } = await import('./ai-models')
  const { anthropicMessages, textOf } = await import('./anthropic-call')
  const { model, fallback } = await modelPairFor('thread-summary')
  const r = await anthropicMessages(key, { model, max_tokens: 450, system: SYSTEM, messages: [{ role: 'user', content: `FACTS: ${facts}\n\nTHREAD (oldest first):\n${lines.join('\n')}` }] }, fallback, 'thread-summary')
  if (!r.ok) {
    const why = r.status === 429 ? str(r.data?.error?.message).slice(0, 200) : ''
    return { ok: false, summary: hit ? hit.s : null, error: why || `The summary could not be written just now (${r.status}).` }
  }
  let parsed: any = null
  try { const t = str(textOf(r.data)); parsed = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) } catch { /* below */ }
  if (!parsed || !str(parsed.headline).trim()) return { ok: false, summary: hit ? hit.s : null, error: 'The summary came back unreadable — try Refresh.' }
  const STATUSES = ['waiting_on_us', 'waiting_on_guest', 'resolved', 'fyi']
  const s: ThreadSummary = {
    headline: str(parsed.headline).trim().slice(0, 160),
    status: (STATUSES.indexOf(str(parsed.status)) >= 0 ? parsed.status : 'fyi') as ThreadSummary['status'],
    points: (Array.isArray(parsed.points) ? parsed.points : []).map((x: any) => str(x).trim()).filter(Boolean).slice(0, 4).map((x: string) => x.slice(0, 220)),
    next: str(parsed.next).trim().slice(0, 200),
    at: new Date().toISOString(), over: real.length,
  }
  // Keep the newest 400. Re-read right before writing so two people opening threads do not erase each other.
  try {
    const cur = await getSettingFresh<Store>(KEY, {}).catch(() => ({} as Store))
    const next: Store = { ...(cur || {}), [id]: { sig, s } }
    const keys = Object.keys(next).sort((a, b) => str(next[b].s.at).localeCompare(str(next[a].s.at)))
    const trimmed: Store = {}
    for (const k of keys.slice(0, 400)) trimmed[k] = next[k]
    await setSetting(KEY, trimmed, 'thread-summary')
  } catch { /* the summary still answers this look */ }
  return { ok: true, summary: s, fresh: true }
}
