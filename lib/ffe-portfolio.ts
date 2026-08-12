// THE ONE UNIT LIST FF&E IS BUILT ON.
//
// The walk form, the hub pages, the order builder and the owner quote all need the same answer to
// "what units exist, in which building, under which owner". It used to live inside the audit route;
// it moved here the moment ordering needed it too, because two copies of this list is two answers
// to "how many units does this owner have" — and the second one is always the wrong one.
import 'server-only'
import { buildingOf } from '@/lib/segments'
import { ownerMap } from '@/lib/billing'

export type FfeUnit = {
  id: string
  name: string
  building: string
  bedrooms: number | null
  ownerId: string
  ownerName: string
}

const str = (v: any) => (v == null ? '' : String(v))
const DEAD = ['inactive', 'disabled', 'archived', 'deleted']

const bedroomsOf = (l: any): number | null => {
  const b = l ? l.bedrooms : null
  if (typeof b === 'number') return b
  const n = parseFloat(str(b))
  return Number.isFinite(n) ? n : null
}

/** Every active unit with its building and owner, sorted the way a person reads a list of units. */
export async function ffePortfolio(db: any): Promise<FfeUnit[]> {
  const [{ data: ls }, owners] = await Promise.all([
    db.from('guesty_listings').select('id,nickname,title,building,status,bedrooms:raw->>bedrooms').limit(2000),
    ownerMap().catch(() => ({ byListing: {} as any })),
  ])
  return ((ls || []) as any[])
    .filter(l => !DEAD.includes(str(l.status).toLowerCase()))
    .map(l => {
      const name = l.nickname || l.title || String(l.id)
      const own = (owners as any).byListing[String(l.id)]
      return {
        id: String(l.id),
        name,
        building: buildingOf(str(l.building), name) || 'Other',
        bedrooms: bedroomsOf(l),
        ownerId: own ? String(own.ownerId) : 'unassigned',
        ownerName: own ? String(own.ownerName) : 'Unassigned owner',
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
}
