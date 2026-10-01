// THE CCS OPEN-LOOP DESK.
//
// Jon, 2026-09-28: "improve Eve to support our CCS team, ops team, manage tasks and ops." The first
// piece is the one that costs money when it slips: a GUEST ASK. A potential guest wants a discount
// and will book right now; a guest in house wants two more nights; somebody asked for a call back;
// a refund is on the table. Each one is revenue or a review, each one has a short shelf life, and
// each one arrives in #vr-customercareteam as a line of chat that scrolls away. The 2026-09-26 Salato scan
// found exactly that: an extension request ("she'd like to add more days") with "on it" and no
// closed loop, and a $2,131 booking that only happened because someone happened to hold the price.
//
// So a guest ask is a KIND OF OPEN ITEM on the Slack watch (lib/eve/slack-watch.ts), with three
// things the other kinds do not have:
//
//   A CLOCK IN MINUTES, NOT DAYS. A commitment gets 24 hours before Eve asks about it. A guest ask
//   gets sixty minutes, then four hours, because the guest is deciding now.
//
//   AN ESCALATION RULE. Jon, 2026-09-23: "All Salato reservations need to be escalated to me, Karla,
//   Roberto and Bernadette — the building is pissed." A guest ask on an escalation building, or on
//   a big booking, is posted to the four of them the moment it is seen, in the thread it came from.
//
//   A CLOSE THAT COMES FROM GUESTY. "Done" in the thread closes it, and so does the booking itself:
//   a reservation created after the ask, on the same unit or under the same guest name, closes it as
//   "booked". A Breezeway task finishing on the unit does NOT close a guest ask — that is a clean,
//   not an answer — so the cross-system check the other kinds use is skipped for this one.
//
// And a SHIFT HANDOFF: three times a day the open asks are posted to the CCS room as a list — guest,
// unit, what they want, who has it, how long it has waited — so the next shift starts from the
// list, not from the scrollback.
//
// PROPOSE, NOT ACT (Jon, 2026-09-28: "propose, you approve"). Every post here goes through the
// agent-mode gate for slack_post; below "act" it is a proposal in #vr-eve with the text attached,
// and a yes posts it. Nothing here writes to Guesty or messages a guest.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting, setSetting } from '@/lib/app-settings'
import { EVE_CHANNELS } from '@/lib/slack-rules'
import { postToChannel, postThreadReply } from '@/lib/slack'
import { nameMatches, nameTokens } from '@/lib/person-name'
import { agentAllowed, stepDown } from './agent-mode'

export const CCS_DESK_KEY = 'eve_ccs_desk'

export type CcsDeskCfg = {
  enabled: boolean
  /** Minutes before the first "still open?" on a guest ask, and before the second. */
  nudgeAfterMin: number
  secondNudgeMin: number
  /** Buildings whose every guest ask is escalated at once (name match on unit/building). */
  escalateBuildings: string[]
  /** Booking value at or above which an ask is escalated regardless of building. */
  escalateValue: number
  /** People tagged on an escalation, by display name (resolved against the Slack directory). */
  escalateNames: string[]
  /** ET hours at which the open-asks handoff is posted to the CCS room. */
  handoffHoursET: number[]
}
export const CCS_DESK_DEFAULTS: CcsDeskCfg = {
  enabled: true,
  nudgeAfterMin: 60,
  secondNudgeMin: 240,
  escalateBuildings: ['Salato'],
  escalateValue: 2000,
  escalateNames: ['Jon McGill', 'Karla Valle', 'Roberto Chiriboga', 'Bernadette'],
  handoffHoursET: [7, 15, 23],
}
export async function getCcsDesk(): Promise<CcsDeskCfg> {
  const s = await getSetting<any>(CCS_DESK_KEY, null)
  const d = CCS_DESK_DEFAULTS
  if (!s || typeof s !== 'object') return d
  const nums = (v: any) => (Array.isArray(v) ? v.map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 23) : d.handoffHoursET)
  const strs = (v: any, dd: string[]) => (Array.isArray(v) ? v.map(String).map(x => x.trim()).filter(Boolean) : dd)
  return {
    enabled: s.enabled !== false,
    nudgeAfterMin: Number.isFinite(Number(s.nudgeAfterMin)) && Number(s.nudgeAfterMin) >= 10 ? Number(s.nudgeAfterMin) : d.nudgeAfterMin,
    secondNudgeMin: Number.isFinite(Number(s.secondNudgeMin)) && Number(s.secondNudgeMin) >= 30 ? Number(s.secondNudgeMin) : d.secondNudgeMin,
    escalateBuildings: strs(s.escalateBuildings, d.escalateBuildings),
    escalateValue: Number.isFinite(Number(s.escalateValue)) && Number(s.escalateValue) >= 0 ? Number(s.escalateValue) : d.escalateValue,
    escalateNames: strs(s.escalateNames, d.escalateNames),
    handoffHoursET: nums(s.handoffHoursET),
  }
}
export async function saveCcsDesk(patch: any, by: string): Promise<CcsDeskCfg> {
  const cur = await getCcsDesk()
  const next = { ...cur, ...(patch && typeof patch === 'object' ? patch : {}) }
  await setSetting(CCS_DESK_KEY, next, by)
  return getCcsDesk()
}

