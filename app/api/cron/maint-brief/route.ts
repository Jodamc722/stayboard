// THE MAINTENANCE BRIEF — one email per market, 7:46am ET (Jon, 2026-08-25: "we should have
// maintenance brief for broward and Miami").
//
// This route was a 410 stub between 2026-08-22 and 2026-08-25, when the two standalone emails
// were folded into Ops Command. Jon has asked for them back for the crews and their supervisors;
// Ops Command KEEPS its two-market summary card (his call), because that card is the ops
// manager's altitude and this email is the market's worklist.
//
//   GET                          → send both markets to their recipient lists
//   GET ?preview=Miami|Broward   → signed-in only: the HTML, no send, nothing stored
//   GET ?test=1                  → signed-in only: send both markets to YOU alone
//
// Recipients live under the SAME app_settings key as every other brief ('ops_brief'), in its
// `maint` sub-object — so /users → App settings → Morning briefs stays the one place recipients
// are edited. NEVER QUIET-SKIP: with no list saved the brief goes to the owner rather than
// nowhere, which is exactly the bug that hid these emails for weeks the first time round.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getSetting } from '@/lib/app-settings'
import { buildMaintBrief } from '@/lib/maint-email'
import type { MaintMarket } from '@/lib/maint-brief'
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const OPS_BRIEF_KEY = 'ops_brief'
const OWNER = 'jon@stay-hospitality.com'
// Standing CC (Jon, 2026-08-09): the operations manager sees every brief that reaches a crew.
const STANDING_CC = ['roberto@stay-hospitality.com']
type Cfg = { fromEmail?: string; maint?: { enabled?: boolean; miamiTo?: string[]; browardTo?: string[] } }

const clean = (list: any): string[] => {
  const seen = new Set<string>(); const out: string[] = []
  for (const x of (Array.isArray(list) ? list : [])) {
    const e = String(x || '').trim().toLowerCase()
    if (e && /@/.test(e) && !seen.has(e)) { seen.add(e); out.push(e) }
  }
  return out
}
const ccFor = (to: string[]) => {
  const already = new Set(to.map(t => t.toLowerCase()))
  return STANDING_CC.filter(c => !already.has(c.toLowerCase()))
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const preview = String(sp.get('preview') || '')
  const test = sp.get('test') === '1'
  let me: string | null = null
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    me = user?.email ? String(user.email).toLowerCase() : null
  } catch { me = null }

  const cfg = await getSetting<Cfg>(OPS_BRIEF_KEY, {}).catch(() => ({} as Cfg))
  const fromEmail = String(cfg.fromEmail || OWNER)
  const MARKETS: { market: MaintMarket; to: string[] }[] = [
    { market: 'Miami', to: clean(cfg.maint?.miamiTo) },
    { market: 'Broward', to: clean(cfg.maint?.browardTo) },
  ]

  // ---- preview: the HTML only. Signed-in, because it names units and guests' situations.
  if (preview) {
    if (!me) return NextResponse.json({ error: 'sign in to preview' }, { status: 401 })
    const m: MaintMarket = /broward/i.test(preview) ? 'Broward' : 'Miami'
    const b = await buildMaintBrief(m)
    return new NextResponse(b.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  // ---- test: both markets, to the tester alone.
  if (test) {
    if (!me) return NextResponse.json({ error: 'sign in to test' }, { status: 401 })
    const out: any[] = []
    for (const { market } of MARKETS) {
      try {
        const b = await buildMaintBrief(market)
        const r = await sendGmail({ fromEmail, to: [me], subject: '[TEST] ' + b.subject, html: b.html })
        out.push({ market, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
      } catch (e: any) { out.push({ market, sent: false, error: String(e?.message || e) }) }
    }
    return NextResponse.json({ ok: out.every(o => o.sent), test: true, to: me, results: out })
  }

  // ---- the real morning send. OFF MEANS OFF, but off is a deliberate setting, not an empty list.
  if (cfg.maint?.enabled === false) {
    return NextResponse.json({ ok: true, sent: false, reason: 'maintenance briefs switched off in settings' })
  }
  const out: any[] = []
  // EACH MARKET ON ITS OWN — one market failing must never take the other's email down.
  for (const { market, to } of MARKETS) {
    const list = to.length ? to : [OWNER]
    try {
      const b = await buildMaintBrief(market)
      const r = await sendGmail({ fromEmail, to: list, cc: ccFor(list), subject: b.subject, html: b.html })
      out.push({ market, to: list.length, defaulted: !to.length, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
    } catch (e: any) {
      out.push({ market, to: list.length, sent: false, error: 'build failed: ' + String(e?.message || e) })
    }
  }
  // A brief that did not arrive looks exactly like a quiet morning — so say so.
  const failed = out.filter(o => !o.sent)
  if (failed.length) {
    await sendGmail({
      fromEmail, to: [OWNER],
      subject: `⚠️ Maintenance briefs: ${failed.length} of ${out.length} did not send`,
      html: '<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.7">' +
        failed.map(f => `<b>${f.market}</b> — ${String(f.error || 'unknown error').replace(/</g, '&lt;')}`).join('<br>') +
        '</p><p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#6b7280">They run again tomorrow morning.</p>',
    }).catch(() => null)
  }
  return NextResponse.json({ ok: out.every(o => o.sent), from: fromEmail, results: out })
}
