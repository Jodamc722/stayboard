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

// ── THE MONTH, AND WHY IT IS DRAWN THIS WAY ─────────────────────────────────
// Jon, 2026-09-18: "more gaps in the calendar, and multiple reservations to show the
// distinctions." The legend under the real calendar has six keys and the first draft only ever
// showed one of them, so five sixths of it was decoration. Every kind now appears once, with
// space between them: a guest booking, a second guest booking, a stay the owner already has, a
// CO-OWNER's stay, a request still waiting, and a night we have blocked. Tapping any of them
// opens the detail, and the six panels are not the same — which is the distinction being taught.
//
// Fourteen of thirty nights are open, deliberately. The live month was 25 of 30 sold, which is
// true and useless to demonstrate with: it left five pickable nights in one corner.
type Kind = 'guest' | 'owner' | 'coowner' | 'requested' | 'blocked'
type Resv = { id: string; kind: Kind; guest?: string; from: number; to: number; rate?: string }

const RESV: Resv[] = [
  { id: 'r1', kind: 'guest', guest: 'Maria Alvarez', from: 2, to: 6, rate: '$182' },
  { id: 'r2', kind: 'guest', guest: 'Robert Whitfield', from: 10, to: 13, rate: '$176' },
  { id: 'r3', kind: 'owner', from: 17, to: 18 },
  { id: 'r4', kind: 'coowner', from: 21, to: 22 },
  { id: 'r5', kind: 'requested', guest: 'Priya Raman', from: 26, to: 27, rate: '$188' },
  { id: 'r6', kind: 'blocked', from: 29, to: 29 },
]
const RATES: Record<number, string> = {
  1: '$168', 7: '$170', 8: '$166', 9: '$166', 14: '$174', 15: '$178', 16: '$172',
  19: '$176', 20: '$188', 23: '$184', 24: '$180', 25: '$174', 28: '$170', 30: '$178',
}
const resvOn = (d: number) => RESV.find(r => d >= r.from && d <= r.to) || null

const KIND: Record<Kind, { fill: string; label: string; onDark: boolean }> = {
  guest: { fill: '#6cc08b', label: 'Confirmed reservation', onDark: true },
  owner: { fill: '#2f80ed', label: 'Owner stay', onDark: true },
  coowner: { fill: '#1b365d', label: 'Other owner stay', onDark: true },
  requested: { fill: '#f2b93b', label: 'Requested reservation', onDark: true },
  blocked: { fill: '#dbe6f7', label: 'Unavailable', onDark: false },
}

type View = 'login' | 'dashboard' | 'properties' | 'calendar' | 'analytics' | 'report' | 'documents' | 'accounting' | 'help'

