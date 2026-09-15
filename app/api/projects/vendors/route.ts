// THE VENDOR DIRECTORY, for the project form's picker.
//
//   GET  /api/projects/vendors          → every active vendor, with contact details
//   POST /api/projects/vendors { … }    → save one (create or update) and hand it straight back
//
// This is the same `vendors` table the staffing settings page edits. Saving a plumber here is
// saving them for the whole app, which is what Jon asked for: "pull from once you save a vendor".
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { listVendors, saveVendor, coiState } from '@/lib/project-vendors'
import { todayISO } from '@/lib/projects-shared'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // A vendor's phone number and rate are ordinary working information for anyone who can see the
  // projects board — the same people who would be calling them.
  const g = await requireLevel('projects', 'view')
  if (!g.ok) return g.res
  const all = req.nextUrl.searchParams.get('all') === '1'
  const today = todayISO()
  const vendors = (await listVendors(all)).map(v => ({ ...v, coi: coiState(v, today) }))
  return NextResponse.json({ ok: true, vendors, today })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('projects', 'edit')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const r = await saveVendor(b?.vendor || b, String(g.access.email || ''))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, vendor: { ...r.vendor, coi: coiState(r.vendor, todayISO()) } })
}
