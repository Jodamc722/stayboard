// THE MORNING BRIEFS — cron sender + on-demand preview/test. ONE BRIEF PER ROLE (Jon, 2026-11-05):
//   gm      → GM morning (the owner: decide, the numbers, labor, arrivals, blocked)
//   full    → Ops morning (the operations manager)
//   miami / broward → Field Run per market · techs / maint → Maintenance Run · vendors → vendor briefs
//
//   GET  (cron)                          → send every brief to its list
//   GET ?send=1 | ?only=gm,full,…        → signed-in re-send, all or some
//   GET ?preview=gm|full|Miami|Broward|maint|maint:<name>|botanica|pt|north → the HTML, no send
//   GET ?test=1[&only=…]                 → signed-in: send to YOU alone
//
// Recipients and the sender live in app_settings key 'ops_brief' (owner-editable on /users):
//   { enabled, fromEmail, miami, broward, full, gm, techs, maint, vendors, lang, eod, cc }
// `cc` is copied on every brief (default empty) — it replaced the hardcoded standing CC.
// SAFE BY DEFAULT: until recipients are configured, nothing sends to anyone but the tester.
// Auth mirrors the other crons: the scheduler's CRON_SECRET bearer only (constant-time; the
// x-vercel-cron header is not trusted), or a signed-in Lighthouse member for preview / test / re-send.
import { NextRequest, NextResponse } from 'next/server'
import { cronAllowed } from '@/lib/cron-auth'
import { setSetting } from '@/lib/app-settings'
import { requireUser } from '@/lib/access'
import { getSetting } from '@/lib/app-settings'
import { buildVendorBrief, VENDOR_GROUPS, type BriefVariant, type VendorGroup } from '@/lib/ops-brief'
import { buildFieldRun } from '@/lib/briefs/field-run'
import { buildOpsDesk } from '@/lib/briefs/ops-desk'
import { buildGmMorning } from '@/lib/briefs/gm-morning'
import { markLaborDelivered } from '@/lib/briefs/labor-scorecard'
import { buildMaintenanceRun, maintenanceTechs } from '@/lib/briefs/maintenance-run'
import { asLang, type BriefLang } from '@/lib/brief-lang'
import { sendGmail } from '@/lib/gmail-send'
import { withRouteReceipt } from '@/lib/automation-runs'
import { hashLegacyPasscodes } from '@/lib/share-links-server'
import { atEasternHour } from '@/lib/et-clock'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const OPS_BRIEF_KEY = 'ops_brief'
type BriefCfg = {
  enabled?: boolean; fromEmail?: string; miami?: string[]; broward?: string[]; full?: string[]; gm?: string[]
  vendors?: Partial<Record<VendorGroup, string[]>>
  // THE CREW'S LANGUAGE, PER BRIEF (Jon, 2026-08-25). Only the field day sheets take one — Ops
  // Command and the GM brief are management documents and stay English.
  lang?: { miami?: string; broward?: string }
  // ONE ROLE, ONE EMAIL (Jon, 2026-10-01). miami/broward now feed the Field Runs, full the Ops
  // Desk (keys kept so no list was lost). `techs` is the Maintenance Run — one email per
  // technician, in that person's language; `maint` gets the combined run (Roberto).
  techs?: Record<string, { to: string[]; lang?: string }>
  maint?: string[]
  // COPIED ON EVERY BRIEF (Jon, 2026-11-05: "one brief per role"). Replaces the hardcoded standing
  // CC to the operations manager; empty by default, edited on /users.
  cc?: string[]
}

// One builder for every variant, so preview / test / cron can never drift apart. The briefs behind
// the stored variant names: Miami/Broward → Field Run, full → Ops morning, GM → GM morning.
const build = (v: BriefVariant, lang: BriefLang = 'en') => v === 'GM' ? buildGmMorning() : v === 'full' ? buildOpsDesk() : buildFieldRun(v, lang)
const langFor = (cfg: BriefCfg, v: BriefVariant): BriefLang =>
  v === 'Miami' ? asLang(cfg.lang?.miami) : v === 'Broward' ? asLang(cfg.lang?.broward) : 'en'
const ALL_VARIANTS: BriefVariant[] = ['Miami', 'Broward', 'full', 'GM']

const DEFAULT_FROM = 'jon@stay-hospitality.com'
// THE CC IS A SETTING, NOT A NAME IN THE CODE (Jon, 2026-11-05). Since 2026-08-09 the operations
// manager was hardcoded on every brief; now `ops_brief.cc` (default empty) is copied on every brief,
// dropped for anyone already a named recipient so nobody is double-sent.
const ccList = (cfg: BriefCfg): string[] => (Array.isArray(cfg.cc) ? cfg.cc : []).map(x => String(x || '').trim().toLowerCase()).filter(x => /@/.test(x))
const ccFor = (cfg: BriefCfg, to: string[]): string[] => {
  const already = new Set(to.map(t => String(t || '').trim().toLowerCase()))
  return ccList(cfg).filter(c => !already.has(c))
}
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

