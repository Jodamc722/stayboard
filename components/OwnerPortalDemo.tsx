'use client'
// ── THE OWNER PORTAL, WALKED THROUGH ────────────────────────────────────────
//
// Jon, 2026-09-18, across several messages: "can we do an actual real illustration of the owner
// portal, make it interactive… show them how to actually make an owner reservation" → "make it
// real and interactive" → "make it just like the real owner portal" → "just main features" →
// "make an owner stay, view calendar and booking, and look at analytics (not accounting data)".
//
// SO IT IS DRAWN FROM THE REAL THING, NOT FROM MEMORY. Every screen below was opened in our own
// portal at stayhospitality.guestyowners.com on 2026-09-18 (Guesty → Operations → Owners →
// Preview) and copied: the white top nav and its tab order, the blue active underline, the green
// "+ New reservation" button, the five metric tiles above the calendar and their exact labels,
// the green reservation bars with nightly rates on the open nights, the six-key legend, and the
// "Create a reservation" drawer with its real fields. The first version of this file was styled
// in the deck's own palette and invented a tab list; it looked good and taught the wrong screen.
//
// THREE FEATURES, BECAUSE THAT IS WHAT WAS ASKED FOR. Calendar and bookings, making an owner
// stay, and Analytics. Accounting exists in the portal and is deliberately not demonstrated.
//
// WHAT OUR SETTINGS ACTUALLY ALLOW (read from Portal settings the same day) shapes two details
// that would otherwise be wrong:
//   · Arrival and departure time are SHOWN BUT NOT EDITABLE — "Change check-in and check-out
//     times" is off for our owners, so the real drawer greys them at 4:00 PM / 11:00 AM.
//   · There is no reviews or ratings widget anywhere, because both are switched off
//     (Jon: "we won't let them see reviews on owner portal").
// A walkthrough that shows a control the owner will not find is worse than no walkthrough: they
// go looking for it, fail, and call us.
//
// IT IS AN ILLUSTRATION AND SAYS SO on the slide. It carries Guesty's real control names because
// that is the point — an owner has to recognise "+ New reservation" when they see it — but it
// holds no real owner's data: every figure here is invented and the unit is the owner's own.
import { useMemo, useState } from 'react'

type Props = {
  unitName: string
  portalUrl: string
  ownerName?: string
}

// The portal's own palette, sampled from the live screens. Deliberately NOT the deck's theme:
// the owner is being taught to recognise a blue Guesty screen, not a Stay-branded one.
const P = {
  bg: '#f6f8fd',
  card: '#ffffff',
  line: '#e4e9f2',
  ink: '#1a2340',
  body: '#41506e',
  muted: '#8390ab',
  blue: '#2563eb',
  blueSoft: '#93b4fb',
  green: '#17a673',
  greenBar: '#6cc08b',
  ownerBlue: '#2f80ed',
  amber: '#f2b93b',
  unavail: '#dbe6f7',
}

const STEPS = [
  { k: 'Your calendar', d: 'Every guest booking, the nightly rate on the open nights, and how the month is performing.' },
  { k: 'New reservation', d: 'The green button, top right. It is the same button whether the stay is for you or for family.' },
  { k: 'Dates and guests', d: 'Pick your nights and say how many are coming. Arrival and departure times are set by us.' },
  { k: 'Create reservation', d: 'Held the moment you press it. Nothing can book over those nights.' },
  { k: 'Analytics', d: 'How the unit is doing across the year, and which of your units is earning what.' },
]

/** Invented bookings, shaped like a real month so the calendar reads true. */
const BOOKED = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])
const RATES: Record<number, string> = { 26: '$77', 27: '$72', 28: '$81', 29: '$78', 30: '$79' }
const LEAD = 0 // the 1st falls on a Monday in this illustration

