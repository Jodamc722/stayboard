// The need list calculator's address (/kit/list?bd=2&ba=2&g=6&k=1&no=oven,dishwasher&opt=1): the home's
// details as short query parameters, so a filled-in list is a link. Isomorphic.
import { APPLIANCES, DEFAULT_SIZE, normSize, type KitAppliance, type KitSize } from './starter-kit'

export type NeedParams = { bd?: string; ba?: string; g?: string; k?: string; no?: string; opt?: string }

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
