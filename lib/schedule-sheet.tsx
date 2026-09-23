// THE DAY SHEET AS A PICTURE (Jon, 2026-09-14: "have a button where we can push the schedule to
// Slack in a JPEG format so that a team can see where they're cleaning each day. This should be
// visually easy to see. It should show the cleaner the unit, the checkout time, the bedroom size,
// and any notes").
//
// ── THE SHAPE CAME FROM JON'S OWN SHEET ─────────────────────────────────────────────────────────
// The first pass grouped the day under a heading per cleaner. Jon: "the format is so unclear, let
// me show you what i kind of want it to look like" — and sent the spreadsheet the team actually
// works from: a FLAT GRID, one row per clean, with the cleaner and the building each a coloured
// pill in their own column. Then "I would add same day turn, Checkout time, ect".
//
// That is a better answer than headings and it is worth saying why, because the difference is not
// taste. A heading tells you where a block starts; a coloured column tells you at a glance how
// much of the day is yours and where it is clustered, WITHOUT reading a word. Vilma finds her four
// rows by colour from arm's length, and the building colour beside it says whether she is in one
// tower all morning or crossing town. Headings cannot do that, and the crew had already worked it
// out for themselves in a spreadsheet.
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
// explicit display:flex. Every column is a fixed pixel width for that reason — which is also what
// keeps them in line down a forty-row page.
import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { buildSchedule } from '@/lib/schedule-build'

export type SheetOpts = { date: string; market?: string | null }

type Clean = {
  listingId: string; unit: string; market: string; hub: string
  bedrooms: number | null; checkOutTime: string | null; doorCode: string | null
  sameDayTurn: boolean; vendor: string | null; assignedNames: string[]
  guestOut?: string | null; nights?: number | null
  extended?: boolean; movedFrom?: string | null; blocked?: boolean; walkInRisk?: boolean; rebook?: boolean
  nextArrival?: string | null; guestyOnly?: boolean
}

const INK = '#0b0b0b'
const MUTED = '#52514e'
const LINE = '#e4e4e1'
const SURFACE = '#ffffff'
const STRIPE = '#f7f8fa'
const RED = '#c0322f'
const REDBG = '#fdeceb'

// ── IDENTITY COLOUR ─────────────────────────────────────────────────────────────────────────────
// The eight hues of the validated categorical palette, in their fixed order (dataviz skill,
// references/palette.md). Assigned in fixed order and never cycled into new generated hues: a
// ninth person or building reuses a slot rather than inventing a colour nobody has learned.
//
// Colour NEVER carries meaning alone here — every pill has its name written inside it, which is
// also the relief the palette's contrast warning requires for three of these hues. What the colour
// buys is speed: finding your own rows without reading, and seeing that they cluster in one tower.
const HUES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

/** Same name, same colour, every day — a colour that moves between people is worse than none. */
function slotFor(name: string): number {
  const s = String(name || '').trim().toLowerCase()
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % HUES.length
}
const hex2rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const rgb2hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
/** A pale wash of the hue for the pill, and a deep step of it for the text on top. */
function pill(name: string): { bg: string; fg: string } {
  const [r, g, b] = hex2rgb(HUES[slotFor(name)])
  return {
    bg: rgb2hex(r + (255 - r) * 0.84, g + (255 - g) * 0.84, b + (255 - b) * 0.84),
    fg: rgb2hex(r * 0.52, g * 0.52, b * 0.52),
  }
}

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
/** Sortable minutes, so 9:00 AM precedes 11:00 AM precedes 1:00 PM. */
const timeKey = (v: string | null | undefined): number => {
  const s = String(v || '').trim()
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return 9999
  let h = Number(m[1])
  if (/pm/i.test(s) && h < 12) h += 12
  if (/am/i.test(s) && h === 12) h = 0
  return h * 60 + Number(m[2])
}
const shortDate = (v: string | null | undefined) => {
  const s = String(v || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const sizeOf = (n: number | null | undefined) => (n == null ? '—' : n === 0 ? 'Studio' : n + ' BR')

// A PILL MUST NEVER WRAP. "Shaany Christian" went to two lines, which made the pill taller than its
// row, and the colour bled down over the row beneath it. Long names lose the surname to an initial
// — the crew know each other by first name, and the colour is doing the identifying anyway.
function shortName(n: string): string {
  const s = String(n || '').replace(/\s+/g, ' ').trim()
  if (s.length <= 15) return s
  const parts = s.split(' ')
  return parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0] + '.' : s.slice(0, 15)
}
/** Same reason, for the guest: a clipped half-name reads as a bug, an ellipsis reads as a name. */
function clip(s: string, max: number): string {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.55 ? cut.slice(0, sp) : cut) + '…'
}

