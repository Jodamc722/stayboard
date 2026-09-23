// WHAT WENT WELL (Jon, 2026-09-23: "making Eve a little bit more supportive").
//
// Eve sees every clean, glitch and review, and until now she only ever spoke up about the ones that
// went wrong. This reads one day and returns the things that went RIGHT, each as a specific line a
// person would be glad to read: "All 19 departure cleans done before 4pm." "HVAC at 1508 closed in
// 1h 50m — Carlos." A 5-star that says the place was spotless.
//
// THREE RULES, because praise done badly is worse than none:
//   - Specific or silent. A line needs a real number or a real name behind it. Nothing is padded.
//   - Never a ranking. No "most cleans", no comparisons between people. Credit is additive; the
//     moment it becomes a leaderboard it is a scorecard with a smiley face on it.
//   - Wins only. A day that went badly produces an empty list here, not a list of what missed —
//     the misses already have their own watches and their own room.
//
// Free: plain reads, no model. Used by the morning roll-up in #vr-eve (lib/eve/slack-watch) and by
// the `team_wins` tool so Eve can give credit in conversation.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isDepartureCleanName } from '@/lib/breezeway'
import { etDay } from '@/lib/clean-day'

/** Standard check-in. A departure clean finished before this hour (ET) was ready for the guest. */
const CHECKIN_HOUR_ET = 16
/** A glitch closed inside this many hours is fast enough to call out. */
const FAST_GLITCH_HOURS = 24
/** A review that says one of these about the place or the team is worth quoting. */
const PRAISE = /\b(spotless|immaculate|so clean|very clean|super clean|clean and|responsive|quick(ly)? (to )?(respond|fix|repla)|fixed (it )?(right away|quickly|fast)|helpful|attentive|went above|above and beyond|amazing (team|staff|host)|great (team|staff|host|communication)|thank(s| you) to)\b/i

export type Wins = {
  day: string
  lines: string[]
  facts: {
    cleans: { done: number; beforeCheckin: number } | null
    fastGlitches: { unit: string; trade: string; hours: number; assignee: string | null }[]
    fiveStars: number
    quotes: { unit: string; channel: string | null; text: string }[]
  }
}

function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
function etHour(ts: string): number {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(new Date(ts)))
  return h === 24 ? 0 : h
}
function tradeOf(category: any, overview: any): string {
  const c = String(category || '')
  if (/pest|bed\s*bug/i.test(c)) return 'Pest issue'
  if (/plumb/i.test(c)) return 'Plumbing'
  if (/hvac|temperature/i.test(c)) return 'AC'
  if (/water\s*heater/i.test(c)) return 'Hot water'
  if (/electric/i.test(c)) return 'Electrical'
  if (/applian/i.test(c)) return 'Appliance'
  if (/clean/i.test(c)) return 'Cleaning issue'
  const o = String(overview || '').replace(/\s+/g, ' ').trim()
  return o ? (o.length > 40 ? o.slice(0, 40).replace(/\s\S*$/, '') + '…' : o) : 'Guest issue'
}
function fmtHours(h: number): string {
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm'
  const whole = Math.floor(h), m = Math.round((h - whole) * 60)
  return m ? `${whole}h ${m}m` : `${whole}h`
}
function firstName(s: any): string | null {
  const t = String(s || '').trim()
  if (!t) return null
  return /^support$/i.test(t) ? 'Support' : t.split(/\s+/)[0]
}
const norm = (v: any) => { const n = Number(v); return Number.isFinite(n) ? (n > 5 ? n / 2 : n) : NaN }

