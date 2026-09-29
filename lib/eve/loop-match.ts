// HOW A LOOP KNOWS IT IS DONE.
//
// Jon, 2026-09-28: "we need to ensure that Eve is understanding when things are actually completed.
// If something is reported in Slack, a task might be created, and she needs to figure out how to
// associate the task with the ask in Slack. Also needs to be able to review messages to see if
// there was communication sent to the guest."
//
// Three ways a loop closes without anyone typing "done" in the thread, in the order they are tried:
//
//   1. THE TASK THAT CAME OUT OF IT. A Breezeway task on the same unit, created on or after the
//      day it was reported, about the SAME THING — matched by topic words (A/C, lock, wifi, leak…),
//      never merely "some task on that unit": a departure clean finishing must not close "AC not
//      working". Once matched, the task id is written on the loop (evidence.taskId) and from then on
//      that ONE task decides: open → the loop shows "in Breezeway"; finished → the loop closes with
//      the task's name and who finished it; cancelled → the match is dropped and it looks again.
//   2. THE GLITCH. Same idea on the glitch board, by unit and topic.
//   3. THE GUEST WAS ANSWERED. For a guest ask or a guest-facing problem, the guest's own Guesty
//      thread: a host message sent after the ask closes it ("we replied 2:10pm by Maria") — the
//      reply IS the completion for a call-back, a question, a change request. For a problem it
//      does not close the loop (telling the guest is not fixing it) but is recorded so the nudge
//      never says "did anyone tell the guest" when someone did.
//
// Every match records WHY on the loop so a person can see the association and undo it if it is
// wrong (Not a loop / Reopen on /loops). Unit resolution uses building + number from the text
// ("Salato 401", "401 at Salato", "PT 223"), not the number alone — "402" exists in five buildings.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isDepartureCleanName } from '@/lib/breezeway'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const lc = (v: any) => str(v).toLowerCase()
/** Guesty activity logs and internal notes — never a message to the guest (same set as lib/eve/watches). */
const INTERNAL_MODULES = new Set(['log', 'note', 'notes', 'internal', 'internal_note', 'activity', 'system'])

// Topic vocabulary: the words a report and its task share. Each group is one topic.
const TOPICS: [string, RegExp][] = [
  ['ac', /\b(a\/?c|ac unit|air ?con(ditioning)?|hvac|thermostat|cooling|not cooling|too hot|mini ?split|freon|compressor|aire)\b/i],
  ['lock', /\b(lock|door code|keypad|deadbolt|latch|fob|key(s)?|locked out|lockout|access|cerradura|llave|código|codigo)\b/i],
  ['wifi', /\b(wi-?fi|internet|router|modem|network|tv|television|remote|cable|streaming|roku|firestick)\b/i],
  ['water', /\b(leak(ing)?|water|flood|drain|clog(ged)?|toilet|shower|faucet|sink|hot water|heater|plumb(ing|er)|fuga|agua|baño|bano)\b/i],
  ['power', /\b(power|electric(al|ity)?|breaker|outlet|light(s|ing)?|bulb|no power|luz)\b/i],
  ['appliance', /\b(washer|dryer|dishwasher|fridge|refrigerator|freezer|oven|stove|microwave|garbage disposal|ice maker|lavadora|secadora|nevera|horno)\b/i],
  ['clean', /\b(clean(ing)?|dirty|dust|hair|stain|smell|odor|trash|garbage|linen|towel(s)?|sheets|limpieza|sucio|sucia|toallas|sábanas|sabanas)\b/i],
  ['pest', /\b(bug(s)?|roach(es)?|ant(s)?|pest|mice|mouse|rat(s)?|bed ?bug(s)?|mosquito|cucaracha(s)?)\b/i],
  ['supply', /\b(restock|supplies|amenit(y|ies)|coffee|soap|shampoo|paper|pack ?n ?play|crib|air mattress|iron|hair ?dryer|inventory|stock)\b/i],
  ['damage', /\b(damage(d)?|broken|crack(ed)?|scratch(ed)?|hole|paint|wall|furniture|blind(s)?|curtain(s)?|roto|rota|dañado)\b/i],
  ['noise', /\b(noise|noisy|loud|party|smok(e|ing)|complain(t|ing)?|neighbor)\b/i],
  ['parking', /\b(parking|garage|valet|car|vehicle|spot)\b/i],
  ['checkin', /\b(check.?in|check.?out|early|late|arrival|departure|eta|luggage|bag(s)?)\b/i],
]
export function topicsOf(text: string): string[] {
  const t = str(text)
  return TOPICS.filter(([, re]) => re.test(t)).map(([k]) => k)
}

