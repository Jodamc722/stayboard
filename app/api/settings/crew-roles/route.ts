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
  area: string | null
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
  const [crew, tc, tasksRes] = await Promise.all([
    getCrew(),
    getTimecardsAudited(from, to).catch(() => ({ cards: [] as any[], complete: false, failedWeeks: [] as string[], weeks: 0 })),
    sb.from('breezeway_tasks_sync')
      .select('name, type_department, assignees, scheduled_date, status')
      .gte('scheduled_date', from).lte('scheduled_date', to).limit(5000),
  ])

  // ── Homebase is the payroll truth. Everyone who clocked an hour starts here. ──────────────────
  const byName: Record<string, Person> = {}
  const blank = (name: string): Person => ({
    name, dept: 'other', source: 'unrostered', sourceLabel: SOURCE_LABEL.unrostered, editable: true,
    hours: 0, payroll: money ? 0 : null, homebaseRole: null, staffRole: null, area: null,
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
    p.area = rec?.area ? str(rec.area) : null
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
  let set = 0, cleared = 0
  for (const rawName of Object.keys(incoming)) {
    const name = String(rawName).trim().slice(0, 120)
    if (!name) continue
    const v = String(incoming[rawName] || '').toLowerCase()
    // '' clears the override and hands the person back to the normal resolution order.
    if (!v) { if (name in next) { delete next[name]; cleared++ } continue }
    if (DEPTS.indexOf(v as Dept) < 0) continue
    if (next[name] !== v) set++
    next[name] = v
  }

  const { error } = await supabaseAdmin().from('app_settings').upsert(
    { key: KEY, value: JSON.stringify(next), updated_by: access.email, updated_at: new Date().toISOString() },
    { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, set, cleared, roles: next })
}
