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
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const OPS_BRIEF_KEY = 'ops_brief'
type BriefCfg = { enabled?: boolean; fromEmail?: string; miami?: string[]; broward?: string[]; full?: string[]; gm?: string[]; vendors?: Partial<Record<VendorGroup, string[]>> }

// One builder for every variant, so preview / test / cron can never drift apart.
const build = (v: BriefVariant) => v === 'GM' ? buildGmBrief() : buildOpsBrief(v)
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
  const isCron = secret ? auth === 'Bearer ' + secret : !!req.headers.get('x-vercel-cron') || auth === ''
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
    const b = await build(v)
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
      const b = await build(v)
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
  for (const { v, to } of lists) {
    if (!to.length) { out.push({ variant: v, skipped: 'no recipients' }); continue }
    const b = await build(v)
    const r = await sendGmail({ fromEmail, to, cc: ccFor(to), subject: b.subject, html: b.html })
    out.push({ variant: v, to: to.length, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
  }
  // Vendor briefs — external companies, so each group only ever sees its own buildings.
  for (const g of VENDOR_GROUPS) {
    const to = ((cfg.vendors || {})[g.key] || []).filter(Boolean)
    if (!to.length) { out.push({ variant: 'vendor:' + g.key, skipped: 'no recipients' }); continue }
    const b = await buildVendorBrief(g.key)
    const r = await sendGmail({ fromEmail, to, cc: ccFor(to), subject: b.subject, html: b.html })
    out.push({ variant: 'vendor:' + g.key, to: to.length, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
  }
  // THE REVIEW WATERMARK. Stamped only after a real send, so tomorrow's brief starts where this
  // one stopped and nobody reads the same review twice. Previews and tests never move it.
  if (out.some(o => o.sent)) {
    await setSetting('ops_brief_reviews_seen', new Date().toISOString(), 'cron').catch(() => null)
  }
  return NextResponse.json({ ok: out.every(o => o.sent || o.skipped), from: fromEmail, results: out })
}