const BUILDINGS = /\b(oasis|botanica|arya|elser|17 ?west|salato|rustic|hendricks|pelican|waves|eden|nomad|capri|lucerne|amrit|park ?towers?|pt|district ?225|d225|miami house|monroe)\b/i
const NUMBER = /\b(\d{3,4}(?:\/\d)?)\b/

/**
 * The listing a report is about, from building + number in the text. A number with no building
 * resolves only when it exists in exactly one building. Null rather than a guess.
 */
export async function resolveUnitInText(text: string, hint?: { unit?: string | null; building?: string | null }): Promise<{ id: string; name: string; building: string } | null> {
  const t = `${str(hint?.building)} ${str(hint?.unit)} ${str(text)}`
  const b = (t.match(BUILDINGS) || [])[0] || ''
  const n = (str(hint?.unit).match(NUMBER) || t.match(NUMBER) || [])[1] || ''
  if (!n && !str(hint?.unit)) return null
  try {
    const db = supabaseAdmin()
    const q = n ? db.from('guesty_listings').select('id,nickname,title,status,building').or(`nickname.ilike.%${n}%,title.ilike.%${n}%`).limit(20)
      : db.from('guesty_listings').select('id,nickname,title,status,building').ilike('nickname', `%${str(hint?.unit).replace(/[%,()]/g, '')}%`).limit(10)
    const { data } = await q
    let rows = ((data || []) as any[]).filter(r => !/inactive|archived|deleted/i.test(str(r.status)))
    if (b) {
      const bb = lc(b).replace(/\s+/g, '').replace(/^pt$/, 'parktower').replace(/^d225$/, 'district225')
      const inB = rows.filter(r => lc(r.building + ' ' + r.nickname + ' ' + r.title).replace(/\s+/g, '').includes(bb.replace(/s$/, '')))
      if (inB.length) rows = inB
    }
    if (n) rows = rows.filter(r => new RegExp(`(^|[^0-9])${n.replace('/', '\\/')}([^0-9]|$)`).test(str(r.nickname) + ' ' + str(r.title)))
    if (rows.length !== 1) return null
    const l = rows[0]
    return { id: str(l.id), name: str(l.nickname || l.title), building: str(l.building) }
  } catch { return null }
}

export type Match = { closed?: string; tracked?: string; evidence?: Record<string, any> }

const done = (t: any) => !!t.finished_at || /complet|finish|close|approv/i.test(str(t.status))
const gone = (t: any) => /cancel|delet|void/i.test(str(t.status))
const who = (t: any) => str(t.finished_by_name || (Array.isArray(t.assignees) && t.assignees[0] && (t.assignees[0].name || t.assignees[0])) || '')
const clock = (iso: any) => { const d = new Date(str(iso)); return isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d).replace(' ', '').toLowerCase() }