/** Yesterday (ET) by default. */
export async function winsFor(day?: string): Promise<Wins> {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? String(day) : addDays(etToday(), -1)
  const lo = addDays(d, -1) + 'T12:00:00Z', hi = addDays(d, 1) + 'T12:00:00Z'
  const db = supabaseAdmin()
  const out: Wins = { day: d, lines: [], facts: { cleans: null, fastGlitches: [], fiveStars: 0, quotes: [] } }

  const names: Record<string, string> = {}
  const nameOf = async (ids: string[]) => {
    const want = ids.filter(id => id && !names[id])
    if (!want.length) return
    const { data } = await db.from('guesty_listings').select('id,nickname,title').in('id', want.slice(0, 200))
    for (const l of (data as any[]) || []) names[String(l.id)] = String(l.nickname || l.title || '')
  }

  // ── Cleans: the day the work landed, and whether it was ready for check-in. ─────────────────
  try {
    const { data } = await db.from('breezeway_tasks_sync').select('id,name,status,finished_at')
      .gte('finished_at', lo).lt('finished_at', hi).limit(3000)
    const done = ((data as any[]) || []).filter(t =>
      isDepartureCleanName(t.name) && !/delete|cancel/i.test(String(t.status || '')) && etDay(t.finished_at) === d)
    const before = done.filter(t => etHour(t.finished_at) < CHECKIN_HOUR_ET).length
    if (done.length) out.facts.cleans = { done: done.length, beforeCheckin: before }
    if (done.length >= 3 && before === done.length) out.lines.push(`All ${done.length} departure cleans done before ${CHECKIN_HOUR_ET - 12}pm.`)
    else if (done.length >= 5 && before / done.length >= 0.9) out.lines.push(`${before} of ${done.length} departure cleans done before ${CHECKIN_HOUR_ET - 12}pm.`)
  } catch { /* a missing read is not a win or a loss; say nothing */ }

  // ── Glitches closed fast. ─────────────────────────────────────────────────────────────────
  try {
    const { data } = await db.from('glitches').select('id,unit,listing_id,category,overview,assignee,created_at,closed_at,closed_at_estimated')
      .gte('closed_at', lo).lt('closed_at', hi).limit(300)
    const rows = ((data as any[]) || []).filter(g => !g.closed_at_estimated && etDay(g.closed_at) === d)
      .map(g => ({ g, hours: (Date.parse(g.closed_at) - Date.parse(g.created_at)) / 3600_000 }))
      .filter(x => Number.isFinite(x.hours) && x.hours > 0 && x.hours <= FAST_GLITCH_HOURS)
      .sort((a, b) => a.hours - b.hours)
    await nameOf(rows.map(x => String(x.g.listing_id || '')))
    for (const { g, hours } of rows.slice(0, 3)) {
      const unit = String(g.unit || names[String(g.listing_id)] || 'a unit')
      const trade = tradeOf(g.category, g.overview)
      const who = firstName(g.assignee)
      out.facts.fastGlitches.push({ unit, trade, hours: Math.round(hours * 10) / 10, assignee: who })
      out.lines.push(`${trade} at ${unit} closed in ${fmtHours(hours)}${who ? ` — ${who}` : ''}.`)
    }
    if (rows.length > 3) out.lines.push(`…and ${rows.length - 3} more glitches closed inside a day.`)
  } catch { /* nothing */ }

  // ── Five-star reviews, and the ones that name what the team did. ──────────────────────────
  try {
    const { data } = await db.from('guesty_reviews').select('id,listing_id,rating,content,channel,created_at')
      .gte('created_at', lo).lt('created_at', hi).eq('excluded_from_score', false).limit(300)
    const five = ((data as any[]) || []).filter(r => etDay(r.created_at) === d && norm(r.rating) >= 4.8)
    out.facts.fiveStars = five.length
    const praised = five.filter(r => PRAISE.test(String(r.content || '')))
    await nameOf(praised.map(r => String(r.listing_id || '')))
    for (const r of praised.slice(0, 2)) {
      const text = String(r.content || '').replace(/\s+/g, ' ').trim()
      const m = text.match(PRAISE)
      // The sentence that carries the praise, not the whole review.
      const at = m?.index ?? 0
      const start = Math.max(0, text.lastIndexOf('.', at) + 1)
      const end = text.indexOf('.', at)
      let sent = text.slice(start, end > 0 ? end + 1 : undefined).trim()
      if (sent.length > 120) sent = sent.slice(0, 117).replace(/\s\S*$/, '') + '…'
      out.facts.quotes.push({ unit: names[String(r.listing_id)] || 'a unit', channel: r.channel || null, text: sent })
    }
    if (five.length) out.lines.push(`${five.length} five-star review${five.length === 1 ? '' : 's'}.`)
    for (const q of out.facts.quotes) out.lines.push(`${q.unit}: “${q.text}”`)
  } catch { /* nothing */ }

  return out
}
