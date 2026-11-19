// GUESTS TO KNOW (Jon, 2026-11-19: "the brief should show any VIPs, VIP arrivals upcoming, big
// bookings, owner stays"). One builder for the Field Runs and the Ops morning, so a VIP reads the
// same wherever the team sees it: who lands today, which owners are in-house, who is coming this week.
import { esc, pill, unitShort, type Line } from './ui'

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const first = (n: string) => str(n).trim().split(/\s+/)[0] || ''
const money0 = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
type Flag = { long?: boolean; big?: boolean; owner?: boolean; total?: number; nights?: number | null }
type Pick = (en: string, es: string) => string

export function guestTags(f: Flag, pick: Pick = en => en): string {
  const bits: string[] = []
  if (f.owner) bits.push(pill(pick('OWNER', 'PROPIETARIO'), 'blue'))
  if (f.big) bits.push(pill(`${pick('BIG BOOKING', 'RESERVA GRANDE')} · ${money0(Number(f.total) || 0)}`, 'amber'))
  if (f.long) bits.push(pill(`${pick('LONG STAY', 'ESTANCIA LARGA')} · ${f.nights}n`, 'amber'))
  return bits.join(' ')
}

export function guestsToKnow(i: {
  arrivals: any[]; flags: Record<string, Flag>; ownerStays: any[]; forward: any[]; today: string
  pick?: Pick; niceDay: (ymd: string) => string; subFor?: (lid: string, unit: string) => string
}): { todayLines: Line[]; aheadLines: Line[] } {
  const pick: Pick = i.pick || (en => en)
  const todayLines: Line[] = []
  const seen = new Set<string>()
  for (const a of i.arrivals) {
    const lid = str(a.listingId)
    const f: Flag = { ...(i.flags[lid] || {}) }
    if (str(a.ownerFlag) === 'owner booking') f.owner = true
    if (!f.owner && !f.big && !f.long) continue
    seen.add(lid)
    todayLines.push({ tone: 'amber', html: `${guestTags(f, pick)} <b>${esc(unitShort(str(a.unit)))}</b> · ${esc(first(a.guest))} ${pick('lands', 'llega')} ${esc(str(a.checkInTime || '4:00 PM'))}`, sub: i.subFor ? i.subFor(lid, str(a.unit)) : undefined })
  }
  for (const o of i.ownerStays) {
    if (seen.has(str(o.listingId))) continue
    todayLines.push({ tone: 'none', html: `${pill(pick('OWNER IN-HOUSE', 'PROPIETARIO EN CASA'), 'blue')} <b>${esc(unitShort(str(o.unit)))}</b> · ${esc(str(o.owner || o.guest))} · ${pick('until', 'hasta')} ${esc(i.niceDay(str(o.checkOut).slice(0, 10)))}` })
  }
  const aheadLines: Line[] = i.forward.map((x: any) => ({ tone: 'none' as const,
    html: `<span style="float:right;margin-left:12px;white-space:nowrap">${esc(i.niceDay(str(x.when)))}</span>${guestTags(x, pick)} <b>${esc(unitShort(str(x.unit)))}</b> · ${esc(str(x.guest))}${x.nights && !x.long ? ` · ${x.nights}n` : ''}` }))
  return { todayLines, aheadLines }
}