const STEPS: { k: string; d: string; at: View[] }[] = [
  { k: 'Sign in', d: 'Your own email and password at the address above. We never send you a code.', at: ['login'] },
  { k: 'Your dashboard', d: 'What the portal opens on: how the last 30 days went across everything you own.', at: ['dashboard'] },
  { k: 'My properties', d: 'Every unit you own. Open one to reach its calendar.', at: ['properties'] },
  { k: 'The calendar', d: 'Green is a guest, blue is your own stay, amber is a request, grey is held by us. Tap any of them.', at: ['calendar'] },
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
    if (resvOn(d) || isMine(d)) return  // any hold blocks it, not just a guest booking
    if (from == null || to != null) { setFrom(d); setTo(null); return }
    if (d <= from) { setFrom(d); setTo(null); return }
    for (let x = from; x <= d; x++) if (resvOn(x)) return
    setTo(d)
  }
  const create = () => {
    if (from == null || to == null) return
    setMine({ from, to }); setDrawer(false); setFrom(null); setTo(null)
  }

  // EVERY TAB GOES SOMEWHERE (Jon, 2026-09-18: "can we have all the tabs working, can be just a
  // visual of the page, not have to click into anything"). Four of the seven used to be dead
  // type, which on a walkthrough reads as "that part is not for you" rather than "we did not
  // draw it". They are static pages — enough to recognise the screen when they land on it.
  const TABS: { label: string; to: View }[] = [
    { label: 'Dashboard', to: 'dashboard' }, { label: 'My properties', to: 'properties' },
    { label: 'Analytics', to: 'analytics' }, { label: 'Reservation report', to: 'report' },
    { label: 'Documents', to: 'documents' }, { label: 'Accounting', to: 'accounting' },
    { label: 'Help center', to: 'help' },
  ]
  const activeTab = view === 'analytics' ? 'Analytics' : view === 'dashboard' ? 'Dashboard'
    : (view === 'properties' || view === 'calendar') ? 'My properties'
    : view === 'report' ? 'Reservation report' : view === 'documents' ? 'Documents'
    : view === 'accounting' ? 'Accounting' : view === 'help' ? 'Help center' : ''

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
          ) : view === 'report' ? (
            /* ── RESERVATION REPORT ────────────────────────────────────────── */
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: P.ink }}>Reservation report</p>
              <div style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.6fr 0.9fr', padding: '6px 9px', background: P.bg, borderBottom: '1px solid ' + P.line }}>
                  {['Guest', 'Check-in', 'Check-out', 'Nights', 'Status'].map(h => (
                    <span key={h} style={{ fontSize: 7.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: P.muted }}>{h}</span>
                  ))}
                </div>
                {RESV.filter(r => r.kind !== 'blocked').map(r => (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.6fr 0.9fr', padding: '7px 9px', borderBottom: '1px solid ' + P.line, alignItems: 'center' }}>
                    <span style={{ fontSize: 8.5, color: P.ink }}>{r.guest || (r.kind === 'owner' ? 'You' : 'Another owner')}</span>
                    <span style={{ fontSize: 8.5, color: P.body }}>Sept {r.from}</span>
                    <span style={{ fontSize: 8.5, color: P.body }}>Sept {r.to + 1}</span>
                    <span style={{ fontSize: 8.5, color: P.body }}>{r.to - r.from + 1}</span>
                    <span style={{ fontSize: 7.5, fontWeight: 600, color: KIND[r.kind].fill }}>{KIND[r.kind].label}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 8.5, color: P.muted, marginTop: 8 }}>Every reservation on your units, exportable.</p>
            </div>
          ) : view === 'documents' ? (
            /* ── DOCUMENTS ─────────────────────────────────────────────────── */
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: P.ink }}>Documents</p>
              <div style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, marginTop: 8, overflow: 'hidden' }}>
                {['Management agreement.pdf', 'W-9 (signed).pdf', 'ACH authorization.pdf', 'Insurance rider.pdf'].map((f, i) => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', borderBottom: i < 3 ? '1px solid ' + P.line : 'none' }}>
                    <span style={{ fontSize: 8.5, color: P.ink }}>{f}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 8, color: P.blue, fontWeight: 600 }}>Download</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 8.5, color: P.muted, marginTop: 8 }}>Anything you have signed with us, kept in one place.</p>
            </div>
          ) : view === 'accounting' ? (
            /* ── ACCOUNTING ────────────────────────────────────────────────── */
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: P.ink }}>Accounting</p>
              <div style={{ display: 'flex', gap: 13, marginTop: 7, borderBottom: '1px solid ' + P.line }}>
                {['Monthly statements', '1099 files'].map((x, i) => (
                  <span key={x} style={{ fontSize: 9, fontWeight: 600, color: i === 0 ? P.blue : P.muted, paddingBottom: 5, borderBottom: '2px solid ' + (i === 0 ? P.blue : 'transparent') }}>{x}</span>
                ))}
              </div>
              <div style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, marginTop: 8, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.1fr', padding: '6px 9px', background: P.bg, borderBottom: '1px solid ' + P.line }}>
                  {['Period start', 'Period end', 'Actions'].map(h => (
                    <span key={h} style={{ fontSize: 7.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: P.muted }}>{h}</span>
                  ))}
                </div>
                {[['Aug 1, 2026', 'Aug 31, 2026'], ['Jul 1, 2026', 'Jul 31, 2026'], ['Jun 1, 2026', 'Jun 30, 2026']].map((r, i) => (
                  <div key={r[0]} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.1fr', padding: '7px 9px', borderBottom: i < 2 ? '1px solid ' + P.line : 'none', alignItems: 'center' }}>
                    <span style={{ fontSize: 8.5, color: P.ink }}>{r[0]}</span>
                    <span style={{ fontSize: 8.5, color: P.body }}>{r[1]}</span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {['View document', 'Download'].map(a => (
                        <span key={a} style={{ fontSize: 7.5, color: P.body, border: '1px solid ' + P.line, borderRadius: 4, padding: '2px 6px' }}>{a}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 8.5, color: P.muted, marginTop: 8 }}>Your monthly owner statement lands here the moment it is issued.</p>
            </div>
          ) : view === 'help' ? (
            /* ── HELP CENTER ───────────────────────────────────────────────── */
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: P.ink }}>Help center</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, marginTop: 9 }}>
                {['How do I book my own stay?', 'How do I read my statement?', 'Where do I update my payout details?', 'Who do I call about the unit?'].map(q => (
                  <div key={q} style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, padding: '10px 11px' }}>
                    <p style={{ fontSize: 9, fontWeight: 600, color: P.ink, lineHeight: 1.35 }}>{q}</p>
                    <p style={{ fontSize: 8, color: P.blue, marginTop: 4 }}>Read &#8594;</p>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 8.5, color: P.muted, marginTop: 9 }}>
                And if the answer is not here, your team&rsquo;s numbers are two slides back.
              </p>
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
                  {/* Nine guest nights of thirty. The figures agree with the calendar below
                      them, because an owner who counts the green squares should not find a
                      different answer in the tile. */}
                  {tile('Booked nights', '9')}
                  {tile("Estimated owner's revenue", '$1,604')}
                  {tile('Occupancy', '30%')}
                  {tile('Revenue PAL', '$53.47')}
                  {tile('Net rental income', '$1,283')}
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
                      const k = r ? KIND[r.kind] : null
                      const bg = ours ? P.ownerBlue : k ? k.fill : picking ? '#cfe0fb' : P.card
                      const light = ours ? true : k ? k.onDark : false
                      return (
                        <button key={d}
                          onClick={() => { if (r) { setOpen(r); setDrawer(false) } else pick(d) }}
                          title={r ? k!.label + (r.guest ? ' \u2014 ' + r.guest : '') : ours ? 'Your stay' : 'Available'}
                          style={{
                            position: 'relative', height: 34, borderRadius: 3,
                            border: '1px solid ' + (picking ? P.blue : P.line),
                            background: bg, cursor: 'pointer', padding: 0, overflow: 'hidden',
                          }}>
                          <span style={{ position: 'absolute', top: 2, right: 4, fontSize: 8, color: light ? '#fff' : P.body }}>{d}</span>
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
                <p style={{ fontSize: 11.5, fontWeight: 700, color: P.ink }}>
                  {open.kind === 'blocked' ? 'Blocked night' : 'Reservation'}
                </p>
                <button onClick={() => setOpen(null)} style={{ marginLeft: 'auto', background: 'none', border: 0, fontSize: 13, color: P.muted, cursor: 'pointer', lineHeight: 1 }}>&times;</button>
              </div>
              <span style={{
                display: 'inline-block', marginTop: 7, fontSize: 7.5, fontWeight: 600, borderRadius: 4,
                padding: '2px 6px', color: '#fff', background: KIND[open.kind].fill,
                ...(open.kind === 'blocked' ? { color: P.body } : null),
              }}>{KIND[open.kind].label}</span>
              {/* Guest FULL NAME is on in our settings; email, phone, booking source and total
                  payout are all off, so a guest panel stops where the real one stops. The other
                  four kinds carry less again, which is the point of showing them side by side. */}
              {([
                open.guest ? ['Guest', open.guest] : null,
                open.kind === 'owner' ? ['Booked by', 'You'] : null,
                open.kind === 'coowner' ? ['Booked by', 'Another owner of this unit'] : null,
                open.kind === 'blocked' ? ['Reason', 'Held by Stay'] : null,
                ['Check-in', 'Sept ' + open.from],
                ['Check-out', 'Sept ' + (open.to + 1)],
                ['Nights', String(open.to - open.from + 1)],
                open.rate ? ['Nightly rate', open.rate] : null,
              ].filter(Boolean) as string[][]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid ' + P.line }}>
                  <span style={{ fontSize: 8.5, color: P.muted }}>{k}</span>
                  <span style={{ fontSize: 9, color: P.ink, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
              <p style={{ fontSize: 8, color: P.muted, marginTop: 8, lineHeight: 1.45 }}>
                {open.kind === 'guest' ? 'Guest contact details stay with us \u2014 you never have to handle a guest.'
                  : open.kind === 'owner' ? 'Your own stay. The clean afterwards is billed to you at cost.'
                  : open.kind === 'coowner' ? 'Another owner of this unit has these nights. You can see that they are taken, not who is in.'
                  : open.kind === 'requested' ? 'Not confirmed yet. It holds the nights until it is accepted or it expires.'
                  : 'We have held this night \u2014 usually maintenance, or a turnover that needs the extra day.'}
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
