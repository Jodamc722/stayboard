// EVE'S ONE MORNING POST (Eve audit 2026-10-07 — Jon: "consolidate Eve's engagement in a way that's
// helpful and direction-focused").
//
// Four morning posts became one. "Today — …" (ops desk plan), "Keeping tabs — …" (the Slack roll-up),
// the 7am CCS handoff and the 6pm "End of day" each said part of the day, at different times, to a
// room where ~61 posts drew one reply in a week. This is the whole morning in one message:
//
//   Ops Command · Wed, Oct 7 — Ops health 72 · Watch
//   19 cleans · 4 by 4pm · 0 unassigned · 31 in / 25 out · 9 on shift
//   Decide today — the Today board's top rows, each: unit — what · OWNER → next step · due
//   Waiting on a person — Slack loops, but each one only on its FIRST morning and once more if it
//     ages past 3 days ("close it or name someone"); after that it lives on the Eve tab, counted.
//   Yesterday — one win line
//   links: the full Ops Command brief · the Today board · the Eve tab
//
// Built from lib/briefs/direction (the same engine as the Ops Command email and the Today board).
// Once a day, 7–10am ET, at the first slack-watch run. Settings: app_settings eve_morning
// { enabled (default true), channel (default #vr-eve) }. Switching it off brings back the old posts.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'
import { EVE_CHANNELS } from '@/lib/slack-rules'
import { postToChannel } from '@/lib/slack'
import { agentAllowed, stepDown } from './agent-mode'
import { buildDirection, type DayDirection, type Loop } from '@/lib/briefs/direction'

export const MORNING_KEY = 'eve_morning'
const STATE_KEY = 'eve_morning_state'
type Cfg = { enabled?: boolean; channel?: string; slack?: boolean }
type State = { lastDay?: string | null; seen?: Record<string, { n: number; first: string }> }

/**
 * Is the CONSOLIDATED morning in force? This is what keeps the old roll-up, the ops-desk plan and
 * the handoff posts suppressed — it is not the same question as "does Eve post in the morning".
 */
export async function morningOn(): Promise<boolean> {
  try { const c = (await getSetting<Cfg>(MORNING_KEY, {})) || {}; return c.enabled !== false } catch { return true }
}

/**
 * DOES IT GO TO SLACK? (Jon, 2026-10-09: "this is noise, only want this in email for ops command".)
 *
 * Off by default now. The post was a shortened Ops Command in a room where it competed with the
 * email that says the same thing better — the brief is the document, Slack was a duplicate. The
 * switch is separate from `enabled` on purpose: turning the morning post OFF used to turn three
 * older, noisier posts back ON, which is the opposite of what quiet means. With this, the legacy
 * posts stay suppressed and nothing is said in the morning at all.
 *
 * Set app_settings `eve_morning` to { slack: true } to bring it back.
 */
export async function morningSlackOn(): Promise<boolean> {
  try { const c = (await getSetting<Cfg>(MORNING_KEY, {})) || {}; return c.slack === true } catch { return false }
}

const APP = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
const etHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date())) % 24
const niceDay = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const age = (h: number) => (h < 48 ? `${h}h` : `${Math.round(h / 24)}d`)
const short = (s: string, n: number) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t }

/**
 * Which loops this morning says out loud. A loop is said on its first morning, and once more when it
 * has aged past 3 days with nobody closing it — then never again in Slack (it is on the Eve tab and
 * counted). This is what stops "PT 223 lock — nobody" appearing seven mornings running.
 */
export function pickLoops(loops: Loop[], seen: Record<string, { n: number; first: string }>, max: number): { say: (Loop & { aging: boolean })[]; quiet: number } {
  const say: (Loop & { aging: boolean })[] = []
  let quiet = 0
  for (const l of loops) {
    const s = seen[l.id]
    const first = !s || s.n === 0
    // Said once already, now past 3 days old, and at least two mornings since it was first said.
    const aging = !!s && s.n === 1 && l.ageH >= 72 && (Date.now() - Date.parse(s.first + 'T12:00:00Z')) >= 2 * 86400_000
    if ((first || aging) && say.length < max) say.push({ ...l, aging })
    else quiet++
  }
  return { say, quiet }
}

