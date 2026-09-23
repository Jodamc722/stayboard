// EVE ON WATCH — the command-center pass, hourly 11am–7pm ET.
//
// Jon, 2026-09-23: "He needs to be more of a high-level command center agent that's active in the
// chats throughout the day … keeping tabs on top of things, reviewing Breezeway tasks, glitches,
// completion." And then, on who she talks to: "Maybe not to the team, but maybe to our customer
// service team, our leadership team, and the team that's responsible for keeping tabs." And:
// "when you send a super long brief, that's not really helpful."
//
// SO SHE READS EVERYWHERE AND SPEAKS IN THREE ROOMS. The field channels are where things get
// reported; she reads them (lib/eve/slack-watch, now hourly) but does not post there. What she
// finds goes to the people whose job is to make sure it gets done:
//
//   ops         things slipping between Slack, the glitch board and Breezeway      → #vr-eve
//   guest       a fix is done and the guest has not heard                           → #vr-ccs-messageboard
//   leadership  a glitch or guest-reported gap (B, C, E) nobody touched for 3 hours  → #leadership
//
// Every room is a setting (app_settings `eve_on_watch`), so moving one is not a deploy.
//
// WHAT SHE LOOKS FOR. Four gaps, all read from the database, no model call:
//   A  reported in a field channel, and no Breezeway task or glitch picked it up in 45 minutes
//   B  a glitch open 2 hours with no Breezeway task behind it
//   C  a glitch's Breezeway task still open 6 hours on, with the guest still in the unit
//   D  a glitch's Breezeway task finished, the glitch still open — tell the guest it is fixed
//   E  a "Guest Reported" Breezeway task, guest in the unit, carried over from an earlier day or
//      still with nobody on it 45 minutes after she first saw it
//   F  a "Guest Reported" Breezeway task finished while the guest is still there — tell them
// E and F exist because most guest issues never reach the glitch board: the team files them
// straight into Breezeway. A task already tied to a glitch is left to C and D.
// Cleans running behind are NOT here on purpose: the late-clean reminders already cover them and
// Jon wants those left exactly as they are.
//
// HOW SHE SPEAKS. Short or not at all:
//   - silent when nothing slipped; one message per room per pass; one line per item; at most six
//   - each item is said once, ever; when it resolves she replies in that message's thread with a ✅,
//     which closes the loop without adding a line to the channel
//   - she flags and offers; she does not act. Anyone can tag @Eve in the thread to have her create or
//     assign the task, and that runs through Agent mode like everything else
//   - every post goes through the slack_post rung, so Agent mode can hold her to drafts
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { postToChannel, postThreadReply } from '@/lib/slack'
import { EVE_CHANNELS } from '@/lib/slack-rules'
import { agentAllowed, stepDown } from './agent-mode'

export const ON_WATCH_KEY = 'eve_on_watch'
const STATE_KEY = 'eve_on_watch_state'

type Room = 'ops' | 'guest' | 'leadership'
export type OnWatchConfig = { enabled: boolean; startHour: number; endHour: number; rooms: Record<Room, string> }
const DEFAULTS: OnWatchConfig = {
  enabled: true, startHour: 11, endHour: 19,
  rooms: { ops: EVE_CHANNELS.approvals, guest: EVE_CHANNELS.ccsBoard, leadership: EVE_CHANNELS.leadership },
}

const MAX_LINES = 6
const SLACK_ITEM_AFTER_MIN = 45
const NO_TASK_AFTER_H = 2
const SLOW_TASK_AFTER_H = 6
const ESCALATE_AFTER_H = 3
const OPEN = (s: any) => !/^(closed|done|resolved)$/i.test(String(s || ''))

type Flag = {
  kind: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; room: Room; line: string; label: string
  channel: string | null; ts: string | null; at: string
  escalated?: boolean; resolved?: string | null; resolvedAt?: string | null
}
type State = { flags: Record<string, Flag>; seen?: Record<string, string> }

export async function getOnWatchConfig(): Promise<OnWatchConfig> {
  const v = await getSetting<any>(ON_WATCH_KEY, null)
  const rooms = { ...DEFAULTS.rooms, ...((v && v.rooms) || {}) }
  return {
    enabled: v?.enabled === undefined ? DEFAULTS.enabled : !!v.enabled,
    startHour: Number.isFinite(Number(v?.startHour)) ? Number(v.startHour) : DEFAULTS.startHour,
    endHour: Number.isFinite(Number(v?.endHour)) ? Number(v.endHour) : DEFAULTS.endHour,
    rooms,
  }
}

