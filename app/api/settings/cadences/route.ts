// PREVENTATIVE CADENCES — settings.
//
// Jon, 2026-08-26: "this should live in user setting where you can have automations (suggestion
// sent)". So the intervals, the caps and the on/off for each job live here, next to Task
// automation, and changing "A/C deep clean" from six months to four is a dropdown, not a deploy.
//
// GET: any admin — a coordinator should be able to see why something is being suggested.
// PUT: owner only. These settings decide what work gets created for named staff.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { CADENCE_KEY, CADENCE_DEFAULTS, DEFAULT_CADENCES, resolveCadences, patternOk } from '@/lib/cadences'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  const stored = await getSetting<any>(CADENCE_KEY, null)
  return NextResponse.json({
    ok: true,
    config: resolveCadences(stored),
    // The client shows "changed from standard" against these, and Reset writes them back.
    defaults: { ...CADENCE_DEFAULTS, cadences: DEFAULT_CADENCES },
    customised: !!stored,
  })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) {
    return NextResponse.json({ error: 'Only the owner can change what work the app proposes.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({} as any))

  // A pattern that will not compile is rejected LOUDLY here rather than silently falling back in
  // the resolver — the person editing it is standing right there and can fix it.
  const bad = (Array.isArray(body?.config?.cadences) ? body.config.cadences : [])
    .filter((c: any) => c && typeof c.match === 'string' && c.match.trim() && !patternOk(c.match))
    .map((c: any) => String(c.label || c.key || 'a cadence'))
  if (bad.length) {
    return NextResponse.json({ error: `That match pattern is not valid: ${bad.join(', ')}.` }, { status: 400 })
  }

  // Round-trip through the resolver so what is stored is exactly what will run.
  const config = resolveCadences({
    ...(body?.config || {}),
    updatedAt: new Date().toISOString(),
    updatedBy: access.email || null,
  })
  config.updatedAt = new Date().toISOString()
  config.updatedBy = access.email || null

  const res = await setSetting(CADENCE_KEY, config, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, config })
}

/** Reset to what shipped. The override disappears; the code defaults take over again. */
export async function DELETE() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'owner only' }, { status: 403 })
  const res = await setSetting(CADENCE_KEY, null, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not reset.' }, { status: 500 })
  return NextResponse.json({ ok: true, config: resolveCadences(null) })
}
