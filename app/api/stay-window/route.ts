// STAY WINDOW — read and set a listing's minimum length of stay across a rolling date window.
//
// GET  ?listingId=X&days=60         → what the listing and its calendar say right now. Read-only.
// POST {listingId, minNights, days} → write that minimum across today..today+days (Eastern dates).
//
// Manual on purpose for now. Jon and I agreed the sequence is: probe → run both ends by hand →
// confirm the change actually lands on Airbnb and Booking → only then attach a cron. A schedule
// pointed at an endpoint nobody has watched work is a schedule that fails quietly at 6pm.
//
// Gated on Revenue/full: minimum stay is a pricing lever, and Revenue is owner-and-admin only.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import {
  readTerms, readMinNights, writeMinNights, conflictsWithMax, summarize, todayET, addDays,
} from '@/lib/stay-window'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_DAYS = 365

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

export async function GET(req: NextRequest) {
  const g = await requireLevel('revenue', 'view')
  if (!g.ok) return g.res

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
  // this listing is cleared for short stays, so a mis-typed value or a stray cron cannot do it.
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
