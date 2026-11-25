// THE BRIEFS PAGE (lib/brief-plans; Jon, 2026-11-25). Gated by the `briefs` key: view reads, edit changes and sends.
//   GET  ?plan=broward|miami|north|care → the plan as it stands now with today's edits marked on it, the edits, the settings
//   POST { plan, op, … } (edit):
//     note { text } · add { text } · remove { id } · hide { id } · show { id }   → today's edits for that plan
//     to { emails } · auto { on }                                               → who gets it, and whether it sends itself at 7
//     test                                                                       → emails it to you only
//     send                                                                       → emails it to the plan's list now
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { buildPlan, readEdits, saveEdits, readPlanSettings, savePlanSettings, sendPlan } from '@/lib/brief-plans'
import { applyEdits, isPlanKey, parseEmails, type PlanKey } from '@/lib/brief-plan-rules'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const nameOf = (a: any) => String(a?.name || '').trim().split(/\s+/)[0] || String(a?.email || '').split('@')[0].replace(/^./, c => c.toUpperCase()) || 'The team'

export async function GET(req: NextRequest) {
  const g = await requireLevel('briefs', 'view')
  if (!g.ok) return g.res
  const key = req.nextUrl.searchParams.get('plan')
  if (!isPlanKey(key)) return NextResponse.json({ ok: false, error: 'Unknown plan.' }, { status: 400 })
  try {
    const [raw, settings] = await Promise.all([buildPlan(key), readPlanSettings()])
    const edits = await readEdits(key, raw.day)
    return NextResponse.json({ ok: true, plan: applyEdits(raw, edits, false), edits, settings: settings[key], me: String((g as any).access?.email || '') })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('briefs', 'edit')
  if (!g.ok) return g.res
  const access: any = (g as any).access || {}
  const who = String(access.email || '') || 'briefs'
  try {
    const b: any = await req.json().catch(() => ({}))
    if (!isPlanKey(b.plan)) return NextResponse.json({ ok: false, error: 'Unknown plan.' }, { status: 400 })
    const key: PlanKey = b.plan, op = String(b.op || '')
    if (op === 'to' || op === 'auto') {
      const s = await readPlanSettings()
      if (op === 'to') s[key] = { ...s[key], to: parseEmails(b.emails) }
      else s[key] = { ...s[key], auto: !!b.on }
      if (s[key].auto && !s[key].to.length) return NextResponse.json({ ok: false, error: 'Add who it goes to before turning it on.' }, { status: 400 })
      const r = await savePlanSettings(s, who)
      return NextResponse.json(r.ok ? { ok: true, settings: s[key] } : r, { status: r.ok ? 200 : 500 })
    }
    if (op === 'test') { if (!/@/.test(who)) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }); return NextResponse.json(await sendPlan(key, [who], who, { test: true })) }
    if (op === 'send') { const s = await readPlanSettings(); const r = await sendPlan(key, s[key].to, who, { record: true }); return NextResponse.json(r, { status: r.ok ? 200 : 400 }) }
    const day = today()
    const e = await readEdits(key, day)
    const id = String(b.id || '')
    if (op === 'note') { e.note = String(b.text || '').slice(0, 1200).trim(); e.noteBy = e.note ? nameOf(access) : '' }
    else if (op === 'add') { const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 300); if (!text) return NextResponse.json({ ok: false, error: 'Write the line first.' }, { status: 400 }); e.extra = [...e.extra, { id: 'x' + Date.now().toString(36), text, by: nameOf(access) }].slice(0, 20) }
    else if (op === 'remove') e.extra = e.extra.filter(x => x.id !== id)
    else if (op === 'hide') { if (id && e.hidden.indexOf(id) < 0) e.hidden = [...e.hidden, id] }
    else if (op === 'show') e.hidden = e.hidden.filter(x => x !== id)
    else return NextResponse.json({ ok: false, error: 'Unknown request.' }, { status: 400 })
    const r = await saveEdits(key, e, who)
    return NextResponse.json(r.ok ? { ok: true, edits: e } : r, { status: r.ok ? 200 : 500 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
