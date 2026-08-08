// Staffing settings — the agencies we contract through and the staff assigned to them.
//
//   GET                        → { agencies, staff, roster }  (roster = live Homebase names, so the
//                                 editor can offer real people instead of free text)
//   PUT { agencies?, staff? }  → upsert either list
//
// Owner/admin only: agency fee rates decide what gets invoiced, so this is not a floor-level edit.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getAgencies, getStaff, upsertAgency, upsertStaff, suggestFromTasks, mergeSuggestion, roleFromDepartment } from '@/lib/staffing'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { nameMatchesRoster } from '@/lib/homebase'
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

// ---- AUTO-FILL ---------------------------------------------------------------
// POST { days? } → create/refresh a staff row for everyone Homebase knows, with role and area
// derived from the Breezeway work they actually did. Never overwrites a value already set by
// hand, and never guesses agency. Returns what it would change so the UI can show the diff.
export async function POST(req: NextRequest) {
  const g = await requireLevel('labor-settings', 'full')
  if (!g.ok) return g.res
  try {
    const body = await req.json().catch(() => ({}))
    const days = Math.min(180, Math.max(7, Number(body.days) || 60))
    const now = new Date()
    const start = dISO(new Date(now.getTime() - days * 864e5))
    const end = dISO(now)

    const sb = supabaseAdmin()
    const presets = await getOpsPresets()
    const VENDOR = vendorRegex(presets.vendorBuildings)

    const [{ data: listings }, { data: tasks }, people, existing] = await Promise.all([
      sb.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000),
      sb.from('breezeway_tasks_sync')
        .select('assignee_name,finished_by_name,reference_property_id,type_department,name,finished_at')
        .gte('finished_at', start).lte('finished_at', end + 'T23:59:59').limit(5000),
      roster(),
      getStaff(true),
    ])

    // listing -> market, with vendor-cleaned buildings bucketed as 'vendor' (same rule as Labor).
    const lmap: Record<string, string> = {}
    for (const l of ((listings || []) as any[])) {
      const nm = l.nickname || l.title || 'Unit'
      lmap[String(l.id)] = (VENDOR.test(String(l.building || '')) || VENDOR.test(nm))
        ? 'vendor' : marketOf(l.building, l.address_city, nm).toLowerCase()
    }
    const suggestions = suggestFromTasks(((tasks || []) as any[]).map(t => ({
      doer: t.assignee_name || t.finished_by_name || null,
      market: lmap[String(t.reference_property_id)] || null,
      dept: String(t.type_department || ''), name: String(t.name || ''),
    })))

    // Breezeway names drift from Homebase spelling — fold suggestions onto the roster name.
    const rosterNames = people.map(p => p.name)
    const byRoster: Record<string, any> = {}
    for (const raw of Object.keys(suggestions)) {
      const canon = nameMatchesRoster(raw, rosterNames) || raw
      const cur = byRoster[canon]
      byRoster[canon] = !cur ? suggestions[raw]
        : { ...cur, tasks: cur.tasks + suggestions[raw].tasks, role: cur.role || suggestions[raw].role, area: cur.area || suggestions[raw].area }
    }

    const exIdx: Record<string, any> = {}
    for (const e of existing) exIdx[e.name.toLowerCase()] = e

    const changed: any[] = []
    for (const p of people) {
      const s = byRoster[p.name] || { name: p.name, role: null, area: null, tasks: 0 }
      // Homebase's own role text is the fallback when they have no Breezeway history at all.
      if (!s.role && p.role) s.role = roleFromDepartment(p.role, '') || null
      const ex = exIdx[p.name.toLowerCase()] || null
      const merged = mergeSuggestion(ex, s, p.name)
      const isNew = !ex
      if (isNew || merged.role !== ex.role || merged.area !== ex.area) {
        const r = await upsertStaff(merged)
        if (r.ok) changed.push({ name: p.name, role: merged.role, area: merged.area, tasks: s.tasks, added: isNew })
      }
    }

    const [agencies, staff] = await Promise.all([getAgencies(true), getStaff(true)])
    return NextResponse.json({ ok: true, days, changed, agencies, staff })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
