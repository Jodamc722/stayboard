// STAY WINDOW — the minimum-length-of-stay switch, and the schedule that throws it.
//
// GET  ?config=1                    → the saved schedule
// GET  ?listingId=X&days=60         → what one listing's calendar says right now (read-only)
// POST {action:'config', config}    → save the schedule
// POST {action:'run', direction}    → throw the switch now: 'open' = short, 'close' = back to long
// POST {listingId, minNights, days} → raw one-off write, for testing a single value
//
// Gated on Revenue/full: minimum stay is a pricing lever, and Revenue is owner-and-admin only.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import {
  readTerms, readMinNights, writeMinNights, conflictsWithMax, summarize, todayET, addDays,
  readConfig, writeConfig, normalizeConfig, runDirection, hourET,
} from '@/lib/stay-window'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_DAYS = 365

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET(req: NextRequest) {
  const g = await requireLevel('revenue', 'view')
  if (!g.ok) return g.res

  if (req.nextUrl.searchParams.get('config')) {
    const config = await readConfig()
    return NextResponse.json({ ok: true, config, nowHourET: hourET(), todayET: todayET() })
  }

  const listingId = str(req.nextUrl.searchParams.get('listingId')).trim()
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 60, 1), MAX_DAYS)

  const start = todayET()
  const end = addDays(start, days)

  try {
    const terms = await readTerms(listingId)
    let calendar: any = null
    let calendarError: string | null = null
    try {
      const cal = await readMinNights(listingId, start, end)
      calendar = { ...summarize(cal), sample: cal.slice(0, 14) }
    } catch (e: any) {
      // A calendar read that fails should not hide the listing terms, which are the more important
      // half of the answer.
      calendarError = str(e?.message).slice(0, 300)
    }
    return NextResponse.json({ ok: true, listingId, window: { start, end, days }, terms, calendar, calendarError })
  } catch (e: any) {
    return NextResponse.json({ error: str(e?.message).slice(0, 300) }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('revenue', 'full')
  if (!g.ok) return g.res

  const body = await req.json().catch(() => ({} as any))
  const action = str(body?.action)

  // ---- save the schedule --------------------------------------------------------------------
  if (action === 'config') {
    const cfg = normalizeConfig(body?.config)
    const w = await writeConfig(cfg, g.access.email)
    if (!w.ok) return NextResponse.json({ error: w.error || 'save failed' }, { status: 500 })
    return NextResponse.json({ ok: true, config: cfg })
  }

  // ---- throw the switch now -------------------------------------------------------------------
  // Same code path the cron uses, forced past the once-per-day guard so a human can always run it.
  if (action === 'run') {
    const direction = body?.direction === 'open' ? 'open' : body?.direction === 'close' ? 'close' : null
    if (!direction) return NextResponse.json({ error: "direction must be 'open' or 'close'" }, { status: 400 })
    const cfg = await readConfig()
    if (!cfg.listings.length) return NextResponse.json({ error: 'No listings are on the schedule yet.' }, { status: 400 })
    const { config, results } = await runDirection(cfg, direction, true)
    await writeConfig(config, g.access.email)
    return NextResponse.json({ ok: true, direction, results })
  }

  // ---- raw one-off write ----------------------------------------------------------------------
  const listingId = str(body?.listingId).trim()
  const minNights = Math.round(Number(body?.minNights))
  const days = Math.min(Math.max(Number(body?.days) || 60, 1), MAX_DAYS)
  const dryRun = body?.dryRun === true

  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  if (!Number.isFinite(minNights) || minNights < 1 || minNights > MAX_DAYS) {
    return NextResponse.json({ error: 'minNights must be a whole number between 1 and 365.' }, { status: 400 })
  }

  // SPEED BUMP. Dropping a listing below a 30-night minimum can be the difference between a legal
  // rental and an unpermitted one — 7071 SW sits in Plantation, which requires a short-term
  // vacation rental certificate for anything under 30 days. The caller has to say out loud that
  // this listing is cleared for short stays, so a mis-typed value cannot do it.
  if (minNights < 30 && body?.confirmShortStay !== true) {
    return NextResponse.json({
      error: 'short-stay-not-confirmed',
      message: `A minimum of ${minNights} nights puts this listing below the 30-day line. Confirm the property is registered for short-term rental in its city, then resend with confirmShortStay: true.`,
    }, { status: 400 })
  }

  const start = todayET()
  const end = addDays(start, days)

  try {
    const terms = await readTerms(listingId)
    const clash = conflictsWithMax(minNights, terms.maxNights)
    if (clash) return NextResponse.json({ error: 'min-above-max', message: clash, terms }, { status: 400 })

    const before = await readMinNights(listingId, start, end).catch(() => [])

    if (dryRun) {
      return NextResponse.json({
        ok: true, dryRun: true, listingId, terms,
        wouldSend: { startDate: start, endDate: end, minNights },
        before: { ...summarize(before), sample: before.slice(0, 14) },
      })
    }

    const res = await writeMinNights(listingId, start, end, minNights)
    const wrote = res.status >= 200 && res.status < 300

    // Read it straight back. "Guesty returned 200" and "the calendar now says 40" are different
    // claims, and only the second one is worth reporting.
    let after: any = null
    let verified: boolean | null = null
    if (wrote) {
      try {
        const rows = await readMinNights(listingId, start, end)
        after = { ...summarize(rows), sample: rows.slice(0, 14) }
        verified = rows.length > 0 && rows.every(r => r.minNights === minNights)
      } catch { after = null; verified = null }
    }

    return NextResponse.json({
      ok: wrote,
      listingId,
      sent: { startDate: start, endDate: end, minNights },
      guestyStatus: res.status,
      guestyBody: res.body.slice(0, 400),
      verified,
      before: { ...summarize(before), sample: before.slice(0, 7) },
      after,
    }, { status: wrote ? 200 : 502 })
  } catch (e: any) {
    return NextResponse.json({ error: str(e?.message).slice(0, 300) }, { status: 502 })
  }
}
