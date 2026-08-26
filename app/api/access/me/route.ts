// Lightweight "who am I" for the client nav: returns the caller's role, workspace + access flags.
import { NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting } from '@/lib/app-settings'
import { NAV_LAYOUT_KEY, normNavLayout } from '@/lib/nav-layout'
export const dynamic = 'force-dynamic'
export async function GET() {
  const a = await getAccess()
  // The saved sidebar layout rides along here rather than getting its own fetch: Shell already
  // waits on this call before it can decide what the user may see, so the nav paints once with
  // the right names in the right order instead of rearranging itself a beat later.
  const nav = await getSetting<any>(NAV_LAYOUT_KEY, null).then(normNavLayout).catch(() => ({}))
  return NextResponse.json({
    nav,
    email: a.email, role: a.role, allowed: a.allowed,
    isAdmin: a.role === 'admin', isOwner: isSuperadmin(a.email),
    features: a.features, workspace: a.workspace, profile: a.profile, prefs: a.prefs,
    // Roles + levels (migration 023): resolved off/view/edit/full per tab, this user's role key
    // and landing page. The nav hides 'off'; pages use levels to render read-only on 'view'.
    accessRole: a.accessRole, levels: a.levels, landing: a.landing,
  })
}
