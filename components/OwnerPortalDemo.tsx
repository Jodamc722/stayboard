'use client'
// ── THE OWNER PORTAL, WALKED THROUGH ────────────────────────────────────────
//
// Jon, 2026-09-18, across the afternoon: "an actual real illustration of the owner portal, make
// it interactive… show them how to actually make an owner reservation" → "make it just like the
// real owner portal" → "just main features" → "make an owner stay, view calendar and booking,
// and look at analytics (not accounting data)" → and finally: "make the calendar less full, show
// reservation details of the other real reservations, and make it function closer to the actual
// way — pretend login, go to dashboard, go to properties to see calendar, etc."
//
// SO IT IS A ROUTE, NOT A SCREEN. The earlier version dropped the owner straight onto a calendar,
// which is the one screen they cannot reach without first signing in, landing on the dashboard
// and opening a property. An owner who has never seen the portal does not need the destination,
// they need the path. This walks: sign in → dashboard → My properties → the property's calendar
// → a booking → a stay of their own → Analytics.
//
// DRAWN FROM THE REAL THING. Every screen was opened in our own portal at
// stayhospitality.guestyowners.com on 2026-09-18 (Guesty → Operations → Owners → Preview) and
// copied: the white top nav and its tab order, the blue active underline, "Welcome back, <name>!"
// over the Performance card, the property grid with its Active chips, the green "+ New
// reservation" button, the five metric tiles and their exact labels, green reservation bars with
// nightly rates on the open nights, the six-key legend, and the "Create a reservation" drawer.
//
// WHAT OUR SETTINGS ALLOW decides what a booking can show when you tap it. Guest FULL NAME and
// the reservation tooltip are on; guest email, guest phone, booking source and total payout are
// all off, so the detail panel shows a name, dates, nights and the nightly rate and stops there.
// Arrival and departure times are shown greyed because owners cannot change them. There is no
// reviews or ratings widget anywhere, because both are switched off (Jon: "we won't let them see
// reviews on owner portal"). A walkthrough that shows a control the owner will not find is worse
// than none: they go looking, fail, and call us.
//
// THE CALENDAR IS DELIBERATELY QUIETER THAN THE REAL ONE. The live month was 25 of 30 nights
// sold, which is true and useless to teach with — it left five pickable nights in one corner and
// nothing to tap. Three bookings across twelve nights leaves room to demonstrate both halves.
//
// It is an illustration and says so on the slide. It carries Guesty's real control names because
// that is the point — an owner has to recognise "+ New reservation" when they see it — and it
// holds no real owner's data: every figure and guest name here is invented.
import { useMemo, useState } from 'react'

type Props = {
  unitName: string
  portalUrl: string
  ownerName?: string
  /** The owner's own listing photos, for the My properties grid. */
  photos?: string[]
}

// The portal's palette, sampled from the live screens. Deliberately NOT the deck's theme: the
// owner is being taught to recognise a blue Guesty screen, not a Stay-branded one.
const P = {
  bg: '#f6f8fd', card: '#ffffff', line: '#e4e9f2',
  ink: '#1a2340', body: '#41506e', muted: '#8390ab',
  blue: '#2563eb', blueSoft: '#93b4fb', green: '#17a673', greenBar: '#6cc08b',
  ownerBlue: '#2f80ed', amber: '#f2b93b', unavail: '#dbe6f7',
}

type Resv = { id: string; guest: string; from: number; to: number; rate: string }
/** Three invented bookings. Twelve nights of thirty — enough to click, enough room to book. */
const RESV: Resv[] = [
  { id: 'r1', guest: 'Maria Alvarez', from: 4, to: 7, rate: '$182' },
  { id: 'r2', guest: 'Robert Whitfield', from: 12, to: 15, rate: '$176' },
  { id: 'r3', guest: 'Daniel Okafor', from: 22, to: 25, rate: '$194' },
]
const RATES: Record<number, string> = {
  1: '$168', 2: '$168', 3: '$172', 8: '$170', 9: '$166', 10: '$166', 11: '$174',
  16: '$178', 17: '$172', 18: '$170', 19: '$176', 20: '$188', 21: '$188',
  26: '$164', 27: '$162', 28: '$170', 29: '$174', 30: '$178',
}
const resvOn = (d: number) => RESV.find(r => d >= r.from && d <= r.to) || null

