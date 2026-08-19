// Task automation settings — the rules that let Lighthouse create work on its own (today:
// pre-arrival inspections for big / VIP / owner arrivals; the key is deliberately generic so
// future automations live under the same roof).
// GET: any admin. PUT: owner only — auto-creating assigned work for named staff is an owner call.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { TASK_AUTOMATION_KEY, TASK_AUTOMATION_DEFAULTS, getTaskAutomation } from '@/lib/auto-inspections'

export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  return NextResponse.json({ ok: true, config: await getTaskAutomation() })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can change task automation.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const c = body?.config && typeof body.config === 'object' ? body.config : {}
  const d = TASK_AUTOMATION_DEFAULTS
  const nm = (v: any, fb: string) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : fb
  const num = (v: any, fb: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : fb }
  const config = {
    enabled: c.enabled === true,
    bigArrivals: c.bigArrivals !== false,
    bigValue: num(c.bigValue, d.bigValue, 100, 100000),
    bigNights: num(c.bigNights, d.bigNights, 2, 60),
    vip: c.vip !== false,
    ownerStays: c.ownerStays !== false,
    daysAhead: num(c.daysAhead, d.daysAhead, 1, 7),
    assignAlways: nm(c.assignAlways, d.assignAlways),
    supervisors: {
      Miami: nm(c.supervisors?.Miami, d.supervisors.Miami),
      Broward: nm(c.supervisors?.Broward, d.supervisors.Broward),
      North: nm(c.supervisors?.North, d.supervisors.North),
    },
  }
  const res = await setSetting(TASK_AUTOMATION_KEY, config, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  return NextResponse.json({ ok: true, config })
}
