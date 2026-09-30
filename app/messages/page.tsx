import { redirect } from 'next/navigation'
import { plainText, isMachineName } from '@/lib/message-text'
import { pageRows } from '@/lib/db-page'
import { createClient } from '@/lib/supabase-server'
import { Shell } from '@/components/Shell'
import { SyncNowButton } from '@/components/SyncNowButton'
import { MessagesInbox, type InboxItem, type WaitInfo, type LastInfo, type StayInfo } from '@/components/MessagesInbox'
import { LeanHead, Pill } from '@/components/lean'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { listPhoneThreads, type PhoneThreadSummary } from '@/lib/phone-threads'
import { talkrouteConfigured } from '@/lib/talkroute'
import { getAccess } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { awaitingSet, median, SLA_RULE_TEXT, AWAITING_HORIZON_H } from '@/lib/response-times'

export const dynamic = 'force-dynamic'

const HOUR_MS = 60 * 60 * 1000
const CONVO_COLS = 'id, reservation_id, listing_id, guest_name, channel, last_message_at, last_message_preview, unread_count'
/** Below this many threads a median or a percentage is an anecdote, not a number. */
const MIN_SAMPLE = 5

export default async function MessagesPage() {
  // MESSAGES ACCESS, NOT JUST A SESSION (2026-09-28 audit, D16). Guest words, phone numbers and
  // complaints are read below with the service role, so a signed-in account is not enough: the
  // person must hold at least view on Messages — the same bar /api/eve/guest-drafts already sets.
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!access.allowed) redirect('/no-access')
  if (!atLeast(access.levels['messages'], 'view')) redirect(access.landing || '/no-access')
  const supabase = createClient()
  const sb = supabaseAdmin()
  const now = Date.now()
  const since30 = new Date(now - 30 * 86400_000).toISOString().slice(0, 19) + 'Z'

  // ONE ROUND for everything independent (the phone read used to wait on its own, after the rest).
  //
  // THE HEADER READS conversation_response (2026-09-28 audit, D4). It used to recompute "Reply" and
  // "Score" on every visit from the newest 4,000 messages (four sequential 1,000-row pages), taking
  // the mean of every guest→host gap — Guesty's automated templates and log/note rows included, so
  // a template firing in 40 seconds counted as us answering in 40 seconds. lib/response-times has
  // measured every thread properly since 2026-08-26 and nothing here read it.
  const [{ data: convos }, { data: sync }, waiting, speed, phone] = await Promise.all([
    supabase.from('guesty_conversations').select(CONVO_COLS).order('last_message_at', { ascending: false }).limit(100),
    supabase.from('guesty_sync_status').select('last_sync_at').eq('entity', 'conversations').maybeSingle(),
    // THE ONE "WAITING ON US" SET (D3/D5): the pill and the Needs-reply tab both come from this.
    awaitingSet({ db: sb, now }),
    // Every thread the guest wrote in during the last 30 days, as already measured.
    pageRows<any>((a, b) => sb.from('conversation_response').select('conversation_id,first_ms,human_first_ms')
      .gte('last_guest_at', since30).order('conversation_id', { ascending: true }).range(a, b), 6),
    phoneThreads(sb),
  ])

  const list: any[] = (convos ?? []).slice()
  const listed = new Set(list.map(c => String(c.id)))
  // EVERY WAITING GUEST IS ON THE LIST. The first page is the 100 most recent threads; a guest who
  // has been waiting while 100 newer threads moved would drop off it, and the tab would disagree
  // with the pill again. Those threads are fetched by id and merged in, newest first like the rest.
  const missing = waiting.ids.filter(id => !listed.has(id))
  const lids = Array.from(new Set(list.map(c => String(c.listing_id || ''))
    .concat(waiting.rows.map(r => String(r.listing_id || '')), phone.list.map(t => t.listingId)).filter(Boolean)))
  const [more, ls, cr] = await Promise.all([
    inChunks(missing, ids => supabase.from('guesty_conversations').select(CONVO_COLS).in('id', ids)),
    inChunks(lids, ids => supabase.from('guesty_listings').select('id, nickname, title').in('id', ids)),
    inChunks(list.map(c => String(c.id)).concat(missing), ids => sb.from('conversation_response').select('conversation_id,last_responder').in('conversation_id', ids)),
  ])
  for (const c of more) list.push(c)

  // WHO SAID THE LAST THING, AND WHOSE STAY IS IT (Jon, 2026-09-30: "it's hard to know who's sending
  // what message… who's saying what, when"). Guesty's preview is only the text. The newest message
  // of every listed thread comes from our copy of the messages — guest, a named teammate, a Guesty
  // template or an internal note — and the booking behind each thread gives the stay dates.
  const convIds = list.map(c => String(c.id))
  const oldest = list.reduce((m, c) => { const t = String(c.last_message_at || ''); return t && (!m || t < m) ? t : m }, '')
  const resIds = Array.from(new Set(list.map(c => String(c.reservation_id || '')).filter(Boolean)))
  const [lastMsgs, stays] = await Promise.all([
    inChunks(convIds, ids => sb.from('guesty_messages').select('conversation_id,sender,sender_name,is_automated,module,sent_at')
      .in('conversation_id', ids).gte('sent_at', oldest ? new Date(Date.parse(oldest) - 60_000).toISOString() : '2000-01-01').order('sent_at', { ascending: false }).limit(4000)),
    inChunks(resIds, ids => sb.from('guesty_reservations').select('id,check_in,check_out,status').in('id', ids)),
  ])
  const lastById: Record<string, LastInfo> = {}
  for (const m of lastMsgs.slice().sort((a, b) => String(b.sent_at || '').localeCompare(String(a.sent_at || '')))) {
    const k = String(m.conversation_id)
    if (lastById[k]) continue
    const who: LastInfo['who'] = m.sender === 'guest' ? 'guest' : m.sender === 'system' ? 'note' : (m.is_automated === true || isMachineName(m.sender_name as string | null)) ? 'auto' : 'team'
    lastById[k] = { who, name: m.sender_name ? String(m.sender_name) : null, module: m.module ? String(m.module) : null }
  }
  const stayById: Record<string, StayInfo> = {}
  for (const r of stays) stayById[String(r.id)] = { checkIn: r.check_in ? String(r.check_in).slice(0, 10) : null, checkOut: r.check_out ? String(r.check_out).slice(0, 10) : null, status: r.status ? String(r.status) : null }

  const unitById: Record<string, string> = {}
  // The listing's own nickname ("Arya 1002", "17WEST 1203") — a bare number said nothing about which building.
  for (const l of ls) { const n = String(l.nickname || l.title || '').trim(); unitById[l.id] = n.length > 28 ? n.slice(0, 28) + '…' : n }
  const lastResponderById: Record<string, string> = {}
  for (const r of cr) if (r.last_responder) lastResponderById[String(r.conversation_id)] = String(r.last_responder)
  const waitById: Record<string, WaitInfo> = {}
  for (const r of waiting.rows) waitById[r.conversation_id] = { since: r.awaiting_since || r.last_guest_at, due: r.sla_due_at }

  // One list, two sources, newest first. Only the fields the inbox shows cross to the client.
  const items: InboxItem[] = (list.map((c: any) => ({
    kind: 'guesty' as const, at: String(c.last_message_at || ''),
    c: { id: c.id, guest_name: c.guest_name, channel: c.channel, listing_id: c.listing_id, last_message_at: c.last_message_at, last_message_preview: c.last_message_preview ? plainText(c.last_message_preview).replace(/\s+/g, ' ').slice(0, 300) : c.last_message_preview, unread_count: c.unread_count,
      last: lastById[String(c.id)] || null, stay: c.reservation_id ? stayById[String(c.reservation_id)] || null : null },
  })) as InboxItem[])
    .concat(phone.list.map(t => ({ kind: 'phone' as const, at: t.lastAt, t })))
    .sort((a, b) => b.at.localeCompare(a.at))

  // The pill counts exactly what the Needs-reply tab lists: the waiting threads that are on the page.
  const gWaiting = list.filter(c => waitById[String(c.id)]).length
  const late = list.filter(c => { const w = waitById[String(c.id)]; return !!(w && w.due && Date.parse(w.due) <= now) }).length
  const phoneAwaiting = phone.list.filter(t => t.awaiting).length
  const waitingN = gWaiting + phoneAwaiting
  const unread = list.reduce((s, c) => s + (Number(c.unread_count) || 0), 0)

  // Response speed over 30 days. human_first_ms is null where we cannot tell a person from a
  // template, so its coverage is part of the hover rather than assumed.
  const num = (v: any) => (v == null || v === '' ? NaN : Number(v))
  const firsts = speed.rows.map(r => num(r.first_ms)).filter(n => Number.isFinite(n) && n >= 0)
  const humans = speed.rows.map(r => num(r.human_first_ms)).filter(n => Number.isFinite(n) && n >= 0)
  const enough = humans.length >= MIN_SAMPLE
  const humanMed = enough ? median(humans) : null
  // A GUEST STILL WAITING IS A MISS (2026-09-29 review, nb-9). The share counted only threads a
  // person had already answered, so the longer a guest went unanswered the less they counted
  // against it. Every thread in the waiting set with no reply from a person yet, waiting over an
  // hour, now joins the denominator as a miss.
  const humanByConv: Record<string, number> = {}
  for (const r of speed.rows) { const h = num(r.human_first_ms); if (Number.isFinite(h) && h >= 0) humanByConv[String(r.conversation_id)] = h }
  const waitingPastHour = waiting.rows.filter(r => {
    if (humanByConv[r.conversation_id] != null) return false   // a person answered its first question: counted above
    const t = Date.parse(String(r.awaiting_since || r.last_guest_at || ''))
    return Number.isFinite(t) && now - t > HOUR_MS
  }).length
  const in1hBase = humans.length + waitingPastHour
  const within1h = in1hBase >= MIN_SAMPLE ? Math.round((humans.filter(n => n <= HOUR_MS).length / in1hBase) * 100) : null
  const anyMed = firsts.length >= MIN_SAMPLE ? median(firsts) : null
  const n = humans.length
  const sample = `${n} thread${n === 1 ? '' : 's'} the guest wrote in during the last 30 days`
  const replyTitle = `Median time to the first reply a person typed, across ${sample} (Guesty templates don't count)`
    + (anyMed != null ? ` · any first reply, templates included: ${fmtDur(anyMed)}` : '')
    + (enough ? '' : ' · too few to call')
    + (speed.truncated ? ' · partial sample' : '')
    + (speed.rows.length > n ? ` · ${speed.rows.length - n} more had no reply yet, or none we could attribute to a person` : '')
  const within1hTitle = within1h != null
    ? `Share of ${sample} whose first reply from a person came within an hour — the benchmark the OTAs reward`
      + (waitingPastHour ? ` · ${waitingPastHour} guest${waitingPastHour === 1 ? '' : 's'} still waiting over an hour with no reply from a person count${waitingPastHour === 1 ? 's' : ''} as ${waitingPastHour === 1 ? 'a miss' : 'misses'}` : '')
    : `Too few threads to call (${in1hBase}) — needs ${MIN_SAMPLE}`
  const waitingTitle = waiting.error ? `Could not read the waiting list: ${waiting.error}`
    : `Guests who wrote in the last ${AWAITING_HORIZON_H}h with no reply from a person since (Guesty templates don't count)`
      + (waiting.slaKnown ? ` · ${late} past their reply-by time — ${SLA_RULE_TEXT}` : ' · reply-by times appear once migration 134 has run')
      + (phone.on ? ` · ${gWaiting} Guesty · ${phoneAwaiting} phone` : '')
      + (waiting.truncated ? ' · first 1,000 only' : '')

  // LEAN PASS (2026-09-22): numbers are pills; what each one means is in its hover title.
  return (
    <Shell>
      <LeanHead title="Messages">
        <Pill tone={humanMed == null ? 'slate' : humanMed <= HOUR_MS ? 'emerald' : humanMed <= 4 * HOUR_MS ? 'amber' : 'rose'} title={replyTitle}>Reply {fmtDur(humanMed)}</Pill>
        <Pill tone={within1h == null ? 'slate' : within1h >= 80 ? 'emerald' : within1h >= 60 ? 'amber' : 'rose'} title={within1hTitle}>{within1h == null ? '—' : within1h + '%'} in 1h</Pill>
        <Pill tone={waiting.error ? 'slate' : late > 0 ? 'rose' : waitingN > 0 ? 'amber' : 'emerald'} title={waitingTitle}>{waiting.error ? '—' : waitingN} waiting{late > 0 ? ` · ${late} late` : ''}</Pill>
        <Pill tone={unread === 0 ? 'emerald' : unread <= 10 ? 'amber' : 'rose'} title="Unread Guesty messages — Guesty's own read flag, not the same as unanswered">{unread} unread</Pill>
        <span className="text-[11px] text-muted" title={`${list.length} Guesty threads${phone.on ? ` · ${phone.list.length} phone threads` : ''}`}>{sync?.last_sync_at ? `synced ${timeAgo(new Date(sync.last_sync_at))}` : 'never synced'}</span>
        <SyncNowButton />
      </LeanHead>

      <MessagesInbox items={items} unitById={unitById} waiting={waitById} lastResponderById={lastResponderById} now={now} />
    </Shell>
  )
}

/* ---------- Reads ---------- */

/** THE PHONE SIDE (Talkroute, 2026-09-21): texts, voicemails and calls keyed by guest number. */
async function phoneThreads(sb: any): Promise<{ on: boolean; list: PhoneThreadSummary[] }> {
  const on = await talkrouteConfigured().catch(() => false)
  if (!on) return { on: false, list: [] }
  return { on: true, list: await listPhoneThreads(sb, 100).catch(() => [] as PhoneThreadSummary[]) }
}

/** `.in()` over a long id list, 200 at a time; the rows of every chunk that answered. */
async function inChunks(ids: string[], q: (ids: string[]) => PromiseLike<any>): Promise<any[]> {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const res: any = await q(ids.slice(i, i + 200))
    for (const r of ((res?.data as any[]) || [])) out.push(r)
  }
  return out
}

/* ---------- Formatting ---------- */

function fmtDur(ms: number | null) {
  if (ms == null) return '—'
  const totalMin = Math.round(ms / 60_000)
  if (totalMin < 1) return '<1m'
  if (totalMin < 60) return `${totalMin}m`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

function timeAgo(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