// THE NOTES COLUMN. There is no free-text note on a clean in the schedule payload — a note typed on
// the board goes onto the Breezeway task, not onto this row. So "notes" is the set of facts that
// change how the clean is done. Same-day turn has left this column: Jon asked for it as its own
// thing, and a flag competing with four others for one line is how it gets missed.
function notesFor(c: Clean): string {
  const bits: string[] = []
  // First, above everything: the guest is still in there. A cleaner who reads nothing else on the
  // row has to read this one.
  if (c.rebook) bits.push('SAME GUEST BACK IN — do not strip, knock first')
  if (c.extended) bits.push('EXTENDED — do not clean')
  if (c.blocked) bits.push('unit blocked')
  if (c.movedFrom) bits.push('moved from ' + shortDate(c.movedFrom))
  if (c.vendor) bits.push(c.vendor + ' staff')
  if (c.walkInRisk) bits.push('walk-in risk')
  if (c.doorCode) bits.push('code ' + c.doorCode)
  if (!bits.length && c.nextArrival) bits.push('next guest ' + shortDate(c.nextArrival))
  return bits.slice(0, 2).join(' · ')
}

// Fixed columns, in the order Jon's own sheet reads them. Sum + the 34px gutters = WIDTH.
// Jon's spreadsheet has a TYPE column because it covers more than cleans. This sheet is departure
// cleans only, so every row would read "Checkout" — a column where every cell says the same word
// costs 112px and earns nothing. The width it frees goes to NOTES, which was being clipped.
const C = { who: 186, bldg: 148, unit: 262, guest: 240, out: 128, size: 84, turn: 128 }
const WIDTH = 1500
const ROW_H = 44
const HEAD_H = 128
const COLS_H = 38
const FOOT_H = 54
const PAD = '0 34px'

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
  // VENDOR BUILDINGS ARE NOT ON THIS SHEET (Jon, 2026-09-23: "can we also remove Botanica from the
  // day sheet download"). This picture is the housekeeping run — who on OUR crew is cleaning what.
  // A Botanica row can never be assigned to anyone on it, so it only ever read as a clean nobody
  // picked up. The vendor's own work is still on the board under the Vendor tab.
  const ours = all.filter(c => !c.vendor)
  const cleans = ours.filter(c => market === 'all' || String(c.market || '').toLowerCase() === market)

  // ── ONE ROW PER CLEAN, PER PERSON ON IT ──────────────────────────────────────────────────────
  // A clean with two names gets a row under each of them. They are both going, and a sheet that
  // prints it once under the first name is how the second person does not turn up.
  type Row = { c: Clean; who: string }
  const rows: Row[] = []
  for (const c of cleans) {
    const names = (c.assignedNames || []).filter(Boolean)
    if (!names.length) { rows.push({ c, who: '' }); continue }
    for (const n of names) rows.push({ c, who: n })
  }
  // Sorted the way the eye wants to read it: person, then building (so their tower groups), then
  // the clock. Unassigned last — it is the only part of the sheet that is a request.
  rows.sort((a, b) =>
    (a.who ? 0 : 1) - (b.who ? 0 : 1)
    || a.who.localeCompare(b.who)
    || String(a.c.hub || '').localeCompare(String(b.c.hub || ''))
    || timeKey(a.c.checkOutTime) - timeKey(b.c.checkOutTime)
    || a.c.unit.localeCompare(b.c.unit))

  const people = Array.from(new Set(rows.filter(r => r.who).map(r => r.who)))
  const sameDay = cleans.filter(c => c.sameDayTurn && !c.extended).length
  const counts = {
    cleans: cleans.length, cleaners: people.length, sameDay,
    unassigned: cleans.filter(c => !(c.assignedNames || []).filter(Boolean).length).length,
  }

  const shown = rows.slice(0, 80)
  const height = HEAD_H + COLS_H + shown.length * ROW_H + FOOT_H
  const mkLabel = market === 'all' ? 'All areas' : market.charAt(0).toUpperCase() + market.slice(1)

  // Satori refuses a style object carrying an explicit `undefined` — it reads every value — so the
  // fixed-width and the flexible header cell are two literals rather than one conditional.
  const TH = { display: 'flex' as const, fontSize: 15, color: MUTED }

  const el = (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: SURFACE, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', flexDirection: 'column', padding: '26px 34px 16px 34px', borderBottom: `3px solid ${INK}` }}>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <div style={{ display: 'flex', fontSize: 38, fontWeight: 700, color: INK }}>Housekeeping — {niceDay(date)}</div>
          <div style={{ display: 'flex', marginLeft: 'auto', fontSize: 23, color: MUTED }}>{mkLabel}</div>
        </div>
        <div style={{ display: 'flex', marginTop: 9, fontSize: 22, color: MUTED }}>
          {counts.cleans} {counts.cleans === 1 ? 'clean' : 'cleans'} · {counts.cleaners} {counts.cleaners === 1 ? 'cleaner' : 'cleaners'}
          {sameDay > 0 ? ' · ' + sameDay + ' same-day ' + (sameDay === 1 ? 'turn' : 'turns') : ''}
          {counts.unassigned > 0 ? ' · ' + counts.unassigned + ' unassigned' : ''}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', height: COLS_H, padding: PAD, backgroundColor: SURFACE }}>
        <div style={{ ...TH, width: C.who }}>CLEANER</div>
        <div style={{ ...TH, width: C.bldg }}>BUILDING</div>
        <div style={{ ...TH, width: C.unit }}>UNIT</div>
        <div style={{ ...TH, width: C.guest }}>GUEST OUT</div>
        <div style={{ ...TH, width: C.out }}>CHECKOUT</div>
        <div style={{ ...TH, width: C.size }}>SIZE</div>
        <div style={{ ...TH, width: C.turn }}>TURN</div>
        <div style={{ ...TH, flex: 1 }}>NOTES</div>
      </div>

      {shown.map((r, i) => {
        const c = r.c
        const who = r.who || 'UNASSIGNED'
        const wp = r.who ? pill(r.who) : { bg: REDBG, fg: RED }
        const bp = pill(String(c.hub || c.market || 'Other'))
        const turn = c.extended ? null : c.sameDayTurn
        // A stripe that changes with the PERSON, not every other row: the band is what says "these
        // four are one run" at the size this gets read at.
        const band = (people.indexOf(r.who) % 2 === 1) ? STRIPE : SURFACE
        return (
          <div key={c.listingId + ':' + i} style={{
            display: 'flex', alignItems: 'center', height: ROW_H, padding: PAD,
            backgroundColor: r.who ? band : REDBG, borderBottom: `1px solid ${LINE}`,
          }}>
            <div style={{ display: 'flex', width: C.who }}>
              <div style={{ display: 'flex', backgroundColor: wp.bg, color: wp.fg, fontSize: 19, fontWeight: 700, padding: '3px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>{r.who ? shortName(r.who) : who}</div>
            </div>
            <div style={{ display: 'flex', width: C.bldg }}>
              <div style={{ display: 'flex', backgroundColor: bp.bg, color: bp.fg, fontSize: 18, fontWeight: 700, padding: '3px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>{clip(c.hub || '—', 11)}</div>
            </div>
            <div style={{ display: 'flex', width: C.unit, fontSize: 21, fontWeight: 600, color: INK, overflow: 'hidden', whiteSpace: 'nowrap' }}>{clip(c.unit, 24)}</div>
            <div style={{ display: 'flex', width: C.guest, fontSize: 19, color: MUTED, overflow: 'hidden', whiteSpace: 'nowrap' }}>{clip(c.guestOut || '—', 22)}</div>
            <div style={{ display: 'flex', width: C.out, fontSize: 20, fontWeight: 600, color: INK }}>{niceTime(c.checkOutTime)}</div>
            <div style={{ display: 'flex', width: C.size, fontSize: 19, color: MUTED }}>{sizeOf(c.bedrooms)}</div>
            <div style={{ display: 'flex', width: C.turn }}>
              {turn
                ? <div style={{ display: 'flex', backgroundColor: RED, color: '#ffffff', fontSize: 16, fontWeight: 700, padding: '3px 10px', borderRadius: 6 }}>SAME-DAY</div>
                : <div style={{ display: 'flex', fontSize: 19, color: '#9aa0a6' }}>—</div>}
            </div>
            <div style={{ display: 'flex', flex: 1, fontSize: 18, color: c.extended ? RED : MUTED, overflow: 'hidden', whiteSpace: 'nowrap' }}>{clip(notesFor(c), 30)}</div>
          </div>
        )
      })}

      <div style={{ display: 'flex', marginTop: 'auto', padding: '12px 34px', fontSize: 18, color: MUTED, borderTop: `1px solid ${LINE}` }}>
        {rows.length > shown.length
          ? (rows.length - shown.length) + ' more on the board · times are the guest’s checkout · SAME-DAY means the next guest arrives today'
          : 'Times are the guest’s checkout. SAME-DAY means the next guest arrives today.'}
      </div>
    </div>
  )

  const png = Buffer.from(await new ImageResponse(el, { width: WIDTH, height }).arrayBuffer())
  // JPEG because Jon asked for it, and because a 40-row sheet is meaningfully smaller than the PNG
  // on a phone with one bar of signal. 4:4:4 so the coloured pills keep their edges.
  const jpeg = await sharp(png).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer()

  return {
    jpeg,
    filename: 'housekeeping-' + date + (market === 'all' ? '' : '-' + market) + '.jpg',
    title: 'Housekeeping — ' + niceDay(date) + (market === 'all' ? '' : ' · ' + mkLabel),
    counts,
  }
}
