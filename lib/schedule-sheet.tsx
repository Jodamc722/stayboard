// THE DAY SHEET AS A PICTURE (Jon, 2026-09-14: "have a button where we can push the schedule to
// Slack in a JPEG format so that a team can see where they're cleaning each day. This should be
// visually easy to see. It should show the cleaner the unit, the checkout time, the bedroom size,
// and any notes").
//
// ── WHY AN IMAGE AND NOT A MESSAGE ──────────────────────────────────────────────────────────────
// Slack renders a posted image inline, at a glance, on a phone, in a channel a cleaner is already
// in — no link to open, no login, no app. A text message of forty cleans is a wall nobody reads to
// the bottom of, and a link to the board is a login the field crew does not have.
//
// ── HOW IT IS BUILT ─────────────────────────────────────────────────────────────────────────────
// next/og (satori) lays it out and renders a PNG; sharp turns that into the JPEG Jon asked for.
// Satori was chosen over handing sharp an SVG of my own because satori bundles its own font: an
// SVG rasterised by librsvg depends on whatever fonts the host happens to have, and the failure
// mode there is a sheet of empty boxes posted to the team channel.
//
// SATORI IS FLEXBOX ONLY. No grid, no floats, and every element with more than one child needs an
// explicit display:flex. Widths are fixed pixel columns for that reason, which is also what keeps
// the columns aligned down the page.
//
// ── GROUPED BY CLEANER, BECAUSE OF THE QUESTION IT ANSWERS ──────────────────────────────────────
// "Where am I cleaning today" is a question about a person, so the person is the heading and their
// units are the list. A unit-ordered sheet makes every cleaner read all forty rows to find their
// four. Unassigned sits last and loudly: it is the only part of the sheet that is a request.
import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { buildSchedule } from '@/lib/schedule-build'

export type SheetOpts = { date: string; market?: string | null }

type Clean = {
  listingId: string; unit: string; market: string; hub: string
  bedrooms: number | null; checkOutTime: string | null; doorCode: string | null
  sameDayTurn: boolean; vendor: string | null; assignedNames: string[]
  extended?: boolean; movedFrom?: string | null; blocked?: boolean; walkInRisk?: boolean
  nextArrival?: string | null; guestyOnly?: boolean
}

const INK = '#0f172a'
const MUTED = '#64748b'
const LINE = '#e2e8f0'
const RED = '#b91c1c'
const REDBG = '#fef2f2'
const AMBER = '#b45309'

