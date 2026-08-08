// Staffing settings — the agencies we contract through and the staff assigned to them.
//
//   GET                        → { agencies, staff, roster }  (roster = live Homebase names, so the
//                                 editor can offer real people instead of free text)
//   PUT { agencies?, staff? }  → upsert either list
//
// Owner/admin only: agency fee rates decide what gets invoiced, so this is not a floor-level edit.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getAgencies, getStaff, upsertAgency, upsertStaff } from '@/lib/staffing'
import { getTimecards } from '@/lib/homebase-labor'
import { getShifts } from '@/lib/homebase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })

// Everyone Homebase has seen recently — punches first, then the schedule, so people who are
// rostered but have not clocked yet still appear and can be assigned an agency before payday.
// Carries the WAGE RATE too (Jon 2026-08-08: the staff table should show rate and agency cost),
// so the editor can price a person without a second round-trip. Rate is whatever Homebase last
// paid them; we never store it, so a raise entered in Homebase shows up here on the next load.
export type RosterPerson = { name: string; wageRate: number | null; role: string | null; days: number }

async function roster(): Promise<RosterPerson[]> {
  const now = new Date()
  const start = dISO(new Date(now.getTime() - 30 * 864e5))
  const end = dISO(now)
  const acc: Record<string, RosterPerson> = {}
  const put = (name: string, wage: number | null, role: string | null, worked: boolean) => {
    if (!name) return
    const p = acc[name] || (acc[name] = { name, wageRate: null, role: null, days: 0 })
    // Most recent non-null wins for rate/role; a blank shift must not wipe a known rate.
    if (wage != null && Number.isFinite(wage)) p.wageRate = wage
    if (role) p.role = role
    if (worked) p.days += 1
  }
  try { for (const t of await getTimecards(start, end)) put(t.name, t.wageRate, t.role, Number(t.hours) > 0) } catch {}
  try { for (const s of await getShifts(end, TZ)) if (!s.open) put(s.name, s.wageRate ?? null, s.role, false) } catch {}
  return Object.values(acc).sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET() {
  const g = await requireLevel('labor-settings', 'view')
  if (!g.ok) return g.res
  const [agencies, staff, names] = await Promise.all([
    getAgencies(true), getStaff(true), roster(),
  ])
  return NextResponse.json({ ok: true, agencies, staff, roster: names })
}

export async function PUT(req: NextRequest) {
  const g = await requireLevel('labor-settings', 'full')
  if (!g.ok) return g.res
  try {
    const body = await req.json().catch(() => ({}))
    const errors: string[] = []
    let saved = 0

    for (const a of (Array.isArray(body.agencies) ? body.agencies : [])) {
      if (!a?.key) continue
      const r = await upsertAgency(a)
      if (r.ok) saved++; else errors.push(`agency ${a.key}: ${r.error}`)
    }
    for (const s of (Array.isArray(body.staff) ? body.staff : [])) {
      if (!s?.name) continue
      const r = await upsertStaff(s)
      if (r.ok) saved++; else errors.push(`staff ${s.name}: ${r.error}`)
    }

    const [agencies, staff] = await Promise.all([getAgencies(true), getStaff(true)])
    return NextResponse.json({ ok: errors.length === 0, saved, errors, agencies, staff })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