export default function OwnerPortalDemo({ unitName, portalUrl, ownerName }: Props) {
  const [tab, setTab] = useState<'cal' | 'analytics'>('cal')
  const [step, setStep] = useState(0)
  const [drawer, setDrawer] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [adults, setAdults] = useState(2)
  const [ff, setFf] = useState(false)
  const [done, setDone] = useState(false)

  const host = String(portalUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const nights = from != null && to != null ? Math.max(1, to - from) : 0

  const reset = () => { setTab('cal'); setStep(0); setDrawer(false); setFrom(null); setTo(null); setAdults(2); setFf(false); setDone(false) }

  // The one place with real rules: a night a guest already has cannot be picked, and a range
  // cannot jump over one. Teaching otherwise would set an owner up to fail on the real screen.
  const pick = (d: number) => {
    if (BOOKED.has(d) || done) return
    if (from == null || to != null) { setFrom(d); setTo(null); setStep(2); return }
    if (d <= from) { setFrom(d); setTo(null); return }
    for (let x = from; x <= d; x++) if (BOOKED.has(x)) return
    setTo(d); setStep(2)
  }
  const mine = (d: number) => from != null && to != null && d >= from && d <= to

  const openDrawer = () => { setDrawer(true); setStep(2) }
  const create = () => { if (from != null && to != null) { setDone(true); setDrawer(false); setStep(3) } }

  const cells = useMemo(() => {
    const out: (number | null)[] = []
    for (let i = 0; i < LEAD; i++) out.push(null)
    for (let d = 1; d <= 30; d++) out.push(d)
    return out
  }, [])

  const TABS = ['Dashboard', 'My properties', 'Analytics', 'Reservation report', 'Documents', 'Accounting', 'Help center']
  const activeTab = tab === 'analytics' ? 'Analytics' : 'My properties'

  const tile = (label: string, value: string, key?: string) => (
    <div key={key || label} style={{ border: '1px solid ' + P.line, borderRadius: 8, padding: '7px 9px', background: P.card, minWidth: 0 }}>
      <p style={{ fontSize: 9.5, color: P.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</p>
      <p style={{ fontSize: 14, fontWeight: 600, color: P.ink, marginTop: 2 }}>{value}</p>
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 250px', columnGap: 24, height: '100%', minHeight: 0 }}>
      {/* ── the portal ─────────────────────────────────────────────────────── */}
      <div style={{
        border: '1px solid ' + P.line, borderRadius: 10, overflow: 'hidden', position: 'relative',
        background: P.bg, display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        {/* the real top nav: white, small wordmark, blue active underline, owner chip right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', height: 34, background: P.card, borderBottom: '1px solid ' + P.line }}>
          <span style={{ fontSize: 7.5, letterSpacing: '0.16em', color: P.muted, fontWeight: 700 }}>STAY</span>
          {TABS.map(x => {
            const on = x === activeTab
            const live = x === 'Analytics' || x === 'My properties'
            return (
              <button key={x} onClick={() => { if (x === 'Analytics') { setTab('analytics'); setStep(4) } else if (x === 'My properties') setTab('cal') }}
                style={{
                  fontSize: 10, fontWeight: 600, letterSpacing: 'normal', fontFamily: 'inherit',
                  color: on ? P.blue : P.body,
                  background: 'none', border: 0, padding: '9px 0 8px', cursor: live ? 'pointer' : 'default',
                  borderBottom: '2px solid ' + (on ? P.blue : 'transparent'), whiteSpace: 'nowrap',
                }}>{x}</button>
            )
          })}
          <span style={{ marginLeft: 'auto', fontSize: 8.5, color: P.body, whiteSpace: 'nowrap' }}>
            {ownerName || 'You'} <span style={{ color: P.muted }}>&#9662;</span>
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: 10, overflow: 'hidden' }}>
          {tab === 'analytics' ? (
            // ── ANALYTICS ────────────────────────────────────────────────
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: P.ink }}>Analytics</p>
                <span style={{ fontSize: 8, color: P.body, border: '1px solid ' + P.line, borderRadius: 5, padding: '2px 6px', background: P.card }}>All properties &#9662;</span>
                <span style={{ fontSize: 8, color: P.body, border: '1px solid ' + P.line, borderRadius: 5, padding: '2px 6px', background: P.card }}>Time frame: This year &#9662;</span>
              </div>
              <div style={{ display: 'flex', gap: 14, marginTop: 8, borderBottom: '1px solid ' + P.line }}>
                {['Performance', 'Operations'].map((x, i) => (
                  <span key={x} style={{ fontSize: 9, fontWeight: i === 0 ? 700 : 500, color: i === 0 ? P.blue : P.muted, paddingBottom: 5, borderBottom: '2px solid ' + (i === 0 ? P.blue : 'transparent') }}>{x}</span>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 9 }}>
                {tile('Net rental income', '$48,910')}
                {tile("Estimated owner's revenue", '$41,260')}
                {tile('Occupancy', '61%')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 8, marginTop: 8 }}>
                <div style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, padding: 8 }}>
                  <p style={{ fontSize: 8, color: P.body, border: '1px solid ' + P.line, borderRadius: 5, padding: '2px 6px', display: 'inline-block' }}>Net rental income &#9662;</p>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 86, marginTop: 7 }}>
                    {[30, 96, 78, 46, 40, 30, 30, 36, 24, 9, 4, 22].map((h, i) => (
                      <div key={i} style={{ flex: 1, height: h + '%', background: P.blueSoft, borderRadius: '2px 2px 0 0' }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                    {['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'].map((m, i) => (
                      <span key={i} style={{ fontSize: 6.5, color: P.muted, flex: 1, textAlign: 'center' }}>{m}</span>
                    ))}
                  </div>
                </div>
                <div style={{ border: '1px solid ' + P.line, borderRadius: 8, background: P.card, padding: 8 }}>
                  <p style={{ fontSize: 8.5, fontWeight: 700, color: P.ink, textAlign: 'center' }}>Revenue per property</p>
                  <div style={{
                    width: 54, height: 54, borderRadius: 999, margin: '7px auto 6px',
                    background: 'conic-gradient(' + P.blueSoft + ' 0 26%, #35a37a 26% 50%, #ef8a7a 50% 73%, ' + P.blue + ' 73% 96%, #1f6f4f 96% 100%)',
                  }} />
                  {[['Unit A', '26%'], ['Unit B', '24%'], ['Unit C', '23%']].map(r => (
                    <div key={r[0]} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, color: P.body, padding: '1px 0' }}>
                      <span>{r[0]}</span><span>{r[1]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            // ── CALENDAR AND RESERVATIONS ────────────────────────────────
            <div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <p style={{ fontSize: 12.5, fontWeight: 700, color: P.ink }}>Calendar and reservations</p>
                <button onClick={openDrawer}
                  style={{
                    marginLeft: 'auto', background: P.green, color: '#fff', border: 0, borderRadius: 6,
                    fontSize: 10.5, fontWeight: 600, padding: '6px 12px', cursor: 'pointer',
                  }}>+ New reservation</button>
              </div>
              <p style={{ fontSize: 10, color: P.muted, textAlign: 'center', marginTop: 5 }}>&#8249;&ensp;September 2026&ensp;&#8250;</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginTop: 7 }}>
                {tile('Booked nights', done ? String(25 + nights) : '25')}
                {tile("Estimated owner's revenue", '$1,084')}
                {tile('Occupancy', done ? '97%' : '83%')}
                {tile('Revenue PAL', '$49.86')}
                {tile('Net rental income', '$1,275')}
              </div>

              <div style={{ marginTop: 8, border: '1px solid ' + P.line, borderRadius: 8, background: P.card, padding: 7 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
                    <div key={d} style={{ fontSize: 8.5, color: P.muted, textAlign: 'center', paddingBottom: 3 }}>{d}</div>
                  ))}
                  {cells.map((d, i) => {
                    if (d == null) return <div key={'b' + i} />
                    const booked = BOOKED.has(d)
                    const ours = mine(d)
                    return (
                      <button key={d} onClick={() => pick(d)} disabled={booked || done}
                        title={booked ? 'Guest reservation' : ours ? 'Your stay' : 'Available'}
                        style={{
                          position: 'relative', height: 40, borderRadius: 3, border: '1px solid ' + P.line,
                          background: ours ? P.ownerBlue : booked ? P.greenBar : P.card,
                          cursor: booked || done ? 'default' : 'pointer', padding: 0, overflow: 'hidden',
                        }}>
                        <span style={{
                          position: 'absolute', top: 2, right: 4, fontSize: 8.5,
                          color: booked || ours ? '#fff' : P.body,
                        }}>{d}</span>
                        {!booked && !ours && RATES[d] ? (
                          <span style={{ position: 'absolute', bottom: 2, left: 4, fontSize: 8, color: P.muted }}>{RATES[d]}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
                {/* the real legend, all six keys */}
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {[['Confirmed reservation', P.greenBar], ['Owner stay', P.ownerBlue], ['Other owner stay', '#1b365d'],
                    ['Available', P.card], ['Unavailable', P.unavail], ['Requested', P.amber]].map(([l, c]) => (
                    <span key={l} style={{ fontSize: 8, color: P.muted, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: c, border: c === P.card ? '1px solid ' + P.line : 0, display: 'inline-block' }} />{l}
                    </span>
                  ))}
                </div>
              </div>

              {done ? (
                <p style={{ fontSize: 10, color: P.green, marginTop: 9, fontWeight: 600 }}>
                  Owner stay created &middot; Sept {from}&ndash;{to} &middot; {nights} {nights === 1 ? 'night' : 'nights'}
                  {ff ? ' · friends & family' : ''}. The clean afterwards is billed to you at cost.
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* ── "Create a reservation", the real drawer ───────────────────────── */}
        {drawer ? (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(20,28,48,0.28)' }}>
            <div style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: '62%', background: P.card,
              padding: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: P.ink }}>Create a reservation</p>
                  <p style={{ fontSize: 7.5, color: P.muted, marginTop: 2, lineHeight: 1.4, maxWidth: '44ch' }}>
                    Reserve the property for yourself or for your friends &amp; family. You can also
                    include special requests in the notes section.
                  </p>
                </div>
                <button onClick={() => setDrawer(false)} style={{ marginLeft: 'auto', background: 'none', border: 0, fontSize: 12, color: P.muted, cursor: 'pointer', lineHeight: 1 }}>&times;</button>
              </div>

              <p style={{ fontSize: 8, fontWeight: 700, color: P.ink, marginTop: 10 }}>Reservation details</p>
              <p style={{ fontSize: 7.5, color: P.muted, marginTop: 6 }}>Check-in and check-out dates</p>
              <div style={{ border: '1px solid ' + (from != null ? P.blue : P.line), borderRadius: 5, padding: '5px 8px', marginTop: 3, fontSize: 8.5, color: from != null ? P.ink : P.muted }}>
                {from == null ? 'Start Date  -  End Date' : to == null ? `Sept ${from}  -  pick the last night` : `Sept ${from}  -  Sept ${to}`}
              </div>

              {/* Shown and greyed, exactly as the real drawer does: our settings do not let an
                  owner change these, so hiding them would misrepresent the screen. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                {[['Arrival time', '04 : 00 PM'], ['Departure time', '11 : 00 AM']].map(([l, v]) => (
                  <div key={l}>
                    <p style={{ fontSize: 7.5, color: P.muted }}>{l}</p>
                    <div style={{ border: '1px solid ' + P.line, borderRadius: 5, padding: '5px 8px', marginTop: 3, fontSize: 8.5, color: P.muted, background: P.bg }}>{v}</div>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 8, fontWeight: 700, color: P.ink, marginTop: 10 }}>Guests</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginTop: 4 }}>
                {[['Adults', adults, setAdults], ['Children', 0, null], ['Infants', 0, null]].map(([l, v, set]: any) => (
                  <div key={l}>
                    <p style={{ fontSize: 7.5, color: P.muted }}>{l}</p>
                    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid ' + P.line, borderRadius: 5, padding: '3px 6px', marginTop: 3 }}>
                      <span style={{ fontSize: 8.5, color: P.ink, flex: 1 }}>{v}</span>
                      {set ? (
                        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 0.8 }}>
                          <button onClick={() => set(Math.min(9, v + 1))} style={{ background: 'none', border: 0, fontSize: 7, color: P.muted, cursor: 'pointer', padding: 0 }}>&#9650;</button>
                          <button onClick={() => set(Math.max(1, v - 1))} style={{ background: 'none', border: 0, fontSize: 7, color: P.muted, cursor: 'pointer', padding: 0 }}>&#9660;</button>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <button onClick={() => setFf(!ff)}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 10, background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 2, flex: '0 0 auto', marginTop: 1,
                  border: '1px solid ' + (ff ? P.blue : P.muted), background: ff ? P.blue : 'transparent',
                  color: '#fff', fontSize: 7, lineHeight: '9px', textAlign: 'center',
                }}>{ff ? '✓' : ''}</span>
                <span style={{ fontSize: 8, color: P.body, lineHeight: 1.35 }}>
                  Reserve for friends &amp; family
                  <span style={{ display: 'block', color: P.muted, fontSize: 7 }}>
                    All messages, including check-in instructions, will be sent directly to them.
                  </span>
                </span>
              </button>

              <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={create} disabled={from == null || to == null}
                  style={{
                    background: from != null && to != null ? P.blue : '#b9cdf5', color: '#fff', border: 0,
                    borderRadius: 6, fontSize: 9, fontWeight: 600, padding: '6px 12px',
                    cursor: from != null && to != null ? 'pointer' : 'default',
                  }}>Create reservation</button>
              </div>
              {from == null ? (
                <p style={{ fontSize: 7, color: P.muted, textAlign: 'right', marginTop: 4 }}>
                  Pick your nights on the calendar behind this panel.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* ── the steps ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: P.muted }}>
          Try it
        </p>
        <div style={{ marginTop: 10, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {STEPS.map((s, i) => {
            const on = i === step
            return (
              <div key={s.k} style={{ padding: '7px 0 7px 10px', borderLeft: '2px solid ' + (on ? P.blue : '#e6e9f0') }}>
                <p style={{ fontSize: 11.5, fontWeight: on ? 700 : 500, color: on ? P.ink : P.muted }}>{i + 1}. {s.k}</p>
                {on ? <p style={{ fontSize: 10, lineHeight: 1.45, color: P.body, marginTop: 2 }}>{s.d}</p> : null}
              </div>
            )
          })}
        </div>
        <button onClick={reset} style={{
          alignSelf: 'flex-start', marginTop: 8, fontSize: 9.5, color: P.body, background: 'none',
          border: '1px solid ' + P.line, borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
        }}>Start over</button>
        <p style={{ fontSize: 8.5, color: P.muted, lineHeight: 1.4, marginTop: 8 }}>
          An illustration of your Owners Portal for this walkthrough &mdash; the figures are made
          up. The real one is at {host}.
        </p>
      </div>
    </div>
  )
}
