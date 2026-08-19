// TEST BENCH — Jon, 2026-08-19: "lets do some tests in my dms".
//
// Builds the real messages off live data and DMs them to one person instead of posting them into
// the field channels. Nothing here touches the outbox, the cooldowns or the quiet-hour windows,
// so you can fire it as many times as you like while the wording is still being argued about.
//
// The English body is the message. The Spanish copy goes in the thread underneath it, exactly the
// way it will appear in a channel.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { getSlackRules, JON_SLACK_ID } from '@/lib/slack-rules'
import { dmUser, postThreadReply, botConnected } from '@/lib/slack'
import { checkReadiness, laborSnapshot, findNotableArrivals } from '@/lib/slack-signals'
import { readinessMessage, laborMessage, notableArrivalsMessage } from '@/lib/slack-messages'
import { groupForBuilding, audienceFor } from '@/lib/slack-rules'
import { buildingOf } from '@/lib/segments'
import { etDate } from '@/lib/slack-alerts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (access.role !== 'admin' && !isSuperadmin(access.email)) {
    return NextResponse.json({ error: 'Admins only.' }, { status: 403 })
  }
  if (!(await botConnected())) return NextResponse.json({ error: 'Slack bot not connected' }, { status: 400 })

  const url = new URL(req.url)
  const to = String(url.searchParams.get('to') || JON_SLACK_ID)
  const what = String(url.searchParams.get('what') || 'all').toLowerCase()
  const want = (k: string) => what === 'all' || what === k

  const rules = await getSlackRules()
  const sent: any[] = []

  // Post the main message, then hang the Spanish off it as a reply — same shape as a channel post.
  const send = async (label: string, body: string, threadBody?: string | null) => {
    const r = await dmUser(to, body)
    let thread: any = null
    if (r.ok && threadBody && r.ts && r.channel) {
      thread = await postThreadReply(String(r.channel), String(r.ts), threadBody)
    }
    sent.push({ label, ok: r.ok, error: r.error, threaded: !!(thread && thread.ok), threadError: thread && thread.error })
  }

  if (want('readiness')) {
    const { units } = await checkReadiness()
    // Same area buckets the real alert uses, so the test shows one message per channel.
    const buckets: Record<string, { label: string; group: any; rows: typeof units }> = {}
    for (const u of units) {
      const g = groupForBuilding(rules, buildingOf(null, u.unit))
      const label = g ? g.label : 'Unassigned'
      if (g && g.vendor) continue
      if (!buckets[label]) buckets[label] = { label, group: g, rows: [] }
      buckets[label].rows.push(u)
    }
    const keys = Object.keys(buckets)
    if (!keys.length) sent.push({ label: 'readiness', ok: false, error: 'no arrivals today' })
    for (const k of keys) {
      const b = buckets[k]
      const audience = audienceFor(rules, b.group, [])
      const m = readinessMessage({
        area: b.label,
        items: b.rows.map(u => ({
          unit: u.unit, at: u.at, status: u.status, assignees: u.assignees, startedAt: u.startedAt,
          guest: u.guest, nights: u.nights, outGuest: u.outGuest, outAt: u.outAt, flags: u.flags, task: u.task,
        })),
        audience,
        spanish: rules.bilingualFieldChannels,
      })
      await send('readiness:' + b.label, m.body, m.threadBody)
    }
  }

  if (want('labor')) {
    const snap = await laborSnapshot(rules.overtimeHours)
    if (!snap.complete) sent.push({ label: 'labor', ok: false, error: 'no Homebase data for today' })
    else {
      const m = laborMessage({
        date: snap.date, totalHours: snap.totalHours, clockedInNow: snap.clockedInNow,
        overHours: snap.overHours, notClockedIn: snap.notClockedIn, missedClockOut: snap.missedClockOut,
        threshold: rules.overtimeHours,
        audience: rules.leadership.length ? rules.leadership : rules.core,
      })
      await send('labor', m.body)
    }
  }

  if (want('notable')) {
    const items = await findNotableArrivals({
      days: rules.notableLookaheadDays,
      bigBookingUsd: rules.bigBookingUsd,
      longStayNights: rules.longStayNights,
    })
    if (!items.length) sent.push({ label: 'notable', ok: false, error: 'nothing notable coming up' })
    else {
      const m = notableArrivalsMessage({
        items: items.map(i => ({
          unit: i.unit, guest: i.guest, checkIn: i.checkIn, daysAway: i.daysAway,
          nights: i.nights, value: i.value, kind: i.kind,
        })),
        audience: rules.leadership.length ? rules.leadership : rules.core,
        days: rules.notableLookaheadDays,
      })
      await send('notable', m.body)
    }
  }

  return NextResponse.json({ ok: true, date: etDate(), to, what, sent })
}

export async function GET(req: NextRequest) { return run(req) }
export async function POST(req: NextRequest) { return run(req) }
