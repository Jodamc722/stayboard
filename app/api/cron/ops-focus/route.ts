// FOUR CONSIDERED LOOKS A DAY (Jon, 2026-09-16: "fable should run … a few times a day on the today
// in ops, maybe 7am, 12n, 3pm, 8pm").
//
// WHY A SCHEDULE IS THE RIGHT SHAPE HERE. Focus ranks itself in code now (lib/ops-focus-rank), so
// the board always has an answer and never waits. What the model adds is a read of the day as a
// whole — the shape of the crew against the shape of the work — and that is worth having ready
// BEFORE somebody opens the page, not computed while they stare at a spinner. It is also worth
// having at particular moments rather than continuously:
//
//   7am   before the crew leaves, when the day can still be arranged
//   noon  the midday check, when the morning's slippage is visible
//   3pm   late enough to know, early enough to fix
//   8pm   after close-out, when tomorrow is the only thing left to change
//
// Between those, the engines rank. That was the whole trade: a handful of considered calls a day
// is affordable in a way that one per page load never was.
//
// DST, HONESTLY. Vercel cron is UTC and does not move with New York. Rather than pick one offset
// and be an hour wrong for half the year, the schedule fires at BOTH candidate UTC hours for each
// slot and this route decides, in Eastern, whether it is actually one of the four. The misfires
// cost a function invocation and return in milliseconds without touching an engine.
import { NextRequest, NextResponse } from 'next/server'
import { buildOpsFocus } from '@/lib/ops-focus'
import { getSetting, setSetting } from '@/lib/app-settings'
import { cronAllowed } from '@/lib/cron-auth'
import { recordRun } from '@/lib/automation-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** The four moments, in Eastern. */
const SLOTS = [7, 12, 15, 20]
/** Asked one at a time, in this order, so the markets people actually work are done first. */
const MARKETS = ['Miami', 'Broward', 'North', 'all']
const SLOT_KEY = 'ops_focus_last_slot'

const etParts = () => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
  return { hour: Number(f.format(new Date())), date: d.format(new Date()) }
}

export async function POST(req: NextRequest) { return run(req) }
export async function GET(req: NextRequest) { return run(req) }

async function run(req: NextRequest) {
  const allowed = cronAllowed(req)
  if (!allowed.ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { hour, date } = etParts()
  const force = req.nextUrl.searchParams.get('force') === '1'
  const slot = SLOTS.indexOf(hour) >= 0 ? hour : null
  if (slot == null && !force) {
    return NextResponse.json({ ok: true, skipped: 'not one of the four slots', etHour: hour, slots: SLOTS })
  }

  // ONE RUN PER SLOT. Both UTC candidates fire every day, and only one of them is the real hour —
  // but twice a year the clocks make both of them the real hour, and a second pass would spend a
  // second set of model calls for the same four markets. The ledger is the guard.
  const stamp = date + '|' + (slot ?? 'forced')
  const last = await getSetting<string>(SLOT_KEY, '')
  if (last === stamp && !force) {
    return NextResponse.json({ ok: true, skipped: 'this slot already ran', slot: stamp })
  }
  await setSetting(SLOT_KEY, stamp, 'cron/ops-focus')

  // Sequential on purpose. Four markets in parallel is four large model calls at once against one
  // key, and nothing here is in a hurry — the page has the engines' answer the whole time.
  const results: { market: string; model: string; focus: number; cached: boolean; error?: string }[] = []
  for (const market of MARKETS) {
    try {
      const r = await buildOpsFocus(market, { investigate: true })
      results.push({
        market,
        model: r.model,
        focus: r.verdict?.focus?.length || 0,
        // `cached: true` here means the candidate set had not changed since the last considered
        // answer, so the model was not asked again. That is a saving, not a failure.
        cached: !!r.cached,
      })
    } catch (e: any) {
      // One market failing is not a reason to skip the rest — they are independent questions.
      results.push({ market, model: 'error', focus: 0, cached: false, error: String(e?.message || e).slice(0, 200) })
    }
  }

  const asked = results.filter(r => !r.cached && r.model !== 'error' && r.model !== 'engine' && r.model !== 'none').length
  await recordRun({
    name: 'ops-focus',
    ok: !results.some(r => r.error),
    itemCount: results.reduce((a, r) => a + r.focus, 0),
    detail: { slot: stamp, asked, results },
  })
  return NextResponse.json({ ok: true, slot: stamp, etHour: hour, asked, results })
}
