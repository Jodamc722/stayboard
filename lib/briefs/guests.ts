// GUESTS TO KNOW (Jon, 2026-11-19: "the brief should show any VIPs, VIP arrivals upcoming, big
// bookings, owner stays"). One builder for the Field Runs and the Ops morning, so a VIP reads the
// same wherever the team sees it: who lands today, which owners are in-house, who is coming this week.
import { esc, pill, unitShort, type Line } from './ui'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const first = (n: string) => str(n).trim().split(/\s+/)[0] || ''
const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
// SIGNAL (Jon, 2026-11-20: "the most important things that need to be completed vs busy work"; "delineate a low-income property versus a high-income property, priority bookings versus non-priority").
// A guest to know is now a PRIORITY BOOKING by the one rule (lib/signal.ts): owner stay, Sensitive or
// VIP, big, long, or a repeat guest. The same two sections; "priority at risk" arrivals (a same-day
// turn, an open glitch on the unit, a recent low review) lead each list, with ONE extra tag that
// says why. The owner / big / long pills are unchanged.
export type GuestFlag = {
  long?: boolean; big?: boolean; owner?: boolean; total?: number; nights?: number | null
  /** Priority booking by the one rule; `also` = the reasons the three pills do not say (repeat guest, sensitive guest, VIP). */
  priority?: boolean; also?: string
  /** Priority AND a risk on arrival; `risk` = "same-day turn, open glitch". */
  atRisk?: boolean; risk?: string
}
type Flag = GuestFlag
type Pick = (en: string, es: string) => string
const ES: Record<string, string> = {
  'same-day turn': 'mismo día', 'open glitch': 'incidencia abierta', 'recent low review': 'reseña baja reciente',
  'repeat guest': 'huésped recurrente', 'sensitive guest': 'huésped sensible', 'VIP': 'VIP',
}
const words = (list: string, pick: Pick) => str(list).split(/,\s*/).filter(Boolean).map(w => pick(w, ES[w] || w)).join(', ')
/** Is this a guest to know? The old three flags, or the priority rule when the brief carries it. */
export const isGuestToKnow = (f?: Flag | null) => !!(f && (f.owner || f.big || f.long || f.priority))

export function guestTags(f: Flag, pick: Pick = en => en): string {
  const bits: string[] = []
  if (f.owner) bits.push(pill(pick('OWNER', 'PROPIETARIO'), 'blue'))
  if (f.big) bits.push(pill(`${pick('BIG BOOKING', 'RESERVA GRANDE')} · ${money0(Number(f.total) || 0)}`, 'amber'))
  if (f.long) bits.push(pill(`${pick('LONG STAY', 'ESTANCIA LARGA')} · ${f.nights}n`, 'amber'))
  // The one extra tag: what puts it at risk, else the priority reason no pill above already gave.
  if (f.atRisk && f.risk) bits.push(pill(`${pick('AT RISK', 'EN RIESGO')} · ${words(f.risk, pick)}`, 'red'))
  else if (f.priority && f.also) bits.push(pill(`${pick('PRIORITY', 'PRIORIDAD')} · ${words(f.also, pick)}`, 'amber'))
  return bits.join(' ')
}

export function guestsToKnow(i: {
  arrivals: any[]; flags: Record<string, Flag>; ownerStays: any[]; forward: any[]; today: string
  pick?: Pick; niceDay: (ymd: string) => string; subFor?: (lid: string, unit: string) => string
}): { todayLines: Line[]; aheadLines: Line[] } {
  const pick: Pick = i.pick || (en => en)
  const todayLines: Line[] = []
  const seen = new Set<string>()
  const risky: Line[] = [], rest: Line[] = []
  for (const a of i.arrivals) {
    const lid = str(a.listingId)
    const f: Flag = { ...(i.flags[lid] || {}) }
    if (str(a.ownerFlag) === 'owner booking') f.owner = true
    if (!isGuestToKnow(f)) continue
    seen.add(lid)
    // Priority at risk leads the list, in red; the rest keep their order.
    ;(f.atRisk ? risky : rest).push({ tone: f.atRisk ? 'red' : 'amber', html: `${guestTags(f, pick)} <b>${esc(unitShort(str(a.unit)))}</b> · ${esc(first(a.guest))} ${pick('lands', 'llega')} ${esc(str(a.checkInTime || '4:00 PM'))}`, sub: i.subFor ? i.subFor(lid, str(a.unit)) : undefined })
  }
  todayLines.push(...risky, ...rest)
  for (const o of i.ownerStays) {
    if (seen.has(str(o.listingId))) continue
    todayLines.push({ tone: 'none', html: `${pill(pick('OWNER IN-HOUSE', 'PROPIETARIO EN CASA'), 'blue')} <b>${esc(unitShort(str(o.unit)))}</b> · ${esc(str(o.owner || o.guest))} · ${pick('until', 'hasta')} ${esc(i.niceDay(str(o.checkOut).slice(0, 10)))}` })
  }
  const aheadLines: Line[] = i.forward.map((x: any) => ({ tone: 'none' as const,
    html: `<span style="float:right;margin-left:12px;white-space:nowrap">${esc(i.niceDay(str(x.when)))}</span>${guestTags(x, pick)} <b>${esc(unitShort(str(x.unit)))}</b> · ${esc(str(x.guest))}${x.nights && !x.long ? ` · ${x.nights}n` : ''}` }))
  return { todayLines, aheadLines }
}