const niceDay = (ymd: string) => {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}
/** "11:00:00" / "11:00 AM" → "11:00 AM". Checkout is a clock time, not a timestamp. */
const niceTime = (v: string | null | undefined): string => {
  const s = String(v || '').trim()
  if (!s) return '—'
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return s
  let h = Number(m[1]); const mm = m[2]
  const ampm = /pm/i.test(s) ? 'PM' : /am/i.test(s) ? 'AM' : h >= 12 ? 'PM' : 'AM'
  if (/pm/i.test(s) && h < 12) h += 12
  const h12 = h % 12 === 0 ? 12 : h % 12
  return h12 + ':' + mm + ' ' + ampm
}
const shortDate = (v: string | null | undefined) => {
  const s = String(v || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

// THE NOTES COLUMN. There is no free-text note on a clean in the schedule payload — a note typed on
// the board goes onto the Breezeway task, not onto this row. So "notes" here is the set of facts
// that change how the clean is done, in the order they change it, and never more than fits a line.
function notesFor(c: Clean): { text: string; urgent: boolean } {
  const bits: string[] = []
  let urgent = false
  if (c.extended) bits.push('EXTENDED — do not clean')
  else if (c.sameDayTurn) { bits.push('SAME-DAY TURN'); urgent = true }
  if (c.blocked) bits.push('unit blocked')
  if (c.movedFrom) bits.push('moved from ' + shortDate(c.movedFrom))
  if (c.vendor) bits.push(c.vendor + ' staff')
  if (c.walkInRisk) { bits.push('walk-in risk'); urgent = true }
  if (c.doorCode) bits.push('code ' + c.doorCode)
  if (!bits.length && c.nextArrival) bits.push('next in ' + shortDate(c.nextArrival))
  // Three facts is what fits. The door code is the one people scroll back for, so when the line is
  // full it is the one that survives — the rest are visible on the board.
  const kept = bits.length > 3 ? bits.slice(0, 2).concat(bits.filter(b => b.startsWith('code ')).slice(0, 1)) : bits
  return { text: kept.join(' · '), urgent }
}

const ROW_H = 46
const GROUP_H = 54
const HEAD_H = 132
const FOOT_H = 58
const COLS_H = 34
const WIDTH = 1180

export async function buildScheduleSheet(opts: SheetOpts): Promise<{
  jpeg: Buffer; filename: string; title: string
  counts: { cleans: number; cleaners: number; sameDay: number; unassigned: number }
}> {
  const date = opts.date
  const market = String(opts.market || 'all').toLowerCase()
  const payload: any = await buildSchedule('day', date)
  const day = (payload?.days || [])[0] || { markets: {} }

  const all: Clean[] = []
  for (const mk of Object.keys(day.markets || {})) {
    for (const c of (day.markets[mk] || [])) all.push(c as Clean)
  }
  const cleans = all.filter(c => market === 'all' || String(c.market || '').toLowerCase() === market)

  // Group by cleaner. A clean with two names on it appears under BOTH — they are both going, and a
  // sheet that picks one of them for brevity is how the second person does not turn up.
  const byPerson: Record<string, Clean[]> = {}
  const unassigned: Clean[] = []
  for (const c of cleans) {
    const names = (c.assignedNames || []).filter(Boolean)
    if (!names.length) { unassigned.push(c); continue }
    for (const n of names) (byPerson[n] = byPerson[n] || []).push(c)
  }
  const people = Object.keys(byPerson).sort((a, b) => a.localeCompare(b))
  for (const p of people) {
    byPerson[p].sort((a, b) => niceTime(a.checkOutTime).localeCompare(niceTime(b.checkOutTime)) || a.unit.localeCompare(b.unit))
  }
  unassigned.sort((a, b) => a.unit.localeCompare(b.unit))

  const sameDay = cleans.filter(c => c.sameDayTurn && !c.extended).length
  const counts = { cleans: cleans.length, cleaners: people.length, sameDay, unassigned: unassigned.length }

  const groups: { name: string; rows: Clean[]; unassigned?: boolean }[] =
    people.map(n => ({ name: n, rows: byPerson[n] }))
  if (unassigned.length) groups.push({ name: 'NOT ASSIGNED YET', rows: unassigned, unassigned: true })

  const rowCount = groups.reduce((a, g) => a + g.rows.length, 0)
  const height = Math.min(5200, HEAD_H + COLS_H + groups.length * GROUP_H + rowCount * ROW_H + FOOT_H)
  const mkLabel = market === 'all' ? 'All areas' : market.charAt(0).toUpperCase() + market.slice(1)

  const el = (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#ffffff', fontFamily: 'sans-serif' }}>
      {/* HEADER — the day, the area, and the three numbers that describe it */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '28px 40px 18px 40px', borderBottom: `3px solid ${INK}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, color: INK }}>Housekeeping — {niceDay(date)}</div>
          <div style={{ display: 'flex', marginLeft: 'auto', fontSize: 24, color: MUTED }}>{mkLabel}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 10, fontSize: 24, color: MUTED }}>
          {counts.cleans} {counts.cleans === 1 ? 'clean' : 'cleans'} · {counts.cleaners} {counts.cleaners === 1 ? 'cleaner' : 'cleaners'}
          {sameDay > 0 ? ' · ' + sameDay + ' same-day ' + (sameDay === 1 ? 'turn' : 'turns') : ''}
          {unassigned.length > 0 ? ' · ' + unassigned.length + ' unassigned' : ''}
        </div>
      </div>

      {/* COLUMN LABELS ONCE, not per group. Four unlabelled columns of times and numbers make a
          reader work out what they are looking at; repeating the labels every group turns the sheet
          into stripes. */}
      <div style={{ display: 'flex', alignItems: 'center', height: COLS_H, padding: '0 40px 0 50px', backgroundColor: '#ffffff' }}>
        <div style={{ display: 'flex', width: 430, fontSize: 16, letterSpacing: 1, color: MUTED }}>UNIT</div>
        <div style={{ display: 'flex', width: 150, fontSize: 16, letterSpacing: 1, color: MUTED }}>GUEST OUT</div>
        <div style={{ display: 'flex', width: 110, fontSize: 16, letterSpacing: 1, color: MUTED }}>SIZE</div>
        <div style={{ display: 'flex', flex: 1, fontSize: 16, letterSpacing: 1, color: MUTED }}>NOTES</div>
      </div>

      {groups.map(g => (
        <div key={g.name} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'flex', alignItems: 'center', height: GROUP_H, padding: '0 40px',
            backgroundColor: g.unassigned ? REDBG : '#f1f5f9',
          }}>
            <div style={{ display: 'flex', fontSize: 27, fontWeight: 700, color: g.unassigned ? RED : INK }}>{g.name}</div>
            <div style={{ display: 'flex', marginLeft: 'auto', fontSize: 22, color: g.unassigned ? RED : MUTED }}>
              {g.rows.length} {g.rows.length === 1 ? 'clean' : 'cleans'}
            </div>
          </div>
          {g.rows.map((c, i) => {
            const n = notesFor(c)
            return (
              <div key={c.listingId + ':' + i} style={{
                display: 'flex', alignItems: 'center', height: ROW_H, padding: '0 40px',
                borderBottom: `1px solid ${LINE}`,
                // The urgent rail is the one thing readable at thumbnail size in a channel.
                borderLeft: n.urgent ? `10px solid ${RED}` : '10px solid #ffffff',
              }}>
                <div style={{ display: 'flex', width: 430, fontSize: 25, fontWeight: 600, color: INK, overflow: 'hidden', whiteSpace: 'nowrap' }}>{c.unit}</div>
                <div style={{ display: 'flex', width: 150, fontSize: 24, color: INK }}>{niceTime(c.checkOutTime)}</div>
                {/* A studio is not "0 BR" — that reads as missing data, and the size is the thing that tells
                    a cleaner how long the unit takes. */}
                <div style={{ display: 'flex', width: 110, fontSize: 24, color: MUTED }}>
                  {c.bedrooms == null ? '—' : c.bedrooms === 0 ? 'Studio' : c.bedrooms + ' BR'}
                </div>
                {/* ONE LINE, ALWAYS. A wrapping note pushed its row taller than the height this sheet was
                    measured at, so every row below it slid down and the last one fell off the image. */}
                <div style={{ display: 'flex', flex: 1, fontSize: 21, color: n.urgent ? RED : AMBER, overflow: 'hidden', whiteSpace: 'nowrap' }}>{n.text}</div>
              </div>
            )
          })}
        </div>
      ))}

      <div style={{ display: 'flex', marginTop: 'auto', padding: '12px 40px', fontSize: 19, color: MUTED, borderTop: `1px solid ${LINE}` }}>
        Times are the guest&apos;s checkout. A red bar means the next guest arrives today.
      </div>
    </div>
  )

  const png = Buffer.from(await new ImageResponse(el, { width: WIDTH, height }).arrayBuffer())
  // JPEG because Jon asked for it, and because a 40-row sheet is meaningfully smaller than the PNG
  // on a phone with one bar of signal. Quality 90: the type has to stay crisp when Slack scales it.
  const jpeg = await sharp(png).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer()

  return {
    jpeg,
    filename: 'housekeeping-' + date + (market === 'all' ? '' : '-' + market) + '.jpg',
    title: 'Housekeeping — ' + niceDay(date) + (market === 'all' ? '' : ' · ' + mkLabel),
    counts,
  }
}
