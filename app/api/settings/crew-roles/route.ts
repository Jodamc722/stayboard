// WHO IS ON WHICH CREW — the editor behind /users → App settings → "Crew & roles".
//
// This setting (app_settings 'crew_roles') has decided which crew every person's wages land in
// since 2026-08-12, and until 2026-08-21 NOTHING IN THE APP COULD WRITE IT. The only way to place
// somebody was to hand-edit the row in Supabase, so in practice the app fell through to the
// hardcoded roster in lib/crew, then to a regex over the free-text Staffing role, then — worst of
// all — to whatever that person happened to do in Breezeway that week. That last step is why a
// maintenance tech who covered some turnovers could land his wages inside the cost per clean.
//
// Jon, 2026-08-21: "use homebase and departure cleans as the calculations, and use breezeway to
// paint a story… Breezeway is the color not the rule." So Breezeway numbers appear here purely as
// EVIDENCE next to a person's name. They never set the answer; a human does.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, requireLevel, canSeeMoney } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSetting } from '@/lib/app-settings'
import { getAgencies, upsertStaff, getStaff, staffSingleSourceReady, type Agency } from '@/lib/staffing'
import { getCrew, DEPTS, DEPT_LABEL, SOURCE_LABEL, type Dept } from '@/lib/crew'
import { getTimecardsAudited } from '@/lib/homebase-labor'
import { nameMatchesRoster } from '@/lib/homebase'
import { isDepartureCleanName } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KEY = 'crew_roles'
const TZ = 'America/New_York'
const dISO = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
const round2 = (n: number) => Math.round(n * 100) / 100
const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))

type Person = {
  name: string
  dept: Dept
  source: string
  sourceLabel: string
  editable: boolean
  hours: number
  payroll: number | null
  homebaseRole: string | null
  staffRole: string | null
  /** '' = W2, in-house. Otherwise the agency key they are contracted through. */
  agency: string | null
  /** miami | broward | north | vendor | '' — '' means they are in no market tab at all. */
  area: string | null
  /** Pay, from the same staff row. Present only once migration 057 has been applied. */
  title?: string | null
  salaried?: boolean
  salaryHourly?: number | null
  salaryHoursPerWeek?: number | null
  salaryAnnual?: number | null
  // Breezeway, as colour only.
  tasks: { total: number; cleans: number; maintenance: number; inspection: number; other: number }
}

