// Staffing settings — the agencies we contract through and the staff assigned to them.
//
//   GET                        → { agencies, staff, roster }  (roster = live Homebase names, so the
//                                 editor can offer real people instead of free text)
//   PUT { agencies?, staff? }  → upsert either list
//
// Owner/admin only: agency fee rates decide what gets invoiced, so this is not a floor-level edit.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getAgencies, getStaff, upsertAgency, upsertStaff, suggestFromTasks, mergeSuggestion, roleFromDepartment, agencyFromText, type Agency } from '@/lib/staffing'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { marketOf } from '@/lib/segments'
import { getOpsPresets } from '@/lib/app-settings'
import { vendorRegex } from '@/lib/ops-presets'
import { nameMatchesRoster, getShifts, getEmployees, getLocationUuids } from '@/lib/homebase'
import { getTimecards } from '@/lib/homebase-labor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })

// THE ROSTER IS THE HOMEBASE EMPLOYEE LIST (Jon 2026-08-08: "why are you not pulling the employee,
// rate and agency from Homebase — this should pull"). It used to be assembled from the last 30 days
// of punches, which meant anyone who had not clocked recently simply did not exist here. Now the
// employee list is the spine — everyone Homebase knows, whether or not they worked this month —
// and punches/shifts are layered on top only to sharpen it:
//
//   wageRate  — the employee record's rate, overridden by the most recent punch's rate when there
//               is one (a punch is what actually got paid, so it wins over the default).
//   role      — Homebase's own job title, used as a fallback when Breezeway history can't say.
//   days      — days actually worked in the last 30, so the editor can tell an active cleaner from
//               a name that has been on the books since March.
//   agencyHint— the agency name found in Homebase's own text (title/department/custom fields).
//               Null when Homebase carries no such tag: see agencyFromText.
//
// Nothing here is stored. A raise entered in Homebase shows up on the next page load.
export type RosterPerson = {
  name: string
  wageRate: number | null
  role: string | null
  days: number
  department: string | null
  active: boolean
  agencyHint: string | null
  source: 'homebase' | 'punches'   // 'punches' = worked but not on the employee list
}

async function roster(agencies: Agency[] = []): Promise<RosterPerson[]> {
  const now = new Date()
  const start = dISO(new Date(now.getTime() - 30 * 864e5))
  const end = dISO(now)
  const acc: Record<string, RosterPerson> = {}
  const key = (n: string) => n.trim().toLowerCase()
  const at = (name: string, source: RosterPerson['source']) => {
    const k = key(name)
    return acc[k] || (acc[k] = {
      name: name.trim(), wageRate: null, role: null, days: 0,
      department: null, active: true, agencyHint: null, source,
    })
  }

  // 1. The employee list — the spine.
  let employeeListOk = false
  try {
    for (const e of await getEmployees()) {
      const p = at(e.name, 'homebase')
      p.wageRate = e.wageRate
      p.role = e.role
      p.department = e.department
      p.active = e.active
      // Jon 2026-08-08: "in the title of their name, look for it — it's there." The agency is
      // written into the person's own name/title in Homebase, so that is the first place we look.
      p.agencyHint = agencyFromText([e.name, e.role, e.department, ...Object.values(e.extra)], agencies)
    }
    employeeListOk = true
  } catch {}

  // 2. Punches — real paid rate and days worked. Also catches anyone the employee endpoint
  //    missed (a second location, or an API key scoped narrower than the schedule).
  try {
    for (const t of await getTimecards(start, end)) {
      const p = at(t.name, employeeListOk ? 'punches' : 'homebase')
      if (t.wageRate != null && Number.isFinite(t.wageRate)) p.wageRate = t.wageRate
      if (!p.role && t.role) p.role = t.role
      if (!p.agencyHint) p.agencyHint = agencyFromText([t.name, t.role], agencies)
      if (Number(t.hours) > 0) p.days += 1
    }
  } catch {}

  // 3. Today's schedule — someone rostered for today who has not clocked in yet.
  try {
    for (const s of await getShifts(end, TZ)) {
      if (s.open) continue
      const p = at(s.name, employeeListOk ? 'punches' : 'homebase')
      if (p.wageRate == null && s.wageRate != null) p.wageRate = s.wageRate
      if (!p.role && s.role) p.role = s.role
    }
  } catch {}

  return Object.values(acc).sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET() {
  const g = await requireLevel('labor-settings', 'view')
  if (!g.ok) return g.res
  // Agencies first — the roster needs them to recognise an agency name in Homebase text.
  const agencies = await getAgencies(true)
  const [staff, names] = await Promise.all([getStaff(true), roster(agencies)])
  // Diagnostics, so "someone is missing" is answerable instead of a shrug: how many locations
  // the API key can see, how many people came from the employee list vs only from punches, and
  // whether the employee endpoint failed outright.
  const diag = {
    locations: await getLocationUuids().then(l => l.length).catch(() => 0),
    fromEmployeeList: names.filter(p => p.source === 'homebase').length,
    punchesOnly: names.filter(p => p.source === 'punches').length,
    inactive: names.filter(p => !p.active).length,
    withAgencyHint: names.filter(p => p.agencyHint).length,
  }
  return NextResponse.json({ ok: true, agencies, staff, roster: names, diag })
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
// derived from the Breezeway work they actually did, and AGENCY read out of the person's own
// Homebase name/title (Jon 2026-08-08). Never overwrites a value already set by hand. Agency is
// still never *invented* — it is only ever copied from text Homebase already carries.
// Returns what it changed so the UI can show the diff.
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
    const agencyList = await getAgencies(true)

    const [{ data: listings }, { data: tasks }, people, existing] = await Promise.all([
      sb.from('guesty_listings').select('id,nickname,title,building,address_city').limit(2000),
      sb.from('breezeway_tasks_sync')
        .select('assignee_name,finished_by_name,reference_property_id,type_department,name,finished_at')
        .gte('finished_at', start).lte('finished_at', end + 'T23:59:59').limit(5000),
      roster(agencyList),
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
      // Agency comes from Homebase's own text; a value already chosen by hand always wins.
      if (!ex?.agency && p.agencyHint) merged.agency = p.agencyHint
      // Homebase says whether they still work here; keep an archived person visible but inactive.
      if (!ex) merged.active = p.active
      const isNew = !ex
      if (isNew || merged.role !== ex.role || merged.area !== ex.area || merged.agency !== ex.agency) {
        const r = await upsertStaff(merged)
        if (r.ok) changed.push({
          name: p.name, role: merged.role, area: merged.area, agency: merged.agency,
          rate: p.wageRate, tasks: s.tasks, added: isNew,
        })
      }
    }

    const [agencies, staff] = await Promise.all([getAgencies(true), getStaff(true)])
    const matchedAgency = changed.filter(c => c.agency).length
    return NextResponse.json({
      ok: true, days, changed, matchedAgency, agencies, staff, roster: people,
      diag: {
        locations: await getLocationUuids().then(l => l.length).catch(() => 0),
        fromEmployeeList: people.filter(p => p.source === 'homebase').length,
        punchesOnly: people.filter(p => p.source === 'punches').length,
        inactive: people.filter(p => !p.active).length,
        withAgencyHint: people.filter(p => p.agencyHint).length,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
