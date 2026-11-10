// The need list calculator's address (/kit/list?bd=2&ba=2&g=6&k=1&no=oven,dishwasher&opt=1): the home's
// details as short query parameters, so a filled-in list is a link. Isomorphic.
import { APPLIANCES, DEFAULT_SIZE, normSize, type KitAppliance, type KitSize } from './starter-kit'

export type NeedParams = { bd?: string; ba?: string; g?: string; k?: string; no?: string; opt?: string; u?: string; t?: string }

export function sizeFromParams(p: NeedParams): KitSize {
  const no = new Set(String(p.no || '').split(',').map(s => s.trim()))
  const appliances = {} as Record<KitAppliance, boolean>
  for (const a of APPLIANCES) appliances[a.k] = !no.has(a.k)
  return normSize({ bedrooms: p.bd ?? DEFAULT_SIZE.bedrooms, bathrooms: p.ba ?? DEFAULT_SIZE.bathrooms, guests: p.g ?? DEFAULT_SIZE.guests, kitchen: p.k === '0' ? false : true, appliances })
}

export function paramsFromSize(z: KitSize, showOptional: boolean): string {
  const q = new URLSearchParams({ bd: String(z.bedrooms), ba: String(z.bathrooms), g: String(z.guests), k: z.kitchen ? '1' : '0' })
  const no = APPLIANCES.filter(a => !z.appliances[a.k]).map(a => a.k)
  if (z.kitchen && no.length) q.set('no', no.join(','))
  if (showOptional) q.set('opt', '1')
  return q.toString()
}

// ── several units (Jon, 2026-11-10: "if onboarding multiple units, create a full order — add unit") ──
// ?u=Unit 302~2~2~6~1~|Unit 602~1~1~4~1~dishwasher  — name~bedrooms~bathrooms~guests~kitchen~missing
// appliances, one unit per `|`. A single unit keeps the short form above. `t` is the shopping grade.
export type NeedUnit = { name: string; size: KitSize }
const clean = (s: string) => s.replace(/[~|]/g, ' ').trim().slice(0, 40)
export function unitsFromParam(u: string | undefined): NeedUnit[] | null {
  if (!u) return null
  const out: NeedUnit[] = []
  for (const part of u.split('|').slice(0, 40)) {
    const [name, bd, ba, g, k, no] = part.split('~')
    out.push({ name: clean(name || '') || `Unit ${out.length + 1}`, size: sizeFromParams({ bd, ba, g, k, no }) })
  }
  return out.length ? out : null
}
export function unitsToParam(units: NeedUnit[]): string {
  return units.map(x => {
    const no = APPLIANCES.filter(a => !x.size.appliances[a.k]).map(a => a.k).join(',')
    return [clean(x.name), x.size.bedrooms, x.size.bathrooms, x.size.guests, x.size.kitchen ? 1 : 0, x.size.kitchen ? no : ''].join('~')
  }).join('|')
}
/** The whole address: one unit in the short form, several in `u`; grade and optional extras either way. */
export function needQuery(units: NeedUnit[], showOptional: boolean, grade: string): string {
  const q = units.length === 1 && units[0].name === 'This home' ? new URLSearchParams(paramsFromSize(units[0].size, showOptional)) : new URLSearchParams({ u: unitsToParam(units) })
  if (units.length !== 1 || units[0].name !== 'This home') { if (showOptional) q.set('opt', '1') }
  if (grade && grade !== 'mid') q.set('t', grade)
  return q.toString()
}
