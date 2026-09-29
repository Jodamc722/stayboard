// THE HOTEL'S ACCESS GATE (migration 118). Every hotel page and route asks this, not the VR role:
// what a person may do at the Garden Hotel is their garden_role's level on that page, full stop.
//
//   requireGarden('rooms', 'edit')   → API gate (401/403 JSON)
//   gardenPage('rooms')              → page gate: redirects, or returns { access, level, canEdit, canFull }
import 'server-only'
import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { requireUser, getAccess, isSuperadmin, type Gate, type Access } from '../access'
import { gAtLeast, GARDEN_PAGE_LABEL, type GardenPageKey, type GLevel } from './pages'

export async function requireGarden(page: GardenPageKey, need: Exclude<GLevel, 'off'>): Promise<Gate> {
  const g = await requireUser()
  if (!g.ok) return g
  const have = g.access.garden?.levels?.[page] || 'off'
  if (!gAtLeast(have, need)) {
    const msg = g.access.garden
      ? `Your hotel role (${g.access.garden.roleLabel}) has ${have} access on ${GARDEN_PAGE_LABEL[page] || page} — this needs ${need}. Ask the hotel's GM to adjust it.`
      : 'You are not on the Garden Hotel team.'
    return { ok: false, res: NextResponse.json({ error: 'forbidden', message: msg }, { status: 403 }), access: g.access }
  }
  return g
}

export async function gardenPage(page: GardenPageKey): Promise<{ access: Access; level: GLevel; canEdit: boolean; canFull: boolean; owner: boolean }> {
  const access = await getAccess()
  if (!access.user) redirect('/login')
  if (!access.garden) redirect(access.landing && !access.landing.startsWith('/garden') ? access.landing : '/no-access')
  const level = (access.garden.levels[page] || 'off') as GLevel
  // The landing is the first page the role can see, so it is never this (off) page — no loop.
  if (level === 'off') redirect(access.garden.landing)
  return { access, level, canEdit: gAtLeast(level, 'edit'), canFull: gAtLeast(level, 'full'), owner: isSuperadmin(access.email) }
}

/**
 * The owner-report routes are shared by both businesses (one table, one editor). A hotel deck
 * (listing_ids ['garden']) is gated by the hotel role on 'owner-reports'; every other deck by the
 * VR 'reports' level — so a hotel-only GM can edit the hotel's decks and never the portfolio's.
 */
export async function requireReportLevel(reportId: string | null | undefined, need: Exclude<GLevel, 'off'>): Promise<Gate> {
  const { requireLevel } = await import('../access')
  if (reportId) {
    const { supabaseAdmin } = await import('../supabase-admin')
    const { data } = await supabaseAdmin().from('owner_reports').select('listing_ids').eq('id', reportId).maybeSingle()
    const ids = Array.isArray((data as any)?.listing_ids) ? (data as any).listing_ids : []
    if (ids.length === 1 && ids[0] === 'garden') return requireGarden('owner-reports', need)
  }
  return requireLevel('reports', need)
}
