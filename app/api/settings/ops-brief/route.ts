// Morning Ops Brief settings — recipients per variant, sender mailbox, on/off.
// GET: any admin. PUT: owner only, same rule as ops presets — this decides who a daily company
// email goes to, which is an owner-level control. Stored in app_settings key 'ops_brief'.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

const KEY = 'ops_brief'
const DEFAULTS = { enabled: false, fromEmail: 'jon@stay-hospitality.com', miami: [] as string[], broward: [] as string[], full: [] as string[], gm: [] as string[] }

const cleanEmails = (v: any): string[] =>
  (Array.isArray(v) ? v : []).map(x => String(x || '').trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 30)

// THE OTHER TWO DAILY EMAILS RIDE ALONG (Jon, 2026-08-17: "make it where we can add who it goes
// to in user settings... also create one for Salato"). The labor true-up email reads app_settings
// 'labor_weekly' and the Salato front-desk email reads 'salato_daily' — both had recipients that
// could only be changed by editing the database. They are surfaced here as two more lists on the
// same owner-only card, stored back to their own keys so the crons keep reading what they always
// read. fromEmail follows the ops-brief sender unless one is already set on the key.
const digestGet = async (key: string) => {
  const d = await getSetting<any>(key, null).catch(() => null)
  const o = d && typeof d === 'object' ? d : {}
  return { enabled: o.enabled === true, to: cleanEmails(o.to), fromEmail: typeof o.fromEmail === 'string' ? o.fromEmail : '' }
}

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  const stored = await getSetting<any>(KEY, null)
  const s = stored && typeof stored === 'object' ? stored : {}
  const [trueup, salato] = await Promise.all([digestGet('labor_weekly'), digestGet('salato_daily')])
  // The staffing planner's target margin rides along too (Jon, 2026-08-18): a number the owner
  // can set, or blank for automatic (settled 30-day HK margin + 3, computed by the planner).
  const lp = await getSetting<any>('labor_plan', null).catch(() => null)
  const lpTarget = Number(lp?.targetMarginPct)
  return NextResponse.json({
    ok: true,
    config: {
      enabled: s.enabled === true,
      fromEmail: typeof s.fromEmail === 'string' && s.fromEmail ? s.fromEmail : DEFAULTS.fromEmail,
      miami: cleanEmails(s.miami), broward: cleanEmails(s.broward), full: cleanEmails(s.full), gm: cleanEmails(s.gm),
      vendors: { botanica: cleanEmails(s.vendors?.botanica), pt: cleanEmails(s.vendors?.pt), north: cleanEmails(s.vendors?.north) },
      trueup, salato,
      laborPlan: { targetMarginPct: Number.isFinite(lpTarget) && lpTarget > 0 ? Math.round(lpTarget) : null },
    },
  })
}

export async function PUT(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!isSuperadmin(access.email)) return NextResponse.json({ error: 'Only the owner can change who receives the brief.' }, { status: 403 })
  const body = await req.json().catch(() => ({} as any))
  const c = body?.config && typeof body.config === 'object' ? body.config : {}
  const config = {
    enabled: c.enabled === true,
    fromEmail: typeof c.fromEmail === 'string' && /@/.test(c.fromEmail) ? c.fromEmail.trim().toLowerCase() : DEFAULTS.fromEmail,
    miami: cleanEmails(c.miami), broward: cleanEmails(c.broward), full: cleanEmails(c.full), gm: cleanEmails(c.gm),
    vendors: { botanica: cleanEmails(c.vendors?.botanica), pt: cleanEmails(c.vendors?.pt), north: cleanEmails(c.vendors?.north) },
  }
  const res = await setSetting(KEY, config, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  // The two ride-along digests write back to their own keys, preserving whatever else lives there
  // (the true-up shares 'labor_weekly' with the Monday email, so a blind overwrite would eat it).
  const saveDigest = async (key: string, incoming: any) => {
    if (!incoming || typeof incoming !== 'object') return null
    const cur = await getSetting<any>(key, null).catch(() => null)
    const base = cur && typeof cur === 'object' ? cur : {}
    const next = {
      ...base,
      enabled: incoming.enabled === true,
      to: cleanEmails(incoming.to),
      fromEmail: typeof incoming.fromEmail === 'string' && /@/.test(incoming.fromEmail)
        ? incoming.fromEmail.trim().toLowerCase()
        : (base.fromEmail || config.fromEmail),
    }
    await setSetting(key, next, access.email).catch(() => null)
    return { enabled: next.enabled, to: next.to, fromEmail: next.fromEmail }
  }
  const trueup = await saveDigest('labor_weekly', c.trueup)
  const salato = await saveDigest('salato_daily', c.salato)
  // Staffing planner target: merge-save into 'labor_plan' (its other keys — forward-booking
  // history lives elsewhere, but stay safe). 20–80 accepted; anything else clears to automatic.
  let laborPlan: { targetMarginPct: number | null } | null = null
  if (c.laborPlan && typeof c.laborPlan === 'object') {
    const n = Number(c.laborPlan.targetMarginPct)
    const target = Number.isFinite(n) && n >= 20 && n <= 80 ? Math.round(n) : null
    const cur = await getSetting<any>('labor_plan', null).catch(() => null)
    const base = cur && typeof cur === 'object' ? cur : {}
    await setSetting('labor_plan', { ...base, targetMarginPct: target }, access.email).catch(() => null)
    laborPlan = { targetMarginPct: target }
  }
  return NextResponse.json({ ok: true, config: { ...config, trueup, salato, laborPlan } })
}
