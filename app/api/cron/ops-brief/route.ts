// Morning Ops Brief — cron sender + on-demand preview/test.
//
//   GET  (cron, or signed-in)          → send all enabled variants to their recipient lists
//   GET ?preview=Miami|Broward|full    → signed-in only: return the HTML so you can look at it
//   GET ?test=1                        → signed-in only: send every variant to YOU alone
//
// Recipients and the sender live in app_settings key 'ops_brief' (owner-editable on /users):
//   { enabled: boolean, fromEmail: string, miami: string[], broward: string[], full: string[] }
// SAFE BY DEFAULT: until recipients are configured, nothing sends to anyone but the tester.
// Auth mirrors the other crons: CRON_SECRET bearer when set; a plain cron send may run without it.
import { NextRequest, NextResponse } from 'next/server'
import { setSetting } from '@/lib/app-settings'
import { createClient } from '@/lib/supabase-server'
import { getSetting } from '@/lib/app-settings'
import { buildOpsBrief, buildGmBrief, buildVendorBrief, VENDOR_GROUPS, type BriefVariant, type VendorGroup } from '@/lib/ops-brief'
import { asLang, type BriefLang } from '@/lib/brief-lang'
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const OPS_BRIEF_KEY = 'ops_brief'
type BriefCfg = {
  enabled?: boolean; fromEmail?: string; miami?: string[]; broward?: string[]; full?: string[]; gm?: string[]
  vendors?: Partial<Record<VendorGroup, string[]>>
  // THE CREW'S LANGUAGE, PER BRIEF (Jon, 2026-08-25). Only the field day sheets take one — Ops
  // Command and the GM brief are management documents and stay English.
  lang?: { miami?: string; broward?: string }
}

// One builder for every variant, so preview / test / cron can never drift apart.
const build = (v: BriefVariant, lang: BriefLang = 'en') => v === 'GM' ? buildGmBrief() : buildOpsBrief(v, lang)
const langFor = (cfg: BriefCfg, v: BriefVariant): BriefLang =>
  v === 'Miami' ? asLang(cfg.lang?.miami) : v === 'Broward' ? asLang(cfg.lang?.broward) : 'en'
const ALL_VARIANTS: BriefVariant[] = ['Miami', 'Broward', 'full', 'GM']

const DEFAULT_FROM = 'jon@stay-hospitality.com'
// STANDING CC (Jon, 2026-08-09): the operations manager sees every brief that goes out — team,
// leadership and vendor alike — so nothing reaches a crew or an outside company that he has not
// also received. Dropped automatically when he is already a named recipient, so he is never
// double-sent, and configurable in one place rather than sprinkled through each send.
const STANDING_CC = ['roberto@stay-hospitality.com']
const ccFor = (to: string[]): string[] => {
  const already = new Set(to.map(t => String(t || '').trim().toLowerCase()))
  return STANDING_CC.filter(c => !already.has(c.toLowerCase()))
}

async function currentUser(): Promise<string | null> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return user?.email ? String(user.email).toLowerCase() : null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  // ANONYMOUS CALLERS ARE NOT CRON (2026-09-02). This read `|| auth === ''`, and an anonymous
  // request sends no Authorization header — so `auth` IS '' and the clause was true for exactly the
  // caller it was meant to exclude. CRON_SECRET has never been set on this project, so that branch
  // was the live one. Vercel's scheduler stamps `x-vercel-cron` on every call; that header is the
  // whole of the leniency it needs. Same shape as app/api/cron/suggestions.
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron')
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
    const v = ALL_VARIANTS.find(x => x.toLowerCase() === preview.toLowerCase()) || 'full'
    // ?lang=es previews the Spanish copy without saving the setting.
    const b = await build(v, asLang(sp.get('lang') || langFor(cfg, v)))
    return new NextResponse(b.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  // ---- test: send every variant to the signed-in tester ONLY. ----
  if (sp.get('test')) {
    if (!me) return NextResponse.json({ error: 'sign in to test' }, { status: 401 })
    const out: any[] = []
    // ?test=1&only=GM sends just one variant — the GM brief is the slow one (full KPI pass).
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
  if (cfg.enabled !== true) {
    return NextResponse.json({ ok: true, skipped: 'ops_brief not enabled — turn it on in /users once recipients are set' })
  }
  const lists: { v: BriefVariant; to: string[] }[] = [
    { v: 'Miami', to: (cfg.miami || []).filter(Boolean) },
    { v: 'Broward', to: (cfg.broward || []).filter(Boolean) },
    { v: 'full', to: (cfg.full || []).filter(Boolean) },
    { v: 'GM', to: (cfg.gm || []).filter(Boolean) },
  ]
  const out: any[] = []
  // EACH VARIANT ON ITS OWN (robustness pass, 2026-08-24): build(v) used to run bare, so one
  // variant throwing — a daysheet hiccup, one bad row — 500'd the whole route and NO brief went
  // out that morning, silently. Now each build/send is isolated, and any failure is reported to
  // the owner below rather than swallowed. Never quiet-skip.
  for (const { v, to } of lists) {
    if (!to.length) { out.push({ variant: v, skipped: 'no recipients' }); continue }
    try {
      const b = await build(v, langFor(cfg, v))
      const r = await sendGmail({ fromEmail, to, cc: ccFor(to), subject: b.subject, html: b.html })
      out.push({ variant: v, to: to.length, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
    } catch (e: any) {
      out.push({ variant: v, to: to.length, sent: false, error: 'build failed: ' + String(e?.message || e) })
    }
  }
  // Vendor briefs — external companies, so each group only ever sees its own buildings.
  for (const g of VENDOR_GROUPS) {
    const to = ((cfg.vendors || {})[g.key] || []).filter(Boolean)
    if (!to.length) { out.push({ variant: 'vendor:' + g.key, skipped: 'no recipients' }); continue }
    try {
      const b = await buildVendorBrief(g.key)
      const r = await sendGmail({ fromEmail, to, cc: ccFor(to), subject: b.subject, html: b.html })
      out.push({ variant: 'vendor:' + g.key, to: to.length, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
    } catch (e: any) {
      out.push({ variant: 'vendor:' + g.key, to: to.length, sent: false, error: 'build failed: ' + String(e?.message || e) })
    }
  }
  // ANY FAILURE GETS A NOTE TO THE OWNER — a brief that didn't arrive looks identical to a quiet
  // morning, so the silence itself is reported. One short email listing what failed and why.
  const failed = out.filter(o => !o.skipped && !o.sent)
  if (failed.length) {
    const esc2 = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    await sendGmail({
      fromEmail, to: [DEFAULT_FROM], cc: ccFor([DEFAULT_FROM]),
      subject: `⚠️ Morning briefs: ${failed.length} of ${out.filter(o => !o.skipped).length} did not send`,
      html: '<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.7;color:#0b1220">' +
        'These briefs did not go out this morning:</p><ul style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;line-height:1.7;color:#374151">' +
        failed.map(f => '<li><b>' + esc2(f.variant) + '</b> &mdash; ' + esc2(f.error || 'unknown error') + '</li>').join('') +
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
