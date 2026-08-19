// FF&E SHARE LINKS — derived, never minted (Jon, 2026-08-11).
//
//   "It should not create a link, it should be created automatically. It should also be a shareable
//    page, meaning I can share property level / unit level in a shareable link, where they can go
//    in and out of links, mark them complete... and should be organized by owner."
//
// WHY THE CODE IS A HASH AND NOT A DATABASE ROW.
// The first version minted a row per unit behind a "Create link" button, which meant a link did not
// exist until somebody made it — exactly the friction Jon is describing. A code derived from the
// listing id exists the moment the unit does: nothing to create, nothing to press, and the same
// unit always produces the same link, so one sent last month still opens today. It also means the
// hub and the unit forms work before a single answer has been saved.
//
// WHAT THIS IS AND IS NOT. These codes are unguessable-in-practice (HMAC over a server-side secret,
// truncated to 16 hex chars = 64 bits) but they are CAPABILITY LINKS, not authentication: whoever
// holds one can see and fill that unit's FF&E list. That is the same trade the audit, walk and
// vendor links already make here, and the blast radius is one unit's furniture checklist — no
// guest data, no money, no ability to reach any other unit. The secret must stay server-side; if
// it ever leaks, rotating FFE_LINK_SECRET invalidates every outstanding link at once.
import 'server-only'
import { createHmac } from 'crypto'

// SECRET RESOLUTION (Jon, 2026-08-18: "can we fix it"). The old fallback was a constant in this
// file, which meant anyone who could read the repo could derive every share link. Now:
//   1. FFE_LINK_SECRET if set — the explicit knob, rotate it to kill every outstanding link.
//   2. Else a secret DERIVED from the service-role key (already server-side, never shipped to the
//      client, unknown to anyone without production env access). Deriving rather than using it raw
//      means the service key itself never doubles as an HMAC key anywhere.
//   3. The old constant only remains as a last resort for local dev with no env at all.
// Switching secrets rotates every outstanding link once — fresh ones come straight from the app.
const SECRET = process.env.FFE_LINK_SECRET
  || (process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY).update('stayboard-ffe-links').digest('hex')
    : 'stayboard-ffe-v1-2026')

export type FfeScopeKind = 'unit' | 'building' | 'owner' | 'order'

function sign(kind: FfeScopeKind, id: string): string {
  return createHmac('sha256', SECRET).update(kind + ':' + String(id || '')).digest('hex').slice(0, 16)
}

export const unitCode = (listingId: string) => sign('unit', listingId)
export const buildingCode = (building: string) => sign('building', building.toLowerCase())
export const ownerCode = (ownerId: string) => sign('owner', ownerId)
// The link an owner gets sent to read and approve a furniture order. Same capability trade as the
// rest of this file, one order wide: no other order, no other owner, no money movement.
export const orderCode = (orderId: string) => sign('order', orderId)

/**
 * Resolve a code back to what it points at.
 *
 * There is no lookup table — the code IS the signature, so resolving means re-signing every
 * candidate and comparing. With ~230 listings, ~25 buildings and ~60 owners that is a few hundred
 * HMACs, which is microseconds and needs no storage. Candidates are passed in by the caller so
 * this file never touches the database.
 */
export function resolveCode(
  code: string,
  candidates: { units: string[]; buildings: string[]; owners: string[]; orders?: string[] },
): { kind: FfeScopeKind; id: string } | null {
  const c = String(code || '').trim().toLowerCase()
  if (!/^[a-f0-9]{16}$/.test(c)) return null
  for (const id of candidates.units) if (unitCode(id) === c) return { kind: 'unit', id }
  for (const b of candidates.buildings) if (buildingCode(b) === c) return { kind: 'building', id: b }
  for (const o of candidates.owners) if (ownerCode(o) === c) return { kind: 'owner', id: o }
  for (const o of candidates.orders || []) if (orderCode(o) === c) return { kind: 'order', id: o }
  return null
}
