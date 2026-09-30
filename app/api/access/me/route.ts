// Lightweight "who am I" for the client nav: returns the caller's role, workspace + access flags.
import { NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
export const dynamic = 'force-dynamic'
export async function GET() {
  const a = await getAccess()
  // The sidebar layout override (nav_layout) retired with the desks (2026-09-29): the desks in
  // lib/desks.ts are the one map of the app, so there is nothing per-install to send here.
  return NextResponse.json({
    email: a.email, role: a.role, allowed: a.allowed,
    isAdmin: a.role === 'admin', isOwner: isSuperadmin(a.email),
    features: a.features, workspace: a.workspace, profile: a.profile, prefs: a.prefs,
    // Roles + levels (migration 023): resolved off/view/edit/full per tab, this user's role key
    // and landing page. The nav hides 'off'; pages use levels to render read-only on 'view'.
    accessRole: a.accessRole, levels: a.levels, landing: a.landing,
    // Business units (migration 118): which businesses this login may enter, and the hotel role.
    businesses: a.businesses, garden: a.garden,
  })
}