// ── The free filter: does this line look like a guest asking for something? ─────────────────────
// Runs before any model call, so it errs wide; the model decides. English and Spanish, the way the
// CCS team and the field team actually write.
export const GUEST_ASK_SIG = /\b(potential guest|prospective guest|inquir(y|ies|ing)|wants? to (book|reserve|extend|add|stay|cancel|check|know)|would like to (book|reserve|extend|add|stay)|asking (if|for|about|whether)|is asking|asked (if|for|about|whether)|requesting|request(ed)? (a|an|to)|offer (him|her|them) a|discount|lower (the )?(rate|price)|best (rate|price)|price match|quote|extra night|more nights?|add (more )?(days|nights)|extend (the|their|her|his) (stay|reservation)|late check.?out|early check.?in|call (him|her|them) back|callback|call back|wants? a call|refund|compensat|book(ing)? right now|will (book|reserve) (now|today|right)|quiere (reservar|extender|agregar|saber|una llamada)|pregunta (si|por)|pide|solicita|descuento|noches? (extra|más|mas))\b/i

// What the ask is, in one word — the model returns it; this is the fallback from the text.
export type AskKind = 'inquiry' | 'discount' | 'extension' | 'callback' | 'refund' | 'change' | 'other'
export function askKindOf(text: string): AskKind {
  const t = String(text || '')
  if (/refund|compensat|reembolso|devoluci/i.test(t)) return 'refund'
  if (/discount|lower (the )?(rate|price)|best (rate|price)|price match|descuento|\$\s?\d/i.test(t)) return 'discount'
  if (/extend|extra night|more nights?|add (more )?(days|nights)|noches? (extra|más|mas)|agregar/i.test(t)) return 'extension'
  if (/call (him|her|them) back|callback|call back|wants? a call|llamada/i.test(t)) return 'callback'
  if (/late check.?out|early check.?in|change (the )?(date|dates|unit)|move (the )?(reservation|dates)|cambiar/i.test(t)) return 'change'
  if (/potential|prospective|inquir|wants? to (book|reserve)|would like to (book|reserve)|quiere reservar|availability|available/i.test(t)) return 'inquiry'
  return 'other'
}

const ASK_LABEL: Record<AskKind, string> = {
  inquiry: 'wants to book', discount: 'asking for a discount', extension: 'wants to extend', callback: 'wants a call back',
  refund: 'asking for a refund', change: 'wants a change', other: 'guest ask',
}

// ── Escalation ──────────────────────────────────────────────────────────────────────────────────

export type AskItem = {
  id: string; channel: string; channel_name: string | null; msg_ts: string; thread_ts: string | null
  summary: string; owner_name: string | null; owner_slack: string | null
  unit: string | null; building: string | null; listing_id: string | null
  first_seen: string; nudge_count: number; nudged_at: string | null; evidence: any
}

export function shouldEscalate(it: Pick<AskItem, 'unit' | 'building' | 'evidence'>, cfg: CcsDeskCfg): string | null {
  const hay = `${it.unit || ''} ${it.building || ''} ${String(it.evidence?.text || '')}`
  for (const b of cfg.escalateBuildings) if (b && new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay)) return b
  const amt = Number(it.evidence?.amount)
  if (cfg.escalateValue > 0 && Number.isFinite(amt) && amt >= cfg.escalateValue) return `$${Math.round(amt).toLocaleString()} booking`
  return null
}