// An ACTIVE Lighthouse member, not merely a Supabase login (2026-09-29): other apps' accounts share
// this Supabase project, and a bare session let them preview the GM brief, test-send, or re-send
// the whole team's brief.
async function currentUser(): Promise<string | null> {
  const g = await requireUser().catch(() => null)
  return g && g.ok && g.access.email ? String(g.access.email).toLowerCase() : null
}

const receipted = withRouteReceipt<NextRequest>('ops-brief', send, {
  skipWhen: (req) => { const sp = new URL(req.url).searchParams; return !!sp.get('preview') || !!sp.get('test') },
  count: (b) => Array.isArray(b?.results) ? b.results.filter((o: any) => o && o.sent).length : undefined,
})

// 7:01AM EASTERN ALL YEAR (2026-09-29). Vercel cron is UTC, so vercel.json fires this at 11:01 AND
// 12:01 UTC; on the scheduler's own call, the one that is not 7am in New York stops here — before
// the receipt, the passcode sweep or any send (lib/et-clock). A person's preview, test or re-send
// carries no bearer and is never skipped.
export async function GET(req: NextRequest) {
  if (cronAllowed(req).viaSecret && !atEasternHour(7)) return NextResponse.json({ ok: true, skipped: 'daylight-saving twin — this job runs at 7am Eastern' })
  return receipted(req)
}

