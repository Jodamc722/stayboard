// THE HOUSEKEEPING DAY SHEET, AS A PICTURE (Jon, 2026-09-14).
//
//   GET  — hands back the JPEG. This is the Download button on the Turnover Schedule.
//   POST — renders the same JPEG and posts it into a Slack channel. This is the Post button.
//
// ONE RENDERER FOR BOTH (lib/schedule-sheet), so what the team sees in Slack and what you
// downloaded to check it are the same picture. Two code paths would drift, and the one that
// drifted would be the one nobody looks at before it reaches forty cleaners.
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { buildScheduleSheet } from '@/lib/schedule-sheet'
import { uploadFileToChannel } from '@/lib/slack'
import { getSlackRules, channelFor } from '@/lib/slack-rules'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

function params(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const d = String(sp.get('date') || '')
  return { date: DATE_RE.test(d) ? d : todayET(), market: String(sp.get('market') || 'all').toLowerCase() }
}

export async function GET(req: NextRequest) {
  // Viewing the sheet is viewing the schedule — same gate, no lower.
  const gate = await requireLevel('schedule', 'view')
  if (!gate.ok) return gate.res
  const { date, market } = params(req)
  try {
    const sheet = await buildScheduleSheet({ date, market })
    return new NextResponse(new Uint8Array(sheet.jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        // `inline` so clicking it previews in a tab; the button sets download= itself when it
        // wants a file on disk. Never cached: the schedule changes all morning.
        'Content-Disposition': 'inline; filename="' + sheet.filename + '"',
        'Cache-Control': 'no-store',
        'x-sheet-cleans': String(sheet.counts.cleans),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  // POSTING IS A WRITE. It puts a picture in front of the whole field crew, so it takes the same
  // level as changing the schedule rather than the level that can look at it.
  const gate = await requireLevel('schedule', 'edit')
  if (!gate.ok) return gate.res
  const { date, market } = params(req)
  const body = await req.json().catch(() => ({} as any))

  try {
    const rules = await getSlackRules()
    // An explicit channel wins; otherwise the housekeeping default. NOT routed through the alert
    // allow-list (lib/slack-rules' master mute): that list exists to stop AUTOMATIC broadcasts,
    // and this is a person pressing a button about their own schedule. Muting it there would make
    // the button silently do nothing, which is the worst of both.
    const channel = String(body?.channel || '').trim()
      || channelFor(rules, null, 'housekeeping') || rules.opsChannel || ''
    if (!channel) {
      return NextResponse.json({ ok: false, error: 'No Slack channel is set. Pick one in Users & admin → Slack.' }, { status: 400 })
    }

    const sheet = await buildScheduleSheet({ date, market })
    const c = sheet.counts
    const comment = sheet.title + ' — ' + c.cleans + ' ' + (c.cleans === 1 ? 'clean' : 'cleans')
      + (c.cleaners ? ' across ' + c.cleaners + ' ' + (c.cleaners === 1 ? 'cleaner' : 'cleaners') : '')
      + (c.sameDay ? ' · ' + c.sameDay + ' same-day ' + (c.sameDay === 1 ? 'turn' : 'turns') : '')
      + (c.unassigned ? ' · ' + c.unassigned + ' still unassigned' : '')

    const res = await uploadFileToChannel({
      channel, filename: sheet.filename, bytes: sheet.jpeg, title: sheet.title, comment,
    })
    if (!res.ok) {
      // Slack's own word for what went wrong, not ours. `missing_scope` means the bot needs
      // files:write; `channel_not_found` usually means the bot was never invited to the room.
      return NextResponse.json({ ok: false, error: res.error || 'Slack refused the upload' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, channel, counts: c, filename: sheet.filename })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