/** Resolve the escalation names to Slack ids through the directory the watch already loaded. */
export function escalationTags(cfg: CcsDeskCfg, directory: Record<string, string>): string[] {
  const out: string[] = []
  for (const nm of cfg.escalateNames) {
    const hit = Object.entries(directory).find(([, v]) => v && nameMatches(v, nm))
    if (hit) out.push(`<@${hit[0]}>`)
  }
  return out
}

export function escalationText(it: AskItem, why: string, tags: string[]): string {
  const kind = ASK_LABEL[(it.evidence?.ask as AskKind) || askKindOf(it.evidence?.text || it.summary)]
  const guest = it.evidence?.guest ? `${it.evidence.guest} ` : ''
  const unit = it.unit ? ` · ${it.unit}` : ''
  return `${tags.join(' ')} 🔔 *${why}* — ${guest}${kind}${unit}. ${it.summary.slice(0, 160)}${it.owner_name ? ` · with ${it.owner_name}` : ' · nobody has it yet'}. Reply here with what was offered or "done" when it is settled.`
}

// ── The nudge, with a one-hour clock ────────────────────────────────────────────────────────────

export function askNudgeText(it: AskItem, who: string | null, minutes: number): string {
  const lead = who ? who + ' — ' : ''
  const kind = ASK_LABEL[(it.evidence?.ask as AskKind) || askKindOf(it.evidence?.text || it.summary)]
  const guest = it.evidence?.guest ? `${it.evidence.guest} ` : 'this guest '
  const age = minutes >= 120 ? `${Math.round(minutes / 60)} hours` : `${Math.round(minutes)} minutes`
  return `${lead}${guest}${kind}${it.unit ? ` (${it.unit})` : ''} — ${age} and no reply in this thread. Did we answer them? Reply "done" and I'll close it, or tell me what's holding it and I'll help.`
}

/** Age of the item in minutes. */
export function ageMinutes(it: Pick<AskItem, 'first_seen'>, now = Date.now()): number {
  return Math.max(0, (now - Date.parse(it.first_seen)) / 60_000)
}

// ── The close that comes from Guesty ────────────────────────────────────────────────────────────

/**
 * Did the booking happen? A reservation created after the ask, on the resolved listing or under the
 * guest's name, closes an inquiry / discount / extension as "booked". Only for the kinds a booking
 * answers — a refund ask is not closed by a booking.
 */
export async function bookedSince(it: AskItem): Promise<string | null> {
  const ask = (it.evidence?.ask as AskKind) || askKindOf(it.evidence?.text || it.summary)
  if (!['inquiry', 'discount', 'extension', 'change'].includes(ask)) return null
  const db = supabaseAdmin()
  const since = new Date(Date.parse(it.first_seen) - 10 * 60_000).toISOString()
  const guest = String(it.evidence?.guest || '').trim()
  // THE RIGHT BOOKING (2026-09-28 audit, F28). With no unit, a first name alone matched any new
  // reservation in the portfolio ("Maria" booked somewhere → "booked"). Now: on the loop's own unit,
  // the guest's name (a first name will do there) or, with no name, the unit's booking; with no unit,
  // only the guest's FULL name closes it.
  const fullName = nameTokens(guest).length >= 2
  const fullMatch = (n: string) => fullName && nameTokens(n).length >= 2 && nameMatches(n, guest)
  try {
    let q = db.from('guesty_reservations').select('id,confirmation_code,guest_name,listing_name,check_in,check_out,status,created_at')
      .gte('created_at', since).in('status', ['confirmed', 'checked_in', 'reserved']).order('created_at', { ascending: false }).limit(20)
    if (it.listing_id) q = q.eq('listing_id', it.listing_id)
    else if (fullName) q = q.ilike('guest_name', `%${guest.split(/\s+/)[0].replace(/[%,()]/g, '')}%`)
    else return null
    const { data } = await q
    const rows = (data || []) as any[]
    const hit = !guest ? rows[0]
      : it.listing_id ? rows.find(r => fullMatch(String(r.guest_name || '')) || nameMatches(String(r.guest_name || ''), guest))
      : rows.find(r => fullMatch(String(r.guest_name || '')))
    if (!hit) return null
    return `booked — ${String(hit.guest_name || 'guest')} ${String(hit.check_in).slice(0, 10)}→${String(hit.check_out).slice(0, 10)}${hit.confirmation_code ? ' (' + hit.confirmation_code + ')' : ''}`
  } catch { return null }
}