async function send(req: NextRequest) {
  // ANONYMOUS CALLERS ARE NOT CRON (2026-09-02). This read `|| auth === ''`, and an anonymous
  // request sends no Authorization header — so `auth` IS '' and the clause was true for exactly the
  // caller it was meant to exclude. CRON_SECRET was not set at the time, so that branch
  // was the live one. Vercel's scheduler stamps `x-vercel-cron` on every call; that header is the
  // whole of the leniency it needs. Same shape as app/api/cron/suggestions.
  // 2026-09-29: the shared gate — a constant-time bearer compare, and no trust in the spoofable
  // x-vercel-cron header (a missing secret in production now means no scheduled send, not an open one).
  const isCron = cronAllowed(req).viaSecret
  const me = await currentUser()
  const sp = new URL(req.url).searchParams

  const cfg = await getSetting<BriefCfg>(OPS_BRIEF_KEY, {})
  const fromEmail = String(cfg.fromEmail || DEFAULT_FROM)

  // ---- preview: just the HTML, no send. Signed-in only (it contains guest names). ----
  const preview = sp.get('preview')
  if (preview) {
    if (!me) return NextResponse.json({ error: 'sign in to preview' }, { status: 401 })
    const vg = VENDOR_GROUPS.find(g => g.key === preview.toLowerCase())
    if (vg) {
      const vb = await buildVendorBrief(vg.key)
      return new NextResponse(vb.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    const pv = preview.toLowerCase()
    const lang = asLang(sp.get('lang') || '')
    if (pv === 'maint' || pv === 'maintenance') {
      const mb = await buildMaintenanceRun('all', lang)
      return new NextResponse(mb.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (pv.startsWith('maint:')) {
      const mb = await buildMaintenanceRun(preview.slice(6), lang)
      return new NextResponse(mb.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (pv === 'techs') return NextResponse.json({ techs: await maintenanceTechs(), configured: Object.keys(cfg.techs || {}) })
    const v = pv === 'ops' || pv === 'desk' ? 'full' : pv === 'field-miami' ? 'Miami' : pv === 'field-broward' ? 'Broward' : ALL_VARIANTS.find(x => x.toLowerCase() === pv) || 'full'
    // ?preview=gm is the GM morning, ?preview=full the Ops morning.
    // ?lang=es previews the Spanish copy without saving the setting.
    const b = await build(v, asLang(sp.get('lang') || langFor(cfg, v)))
    return new NextResponse(b.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  // ---- test: send every variant to the signed-in tester ONLY. ----
  if (sp.get('test')) {
    if (!me) return NextResponse.json({ error: 'sign in to test' }, { status: 401 })
    const out: any[] = []
    // ?test=1&only=GM sends just one variant — the GM morning is the slow one (KPI + labor engine).
    const only = String(sp.get('only') || '').toLowerCase()
    const pick = only ? ALL_VARIANTS.filter(v => v.toLowerCase() === only) : ALL_VARIANTS
    for (const v of pick) {
      const b = await build(v, langFor(cfg, v))
      const r = await sendGmail({ fromEmail, to: [me], subject: '[TEST] ' + b.subject, html: b.html })
      out.push({ variant: v, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
    }
    return NextResponse.json({ ok: out.every(o => o.sent), test: true, to: me, from: fromEmail, results: out })
  }

  // ---- the real morning send ----
  if (!isCron && !me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // A SIGNED-IN GET WITH NO PARAMETERS IS NOT A RE-SEND (Eve audit 2026-10-10). Opening this URL in
  // a browser sent every morning brief to every list again. A person re-sends on purpose: ?send=1
  // for everything, or ?only=Miami,GM for some. Previews and tests are unchanged.
  if (!isCron && !sp.get('send') && !sp.get('only')) {
    return NextResponse.json({ ok: false, error: 'Nothing sent. Add ?send=1 to re-send every brief to its list, or ?only=Miami,Broward,full,GM,maint for some. ?preview=gm (GM morning) or ?preview=full (Ops morning) shows one on screen; ?test=1 sends them all to you only.' }, { status: 400 })
  }
  // NO PLAINTEXT PASSCODE AT REST PAST THE FIRST MORNING (2026-09-18). Migration 101 carries a few
  // legacy cleartext passcodes into share_links; the hub hashes them on its first load, but nobody
  // may open /links for days. The daily brief is the one job that runs every morning regardless —
  // it does the same sweep here. Cheap once nothing is left; runs before the sends, never blocks them.
  try { await hashLegacyPasscodes() } catch { /* the next morning tries again */ }
  // THE WHOLE MORNING SYSTEM CAN BE OFF AND NOBODY IS TOLD (audit 2026-09-21). This returned a
  // cheerful 200 and every brief simply never arrived — indistinguishable from a quiet morning.
  // It is still allowed to be off; it is no longer allowed to be off silently.
  if (cfg.enabled !== true) {
    if (!sp.get('preview') && !sp.get('test')) {
      await sendGmail({
        fromEmail, to: [DEFAULT_FROM],
        subject: '⚠️ Morning briefs did not run — the system is switched off',
        html: '<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.7;color:#0b1220">No Field Runs, no Ops morning, no GM morning and no vendor briefs went out this morning: <b>Morning briefs</b> is switched off in /users → App settings.</p><p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#6b7280">Turn it on there and they resume tomorrow at 7:01am. This note is sent once a day while it is off.</p>',
      }).catch(() => null)
    }
    return NextResponse.json({ ok: true, skipped: 'ops_brief not enabled — turn it on in /users once recipients are set' })
  }
  const lists: { v: BriefVariant; to: string[] }[] = [
    { v: 'Miami', to: (cfg.miami || []).filter(Boolean) },
    { v: 'Broward', to: (cfg.broward || []).filter(Boolean) },
    { v: 'full', to: (cfg.full || []).filter(Boolean) },
  ]
  const out: any[] = []
  // A SIGNED-IN RESEND OF JUST SOME VARIANTS (Jon, 2026-09-07: "resend briefs" after the revamp):
  // ?only=Miami,Broward,full re-sends those to their real lists and leaves the vendor briefs
  // alone — outside companies should not get a duplicate because ours changed shape.
  const onlyList = String(sp.get('only') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
  const wanted = (v: string) => !onlyList.length || onlyList.includes(v.toLowerCase())
  // EACH VARIANT ON ITS OWN (robustness pass, 2026-08-24): build(v) used to run bare, so one
  // variant throwing — a daysheet hiccup, one bad row — 500'd the whole route and NO brief went
  // out that morning, silently. Now each build/send is isolated, and any failure is reported to
  // the owner below rather than swallowed. Never quiet-skip.
  for (const { v, to } of lists) {
    if (!wanted(v)) { out.push({ variant: v, skipped: 'not in ?only' }); continue }
    if (!to.length) { out.push({ variant: v, skipped: 'no recipients' }); continue }
    try {
      const b = await build(v, langFor(cfg, v))
      const r = await sendGmail({ fromEmail, to, cc: ccFor(cfg, to), subject: b.subject, html: b.html })
      out.push({ variant: v, to: to.length, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
    } catch (e: any) {
      out.push({ variant: v, to: to.length, sent: false, error: 'build failed: ' + String(e?.message || e) })
    }
  }
  // Maintenance Run — one email per technician, in that person's language; the combined run to `maint`.
  const techCfg = cfg.techs || {}
  for (const name of Object.keys(techCfg)) {
    const to = (techCfg[name]?.to || []).filter(Boolean)
    const key = 'maint:' + name
    if (onlyList.length && !wanted(key) && !wanted('maint')) { out.push({ variant: key, skipped: 'not in ?only' }); continue }
    if (!to.length) { out.push({ variant: key, skipped: 'no recipients' }); continue }
    try {
      const b = await buildMaintenanceRun(name, asLang(techCfg[name]?.lang))
      const r = await sendGmail({ fromEmail, to, cc: ccFor(cfg, to), subject: b.subject, html: b.html })
      out.push({ variant: key, to: to.length, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
    } catch (e: any) { out.push({ variant: key, to: to.length, sent: false, error: 'build failed: ' + String(e?.message || e) }) }
  }
  if (!onlyList.length || wanted('maint')) {
    const to = (cfg.maint || []).filter(Boolean)
    if (to.length) {
      try {
        const b = await buildMaintenanceRun('all', 'en')
        const r = await sendGmail({ fromEmail, to, cc: ccFor(cfg, to), subject: b.subject, html: b.html })
        out.push({ variant: 'maint', to: to.length, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
      } catch (e: any) { out.push({ variant: 'maint', to: to.length, sent: false, error: 'build failed: ' + String(e?.message || e) }) }
    }
  }
  // Vendor briefs — external companies, so each group only ever sees its own buildings.
  for (const g of VENDOR_GROUPS) {
    if (onlyList.length && !wanted('vendor:' + g.key) && !wanted(g.key)) { out.push({ variant: 'vendor:' + g.key, skipped: 'not in ?only' }); continue }
    const to = ((cfg.vendors || {})[g.key] || []).filter(Boolean)
    if (!to.length) { out.push({ variant: 'vendor:' + g.key, skipped: 'no recipients' }); continue }
    try {
      const b = await buildVendorBrief(g.key)
      const r = await sendGmail({ fromEmail, to, cc: ccFor(cfg, to), subject: b.subject, html: b.html })
      out.push({ variant: 'vendor:' + g.key, to: to.length, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
    } catch (e: any) {
      out.push({ variant: 'vendor:' + g.key, to: to.length, sent: false, error: 'build failed: ' + String(e?.message || e) })
    }
  }
  // GM MORNING LAST (Jon, 2026-11-05). It carries the labor engine now — the slowest build of the
  // morning — so it goes after every team and vendor brief: if the shared time budget runs out, it
  // is the owner's email that is late, not a crew's. When it lands with its Labor block, the 7:58
  // labor job is told, and its separate integrity email stays quiet (lib/briefs/labor-scorecard).
  if (wanted('GM')) {
    const to = (cfg.gm || []).filter(Boolean)
    if (!to.length) out.push({ variant: 'GM', skipped: 'no recipients' })
    else {
      try {
        const b = await buildGmMorning()
        const r = await sendGmail({ fromEmail, to, cc: ccFor(cfg, to), subject: b.subject, html: b.html })
        out.push({ variant: 'GM', to: to.length, subject: b.subject, counts: b.counts, labor: b.labor, sent: r.ok, error: r.error })
        if (r.ok && b.labor !== 'timeout') await markLaborDelivered(etToday(), b.labor)
      } catch (e: any) { out.push({ variant: 'GM', to: to.length, sent: false, error: 'build failed: ' + String(e?.message || e) }) }
    }
  } else out.push({ variant: 'GM', skipped: 'not in ?only' })
  // ANY FAILURE GETS A NOTE TO THE OWNER — a brief that didn't arrive looks identical to a quiet
  // morning, so the silence itself is reported. One short email listing what failed and why.
  // A BRIEF WITH NOBODY ON IT IS NOT A SKIP, IT IS A BRIEF THAT DID NOT ARRIVE (audit 2026-09-21).
  // 'no recipients' used to be excluded from this alert, so a list someone emptied by accident —
  // or never filled, which is how Salato and the vendor briefs sat dark — raised nothing at all.
  // '?only' is a deliberate human choice and stays quiet.
  const failed = out.filter(o => (!o.skipped && !o.sent) || o.skipped === 'no recipients')
  if (failed.length) {
    const esc2 = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    await sendGmail({
      fromEmail, to: [DEFAULT_FROM], cc: ccFor(cfg, [DEFAULT_FROM]),
      subject: `⚠️ Morning briefs: ${failed.length} of ${out.filter(o => o.skipped !== 'not in ?only').length} did not send`,
      html: '<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.7;color:#0b1220">' +
        'These briefs did not go out this morning:</p><ul style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;line-height:1.7;color:#374151">' +
        failed.map(f => '<li><b>' + esc2(f.variant) + '</b> &mdash; ' + esc2(f.error || (f.skipped === 'no recipients' ? 'nobody is on this list — add recipients in /users → App settings' : 'unknown error')) + '</li>').join('') +
        '</ul><p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#6b7280">Any brief not listed above sent normally. They will all run again tomorrow morning.</p>',
    }).catch(() => null)
  }
  // THE REVIEW WATERMARK. Stamped only after a real send, so tomorrow's brief starts where this
  // one stopped and nobody reads the same review twice. Previews and tests never move it.
  if (out.some(o => o.sent)) {
    await setSetting('ops_brief_reviews_seen', new Date().toISOString(), 'cron').catch(() => null)
  }
  return NextResponse.json({ ok: out.every(o => o.sent || o.skipped), from: fromEmail, results: out })
}
