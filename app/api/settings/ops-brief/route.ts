// Morning brief settings — recipients per role, sender mailbox, on/off (Jon, 2026-11-05: ONE BRIEF
// PER ROLE — gm = GM morning, full = Ops morning, miami/broward = Field Runs, techs/maint =
// Maintenance Run, vendors, eod, and `cc`, copied on every brief).
// GET: any admin. PUT: owner only, same rule as ops presets — this decides who a daily company
// email goes to, which is an owner-level control. Stored in app_settings key 'ops_brief'.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { isVrLogin, hotelOnlyRes } from '@/lib/vr-gate'
import { getSetting, setSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'

const KEY = 'ops_brief'
const DEFAULTS = { enabled: false, fromEmail: 'jon@stay-hospitality.com', miami: [] as string[], broward: [] as string[], full: [] as string[], gm: [] as string[], cc: [] as string[] }
// THE MAINTENANCE RUN (Jon, 2026-10-01): one email per technician, in that person's language.
// `techs` maps the technician's name (as Breezeway and Homebase spell it) to addresses + language;
// `maint` is the combined run (Roberto).
const cleanTechs = (v: any): Record<string, { to: string[]; lang: 'en' | 'es' }> => {
  const out: Record<string, { to: string[]; lang: 'en' | 'es' }> = {}
  if (!v || typeof v !== 'object') return out
  for (const k of Object.keys(v).slice(0, 20)) {
    const name = String(k || '').trim().slice(0, 60)
    if (!name) continue
    const row = v[k] && typeof v[k] === 'object' ? v[k] : { to: v[k] }
    out[name] = { to: cleanEmails(row.to), lang: String(row.lang || '').toLowerCase() === 'es' ? 'es' : 'en' }
  }
  return out
}

const cleanEmails = (v: any): string[] =>
  (Array.isArray(v) ? v : []).map(x => String(x || '').trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 30)

// THE SALATO EMAIL RIDES ALONG (Jon, 2026-08-17: "make it where we can add who it goes to in user
// settings... also create one for Salato"). It reads app_settings 'salato_daily'; surfaced here on
// the same owner-only card and stored back to its own key. fromEmail follows the ops-brief sender
// unless one is already set on the key. `newBookings` (default on) is the new-booking emails' switch.
//
// LABOR HAS ONE LIST NOW (Jon, 2026-11-05). The Labor Scorecard's lists ('labor_weekly' and the
// older 'labor_daily') are no longer read by anything that sends: labor is in the GM morning, which
// goes to `gm`. They are still READ here — never written or deleted — so the card can show who was
// on the old labor list and is not on the GM morning yet.
const digestGet = async (key: string) => {
  const d = await getSetting<any>(key, null).catch(() => null)
  const o = d && typeof d === 'object' ? d : {}
  return { enabled: o.enabled === true, to: cleanEmails(o.to), fromEmail: typeof o.fromEmail === 'string' ? o.fromEmail : '', newBookings: o.newBookings !== false }
}

// LANGUAGE IS A SAVED SETTING, NOT DECORATION (Jon, 2026-08-26 audit).
//
// The admin screen has shipped language pickers for the Miami/Broward day sheets since the Spanish
// work landed, and the UI sends them on every save. Neither this route's GET nor its PUT ever
// mentioned `lang` — so the picker showed English on load, accepted a change, reported "Saved",
// and dropped it on the floor. The morning brief cron (app/api/cron/ops-brief) reads exactly these
// fields, so setting a crew's language was a Supabase row edit. A control that lies about having
// saved is worse than no control: nobody goes looking for a bug in a screen that said yes.
//
// The maintenance briefs' own lists and languages (app_settings 'maint_brief') are gone from this
// route: those briefs were retired on 2026-09-09 and their cron deleted on 2026-09-28, so nothing
// reads the key any more. A stored row is left as it is.
const asLang = (v: any): 'en' | 'es' => String(v || '').toLowerCase() === 'es' ? 'es' : 'en'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin') return NextResponse.json({ error: 'admins only' }, { status: 403 })
  if (!isVrLogin(access)) return hotelOnlyRes()
  const stored = await getSetting<any>(KEY, null)
  const s = stored && typeof stored === 'object' ? stored : {}
  const [trueup, laborDaily, salato] = await Promise.all([digestGet('labor_weekly'), digestGet('labor_daily'), digestGet('salato_daily')])
  const gm = cleanEmails(s.gm)
  const legacyLabor = Array.from(new Set([...trueup.to, ...laborDaily.to])).filter(e => !gm.includes(e))
  // The staffing planner's target margin rides along too (Jon, 2026-08-18): a number the owner
  // can set, or blank for automatic (settled 30-day HK margin + 3, computed by the planner).
  const lp = await getSetting<any>('labor_plan', null).catch(() => null)
  const lpTarget = Number(lp?.targetMarginPct)
  return NextResponse.json({
    ok: true,
    config: {
      enabled: s.enabled === true,
      fromEmail: typeof s.fromEmail === 'string' && s.fromEmail ? s.fromEmail : DEFAULTS.fromEmail,
      miami: cleanEmails(s.miami), broward: cleanEmails(s.broward), full: cleanEmails(s.full), gm,
      maint: cleanEmails(s.maint), techs: cleanTechs(s.techs),
      vendors: { botanica: cleanEmails(s.vendors?.botanica), pt: cleanEmails(s.vendors?.pt), north: cleanEmails(s.vendors?.north) },
      cc: cleanEmails(s.cc),
      // Who is told when a brief does not go out (lib/briefs/delivery). Empty = the owner's address.
      alertTo: cleanEmails(typeof s.alertTo === 'string' ? s.alertTo.split(/[,;\s]+/) : s.alertTo),
      trueup, salato, legacyLabor,
      // The EOD recap lives on this key (Eve audit 2026-10-10): on unless switched off, to its own list or the GM morning list.
      eod: { enabled: !(s.eod && s.eod.enabled === false), to: cleanEmails(s.eod?.to) },
      lang: { miami: asLang(s.lang?.miami), broward: asLang(s.lang?.broward) },
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
    maint: cleanEmails(c.maint), techs: cleanTechs(c.techs),
    vendors: { botanica: cleanEmails(c.vendors?.botanica), pt: cleanEmails(c.vendors?.pt), north: cleanEmails(c.vendors?.north) },
    lang: { miami: asLang(c.lang?.miami), broward: asLang(c.lang?.broward) },
    eod: { enabled: !(c.eod && typeof c.eod === 'object' && c.eod.enabled === false), to: cleanEmails(c.eod?.to) },
    cc: cleanEmails(c.cc),
    // Kept on save since 2026-11-10 — this route writes a fixed list of fields, so it was wiped before.
    alertTo: cleanEmails(c.alertTo),
  }
  const res = await setSetting(KEY, config, access.email)
  if (!res.ok) return NextResponse.json({ error: res.error || 'Could not save.' }, { status: 500 })
  // The Salato digest writes back to its own key, preserving whatever else lives there (a blind
  // overwrite would eat any other field stored on the key).
  const saveDigest = async (key: string, incoming: any) => {
    if (!incoming || typeof incoming !== 'object') return null
    const cur = await getSetting<any>(key, null).catch(() => null)
    const base = cur && typeof cur === 'object' ? cur : {}
    const next = {
      ...base,
      enabled: incoming.enabled === true,
      to: cleanEmails(incoming.to),
      ...(typeof incoming.newBookings === 'boolean' ? { newBookings: incoming.newBookings } : {}),
      fromEmail: typeof incoming.fromEmail === 'string' && /@/.test(incoming.fromEmail)
        ? incoming.fromEmail.trim().toLowerCase()
        : (base.fromEmail || config.fromEmail),
    }
    await setSetting(key, next, access.email).catch(() => null)
    return { enabled: next.enabled, to: next.to, fromEmail: next.fromEmail, newBookings: (next as any).newBookings !== false }
  }
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
  const lw = await digestGet('labor_weekly'), ld = await digestGet('labor_daily')
  const legacyLabor = Array.from(new Set([...lw.to, ...ld.to])).filter(e => !config.gm.includes(e))
  return NextResponse.json({ ok: true, config: { ...config, trueup: lw, salato, legacyLabor, laborPlan } })
}
