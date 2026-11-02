// HOURS PER CLEAN — the P&L cleaning rates the scheduler sizes the team with (lib/clean-rates.ts).
//
// GET: anyone signed in to the VR side — the scheduler prices every day with this. Admins see the
//      dollar rates; everybody else gets the same table already turned into hours (rate ÷ pay, with
//      pay set to 1), so the floor sees "2.5h a clean" and never what a clean is worth.
// PUT: admins. { config } — merged over the defaults, so a partial save never drops a building.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { getSetting, setSetting } from '@/lib/app-settings'
import { CLEAN_RATES_KEY, DEFAULT_CLEAN_RATES, resolveCleanRates, RATE_SIZES, type CleanRates } from '@/lib/clean-rates'

export const dynamic = 'force-dynamic'

function asHours(cfg: CleanRates): CleanRates {
  const h = (n: number) => Math.round((n / cfg.payPerHour) * 100) / 100
  return {
    ...cfg,
    payPerHour: 1,
    marketRate: { Miami: h(cfg.marketRate.Miami), Broward: h(cfg.marketRate.Broward), North: h(cfg.marketRate.North) },
    buildings: cfg.buildings.map(b => {
      const rates: any = {}
      for (const k of RATE_SIZES) if (b.rates[k] != null) rates[k] = h(b.rates[k] as number)
      return { ...b, rates, fullRate: b.fullRate != null ? h(b.fullRate) : undefined }
    }),
  }
}

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  const stored = await getSetting<any>(CLEAN_RATES_KEY, null).catch(() => null)
  const cfg = resolveCleanRates(stored)
  const admin = access.role === 'admin'
  return NextResponse.json({ ok: true, admin, dollars: admin, config: admin ? cfg : asHours(cfg), defaults: admin ? DEFAULT_CLEAN_RATES : undefined, customised: !!stored })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  if (body?.reset) {
    const r = await setSetting(CLEAN_RATES_KEY, null, access.email)
    if (!r.ok) return NextResponse.json({ error: r.error || 'could not save' }, { status: 500 })
    return NextResponse.json({ ok: true, config: DEFAULT_CLEAN_RATES, customised: false })
  }
  const config = resolveCleanRates({ ...(body?.config || {}), updatedAt: new Date().toISOString(), updatedBy: access.email || undefined })
  const r = await setSetting(CLEAN_RATES_KEY, config, access.email)
  if (!r.ok) return NextResponse.json({ error: r.error || 'could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, config, customised: true })
}
