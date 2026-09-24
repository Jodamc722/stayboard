// THE VENDOR DIRECTORY, for every board (Jon, 2026-09-24: one vendor list across projects,
// glitches and requests). /api/projects/vendors stays for the project board; this one answers
// anyone signed in, because a glitch or a request is raised by people who never open Projects.
//
//   GET  /api/vendors[?all=1]   → active vendors (all: inactive too), regulars first
//   POST /api/vendors { … }     → save one (create or update) and hand it back — the inline add
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/access'
import { listVendors, saveVendor, coiState } from '@/lib/project-vendors'
import { todayISO, CADENCE_DAYS } from '@/lib/projects-shared'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await requireUser()
  if (!g.ok) return g.res
  const all = req.nextUrl.searchParams.get('all') === '1'
  const today = todayISO()
  const vendors = (await listVendors(all)).map(v => ({ ...v, coi: coiState(v, today), lastVisit: null as string | null, overdueBy: null as number | null }))
    .sort((a, b) => Number(b.regular) - Number(a.regular) || a.sort - b.sort || a.label.localeCompare(b.label))
  // REGULARS ARE ON A CLOCK. For each regular vendor, when were they last here (a finished project
  // visit), and are they past their own cadence. One query for all of them; the Command Center
  // shows only the overdue ones. Before 088/109 the query fails and nothing is overdue.
  const regulars = vendors.filter(v => v.regular && v.cadence)
  if (regulars.length) {
    try {
      const { data } = await supabaseAdmin().from('project_steps').select('vendor_key,visit_on,done_at')
        .in('vendor_key', regulars.map(v => v.key)).or('done.eq.true,status.eq.done').limit(2000)
      const last: Record<string, string> = {}
      for (const r of (data as any[]) || []) {
        const d = String(r.visit_on || r.done_at || '').slice(0, 10)
        if (d && d <= today && (!last[r.vendor_key] || d > last[r.vendor_key])) last[r.vendor_key] = d
      }
      for (const v of regulars) {
        v.lastVisit = last[v.key] || null
        if (v.lastVisit && v.cadence) {
          const days = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(v.lastVisit + 'T00:00:00Z')) / 86400_000)
          v.overdueBy = Math.max(0, days - CADENCE_DAYS[v.cadence])
        }
      }
    } catch { /* columns not there yet */ }
  }
  return NextResponse.json({ ok: true, vendors, today })
}

export async function POST(req: NextRequest) {
  const g = await requireUser()
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const r = await saveVendor(b?.vendor || b, String(g.access.email || ''))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ ok: true, vendor: { ...r.vendor, coi: coiState(r.vendor, todayISO()) } })
}
