// THE MAINTENANCE BRIEF — RETIRED 2026-09-09. It no longer sends.
//
// Jon: "duplicate info, not clean and to the point", then, asked how hard to cut: fold maintenance
// in. Maintenance was being told three times before 8am — on the market day sheet by technician, in
// Ops Command as a two-market table, and again here 45 minutes later — and this email's own
// worklist, vacant units and recurring-unit lines all had a copy in one of the other two.
//
// Everything it carried now renders inside the day sheets: the maintenance table is on each market
// sheet for its own market, the carryover worklist is the Review card (which also says the next day
// each unit is empty), and vacant units come from the same vacantWork engine either way.
//
// THE ROUTE STAYS, ANSWERING HONESTLY. A Vercel cron still points at it, and the ?preview= and
// ?test= paths are how anyone checks what this used to look like — but the morning send is gone.
//
// WORTH KNOWING: the recipient list saved in the UI never reached this route. Settings wrote it to
// app_settings['maint_brief'] and read it back from there, so the card looked right, while the send
// read cfg.maint on 'ops_brief' — a key nothing ever wrote. So `to` was always empty, both emails
// went to the owner alone, CC Roberto, and `maint.enabled === false` could never be true either:
// the off switch did not work. Nobody on that saved list has been receiving these.
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
import { asLang, type BriefLang } from '@/lib/brief-lang'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const OPS_BRIEF_KEY = 'ops_brief'
const OWNER = 'jon@stay-hospitality.com'
type Cfg = { fromEmail?: string; maint?: { enabled?: boolean; miamiTo?: string[]; browardTo?: string[]; miamiLang?: string; browardLang?: string } }

const clean = (list: any): string[] => {
  const seen = new Set<string>(); const out: string[] = []
  for (const x of (Array.isArray(list) ? list : [])) {
    const e = String(x || '').trim().toLowerCase()
    if (e && /@/.test(e) && !seen.has(e)) { seen.add(e); out.push(e) }
  }
  return out
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
  const MARKETS: { market: MaintMarket; to: string[]; lang: BriefLang }[] = [
    { market: 'Miami', to: clean(cfg.maint?.miamiTo), lang: asLang(cfg.maint?.miamiLang) },
    { market: 'Broward', to: clean(cfg.maint?.browardTo), lang: asLang(cfg.maint?.browardLang) },
  ]

  // ---- preview: the HTML only. Signed-in, because it names units and guests' situations.
  if (preview) {
    if (!me) return NextResponse.json({ error: 'sign in to preview' }, { status: 401 })
    const m: MaintMarket = /broward/i.test(preview) ? 'Broward' : 'Miami'
    // ?lang=es previews the Spanish copy without saving the setting.
    const b = await buildMaintBrief(m, asLang(sp.get('lang') || MARKETS.find(x => x.market === m)?.lang))
    return new NextResponse(b.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  // ---- test: both markets, to the tester alone.
  if (test) {
    if (!me) return NextResponse.json({ error: 'sign in to test' }, { status: 401 })
    const out: any[] = []
    for (const { market, lang } of MARKETS) {
      try {
        const b = await buildMaintBrief(market, lang)
        const r = await sendGmail({ fromEmail, to: [me], subject: '[TEST] ' + b.subject, html: b.html })
        out.push({ market, subject: b.subject, counts: b.counts, sent: r.ok, error: r.error })
      } catch (e: any) { out.push({ market, sent: false, error: String(e?.message || e) }) }
    }
    return NextResponse.json({ ok: out.every(o => o.sent), test: true, to: me, results: out })
  }

  // ---- the morning send is retired. The cron still fires; it just has nothing to send.
  return NextResponse.json({
    ok: true, sent: false,
    reason: 'retired 2026-09-09 — maintenance is now inside the market day sheets and Ops Command',
    where: 'Miami / Broward day sheets carry their own maintenance table; carryover is named in the Review card with the day each unit is next empty',
  })
}
