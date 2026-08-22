// MAINTENANCE BRIEF — ONE PER MARKET (Jon, 2026-08-20: "1 for broward, 1 for Miami. 17west
// should be seperate breif, as i will explain later").
//
// Two independent emails a morning — Miami's maintenance picture and Broward's — each built by
// lib/maint-brief.ts: task completion vs plan, carryover (scheduled but not finished), open
// glitches, vacant units worth preventive attention, recurring-issue units, and billable labor
// for yesterday / 7 days / 30 days priced EXACTLY like the invoices and the labor engine.
// 17 WEST is excluded from both (its own brief comes later, per Jon), and vendor-cleaned
// buildings never appear.
//
// GET                     → cron: send each market's brief to its configured list
// GET ?preview=miami      → return that market's HTML without sending (signed in)
// GET ?preview=broward    → same for Broward
// GET ?test=1             → send BOTH briefs to the signed-in user only
// GET ?force=1            → cron path but ignore the enabled flag
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getSetting } from '@/lib/app-settings'
import { buildMaintBrief, MaintMarket } from '@/lib/maint-brief'
import { sendGmail } from '@/lib/gmail-send'

export const dynamic = 'force-dynamic'
// No labor-engine runs in here (billable comes straight from Breezeway rows, wages from two
// cached Homebase windows), so this is far lighter than the labor email — but leave headroom.
export const maxDuration = 300

type Cfg = {
  enabled?: boolean
  fromEmail?: string
  miamiTo?: string[]
  browardTo?: string[]
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const previewMarket = (sp.get('preview') || '').toLowerCase()
  const test = sp.get('test') === '1'
  const force = sp.get('force') === '1'
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if ((previewMarket || test) && !user) return NextResponse.json({ error: 'sign in' }, { status: 401 })

    if (previewMarket) {
      const market: MaintMarket = previewMarket === 'broward' ? 'Broward' : 'Miami'
      const b = await buildMaintBrief(market)
      return new NextResponse(b.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }

    const cfg = await getSetting<Cfg>('maint_brief', {}).catch(() => ({} as Cfg))
    // Sender falls back to the main brief's, so this works the morning it ships without
    // touching settings. jon@ is the house default for everything but front-office notices.
    const ops = await getSetting<{ fromEmail?: string }>('ops_brief', {}).catch(() => ({} as any))
    const fromEmail = cfg?.fromEmail || ops?.fromEmail || 'jon@stay-hospitality.com'

    if (test) {
      const who = user?.email || ''
      if (!who) return NextResponse.json({ ok: false, error: 'no signed-in address' })
      const out: any[] = []
      for (const market of ['Miami', 'Broward'] as MaintMarket[]) {
        const b = await buildMaintBrief(market)
        const r = await sendGmail({ fromEmail, to: [who], subject: '[TEST] ' + b.subject, html: b.html })
        out.push({ market, sent: !!r?.ok, subject: b.subject, counts: b.counts })
      }
      return NextResponse.json({ ok: true, test: true, to: who, briefs: out })
    }

    // ── cron path: one email per market, each to its own list ─────────────
    if (cfg?.enabled === false && !force) {
      return NextResponse.json({ ok: true, sent: false, reason: 'disabled in settings' })
    }
    // DEFAULTS ON, TO THE OWNER (2026-08-22). This brief shipped 08-20 with empty recipient
    // lists and silently skipped every morning — Jon: "don't see maintenance one going out yet."
    // Same rule as the Daily Labor email: until a list is saved in /users, it goes to the owner
    // alone rather than silently nowhere. A saved list replaces the default.
    const OWNER = 'jon@stay-hospitality.com'
    const lists: Array<{ market: MaintMarket; to: string[]; defaulted?: boolean }> = [
      { market: 'Miami', to: (cfg?.miamiTo || []).filter(Boolean) },
      { market: 'Broward', to: (cfg?.browardTo || []).filter(Boolean) },
    ]
    for (const l of lists) if (!l.to.length) { l.to = [OWNER]; l.defaulted = true }
    const out: any[] = []
    for (const { market, to, defaulted } of lists) {
      // SEQUENTIAL on purpose — both markets share the same Homebase/Supabase upstreams and the
      // second build rides the first one's caches.
      const b = await buildMaintBrief(market)
      const r = await sendGmail({ fromEmail, to, subject: b.subject, html: b.html })
      out.push({ market, sent: !!r?.ok, to, defaulted: !!defaulted, subject: b.subject, counts: b.counts })
    }
    return NextResponse.json({ ok: true, briefs: out })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
