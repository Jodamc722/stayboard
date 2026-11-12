// THE FREE TOOLS, PUBLIC (lib/free-tools). Anyone can run a calculator and see its headline; the full
// quote comes back only with an email, which is kept with the need-list leads (Onboarding → Starter
// kits) and sent to Nick as a notification. No account, no cookie; a honeypot and a per-address limit
// keep bots out.
import { NextRequest, NextResponse } from 'next/server'
import { toolKeyOf, cleanInput, TOOL_META, type IncomeFull, type InventoryFull } from '@/lib/free-tools'
import { runTool, summaryOf } from '@/lib/free-tools-server'
import { addLead, EMAIL_RE } from '@/lib/need-list-leads'
import { notify } from '@/lib/notify'
import { STAY_CONTACT } from '@/lib/need-list-contact'

export const dynamic = 'force-dynamic'

const hits = new Map<string, number[]>()
function limited(ip: string): boolean {
  const now = Date.now(), win = hits.get(ip)?.filter(t => now - t < 60_000) || []
  win.push(now); hits.set(ip, win)
  if (hits.size > 5000) hits.clear()
  return win.length > 40
}
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'x'
  if (limited(ip)) return NextResponse.json({ ok: false, error: 'Too many tries. Wait a minute and try again.' }, { status: 429, headers: NO_STORE })
  const b = await req.json().catch(() => ({}))
  const tool = toolKeyOf(b?.tool)
  if (!tool) return NextResponse.json({ ok: false, error: 'Unknown tool.' }, { status: 400, headers: NO_STORE })
  const input = cleanInput(tool, b?.input)
  const email = String(b?.email || '').trim().toLowerCase()
  const full = await runTool(tool, input, { light: !email })
  const summary = summaryOf(tool, full)
  if (!email) return NextResponse.json({ ok: true, summary }, { headers: NO_STORE })
  if (b?.website) return NextResponse.json({ ok: true, summary }, { headers: NO_STORE })   // a filled honeypot is a bot
  if (!EMAIL_RE.test(email)) return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400, headers: NO_STORE })

  const ref = String(b?.ref || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)
  const where = String(b?.where || '').replace(/\s+/g, ' ').slice(0, 80)
  const ii: any = input
  const homes = tool === 'income' ? [ii.building, ii.address, (ii.bedrooms === 0 ? 'Studio' : ii.bedrooms + ' BR'), ii.sqft ? ii.sqft + ' SF' : '', ii.view !== 'none' ? ii.view + ' view' : ''].filter(Boolean).join(' · ')
    : (full as InventoryFull).describe
  // A change after unlocking recomputes the same lead's quote; it is not a new lead and no new bell.
  // The percentages behind an estimate stay with the team (Jon, 2026-11-12: "the percentage increase
  // should not show… it should just increase"): the public answer carries the adjusted range only.
  const out: any = tool === 'income' ? { ...full, adjustments: [], adjTotal: 0, baseLo: 0, baseHi: 0 } : full
  if (b?.refresh) return NextResponse.json({ ok: true, summary, full: out }, { headers: NO_STORE })
  const saved = await addLead({ email, name: b?.name, phone: b?.phone, homes: TOOL_META[tool].short + ': ' + homes, units: 1, source: ['Free tool', TOOL_META[tool].short, where, ref ? '/r/' + ref : ''].filter(Boolean).join(' · ') })
  if (!saved.ok) return NextResponse.json(saved, { status: 400, headers: NO_STORE })
  try {
    const nick = STAY_CONTACT.person?.email
    if (nick) await notify([nick], { kind: 'tool_lead', title: `New lead: ${String(b?.name || email).slice(0, 60)} used the ${TOOL_META[tool].short.toLowerCase()}`, body: homes + (where ? ' · from ' + where : ''), link: '/sales' })
  } catch { /* the lead is saved; the bell is a courtesy */ }
  return NextResponse.json({ ok: true, summary, full: out }, { headers: NO_STORE })
}