export async function GET(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const money = canSeeMoney(access)

  const days = Math.max(7, Math.min(90, Number(new URL(req.url).searchParams.get('days')) || 30))
  const to = dISO(new Date())
  const from = dISO(new Date(Date.now() - days * 864e5))

  const sb = supabaseAdmin()
  const [crew, agencies, tc, tasksRes, singleSource, staffRows] = await Promise.all([
    getCrew(),
    getAgencies(true).catch(() => [] as Agency[]),
    getTimecardsAudited(from, to).catch(() => ({ cards: [] as any[], complete: false, failedWeeks: [] as string[], weeks: 0 })),
    sb.from('breezeway_tasks_sync')
      .select('name, type_department, assignees, scheduled_date, status')
      .gte('scheduled_date', from).lte('scheduled_date', to).limit(5000),
    staffSingleSourceReady().catch(() => false),
    getStaff(true).catch(() => [] as any[]),
  ])
  const staffByLower: Record<string, any> = {}
  for (const r of (staffRows || [])) staffByLower[String(r.name).toLowerCase()] = r

  // ── Homebase is the payroll truth. Everyone who clocked an hour starts here. ──────────────────
  const byName: Record<string, Person> = {}
  const blank = (name: string): Person => ({
    name, dept: 'other', source: 'unrostered', sourceLabel: SOURCE_LABEL.unrostered, editable: true,
    hours: 0, payroll: money ? 0 : null, homebaseRole: null, staffRole: null, agency: null, area: null,
    tasks: { total: 0, cleans: 0, maintenance: 0, inspection: 0, other: 0 },
  })
  for (const c of (tc.cards || [])) {
    const n = str(c.name).trim(); if (!n) continue
    const p = byName[n] || (byName[n] = blank(n))
    p.hours = round2(p.hours + (Number(c.hours) || 0))
    if (money) p.payroll = round2((p.payroll || 0) + (Number(c.laborCost) || 0))
    if (!p.homebaseRole && c.role) p.homebaseRole = str(c.role)
  }

  // ── Breezeway: colour. Folded onto the Homebase spelling so one person is one row. ────────────
  const knownNames = Object.keys(byName)
  for (const t of (tasksRes.data || [])) {
    const raw = Array.isArray((t as any).assignees) ? (t as any).assignees : []
    const dept = str((t as any).type_department).toLowerCase()
    const isClean = isDepartureCleanName((t as any).name)
    for (const a of raw) {
      const nm = str(typeof a === 'string' ? a : a?.name).trim(); if (!nm) continue
      const canon = nameMatchesRoster(nm, knownNames) || nm
      const p = byName[canon] || (byName[canon] = blank(canon))
      p.tasks.total++
      if (isClean) p.tasks.cleans++
      else if (/maint|repair/.test(dept)) p.tasks.maintenance++
      else if (/inspect/.test(dept)) p.tasks.inspection++
      else p.tasks.other++
    }
  }

  // ── Resolve each person the same way the money does, and say where the answer came from. ─────
  for (const n of Object.keys(byName)) {
    const p = byName[n]
    const rec = crew.staff[n] || Object.values(crew.staff).find((s: any) => nameMatchesRoster(n, [s.name])) as any
    p.staffRole = rec?.role ? str(rec.role) : null
    p.agency = rec?.agency ? str(rec.agency) : null
    p.area = rec?.area ? str(rec.area) : null
    // Pay rides the same record now — one row per person, edited in one place.
    const sr = (rec && staffByLower[String(rec.name || '').toLowerCase()]) || staffByLower[n.toLowerCase()] || null
    p.title = sr?.title ?? null
    p.salaried = sr?.salaried === true
    p.salaryHourly = sr?.salaryHourly ?? null
    p.salaryHoursPerWeek = sr?.salaryHoursPerWeek ?? null
    p.salaryAnnual = sr?.salaryAnnual ?? null
    const r = crew.deptOfDetailed(n, p.homebaseRole, null)
    p.dept = r.dept
    p.source = r.source
    p.sourceLabel = SOURCE_LABEL[r.source]
  }

  const people = Object.values(byName).sort((a, b) => {
    // The people whose crew nobody has stated come first — they are the ones bending the numbers.
    const rank = (p: Person) => {
      const unset = p.source === 'unrostered' || p.source === 'inferred'
      if (unset && p.hours > 0) return 0     // real wages in the wrong place
      if (unset) return 2                    // outside cleaner — expected
      return 1
    }
    return rank(a) - rank(b) || b.hours - a.hours || a.name.localeCompare(b.name)
  })

  // TWO DIFFERENT KINDS OF "NOT PLACED", AND ONLY ONE OF THEM IS A PROBLEM.
  //   • On payroll with no crew — they clocked Homebase hours, so real wages are sitting in Other
  //     instead of a margin. This is the one worth shouting about.
  //   • Seen in Breezeway but never clocked an hour — a vendor's cleaner or an outside contractor.
  //     Expected, costs us no payroll, and placing them would ADD cleans with no wages behind them.
  // Reporting them as one number said "16 people on payroll — $0 of wages", which is nonsense.
  const unplaced = (p: Person) => p.source === 'unrostered' || p.source === 'inferred'
  const onPayrollNoCrew = people.filter(p => unplaced(p) && p.hours > 0)
  const breezewayOnly = people.filter(p => unplaced(p) && p.hours <= 0)
  const counts: Record<string, number> = {}
  for (const d of DEPTS) counts[d] = people.filter(p => p.dept === d).length

  return NextResponse.json({
    ok: true,
    from, to, days,
    people,
    depts: DEPTS.map(d => ({ key: d, label: DEPT_LABEL[d] })),
    counts,
    overrides: crew.overrides,
    // W2 is the absence of an agency, so it is offered as a real choice rather than a blank.
    agencies: [{ key: '', label: 'W2 — in-house' }, ...agencies.map(a => ({ key: a.key, label: a.label, fee_percent: a.fee_percent, fee_per_hour: a.fee_per_hour, fee_flat: a.fee_flat }))],
    // Vendor sits beside the geographic markets on purpose: a vendor-cleaned unit is its own bucket
    // in the economics, never part of Miami or Broward.
    areas: [
      { key: '', label: 'Not set' },
      { key: 'miami', label: 'Miami' },
      { key: 'broward', label: 'Broward' },
      { key: 'north', label: 'North' },
      { key: 'vendor', label: 'Vendor' },
    ],
    // The cost of the hole, in the units that matter.
    gap: {
      people: onPayrollNoCrew.length,
      hours: round2(onPayrollNoCrew.reduce((s, p) => s + p.hours, 0)),
      payroll: money ? round2(onPayrollNoCrew.reduce((s, p) => s + (p.payroll || 0), 0)) : null,
    },
    // Not a problem — stated so it is obvious why they sit in Other.
    outside: {
      people: breezewayOnly.length,
      names: breezewayOnly.map(p => p.name),
      tasks: breezewayOnly.reduce((s, p) => s + p.tasks.total, 0),
    },
    // Homebase week fetches can fail; a partial roster must not read as a complete one.
    payrollComplete: (tc as any).complete !== false,
    // ONE SOURCE (Jon, 2026-08-26). false = migration 057 has not been applied, so crew and pay
    // edits made here cannot persist to the staff row yet and the app is still resolving people
    // through the old ladder. Said plainly on screen rather than failing quietly.
    singleSource,
    canEdit: true,
  })
}