const ET = 'America/New_York'
export function etHourNow(): number {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', hour12: false }).format(new Date()))
  return h === 24 ? 0 : h
}
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: ET }).format(new Date())
const clock = (ts: any) => {
  const d = new Date(String(ts)); if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }).format(d).replace(' ', '').toLowerCase()
}
const weekday = (ymd: string) => {
  const d = new Date(ymd + 'T12:00:00Z'); if (isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
}
function age(fromIso: any): string {
  const ms = Date.now() - Date.parse(String(fromIso))
  if (!Number.isFinite(ms) || ms < 0) return ''
  const h = ms / 3600_000
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm'
  if (h < 48) return Math.round(h) + 'h'
  return Math.round(h / 24) + 'd'
}
const hoursSince = (iso: any) => (Date.now() - Date.parse(String(iso))) / 3600_000
function trade(category: any, overview: any): string {
  const c = String(category || '')
  if (/pest|bed\s*bug/i.test(c)) return 'pest issue'
  if (/plumb/i.test(c)) return 'plumbing'
  if (/hvac|temperature/i.test(c)) return 'AC'
  if (/water\s*heater/i.test(c)) return 'hot water'
  if (/electric/i.test(c)) return 'electrical'
  if (/applian/i.test(c)) return 'appliance'
  if (/clean/i.test(c)) return 'cleaning issue'
  const o = String(overview || '').replace(/\s+/g, ' ').trim()
  return o ? (o.length > 48 ? o.slice(0, 48).replace(/\s\S*$/, '') + '…' : o) : 'guest issue'
}
const first = (s: any) => { const t = String(s || '').trim(); return t ? t.split(/\s+/)[0] : '' }

export type OnWatchRun = { ok: boolean; skipped?: string; found: Record<string, number>; posted: Record<string, number>; resolved: number; escalated: number; notes: string[]; preview?: Record<string, string[]> }

/** preview: find and word everything, post nothing, save nothing — what the next pass would say. */
export async function runOnWatch(opts: { force?: boolean; preview?: boolean } = {}): Promise<OnWatchRun> {
  const out: OnWatchRun = { ok: true, found: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 }, posted: {}, resolved: 0, escalated: 0, notes: [] }
  const cfg = await getOnWatchConfig()
  if (!cfg.enabled && !opts.force && !opts.preview) return { ...out, skipped: 'switched off (app_settings eve_on_watch)' }
  const hour = etHourNow()
  if (!opts.force && !opts.preview && (hour < cfg.startHour || hour > cfg.endHour)) return { ...out, skipped: `outside ${cfg.startHour}:00–${cfg.endHour}:00 ET` }

  const db = supabaseAdmin()
  const st: State = { flags: {}, ...((await getSetting<any>(STATE_KEY, null)) || {}) }
  const flags = st.flags || {}
  const seen: Record<string, string> = st.seen || {}
  const seenNow: Record<string, string> = {}
  const today = etToday()
  const now = new Date().toISOString()

  // ── Read
  const { data: itemRows } = await db.from('eve_slack_items').select('id,kind,summary,unit,channel_name,status,tracked_in,first_seen,closed_reason')
    .gte('first_seen', new Date(Date.now() - 3 * 86400_000).toISOString()).limit(400)
  const items = (itemRows as any[]) || []
  const { data: gRows } = await db.from('glitches').select('id,unit,listing_id,status,category,overview,assignee,guest_name,check_in,check_out,breezeway_task_id,created_at,closed_at')
    .gte('created_at', new Date(Date.now() - 5 * 86400_000).toISOString()).limit(500)
  const glitches = (gRows as any[]) || []
  const taskIds = Array.from(new Set(glitches.map(g => String(g.breezeway_task_id || '')).filter(Boolean)))
  const tasks: Record<string, any> = {}
  for (let i = 0; i < taskIds.length; i += 200) {
    const { data } = await db.from('breezeway_tasks_sync').select('id,status,started_at,finished_at,finished_by_name,assignees').in('id', taskIds.slice(i, i + 200))
    for (const t of (data as any[]) || []) tasks[String(t.id)] = t
  }
  const taskDone = (t: any) => !!t && (!!t.finished_at || /complete|finish|close|approv/i.test(String(t.status || '')))
  const who = (t: any) => first(t?.finished_by_name) || first(Array.isArray(t?.assignees) ? t.assignees[0]?.name : '')
  const unitOf = (g: any) => String(g.unit || 'a unit')
  // Breezeway tasks the guest reported, open or finished in the last day, not tied to a glitch.
  const GUEST_TASK = /guest\s*report|glitch/i
  const glitchTaskIds = new Set(taskIds)
  const { data: gtRows } = await db.from('breezeway_tasks_sync').select('id,name,status,scheduled_date,started_at,finished_at,finished_by_name,assignees,reference_property_id,linked_reservation_id')
    .gte('scheduled_date', new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10)).lte('scheduled_date', today)
    .or('name.ilike.%guest report%,name.ilike.%glitch%').limit(600)
  const guestTasks = ((gtRows as any[]) || []).filter(t => GUEST_TASK.test(String(t.name || '')) && !/delete|cancel/i.test(String(t.status || '')) && !glitchTaskIds.has(String(t.id)))
  const lids = Array.from(new Set(guestTasks.map(t => String(t.reference_property_id || '')).filter(Boolean)))
  const unitName: Record<string, string> = {}
  const stayNow: Record<string, { guest: string; out: string }> = {}
  for (let i = 0; i < lids.length; i += 200) {
    const part = lids.slice(i, i + 200)
    const [{ data: ls }, { data: rs }] = await Promise.all([
      db.from('guesty_listings').select('id,nickname,title').in('id', part),
      db.from('guesty_reservations').select('listing_id,guest_name,check_in,check_out,status').in('listing_id', part).lte('check_in', today).gte('check_out', today).limit(600),
    ])
    for (const l of (ls as any[]) || []) unitName[String(l.id)] = String(l.nickname || l.title || '')
    for (const r of (rs as any[]) || []) {
      if (/cancel|declin|inquir|expire/i.test(String(r.status || ''))) continue
      stayNow[String(r.listing_id)] = { guest: String(r.guest_name || ''), out: String(r.check_out || '').slice(0, 10) }
    }
  }
  const inHouse = (g: any) => { const ci = String(g.check_in || '').slice(0, 10), co = String(g.check_out || '').slice(0, 10); return !!ci && ci <= today && !!co && co > today }

  // ── Resolve what she already said
  const byId = (id: string) => glitches.find(g => String(g.id) === id)
  for (const [key, f] of Object.entries(flags)) {
    if (f.resolved) continue
    const [, id] = key.split(':')
    let done: string | null = null
    if (f.kind === 'E' || f.kind === 'F') {
      if (f.kind === 'E') {
        const t = guestTasks.find(x => String(x.id) === id)
        if (!t) done = 'no longer open'
        else if (taskDone(t)) done = `done ${clock(t.finished_at)}${who(t) ? ' by ' + who(t) : ''}`
        else if (/nobody assigned/.test(f.line) && Array.isArray(t.assignees) && t.assignees.length) done = 'assigned to ' + first(t.assignees[0]?.name)
      }
      // F is a nudge to write to the guest; nothing records that it was done, so it simply ages out.
    } else if (f.kind === 'A') {
      const it = items.find(i => String(i.id) === id)
      if (it && it.status !== 'open') done = 'closed' + (it.closed_reason ? ` (${String(it.closed_reason).slice(0, 60)})` : '')
      else if (it && it.tracked_in) done = 'now tracked in ' + String(it.tracked_in).split(':')[0]
    } else {
      const g = byId(id)
      if (!g) continue
      const t = tasks[String(g.breezeway_task_id || '')]
      if (!OPEN(g.status)) done = 'glitch closed'
      else if (f.kind === 'B' && g.breezeway_task_id) done = 'Breezeway task created'
      else if (f.kind === 'C' && taskDone(t)) done = `done ${clock(t.finished_at)}${who(t) ? ' by ' + who(t) : ''}`
    }
    if (done) { f.resolved = done; f.resolvedAt = now; out.resolved++ }
  }
  // One thread reply per message, listing what closed since.
  if (opts.preview) { out.preview = { resolved: Object.values(flags).filter(f => f.resolvedAt === now).map(f => `✅ ${f.label} — ${f.resolved}`) } }
  const closures: Record<string, { channel: string; ts: string; lines: string[] }> = {}
  for (const f of Object.values(flags)) {
    if (!f.resolved || f.resolvedAt !== now || !f.channel || !f.ts) continue
    const k = f.channel + ':' + f.ts
    ;(closures[k] = closures[k] || { channel: f.channel, ts: f.ts, lines: [] }).lines.push(`✅ ${f.label} — ${f.resolved}`)
  }
  for (const c of opts.preview ? [] : Object.values(closures)) {
    const r = await postThreadReply(c.channel, c.ts, c.lines.join('\n'))
    if (!r.ok) out.notes.push(`closure reply: ${r.error}`)
  }

  // ── Find what is slipping now
  const fresh: Record<string, Flag> = {}
  const add = (key: string, f: Omit<Flag, 'channel' | 'ts' | 'at'>) => { if (!flags[key] && !fresh[key]) { fresh[key] = { ...f, channel: null, ts: null, at: now }; out.found[f.kind]++ } }

  // A — reported in the field, nothing picked it up.
  for (const it of items) {
    if (it.status !== 'open' || it.kind !== 'problem' || it.tracked_in) continue
    const h = hoursSince(it.first_seen)
    if (h * 60 < SLACK_ITEM_AFTER_MIN || h > 12) continue
    const label = `${it.unit ? it.unit + ' · ' : ''}${String(it.summary).slice(0, 90)}`
    add('A:' + it.id, { kind: 'A', room: 'ops', label, line: `${label} — raised in #${it.channel_name || 'a channel'} ${age(it.first_seen)} ago, no Breezeway task or glitch yet.` })
  }
  for (const g of glitches) {
    if (!OPEN(g.status)) continue
    const label = `${unitOf(g)} · ${trade(g.category, g.overview)}`
    const t = tasks[String(g.breezeway_task_id || '')]
    const h = hoursSince(g.created_at)
    // B — a glitch with nothing behind it in Breezeway. Refund and manager-review lanes are money
    // decisions, not field work, so an empty Breezeway link there is normal.
    if (!g.breezeway_task_id && h >= NO_TASK_AFTER_H && h <= 7 * 24 && !/refund|manager_review/.test(String(g.status))) {
      add('B:' + g.id, { kind: 'B', room: 'ops', label, line: `${label} — glitch open ${age(g.created_at)}, no Breezeway task${g.assignee ? `, with ${first(g.assignee)}` : ''}.` })
    }
    // C — the task exists but is dragging, and the guest is living with it.
    if (t && !taskDone(t) && h >= SLOW_TASK_AFTER_H && h <= 7 * 24 && inHouse(g)) {
      add('C:' + g.id, { kind: 'C', room: 'ops', label, line: `${label} — Breezeway task still open after ${age(g.created_at)}, guest in the unit until ${weekday(String(g.check_out).slice(0, 10))}.` })
    }
    // D — fixed, and the guest has not been told. Only while they are still there or leaving today.
    const co = String(g.check_out || '').slice(0, 10)
    if (t && taskDone(t) && hoursSince(t.finished_at) <= 24 && Date.parse(t.finished_at) > Date.parse(g.created_at) && (inHouse(g) || co === today)) {
      const guest = first(g.guest_name)
      add('D:' + g.id, { kind: 'D', room: 'guest', label, line: `${label} — fixed ${clock(t.finished_at)}${who(t) ? ' by ' + who(t) : ''}. ${guest ? guest + ' is' : 'The guest is'} ${co === today ? 'checking out today' : 'in until ' + weekday(co)}; worth a quick note that it's sorted. I can draft it.` })
    }
  }

  // E / F — guest-reported work that lives only in Breezeway.
  for (const t of guestTasks) {
    const lid = String(t.reference_property_id || '')
    const stay = stayNow[lid]
    const label = `${unitName[lid] || 'a unit'} · ${String(t.name || '').replace(/\s+/g, ' ').trim().slice(0, 60)}`
    const sd = String(t.scheduled_date || '').slice(0, 10)
    const nobody = !(Array.isArray(t.assignees) && t.assignees.length)
    if (!taskDone(t)) {
      if (!stay || stay.out <= today) continue
      if (sd && sd < today) {
        add('E:' + t.id, { kind: 'E', room: 'ops', label, line: `${label} — open since ${weekday(sd)}${nobody ? ', nobody assigned' : ''}; guest in the unit until ${weekday(stay.out)}.` })
      } else if (nobody) {
        // Seen unassigned on an earlier pass and still unassigned 45 minutes on: then it is a gap.
        const k = 'E:' + t.id
        seenNow[k] = seen[k] || now
        if (hoursSince(seenNow[k]) * 60 >= SLACK_ITEM_AFTER_MIN) add(k, { kind: 'E', room: 'ops', label, line: `${label} — nobody assigned since ${clock(seenNow[k])}; guest in the unit until ${weekday(stay.out)}.` })
      }
    } else if (t.finished_at && hoursSince(t.finished_at) <= 24 && stay && stay.out >= today) {
      const guest = first(stay.guest)
      add('F:' + t.id, { kind: 'F', room: 'guest', label, line: `${label} — done ${clock(t.finished_at)}${who(t) ? ' by ' + who(t) : ''}. ${guest ? guest + ' is' : 'The guest is'} ${stay.out === today ? 'checking out today' : 'in until ' + weekday(stay.out)}; worth a quick note that it's sorted. I can draft it.` })
    }
  }

  // ── Escalate what nobody touched
  const escalate: [string, Flag][] = []
  for (const [key, f] of Object.entries(flags)) {
    // Only glitch-backed gaps go up to leadership. A Slack problem often closes without anyone
    // saying so in the thread, and paging leadership about one of those is noise.
    if (f.resolved || f.escalated || (f.kind !== 'B' && f.kind !== 'C' && f.kind !== 'E') || !f.ts) continue
    if (hoursSince(f.at) >= ESCALATE_AFTER_H) escalate.push([key, f])
  }

  if (opts.preview) {
    for (const [, f] of Object.entries(fresh)) (out.preview![f.room] = out.preview![f.room] || []).push(f.line)
    out.preview!.leadership = escalate.map(([, f]) => f.line)
    return out
  }

  // ── Speak: one short message per room
  // Returns the keys actually said and where. Lines past the cap are NOT marked as said; they go
  // out on the next pass.
  const say = async (room: Room, head: string, rows: [string, Flag][], tail: string): Promise<{ channel: string; ts: string | null; keys: string[] } | null> => {
    if (!rows.length) return null
    const channel = cfg.rooms[room]
    if (!channel) { out.notes.push(`${room}: no room set`); return null }
    const shown = rows.slice(0, MAX_LINES)
    const more = rows.length > shown.length ? `\n…and ${rows.length - shown.length} more. Ask me for the list.` : ''
    const text = `${head}\n${shown.map(([, f]) => `• ${f.line}`).join('\n')}${more}${tail ? '\n' + tail : ''}`
    const gate = await agentAllowed('slack_post')
    const r = await stepDown(gate, { action: 'slack_post', summary: `on watch · ${room}: ${rows.length} item${rows.length === 1 ? '' : 's'}`, exec: { channel, text }, by: 'cron:on-watch' },
      async () => { const p = await postToChannel(channel, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
    if (r.mode !== 'act') out.notes.push(`${room} ${r.mode}: ${gate.reason}`)
    if (r.mode === 'act' && !r.ok) { out.notes.push(`${room}: ${r.error}`); return null }
    if (r.mode === 'observe') return null
    out.posted[room] = (out.posted[room] || 0) + shown.length
    return { channel, ts: r.mode === 'act' ? (r.ref || null) : null, keys: shown.map(([k]) => k) }
  }

  const freshRows = Object.entries(fresh)
  const t = clock(now)
  for (const [room, head, tail] of [
    ['ops', `*On watch · ${t}*`, 'Tag @Eve here if you want me to create or assign any of these.'],
    ['guest', `*Fixed, guest not told yet · ${t}*`, ''],
  ] as [Room, string, string][]) {
    const said = await say(room, head, freshRows.filter(([, f]) => f.room === room), tail)
    if (said) for (const k of said.keys) { fresh[k].channel = said.channel; fresh[k].ts = said.ts; flags[k] = fresh[k] }
  }
  // Escalations are a new line in leadership; the flag keeps its original thread for the ✅.
  const esc = await say('leadership', `*Still open after ${ESCALATE_AFTER_H}h, nobody on it*`, escalate, '')
  if (esc) for (const k of esc.keys) { flags[k].escalated = true; out.escalated++ }

  // ── Remember
  for (const [key, f] of Object.entries(flags)) {
    const old = hoursSince(f.resolvedAt || f.at)
    if ((f.resolved && old > 48) || old > 5 * 24) delete flags[key]
  }
  await setSetting(STATE_KEY, { flags, seen: seenNow }, 'on-watch')
  return out
}