// ── The handoff ─────────────────────────────────────────────────────────────────────────────────

const HANDOFF_STATE_KEY = 'eve_ccs_desk_state'

function etHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now)) % 24
}
function etDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now)
}

export function handoffText(open: AskItem[], now = Date.now()): string {
  const line = (it: AskItem) => {
    const kind = ASK_LABEL[(it.evidence?.ask as AskKind) || askKindOf(it.evidence?.text || it.summary)]
    const m = ageMinutes(it, now)
    const age = m >= 120 ? `${Math.round(m / 60)}h` : `${Math.round(m)}m`
    return `• ${it.evidence?.guest ? it.evidence.guest + ' · ' : ''}${kind}${it.unit ? ` · ${it.unit}` : ''} — ${it.summary.slice(0, 110)} · ${it.owner_name || '_nobody_'} · ${age}`
  }
  if (!open.length) return `*CCS handoff* — no open guest asks. Clean slate.`
  const sorted = [...open].sort((a, b) => Date.parse(a.first_seen) - Date.parse(b.first_seen))
  return `*CCS handoff — ${open.length} open guest ask${open.length === 1 ? '' : 's'}* (oldest first)\n${sorted.slice(0, 15).map(line).join('\n')}${open.length > 15 ? `\n…and ${open.length - 15} more` : ''}\nReply "done" in each thread when it is settled and I take it off the list.`
}

/**
 * Post the handoff once per configured hour. Returns what it did, for the run receipt.
 */
export async function runHandoff(open: AskItem[], cfg: CcsDeskCfg, now = new Date()): Promise<{ posted: boolean; mode?: string; note?: string }> {
  const h = etHour(now), d = etDate(now)
  if (!cfg.handoffHoursET.includes(h)) return { posted: false }
  const slot = `${d}T${String(h).padStart(2, '0')}`
  const st = (await getSetting<any>(HANDOFF_STATE_KEY, null)) || {}
  if (st.lastHandoff === slot) return { posted: false }
  const text = handoffText(open, now.getTime())
  // AT THE HOUR IT WAS SET FOR (2026-09-28 audit, F27). The 23:00 slot falls in quiet hours, so it
  // was held and posted at 7am next to the fresh 7am handoff — stale on arrival. A handoff runs at
  // the hours in this desk's settings, which are a person's schedule, not Eve's initiative: urgent.
  const gate = await agentAllowed('slack_post', { ask: true, urgent: true })
  const r = await stepDown(gate, { action: 'slack_post', summary: `CCS handoff in #vr-customercareteam (${open.length} open asks)`, exec: { channel: EVE_CHANNELS.ccsJon, channel_name: 'vr-customercareteam', text }, by: 'cron:slack-watch' },
    async () => { const p = await postToChannel(EVE_CHANNELS.ccsJon, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
  if (r.ok && r.mode !== 'observe') await setSetting(HANDOFF_STATE_KEY, { ...st, lastHandoff: slot }, 'ccs-desk')
  return { posted: r.mode === 'act', mode: r.mode, note: r.mode !== 'act' ? gate.reason : undefined }
}

/** Escalate one ask in its own thread, gated. */
export async function escalate(it: AskItem, why: string, tags: string[]): Promise<{ ok: boolean; mode: string }> {
  const text = escalationText(it, why, tags)
  const gate = await agentAllowed('slack_post', { urgent: true, ask: true })
  const r = await stepDown(gate, { action: 'slack_post', summary: `escalate guest ask (${why}) in #${it.channel_name}: ${it.summary.slice(0, 120)}`, exec: { channel: it.channel, channel_name: it.channel_name, thread_ts: it.thread_ts || it.msg_ts, text }, why: it.summary.slice(0, 200), by: 'cron:slack-watch' },
    async () => { const p = await postThreadReply(it.channel, it.thread_ts || it.msg_ts, text); return { ok: p.ok, ref: p.ts || null, error: p.error } })
  return { ok: r.ok, mode: r.mode }
}