export async function PUT(req: NextRequest) {
  // Same gate as Staffing — this decides whose wages land in which margin.
  const g = await requireLevel('labor-settings', 'full')
  if (!g.ok) return g.res
  const access = await getAccess()

  const body = await req.json().catch(() => ({} as any))
  const incoming = (body?.roles && typeof body.roles === 'object') ? body.roles : {}
  const current = await getSetting<Record<string, string>>(KEY, {}).catch(() => ({} as Record<string, string>))

  const next: Record<string, string> = { ...(current || {}) }
  // THE CREW NOW LANDS ON THE PERSON'S OWN ROW (Jon, 2026-08-26: one source of data). The legacy
  // app_settings blob is still written alongside it, for two reasons: it is what resolves people
  // on any deploy where migration 057 has not run, and keeping it in step means this change can
  // be rolled back without losing a single operator decision.
  const deptWrites: Record<string, string | null> = {}
  let set = 0, cleared = 0
  for (const rawName of Object.keys(incoming)) {
    const name = String(rawName).trim().slice(0, 120)
    if (!name) continue
    const v = String(incoming[rawName] || '').toLowerCase()
    // '' clears the stated crew and hands the person back to the normal resolution order.
    if (!v) { if (name in next) { delete next[name]; cleared++ } deptWrites[name] = null; continue }
    if (DEPTS.indexOf(v as Dept) < 0) continue
    if (next[name] !== v) set++
    next[name] = v
    deptWrites[name] = v
  }

  // Agency (or W2) and market live on the `staff` row, not in this setting — same record the
  // Staffing screen edits, so the two can never drift apart. Partial upsert: only the fields
  // actually sent are touched.
  const staffEdits = (body?.staff && typeof body.staff === 'object') ? body.staff : {}
  const staffErrors: string[] = []
  let staffSaved = 0
  let migrationPending = false
  for (const rawName of Object.keys(staffEdits)) {
    const name = String(rawName).trim().slice(0, 120)
    if (!name) continue
    const e = staffEdits[rawName] || {}
    const patch: any = { name }
    if ('agency' in e) patch.agency = e.agency ? String(e.agency) : null
    if ('area' in e) patch.area = e.area ? String(e.area).toLowerCase() : null
    // Role rides the same staff row (Jon, 2026-08-23: "put the role, the agency, and their pay
    // agency fees so I can get a better assumption of labor cost based on market area and role").
    if ('role' in e) patch.role = e.role ? String(e.role) : null
    // Pay lives on the same row, so the People card can state it in the same save.
    if ('title' in e) patch.title = e.title ? String(e.title) : null
    if ('salaried' in e) patch.salaried = !!e.salaried
    if ('salaryHourly' in e) patch.salaryHourly = e.salaryHourly === '' || e.salaryHourly == null ? null : Number(e.salaryHourly)
    if ('salaryHoursPerWeek' in e) patch.salaryHoursPerWeek = e.salaryHoursPerWeek === '' || e.salaryHoursPerWeek == null ? null : Number(e.salaryHoursPerWeek)
    if ('salaryAnnual' in e) patch.salaryAnnual = e.salaryAnnual === '' || e.salaryAnnual == null ? null : Number(e.salaryAnnual)
    if (name in deptWrites) { patch.dept = deptWrites[name]; patch.deptSource = 'set here' }
    if (Object.keys(patch).length < 2) continue
    const r = await upsertStaff(patch)
    if (r.ok) { staffSaved++; if (r.migrationPending) migrationPending = true }
    else staffErrors.push(`${name}: ${r.error}`)
    delete deptWrites[name]
  }
  // Anybody whose crew changed but who had no other staff edit still needs their row written.
  for (const name of Object.keys(deptWrites)) {
    const r = await upsertStaff({ name, dept: deptWrites[name], deptSource: 'set here' })
    if (r.ok) { staffSaved++; if (r.migrationPending) migrationPending = true }
    else staffErrors.push(`${name}: ${r.error}`)
  }

  const { error } = await supabaseAdmin().from('app_settings').upsert(
    { key: KEY, value: JSON.stringify(next), updated_by: access.email, updated_at: new Date().toISOString() },
    { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    ok: true, set, cleared, staffSaved, staffErrors, roles: next,
    // true = the crew and pay half of this save could not reach the staff row because migration
    // 057 is not applied. The legacy setting still holds the crew, so nothing was lost — but the
    // operator is told rather than left believing the record is now the source.
    migrationPending,
  })
}

