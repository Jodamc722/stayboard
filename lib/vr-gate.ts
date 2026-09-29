// VACATION-RENTAL API GATES (2026-09-29). Since migration 118 one login can hold two businesses.
// getAccess() gives a hotel-only login (access.businesses = ['garden']) `allowed: true` with every
// VR feature level 'off', so routes gated by requireLevel / requireAnyLevel already refuse it. A
// route gated only by requireUser() (signed in + active member) or requireAdmin() (VR role 'admin',
// which a hotel-only row can still carry) let it through — and middleware keeps a hotel-only login
// off the VR PAGES only; /api is outside middleware. These are the same two gates plus one more
// question: is this a vacation-rental login?
//
// requireUser itself must not change: the hotel's own gate (requireGarden, lib/garden/access.ts) is
// built on it, and the endpoints the hotel side shares with the VR side (/api/access/*,
// /api/notifications, /api/activity, /api/files/*, /api/garden/*, /api/reports*, the owner-report
// editor's routes) keep requireUser on purpose.
import 'server-only'
import { NextResponse } from 'next/server'
import { requireUser, requireAdmin, isSuperadmin, type Access, type Gate } from './access'

/**
 * True for every login except one that holds ONLY the hotel. The owner is VR whatever his row says.
 * An EMPTY list is only trusted from the two shapes that legitimately have one — the first-login
 * bootstrap and the owner's fail-closed path (both `bootstrap: true`). A real row resolves to an
 * empty list when it has no 'vr' and its hotel role did not resolve (garden_role unset or unknown,
 * or a cached roles read error), which is a hotel-only login and is refused like one (2026-09-29
 * review). Rows from before business units have no `businesses` value and resolve to ['vr'].
 */
export function isVrLogin(access: Pick<Access, 'businesses' | 'email' | 'bootstrap'>): boolean {
  if (isSuperadmin(access.email)) return true
  const units = access.businesses
  if (!Array.isArray(units)) return true
  if (units.length === 0) return !!access.bootstrap
  return units.includes('vr')
}

export const HOTEL_ONLY_MESSAGE = 'This is part of the vacation-rental side. Your login is for the Garden Hotel only.'

/** The refusal a VR-only route gives a hotel-only login (for routes with a gate of their own). */
export function hotelOnlyRes(): NextResponse {
  return NextResponse.json({ error: 'no-access', message: HOTEL_ONLY_MESSAGE }, { status: 403 })
}

/** requireUser(), and a vacation-rental login. Use on VR-only routes; never on a shared one. */
export async function requireVrUser(): Promise<Gate> {
  const g = await requireUser()
  if (!g.ok) return g
  if (!isVrLogin(g.access)) return { ok: false, res: hotelOnlyRes(), access: g.access }
  return g
}

/** requireAdmin(need), and a vacation-rental login. */
export async function requireVrAdmin(need: 'admin' | 'owner' = 'admin'): Promise<Gate> {
  const g = await requireAdmin(need)
  if (!g.ok) return g
  if (!isVrLogin(g.access)) return { ok: false, res: hotelOnlyRes(), access: g.access }
  return g
}
