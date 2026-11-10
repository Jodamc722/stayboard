// THE NEXT-WEEK PLAN for the Scheduler's "Next 7 days" panel (components/ScheduleNextWeek.tsx) and
// the knowledge browser's "How we schedule" card. Read-only.
//
// GET ?days=7&market=Broward&from=YYYY-MM-DD → lib/forecast/plan buildNextWeekPlan (cached 10 min)
// GET ?profile=1                           → the how-we-schedule profile lines from the cached
//                                            picture (never rebuilt here — it is a 90-day read),
//                                            plus the short list of missing FAQ answers
// Hours and people only; no dollar figure leaves this route.
import { NextRequest, NextResponse } from 'next/server'
import { requireVrUser } from '@/lib/vr-gate'
import { getSetting } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const gate = await requireVrUser()
  if (!gate.ok) return gate.res
  const sp = new URL(req.url).searchParams
  try {
    if (sp.get('profile') === '1') {
      const { KNOWLEDGE_KEY, scheduleProfile } = await import('@/lib/eve/schedule-knowledge')
      const { listFaqGaps, faqGapLine } = await import('@/lib/eve/faq-gaps')
      const [k, gaps] = await Promise.all([getSetting<any>(KNOWLEDGE_KEY, null), listFaqGaps(10)])
      const faqGaps = gaps.map(faqGapLine)
      if (!k || !Array.isArray(k.facts)) return NextResponse.json({ ok: true, learned: false, lines: [], faqGaps, note: 'Not learned yet — the picture is rebuilt by the evening schedule check.' })
      return NextResponse.json({ ok: true, learned: true, asOf: k.asOf || null, from: k.from || null, to: k.to || null, cleansRead: Number(k.cleansRead) || 0, lines: scheduleProfile(k), faqGaps })
    }
    const { buildNextWeekPlan } = await import('@/lib/forecast/plan')
    const plan = await buildNextWeekPlan({ from: sp.get('from') || undefined, days: Number(sp.get('days')) || 7, market: sp.get('market') || null })
    return NextResponse.json(plan)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