// ---------------------------------------------------------------------------------------------
// CONSOLIDATE — pull every person onto their own staff row, once (Jon, 2026-08-26: "make sure all
// staff and role is pulled from one source of data").
//
// Migration 057 adds the columns; this fills them. For everyone the app currently resolves through
// the OLD ladder — the settings override, the roster hardcoded in lib/crew, the Homebase role text
// — it writes that answer onto their record and stamps where it came from. Nothing changes on
// screen: the same crew each person already had is simply now STATED on their row instead of being
// re-derived from five places on every request.
//
// Idempotent by construction: a person whose row already names a crew is skipped, so running it
// twice is the same as running it once, and it can never overwrite an operator's choice.
export async function POST(req: NextRequest) {
  const g = await requireLevel('labor-settings', 'full')
  if (!g.ok) return g.res

  if (!(await staffSingleSourceReady())) {
    return NextResponse.json({
      ok: false,
      error: 'The staff table does not have the single-source columns yet — apply supabase/migrations/057_staff_single_source.sql, then run this again.',
      migrationPending: true,
    }, { status: 409 })
  }

  const days = 30
  const to = dISO(new Date())
  const from = dISO(new Date(Date.now() - days * 864e5))
  const sb = supabaseAdmin()
  const [crew, existing, tc, tasksRes] = await Promise.all([
    getCrew(),
    getStaff(true).catch(() => [] as any[]),
    getTimecardsAudited(from, to).catch(() => ({ cards: [] as any[] })),
    sb.from('breezeway_tasks_sync').select('assignees, scheduled_date')
      .gte('scheduled_date', from).lte('scheduled_date', to).limit(5000),
  ])

  // Everyone the app knows about: on payroll, seen in Breezeway, or already on the roster.
  const names: Record<string, string> = {}
  const roleOf: Record<string, string | null> = {}
  for (const c of ((tc as any).cards || [])) {
    const n = str(c.name).trim(); if (!n) continue
    names[n.toLowerCase()] = n
    if (!roleOf[n.toLowerCase()] && c.role) roleOf[n.toLowerCase()] = str(c.role)
  }
  for (const t of (tasksRes.data || [])) {
    const raw = Array.isArray((t as any).assignees) ? (t as any).assignees : []
    for (const a of raw) {
      const nm = str(typeof a === 'string' ? a : a?.name).trim()
      if (nm) names[nm.toLowerCase()] = nm
    }
  }
  for (const r of (existing || [])) names[String(r.name).toLowerCase()] = String(r.name)

  const stated: Record<string, boolean> = {}
  for (const r of (existing || [])) if (r.dept) stated[String(r.name).toLowerCase()] = true

  const written: { name: string; dept: string; from: string }[] = []
  const skipped: string[] = []
  const errors: string[] = []
  for (const key of Object.keys(names)) {
    const name = names[key]
    // Already stated on the record — the whole point is that this can never override a person.
    if (stated[key]) { skipped.push(name); continue }
    const r = crew.deptOfDetailed(name, roleOf[key] || null, null)
    // 'unrostered' means nobody has actually said. Writing 'other' for them would turn a visible
    // gap into a stated fact, which is the exact failure this roster exists to prevent.
    if (r.source === 'unrostered') { skipped.push(name); continue }
    const res = await upsertStaff({ name, dept: r.dept, deptSource: 'consolidated:' + r.source })
    if (res.ok) written.push({ name, dept: r.dept, from: SOURCE_LABEL[r.source] })
    else errors.push(`${name}: ${res.error}`)
  }

  return NextResponse.json({
    ok: true,
    written: written.length,
    skipped: skipped.length,
    people: written,
    errors,
    note: 'Every person above now states their own crew on their own record. Nobody moved crews — the answer they already had was written down.',
  })
}
