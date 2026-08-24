// SUNDAY EVENING: post next week's planner to the team, one message per market.
//
// Goes through the SAME approval outbox as every other staff-facing alert — nothing reaches the
// crew until it is approved, and the event starts disabled so turning it on is a decision Jon makes
// in settings rather than something that surprises everyone one Sunday.
import { NextRequest, NextResponse } from 'next/server'
import { buildPlannerPosts } from '@/lib/slack-planner'
import { getSlackRules } from '@/lib/slack-rules'
import { draft } from '@/lib/slack-queue'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    if (auth !== 'Bearer ' + secret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const started = Date.now()
  try {
    const rules = await getSlackRules()
    const rule = rules.events.weekly_planner
    if (!rule || !rule.enabled) {
      return NextResponse.json({ ok: true, skipped: 'weekly_planner is switched off in settings', elapsed_ms: Date.now() - started })
    }
    const weekStart = (new URL(req.url).searchParams.get('weekStart') || '').slice(0, 10) || undefined
    // Both trades, each market, each to the channel that trade already lives in.
    const posts = (await buildPlannerPosts(weekStart, rules, 'cleaning'))
      .concat(await buildPlannerPosts(weekStart, rules, 'maintenance'))
    const results: any[] = []
    for (const p of posts) {
      const r = await draft({
        eventKey: 'weekly_planner',
        groupKey: p.groupKey,
        building: p.market,
        channelId: p.channelId,
        body: p.body,
        threadBody: p.threadBody,
        summary: p.summary,
        itemCount: p.people,
      }, rules)
      results.push({ market: p.market, dept: p.dept, channel: p.channelId, people: p.people, cleans: p.cleans, ...r })
    }
    return NextResponse.json({ ok: true, posts: results.length, results, elapsed_ms: Date.now() - started })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