export function morningText(d: DayDirection, picked: { say: (Loop & { aging: boolean })[]; quiet: number }): string {
  const parts: string[] = []
  const h = d.health
  const band = h ? (h.band === 'smooth' ? '🟢' : h.band === 'watch' ? '🟡' : '🔴') : ''
  parts.push(`*Ops Command · ${niceDay(d.today)}*${h ? ` — ${band} Ops health *${h.score}* · ${h.label}` : ''}`)
  const day = d.day
  if (day) {
    const c = day.tiles.cleans
    const unassigned = c.rows.filter(r => r.status !== 'done' && r.status !== 'vendor' && (!r.who || /unassigned/i.test(r.who))).length
    const sameDay = c.rows.filter(r => r.sameDay && r.status !== 'done').length
    parts.push([`${c.total} cleans`, sameDay ? `*${sameDay} by 4pm*` : '', unassigned ? `*${unassigned} unassigned*` : 'all assigned', `${day.pulse.arrivals} in / ${day.pulse.departures} out`, `${day.tiles.team.onShift} on shift`, day.tiles.glitches.open ? `${day.tiles.glitches.open} glitches open${day.tiles.glitches.overdue ? ` (*${day.tiles.glitches.overdue} overdue*)` : ''}` : ''].filter(Boolean).join(' · '))
    if (h && h.score < 100) parts.push(`_${h.headline}_`)
  }
  if (d.decide.length) {
    parts.push(`*Decide today*\n${d.decide.slice(0, 5).map((x, i) => `${i + 1}. *${short(x.unit || x.title, 34)}* — ${short(x.title, 70)} · *${x.owner}* → ${short(x.next, 80)}${x.due ? ` · ${x.due}` : ''}`).join('\n')}`)
  } else if (day) parts.push('*Decide today* — nothing on the board needs a decision. 👏')
  if (picked.say.length) {
    const line = (l: Loop & { aging: boolean }) => {
      const what = l.kind === 'guest_ask' ? 'Guest ask' : l.kind === 'problem' ? 'No owner' : 'Promised'
      const tail = l.aging ? ` — *${age(l.ageH)} old: close it or name someone*` : ` · ${age(l.ageH)}`
      return `• ${what}${l.unit ? ` · ${short(l.unit, 24)}` : ''} — ${short(l.summary, 90)}${l.owner ? ` — ${l.owner}` : ''}${tail}`
    }
    parts.push(`*Waiting on a person*\n${picked.say.map(line).join('\n')}`)
  }
  if (d.wins.length) parts.push(`_Yesterday:_ ${d.wins.join(' · ')}`)
  const links = [`<${APP}/api/cron/ops-brief?preview=full|Full Ops Command>`, `<${APP}/command|Today board>`, `<${APP}/eve?tab=loops|Eve tab${picked.quiet ? ` (${picked.quiet} more open)` : ''}>`]
  parts.push(links.join(' · '))
  if (d.degraded.length) parts.push(`_Partial: ${d.degraded.join('; ')}._`)
  return parts.join('\n\n')
}

export type MorningRun = { posted: boolean; skipped?: string; text?: string; mode?: string; note?: string }

export async function runMorning(opts: { force?: boolean; preview?: boolean } = {}): Promise<MorningRun> {
  const cfg = (await getSetting<Cfg>(MORNING_KEY, {})) || {}
  if (cfg.enabled === false && !opts.force && !opts.preview) return { posted: false, skipped: 'off' }
  const st = ((await getSetting<State>(STATE_KEY, {})) || {}) as State
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const h = etHour()
  if (!opts.force && !opts.preview && (st.lastDay === today || h < 7 || h > 10)) return { posted: false, skipped: st.lastDay === today ? 'already posted today' : `not morning (${h}:00 ET)` }

  const d = await buildDirection()
  const seen = { ...(st.seen || {}) }
  const all = [...d.loops.asks, ...d.loops.unowned, ...d.loops.late]
  // Forget loops that are no longer open, so the map never grows past what is live.
  const live = new Set(all.map(l => l.id))
  for (const k of Object.keys(seen)) if (!live.has(k)) delete seen[k]
  const picked = pickLoops(all, seen, 5)
  const text = morningText(d, picked)
  if (opts.preview) return { posted: false, text }
  // Email only, unless somebody has switched the Slack post back on.
  if (!opts.force && !(await morningSlackOn())) return { posted: false, skipped: 'email only — Ops Command goes out as the brief', text }

  const channel = cfg.channel || EVE_CHANNELS.approvals
  // A person's schedule, not Eve's initiative — urgent, so the room cap and quiet hours never hold it.
  const gate = await agentAllowed('slack_post', { urgent: true })
  const r = await stepDown(gate, { action: 'slack_post', summary: `Ops Command morning post (${d.decide.length} to decide, ${picked.say.length} waiting)`, exec: { channel, channel_name: 'vr-eve', text }, subject: 'morning:' + today, by: 'cron:morning' },
    async () => { const p = await postToChannel(channel, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
  if (r.ok && r.mode !== 'observe') {
    for (const l of picked.say) seen[l.id] = { n: (seen[l.id]?.n || 0) + 1, first: seen[l.id]?.first || today }
    await setSetting(STATE_KEY, { lastDay: today, seen }, 'eve-morning')
  }
  return { posted: r.mode === 'act' && r.ok, mode: r.mode, text, note: r.mode !== 'act' ? gate.reason : undefined }
}