/** 1. The task that came out of it. */
export async function matchTask(item: { listing_id?: string | null; first_seen: string; summary: string; evidence?: any }): Promise<Match | null> {
  const db = supabaseAdmin()
  const text = `${item.summary} ${str(item.evidence?.text)}`
  const topics = topicsOf(text)
  const sinceDay = str(item.first_seen).slice(0, 10)
  const sinceDayMinus = new Date(Date.parse(sinceDay + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)

  // A task already matched decides on its own.
  const pinned = str(item.evidence?.taskId)
  if (pinned) {
    const { data: t } = await db.from('breezeway_tasks_sync').select('id,name,status,finished_at,finished_by_name,assignees').eq('id', pinned).maybeSingle()
    if (t && !gone(t)) {
      if (done(t)) return { closed: `Breezeway task "${str(t.name).slice(0, 60)}" finished${clock(t.finished_at) ? ' ' + clock(t.finished_at) : ''}${who(t) ? ' by ' + who(t) : ''}` }
      return { tracked: `breezeway:${pinned}` }
    }
    // cancelled or gone: forget it and look again
  }
  if (!item.listing_id) return null
  const { data } = await db.from('breezeway_tasks_sync')
    .select('id,name,status,scheduled_date,finished_at,finished_by_name,assignees,type_department,description:raw->>description,created_at:raw->>created_at')
    .eq('reference_property_id', item.listing_id).gte('scheduled_date', sinceDayMinus)
    .order('scheduled_date', { ascending: true }).limit(40)
  const tasks = ((data || []) as any[]).filter(t => !gone(t))
  let best: any = null, bestScore = 0
  for (const t of tasks) {
    const tt = `${str(t.name)} ${str(t.description)}`
    const isClean = isDepartureCleanName(str(t.name)) || /departure clean|turnover/i.test(str(t.name))
    // A clean or a routine inspection only matches a cleaning report.
    if (isClean && !topics.includes('clean')) continue
    if (/quality inspection|pre-arrival inspection/i.test(str(t.name)) && !topics.length) continue
    const tTopics = topicsOf(tt)
    const overlap = topics.filter(k => tTopics.includes(k)).length
    // Guest-reported / glitch tasks on the same unit created after the report match with weaker
    // evidence — that is what those tasks are for.
    const guestReported = /guest reported|glitch/i.test(str(t.name))
    const score = overlap * 2 + (guestReported ? 1 : 0)
    if (!topics.length && !guestReported) continue
    if (score > bestScore && (overlap > 0 || guestReported)) { best = t; bestScore = score }
  }
  if (!best) return null
  const ev = { taskId: str(best.id), taskName: str(best.name).slice(0, 80), matchedBy: topics.length ? 'topic: ' + topics.join(', ') : 'guest-reported task on the unit after the report' }
  if (done(best)) return { closed: `Breezeway task "${str(best.name).slice(0, 60)}" finished${clock(best.finished_at) ? ' ' + clock(best.finished_at) : ''}${who(best) ? ' by ' + who(best) : ''}`, evidence: ev }
  return { tracked: `breezeway:${best.id}`, evidence: ev }
}

/** 2. The glitch. */
export async function matchGlitch(item: { listing_id?: string | null; unit?: string | null; first_seen: string; summary: string; evidence?: any }): Promise<Match | null> {
  const db = supabaseAdmin()
  const topics = topicsOf(`${item.summary} ${str(item.evidence?.text)}`)
  const since = new Date(Date.parse(item.first_seen) - 86400000).toISOString()
  let q = db.from('glitches').select('id,unit,status,category,overview,created_at,listing_id').gte('created_at', since).order('created_at', { ascending: false }).limit(10)
  if (item.listing_id) q = q.eq('listing_id', item.listing_id)
  else if (item.unit) q = q.ilike('unit', `%${str(item.unit).replace(/[%,()]/g, '')}%`)
  else return null
  const { data } = await q
  const g = ((data || []) as any[]).find(x => !topics.length || topicsOf(`${x.category} ${x.overview}`).some(k => topics.includes(k)))
  if (!g) return null
  if (/closed|resolved|done|complete/i.test(str(g.status))) return { closed: `glitch #${g.id} closed`, evidence: { glitchId: str(g.id) } }
  return { tracked: `glitch:${g.id}`, evidence: { glitchId: str(g.id) } }
}

/** 3. The guest was answered — did we write to the guest after this was raised? */
export async function guestAnswered(item: { listing_id?: string | null; first_seen: string; evidence?: any }): Promise<{ at: string; by: string; conversationId: string } | null> {
  const db = supabaseAdmin()
  const guest = str(item.evidence?.guest).trim()
  const sinceIso = new Date(Date.parse(item.first_seen) - 5 * 60_000).toISOString()
  try {
    const ids: string[] = []
    // THE RIGHT GUEST (2026-09-28 audit, F28). A first name alone matched threads across the whole
    // portfolio — "Maria" is a dozen guests — and closed the ask on somebody else's reply. A name now
    // counts only as a FULL name (every part of it in the thread's guest name); otherwise the thread
    // must be the one on the loop's own unit (below).
    const parts = guest.split(/\s+/).filter(p => p.replace(/[^a-z]/gi, '').length >= 2)
    if (parts.length >= 2) {
      const { data: byName } = await db.from('guesty_conversations').select('id,guest_name,last_message_at').ilike('guest_name', `%${parts[0].replace(/[%,()]/g, '')}%`).gte('last_message_at', sinceIso).order('last_message_at', { ascending: false }).limit(10)
      for (const c of ((byName || []) as any[])) { const n = lc(c.guest_name); if (parts.every(p => n.includes(lc(p)))) ids.push(str(c.id)) }
    }
    if (!ids.length && item.listing_id) {
      const day = str(item.first_seen).slice(0, 10)
      const { data: rs } = await db.from('guesty_reservations').select('id,status').eq('listing_id', item.listing_id).lte('check_in', day).gte('check_out', day).limit(5)
      const r = ((rs || []) as any[]).find(x => !/cancel|declin|inquir|expire/i.test(str(x.status)))
      if (r) { const { data: convs } = await db.from('guesty_conversations').select('id').eq('reservation_id', str(r.id)).limit(5); for (const c of ((convs || []) as any[])) ids.push(str(c.id)) }
    }
    if (!ids.length) return null
    // A GUESTY TEMPLATE IS NOT A REPLY (2026-09-28 audit, F28 / 09 D13). Scheduled templates (check-in
    // instructions, review requests) are host messages with is_automated=true and closed the ask as
    // "we replied". They are skipped — `.or(...)` keeps the NULL rows, which are most of them — and so
    // are internal notes and logs; a message with a person's name on it is preferred.
    const { data: msgs } = await db.from('guesty_messages').select('conversation_id,sent_at,sender_name,module').in('conversation_id', ids).eq('sender', 'host').gt('sent_at', sinceIso)
      .or('is_automated.is.null,is_automated.eq.false').order('sent_at', { ascending: true }).limit(10)
    const real = ((msgs || []) as any[]).filter(x => !INTERNAL_MODULES.has(lc(x.module)))
    const m = real.find(x => str(x.sender_name).trim()) || real[0]
    return m ? { at: str(m.sent_at), by: str(m.sender_name), conversationId: str(m.conversation_id) } : null
  } catch { return null }
}

/**
 * The whole check for one open loop. Returns what to do: close (with reason), mark tracked, and
 * the evidence to merge in. `kind` decides what a guest reply means.
 */
export async function checkLoop(item: { kind: string; listing_id?: string | null; unit?: string | null; first_seen: string; summary: string; evidence?: any; tracked_in?: string | null }): Promise<Match | null> {
  if (item.kind === 'decision') return null
  const ev: Record<string, any> = {}
  // A guest ask is answered by us replying to the guest, or by the booking (checked by the caller).
  if (item.kind === 'guest_ask' || item.kind === 'question' || item.kind === 'problem') {
    const g = await guestAnswered(item)
    if (g && !item.evidence?.guestTold) {
      ev.guestTold = g.at; ev.guestToldBy = g.by; ev.conversationId = g.conversationId
      // A REFUND IS NEVER CLOSED BY A REPLY (F28): telling the guest is not deciding the money.
      const ask = str(item.evidence?.ask)
      if (item.kind === 'guest_ask' && ask !== 'refund' && ['callback', 'change', 'other', 'inquiry', 'discount', 'extension'].includes(ask)) {
        return { closed: `we replied to the guest ${clock(g.at)}${g.by ? ' by ' + g.by : ''}`, evidence: ev }
      }
    }
  }
  if (item.kind === 'guest_ask') return Object.keys(ev).length ? { evidence: ev } : null
  const t = await matchTask(item)
  if (t) return { ...t, evidence: { ...ev, ...(t.evidence || {}) } }
  const g = await matchGlitch(item)
  if (g) return { ...g, evidence: { ...ev, ...(g.evidence || {}) } }
  return Object.keys(ev).length ? { evidence: ev } : null
}