type View = 'login' | 'dashboard' | 'properties' | 'calendar' | 'analytics'

const STEPS: { k: string; d: string; at: View[] }[] = [
  { k: 'Sign in', d: 'Your own email and password at the address above. We never send you a code.', at: ['login'] },
  { k: 'Your dashboard', d: 'What the portal opens on: how the last 30 days went across everything you own.', at: ['dashboard'] },
  { k: 'My properties', d: 'Every unit you own. Open one to reach its calendar.', at: ['properties'] },
  { k: 'The calendar', d: 'Guest bookings in green, the nightly rate on the open nights. Tap a booking to see who is in.', at: ['calendar'] },
  { k: 'Book your own stay', d: 'The green button. Pick your nights, say how many are coming, create it.', at: ['calendar'] },
  { k: 'Analytics', d: 'The year, and which of your units is earning what.', at: ['analytics'] },
]

export default function OwnerPortalDemo({ unitName, portalUrl, ownerName, photos }: Props) {
  const [view, setView] = useState<View>('login')
  const [open, setOpen] = useState<Resv | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [adults, setAdults] = useState(2)
  const [ff, setFf] = useState(false)
  const [mine, setMine] = useState<{ from: number; to: number } | null>(null)

  const host = String(portalUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const who = String(ownerName || '').trim() || 'there'
  const nights = from != null && to != null ? Math.max(1, to - from) : 0
  const pics = (photos || []).filter(Boolean)

  const reset = () => {
    setView('login'); setOpen(null); setDrawer(false)
    setFrom(null); setTo(null); setAdults(2); setFf(false); setMine(null)
  }

  const step = useMemo(() => {
    if (view === 'calendar' && (drawer || mine)) return 4
    const i = STEPS.findIndex(s => s.at.indexOf(view) >= 0)
    return i < 0 ? 0 : i
  }, [view, drawer, mine])

  const isMine = (d: number) => mine != null && d >= mine.from && d <= mine.to
  const isPicking = (d: number) => from != null && to != null && d >= from && d <= to

  // The one place with real rules: a night a guest has cannot be picked, and a range cannot jump
  // one. Teaching otherwise sets an owner up to fail on the real screen.
  const pick = (d: number) => {
    if (resvOn(d) || isMine(d)) return
    if (from == null || to != null) { setFrom(d); setTo(null); return }
    if (d <= from) { setFrom(d); setTo(null); return }
    for (let x = from; x <= d; x++) if (resvOn(x)) return
    setTo(d)
  }
  const create = () => {
    if (from == null || to == null) return
    setMine({ from, to }); setDrawer(false); setFrom(null); setTo(null)
  }

  const TABS: { label: string; to?: View }[] = [
    { label: 'Dashboard', to: 'dashboard' }, { label: 'My properties', to: 'properties' },
    { label: 'Analytics', to: 'analytics' }, { label: 'Reservation report' },
    { label: 'Documents' }, { label: 'Accounting' }, { label: 'Help center' },
  ]
  const activeTab = view === 'analytics' ? 'Analytics' : view === 'dashboard' ? 'Dashboard'
    : (view === 'properties' || view === 'calendar') ? 'My properties' : ''

  const tile = (label: string, value: string) => (
    <div key={label} style={{ border: '1px solid ' + P.line, borderRadius: 8, padding: '7px 9px', background: P.card, minWidth: 0 }}>
      <p style={{ fontSize: 9, color: P.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</p>
      <p style={{ fontSize: 13.5, fontWeight: 600, color: P.ink, marginTop: 2 }}>{value}</p>
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 236px', columnGap: 22, height: '100%', minHeight: 0 }}>
      <div style={{
        border: '1px solid ' + P.line, borderRadius: 10, overflow: 'hidden', position: 'relative',
        background: P.bg, display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        {/* the real top nav — hidden on the login screen, exactly as the portal does */}
        {view !== 'login' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '0 12px', height: 32, background: P.card, borderBottom: '1px solid ' + P.line, flex: '0 0 auto' }}>
            <span style={{ fontSize: 7.5, letterSpacing: '0.16em', color: P.muted, fontWeight: 700 }}>STAY</span>
            {TABS.map(x => {
              const on = x.label === activeTab
              return (
                <button key={x.label} onClick={() => { if (x.to) { setView(x.to); setOpen(null); setDrawer(false) } }}
                  style={{
                    fontSize: 9.5, fontWeight: 600, letterSpacing: 'normal', color: on ? P.blue : P.body,
                    background: 'none', border: 0, padding: '8px 0 7px', cursor: x.to ? 'pointer' : 'default',
                    borderBottom: '2px solid ' + (on ? P.blue : 'transparent'), whiteSpace: 'nowrap',
                  }}>{x.label}</button>
              )
            })}
            <span style={{ marginLeft: 'auto', fontSize: 8.5, color: P.body, whiteSpace: 'nowrap' }}>
              {who === 'there' ? 'You' : who} <span style={{ color: P.muted }}>&#9662;</span>
            </span>
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, padding: view === 'login' ? 0 : 10, overflow: 'hidden' }}>
          {/* ── 1 · SIGN IN ───────────────────────────────────────────────── */}
          {view === 'login' ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: P.card }}>
              <div style={{ width: 230, textAlign: 'center' }}>
                <p style={{ fontSize: 9, letterSpacing: '0.18em', color: P.muted, fontWeight: 700 }}>STAY HOSPITALITY</p>
                <p style={{ fontSize: 13, fontWeight: 700, color: P.ink, marginTop: 12 }}>Owner sign in</p>
                <p style={{ fontSize: 8.5, color: P.muted, marginTop: 3 }}>{host}</p>
                <div style={{ textAlign: 'left', marginTop: 12 }}>
                  <p style={{ fontSize: 8, color: P.muted }}>Email</p>
                  <div style={{ border: '1px solid ' + P.line, borderRadius: 5, padding: '6px 8px', marginTop: 3, fontSize: 9, color: P.body, background: P.bg }}>
                    the email we have on file for you
                  </div>
                  <p style={{ fontSize: 8, color: P.muted, marginTop: 8 }}>Password</p>
                  <div style={{ border: '1px solid ' + P.line, borderRadius: 5, padding: '6px 8px', marginTop: 3, fontSize: 9, color: P.muted, letterSpacing: 3, background: P.bg }}>
                    ••••••••
                  </div>
                </div>
                <button onClick={() => setView('dashboard')} style={{
                  width: '100%', marginTop: 12, background: P.blue, color: '#fff', border: 0,
                  borderRadius: 6, fontSize: 10.5, fontWeight: 600, padding: '8px 0', cursor: 'pointer',
                }}>Sign in</button>
              </div>
            </div>
          ) : view === 'dashboard' ? (
            /* ── 2 · DASHBOARD ─────────────────────────────────────────────── */
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: P.ink }}>Welcome back, {who}!</p>
              <div style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, padding: 10, marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  <div>
                    <p style={{ fontSize: 10.5, fontWeight: 700, color: P.ink }}>Performance</p>
                    <p style={{ fontSize: 8, color: P.muted }}>Past 30 days</p>
                  </div>
                  <button onClick={() => setView('analytics')} style={{
                    marginLeft: 'auto', fontSize: 8.5, color: P.body, background: P.card,
                    border: '1px solid ' + P.line, borderRadius: 5, padding: '4px 8px', cursor: 'pointer',
                  }}>View more data</button>
                </div>
                <div style={{ display: 'flex', gap: 30, marginTop: 9 }}>
                  {[['Owner revenue', '$4,180'], ['Occupancy', '62%']].map(([k, v]) => (
                    <div key={k} style={{ borderLeft: '2px solid ' + P.blue, paddingLeft: 6 }}>
                      <p style={{ fontSize: 8.5, color: P.muted }}>{k}</p>
                      <p style={{ fontSize: 16, fontWeight: 600, color: P.ink }}>{v}</p>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 96, marginTop: 10 }}>
                  {[46, 78, 66, 92, 58, 70, 38, 84, 52, 74].map((h, i) => (
                    <div key={i} style={{ flex: 1, height: h + '%', background: i % 2 ? P.blue : P.blueSoft, borderRadius: '2px 2px 0 0' }} />
                  ))}
                </div>
              </div>
              <button onClick={() => setView('properties')} style={{
                marginTop: 9, fontSize: 9.5, fontWeight: 600, color: P.blue, background: 'none',
                border: '1px solid ' + P.blue, borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
              }}>Go to My properties &#8594;</button>
            </div>
          ) : view === 'properties' ? (
            /* ── 3 · MY PROPERTIES ─────────────────────────────────────────── */
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: P.ink }}>My properties</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9, marginTop: 9 }}>
                {[0, 1, 2].map(i => (
                  <button key={i} onClick={() => setView('calendar')} style={{
                    border: '1px solid ' + (i === 0 ? P.blue : P.line), borderRadius: 8, background: P.card,
                    padding: 0, overflow: 'hidden', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <div style={{ position: 'relative', height: 74, background: P.unavail }}>
                      {pics[i] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={pics[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : null}
                      <span style={{
                        position: 'absolute', top: 5, right: 5, fontSize: 7, fontWeight: 600,
                        background: '#e7f5ee', color: '#1a7f5a', borderRadius: 4, padding: '2px 5px',
                      }}>Active</span>
                    </div>
                    <div style={{ padding: '7px 8px 9px' }}>
                      <p style={{ fontSize: 9.5, fontWeight: 700, color: P.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {i === 0 ? (unitName || 'Your unit') : (unitName || 'Your unit') + ' · ' + (i + 1)}
                      </p>
                      <p style={{ fontSize: 7.5, color: P.muted, marginTop: 2 }}>Miami, Florida, United States</p>
                    </div>
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 8.5, color: P.muted, marginTop: 9 }}>Open a property to reach its calendar.</p>
            </div>
          ) : view === 'analytics' ? (
            /* ── 6 · ANALYTICS ─────────────────────────────────────────────── */
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <p style={{ fontSize: 12.5, fontWeight: 700, color: P.ink }}>Analytics</p>
                <span style={{ fontSize: 8, color: P.body, border: '1px solid ' + P.line, borderRadius: 5, padding: '2px 6px', background: P.card }}>All properties &#9662;</span>
                <span style={{ fontSize: 8, color: P.body, border: '1px solid ' + P.line, borderRadius: 5, padding: '2px 6px', background: P.card }}>Time frame: This year &#9662;</span>
              </div>
              <div style={{ display: 'flex', gap: 13, marginTop: 7, borderBottom: '1px solid ' + P.line }}>
                {['Performance', 'Operations'].map((x, i) => (
                  <span key={x} style={{ fontSize: 9, fontWeight: 600, color: i === 0 ? P.blue : P.muted, paddingBottom: 5, borderBottom: '2px solid ' + (i === 0 ? P.blue : 'transparent') }}>{x}</span>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 8 }}>
                {tile('Net rental income', '$48,910')}
                {tile("Estimated owner's revenue", '$41,260')}
                {tile('Occupancy', '61%')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 138px', gap: 8, marginTop: 8 }}>
                <div style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, padding: 8 }}>
                  <span style={{ fontSize: 8, color: P.body, border: '1px solid ' + P.line, borderRadius: 5, padding: '2px 6px' }}>Net rental income &#9662;</span>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 74, marginTop: 7 }}>
                    {[30, 96, 78, 46, 40, 30, 30, 36, 24, 9, 4, 22].map((h, i) => (
                      <div key={i} style={{ flex: 1, height: h + '%', background: P.blueSoft, borderRadius: '2px 2px 0 0' }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', marginTop: 3 }}>
                    {['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((m, i) => (
                      <span key={i} style={{ fontSize: 6.5, color: P.muted, flex: 1, textAlign: 'center' }}>{m}</span>
                    ))}
                  </div>
                </div>
                <div style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, padding: 8 }}>
                  <p style={{ fontSize: 8.5, fontWeight: 700, color: P.ink, textAlign: 'center' }}>Revenue per property</p>
                  <div style={{
                    width: 50, height: 50, borderRadius: 999, margin: '6px auto 5px',
                    background: 'conic-gradient(' + P.blueSoft + ' 0 38%, #35a37a 38% 66%, #ef8a7a 66% 88%, ' + P.blue + ' 88% 100%)',
                  }} />
                  {[['This unit', '38%'], ['Unit 2', '28%'], ['Unit 3', '22%']].map(r => (
                    <div key={r[0]} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: P.body, padding: '1px 0' }}>
                      <span>{r[0]}</span><span>{r[1]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ── 4 · CALENDAR AND RESERVATIONS ─────────────────────────────── */
            <div style={{ display: 'grid', gridTemplateColumns: '98px 1fr', columnGap: 10, minHeight: 0 }}>
              {/* the real left rail: the property, then its one nav item */}
              <div style={{ minWidth: 0 }}>
                <div style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, overflow: 'hidden' }}>
                  <div style={{ position: 'relative', height: 52, background: P.unavail }}>
                    {pics[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pics[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : null}
                    <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 6.5, fontWeight: 600, background: '#e7f5ee', color: '#1a7f5a', borderRadius: 4, padding: '1px 4px' }}>Active</span>
                  </div>
                  <p style={{ fontSize: 8.5, fontWeight: 700, color: P.ink, padding: '6px 7px 7px', lineHeight: 1.25 }}>{unitName || 'Your unit'}</p>
                </div>
                <p style={{ fontSize: 8, color: P.blue, fontWeight: 600, marginTop: 8 }}>Calendar and reservations</p>
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: P.ink }}>Calendar and reservations</p>
                  <button onClick={() => { setDrawer(true); setOpen(null) }} style={{
                    marginLeft: 'auto', background: P.green, color: '#fff', border: 0, borderRadius: 6,
                    fontSize: 10, fontWeight: 600, padding: '6px 11px', cursor: 'pointer',
                  }}>+ New reservation</button>
                </div>
                <p style={{ fontSize: 9, color: P.muted, textAlign: 'center', marginTop: 4 }}>&#8249;&ensp;September 2026&ensp;&#8250;</p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 5, marginTop: 6 }}>
                  {tile('Booked nights', String(12 + (mine ? mine.to - mine.from + 1 : 0)))}
                  {tile("Estimated owner's revenue", '$2,140')}
                  {tile('Occupancy', mine ? '53%' : '40%')}
                  {tile('Revenue PAL', '$71.30')}
                  {tile('Net rental income', '$1,712')}
                </div>

                <div style={{ marginTop: 7, border: '1px solid ' + P.line, borderRadius: 8, background: P.card, padding: 7 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                      <div key={d} style={{ fontSize: 8, color: P.muted, textAlign: 'center', paddingBottom: 2 }}>{d}</div>
                    ))}
                    {Array.from({ length: 30 }, (_, i) => i + 1).map(d => {
                      const r = resvOn(d)
                      const ours = isMine(d)
                      const picking = isPicking(d)
                      const bg = ours ? P.ownerBlue : r ? P.greenBar : picking ? '#cfe0fb' : P.card
                      return (
                        <button key={d}
                          onClick={() => { if (r) { setOpen(r); setDrawer(false) } else pick(d) }}
                          title={r ? r.guest : ours ? 'Your stay' : 'Available'}
                          style={{
                            position: 'relative', height: 34, borderRadius: 3,
                            border: '1px solid ' + (picking ? P.blue : P.line),
                            background: bg, cursor: 'pointer', padding: 0, overflow: 'hidden',
                          }}>
                          <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 8, color: r || ours ? '#fff' : P.body }}>{d}</span>
                          {!r && !ours && RATES[d] ? (
                            <span style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 7.5, color: P.muted }}>{RATES[d]}</span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    {[['Confirmed reservation', P.greenBar], ['Owner stay', P.ownerBlue], ['Other owner stay', '#1b365d'],
                      ['Available', P.card], ['Unavailable', P.unavail], ['Requested', P.amber]].map(([l, c]) => (
                      <span key={l} style={{ fontSize: 7, color: P.muted, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 999, background: c, border: c === P.card ? '1px solid ' + P.line : 0, display: 'inline-block' }} />{l}
                      </span>
                    ))}
                  </div>
                </div>

                {mine ? (
                  <p style={{ fontSize: 9, color: P.green, marginTop: 6, fontWeight: 600 }}>
                    Owner stay created &middot; Sept {mine.from}&ndash;{mine.to}. The clean afterwards is billed to you at cost.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* ── a guest booking, tapped ───────────────────────────────────────── */}
        {open ? (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,28,48,0.26)' }} onClick={() => setOpen(null)}>
            <div onClick={e => e.stopPropagation()} style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: '46%', background: P.card, padding: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <p style={{ fontSize: 11.5, fontWeight: 700, color: P.ink }}>Reservation</p>
                <button onClick={() => setOpen(null)} style={{ marginLeft: 'auto', background: 'none', border: 0, fontSize: 13, color: P.muted, cursor: 'pointer', lineHeight: 1 }}>&times;</button>
              </div>
              <span style={{ display: 'inline-block', marginTop: 7, fontSize: 7.5, fontWeight: 600, background: '#e7f5ee', color: '#1a7f5a', borderRadius: 4, padding: '2px 6px' }}>Confirmed</span>
              {/* Guest FULL NAME is on in our settings; email, phone, booking source and total
                  payout are all off, so this panel stops where the real one stops. */}
              {[['Guest', open.guest], ['Check-in', 'Sept ' + open.from], ['Check-out', 'Sept ' + (open.to + 1)],
                ['Nights', String(open.to - open.from + 1)], ['Nightly rate', open.rate]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + P.line }}>
                  <span style={{ fontSize: 8.5, color: P.muted }}>{k}</span>
                  <span style={{ fontSize: 9, color: P.ink, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
              <p style={{ fontSize: 8, color: P.muted, marginTop: 9, lineHeight: 1.45 }}>
                Guest contact details stay with us &mdash; you never have to handle a guest.
              </p>
            </div>
          </div>
        ) : null}

        {/* ── "Create a reservation", the real drawer ───────────────────────── */}
        {drawer ? (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,28,48,0.26)' }}>
            <div style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: '54%', background: P.card,
              padding: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ fontSize: 11.5, fontWeight: 700, color: P.ink }}>Create a reservation</p>
                  <p style={{ fontSize: 7.5, color: P.muted, marginTop: 2, lineHeight: 1.4 }}>
                    Reserve the property for yourself or for your friends &amp; family.
                  </p>
                </div>
                <button onClick={() => setDrawer(false)} style={{ marginLeft: 'auto', background: 'none', border: 0, fontSize: 13, color: P.muted, cursor: 'pointer', lineHeight: 1 }}>&times;</button>
              </div>

              <p style={{ fontSize: 8, fontWeight: 700, color: P.ink, marginTop: 9 }}>Reservation details</p>
              <p style={{ fontSize: 7.5, color: P.muted, marginTop: 5 }}>Check-in and check-out dates</p>
              <div style={{ border: '1px solid ' + (from != null ? P.blue : P.line), borderRadius: 5, padding: '5px 8px', marginTop: 3, fontSize: 8.5, color: from != null ? P.ink : P.muted }}>
                {from == null ? 'Start Date  -  End Date'
                  : to == null ? `Sept ${from}  -  now pick the last night`
                  : `Sept ${from}  -  Sept ${to} · ${nights} ${nights === 1 ? 'night' : 'nights'}`}
              </div>
              <p style={{ fontSize: 7, color: P.blue, marginTop: 4 }}>
                {to == null ? 'Tap the nights on the calendar behind this panel.' : 'Looks right? Create it.'}
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                {[['Arrival time', '04 : 00 PM'], ['Departure time', '11 : 00 AM']].map(([l, v]) => (
                  <div key={l}>
                    <p style={{ fontSize: 7.5, color: P.muted }}>{l}</p>
                    <div style={{ border: '1px solid ' + P.line, borderRadius: 5, padding: '5px 8px', marginTop: 3, fontSize: 8.5, color: P.muted, background: P.bg }}>{v}</div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 8, fontWeight: 700, color: P.ink, marginTop: 9 }}>Guests</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 4 }}>
                {([['Adults', adults, setAdults], ['Children', 0, null], ['Infants', 0, null]] as Array<[string, number, ((n: number) => void) | null]>).map(([l, v, set]) => (
                  <div key={l}>
                    <p style={{ fontSize: 7.5, color: P.muted }}>{l}</p>
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid ' + P.line, borderRadius: 5, padding: '3px 6px', marginTop: 3 }}>
                      <span style={{ fontSize: 8.5, color: P.ink, flex: 1 }}>{v}</span>
                      {set ? (
                        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 0.8 }}>
                          <button aria-label="more adults" onClick={() => set(Math.min(9, v + 1))} style={{ background: 'none', border: 0, fontSize: 7, color: P.muted, cursor: 'pointer', padding: 0 }}>&#9650;</button>
                          <button aria-label="fewer adults" onClick={() => set(Math.max(1, v - 1))} style={{ background: 'none', border: 0, fontSize: 7, color: P.muted, cursor: 'pointer', padding: 0 }}>&#9660;</button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={() => setFf(!ff)} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 9, background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 2, flex: '0 0 auto', marginTop: 1,
                  border: '1px solid ' + (ff ? P.blue : P.muted), background: ff ? P.blue : 'transparent',
                  color: '#fff', fontSize: 7, lineHeight: '9px', textAlign: 'center',
                }}>{ff ? '✓' : ''}</span>
                <span style={{ fontSize: 8, color: P.body, lineHeight: 1.35 }}>Reserve for friends &amp; family</span>
              </button>

              <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={create} disabled={from == null || to == null}
                  style={{
                    background: from != null && to != null ? P.blue : '#b9cdf5', color: '#fff', border: 0,
                    borderRadius: 6, fontSize: 9.5, fontWeight: 600, padding: '7px 13px',
                    cursor: from != null && to != null ? 'pointer' : 'default',
                  }}>Create reservation</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── the steps ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: P.muted }}>Try it</p>
        <div style={{ marginTop: 9, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {STEPS.map((s, i) => {
            const on = i === step
            return (
              <div key={s.k} style={{ padding: '6px 0 6px 9px', borderLeft: '2px solid ' + (on ? P.blue : '#e6e9f0') }}>
                <p style={{ fontSize: 11, fontWeight: on ? 700 : 500, color: on ? P.ink : P.muted }}>{i + 1}. {s.k}</p>
                {on ? <p style={{ fontSize: 9.5, lineHeight: 1.45, color: P.body, marginTop: 2 }}>{s.d}</p> : null}
              </div>
            )
          })}
        </div>
        <button onClick={reset} style={{
          alignSelf: 'flex-start', marginTop: 7, fontSize: 9, color: P.body, background: 'none',
          border: '1px solid ' + P.line, borderRadius: 6, padding: '5px 9px', cursor: 'pointer',
        }}>Start over</button>
        <p style={{ fontSize: 8, color: P.muted, lineHeight: 1.4, marginTop: 7 }}>
          An illustration of your Owners Portal &mdash; the figures and guest names are made up.
          The real one is at {host}.
        </p>
      </div>
    </div>
  )
}
