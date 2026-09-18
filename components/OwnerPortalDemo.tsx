'use client'
// ── THE OWNER PORTAL, WALKED THROUGH ────────────────────────────────────────
//
// Jon, 2026-09-18: "can we do an actual real illustration of the owner portal, make it
// interactive… want to give overview and show them how to actually make an owner reservation",
// then "love the slide but make it real and interactive", then "we won't let them see reviews on
// owner portal — so check our settings".
//
// WHY THIS IS BUILT AND NOT SCREENSHOTTED. A screenshot of the portal is one frozen state, it
// ages the day Guesty ships a redesign, and it cannot show a sequence. The thing an owner
// actually needs is the SEQUENCE — where the button is, what the form asks, what it looks like
// when it worked. So this is a walkthrough they can click.
//
// EVERY LABEL HERE WAS READ OUT OF OUR OWN GUESTY ACCOUNT, not from memory and not from Guesty's
// marketing pages (Operations > Owners > Portal settings, 2026-09-18). That matters because the
// portal is configurable and ours is configured tightly:
//
//   ON   booked nights · owner revenue · revenue per listing · occupancy · net rental income
//   ON   nightly rate · reserved guest reservations · reservation tooltip · guest full name
//   ON   owner booked nights · upcoming owner reservations · ALLOW THE OWNER TO MAKE RESERVATIONS
//   ON   reservations report · help center
//   OFF  guest reviews · overall guest rating · owner inbox
//   OFF  revenue loss · co-owner notes · changing check-in and check-out times
//   OFF  booking sources · total payout · guest email · guest phone · cleaning/inspection photos
//
// So there is no reviews widget in here, no revenue-loss figure, and the reservation form does
// not offer a time picker — because none of those exist for our owners. A walkthrough that shows
// a control the owner will not find is worse than no walkthrough: they go looking for it, fail,
// and call us.
//
// IT IS LABELLED AS AN ILLUSTRATION, on the slide, in words. It carries Guesty's real control
// names because that is the whole point — an owner has to recognise "Create reservation" when
// they see it — but it never pretends to be a live screen or carries Guesty's logo.
import { useMemo, useState } from 'react'

type Tone = {
  ink: string; body: string; muted: string; rule: string; accent: string
  card: string; cardBorder: string; chip: string; bg: string
}

type Props = {
  tone: Tone
  unitName: string
  portalUrl: string
  /** Owner's sign-in email, when the deck knows it. */
  loginEmail?: string
}

const STEPS = [
  { k: 'Sign in', d: 'Your own login, at the address above. Same password every time — no code from us.' },
  { k: 'Open the property', d: 'Everything you own sits under My Properties. Pick the one you want.' },
  { k: 'Pick your dates', d: 'Tap a free night, then the last night. Anything already booked by a guest cannot be picked.' },
  { k: 'Say who it is for', d: 'Yourself, or friends and family staying in your place. That is the only question.' },
  { k: 'Create reservation', d: 'It is held the moment you press the button. Nothing can book over it.' },
]

/** A month of nights. Guest bookings are fixed so the calendar reads like a real one. */
const GUEST_NIGHTS = new Set([3, 4, 5, 6, 9, 10, 20, 21, 22, 23, 24])
const DAYS = 30
const LEAD_BLANKS = 2 // the month starts on a Wednesday

export default function OwnerPortalDemo({ tone: t, unitName, portalUrl, loginEmail }: Props) {
  const [step, setStep] = useState(0)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [ff, setFf] = useState(false)
  const [done, setDone] = useState(false)

  const host = String(portalUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  const nights = from != null && to != null ? Math.max(1, to - from) : 0

  const reset = () => { setStep(0); setFrom(null); setTo(null); setFf(false); setDone(false) }

  // Picking dates is the one place the demo has real rules: you cannot select a night a guest
  // already has, and you cannot select backwards. Getting this wrong would teach the wrong thing.
  const pick = (d: number) => {
    if (GUEST_NIGHTS.has(d) || done) return
    if (from == null || (from != null && to != null)) { setFrom(d); setTo(null); setStep(2); return }
    if (d <= from) { setFrom(d); setTo(null); return }
    for (let x = from; x <= d; x++) if (GUEST_NIGHTS.has(x)) return
    setTo(d); setStep(3)
  }

  const inStay = (d: number) => from != null && to != null && d >= from && d <= to
  const isEdge = (d: number) => d === from || d === to

  const create = () => { if (from != null && to != null) { setDone(true); setStep(4) } }

  const cells = useMemo(() => {
    const out: (number | null)[] = []
    for (let i = 0; i < LEAD_BLANKS; i++) out.push(null)
    for (let d = 1; d <= DAYS; d++) out.push(d)
    return out
  }, [])

  const btn = (label: string, on: () => void, primary?: boolean, disabled?: boolean) => (
    <button onClick={on} disabled={disabled}
      style={{
        fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: '8px 14px', cursor: disabled ? 'default' : 'pointer',
        border: '1px solid ' + (primary ? t.accent : t.cardBorder),
        background: primary ? (disabled ? t.chip : t.accent) : 'transparent',
        color: primary ? (disabled ? t.muted : '#fff') : t.body,
        opacity: disabled ? 0.55 : 1,
      }}>{label}</button>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', columnGap: 30, height: '100%', minHeight: 0 }}>
      {/* ── the portal itself ─────────────────────────────────────────────── */}
      <div style={{
        border: '1px solid ' + t.cardBorder, borderRadius: 12, overflow: 'hidden',
        background: t.card, display: 'flex', flexDirection: 'column', minHeight: 0,
      }}>
        {/* browser chrome, so it reads as a website and not as part of the slide */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid ' + t.rule, background: t.chip }}>
          {['#e5675f', '#e0b34f', '#6fbf73'].map(c => (
            <span key={c} style={{ width: 9, height: 9, borderRadius: 999, background: c, display: 'inline-block' }} />
          ))}
          <span style={{
            marginLeft: 8, flex: 1, fontSize: 11.5, color: t.muted, background: t.bg,
            border: '1px solid ' + t.rule, borderRadius: 999, padding: '4px 12px',
          }}>{host || 'your portal address'}</span>
        </div>

        {/* the tabs our account actually exposes */}
        <div style={{ display: 'flex', gap: 20, padding: '10px 16px 0', borderBottom: '1px solid ' + t.rule }}>
          {['My Properties', 'Reservations report', 'Documents', 'Help center'].map((tab, i) => (
            <span key={tab} style={{
              fontSize: 12, fontWeight: i === 0 ? 700 : 500, paddingBottom: 8,
              color: i === 0 ? t.ink : t.muted,
              borderBottom: '2px solid ' + (i === 0 ? t.accent : 'transparent'),
            }}>{tab}</span>
          ))}
        </div>

        <div style={{ flex: 1, minHeight: 0, padding: 16, display: 'flex', flexDirection: 'column' }}>
          {step === 0 ? (
            // ── SIGN IN ──────────────────────────────────────────────────
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 300 }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: t.ink }}>Sign in to your portal</p>
              <div style={{ marginTop: 14, textAlign: 'left' }}>
                <div style={{ fontSize: 10.5, color: t.muted, marginBottom: 4 }}>Email</div>
                <div style={{ fontSize: 12, color: t.body, border: '1px solid ' + t.rule, borderRadius: 7, padding: '8px 10px', background: t.bg }}>
                  {loginEmail || 'the email we have on file for you'}
                </div>
                <div style={{ fontSize: 10.5, color: t.muted, margin: '10px 0 4px' }}>Password</div>
                <div style={{ fontSize: 12, color: t.muted, border: '1px solid ' + t.rule, borderRadius: 7, padding: '8px 10px', background: t.bg, letterSpacing: 3 }}>
                  ••••••••
                </div>
              </div>
              <div style={{ marginTop: 16 }}>{btn('Sign in', () => setStep(1), true)}</div>
            </div>
          ) : step === 1 ? (
            // ── MY PROPERTIES ────────────────────────────────────────────
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 700, color: t.ink, marginBottom: 10 }}>My Properties</p>
              <button onClick={() => setStep(2)} style={{
                width: '100%', textAlign: 'left', cursor: 'pointer',
                border: '1px solid ' + t.accent, borderRadius: 10, padding: 12, background: t.bg,
              }}>
                <p style={{ fontSize: 13.5, fontWeight: 700, color: t.ink }}>{unitName || 'Your unit'}</p>
                <p style={{ fontSize: 11.5, color: t.muted, marginTop: 3 }}>Tap to open the calendar</p>
              </button>
              {/* The five performance figures our settings switch on, and nothing else. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 14 }}>
                {[['Booked nights', '18'], ['Occupancy', '62%'], ['Owner revenue', '$4,180'],
                  ['Revenue per listing', '$4,180'], ['Net rental income', '$3,344'], ['Upcoming owner stays', '0']].map(([k, v]) => (
                  <div key={k} style={{ border: '1px solid ' + t.rule, borderRadius: 8, padding: '8px 10px', background: t.bg }}>
                    <p style={{ fontSize: 13.5, fontWeight: 700, color: t.ink }}>{v}</p>
                    <p style={{ fontSize: 9.5, color: t.muted, marginTop: 1 }}>{k}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // ── CALENDAR, FORM, RESULT ───────────────────────────────────
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 188px', columnGap: 14, minHeight: 0 }}>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: t.ink, marginBottom: 8 }}>{unitName || 'Your unit'} · April</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3 }}>
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                    <div key={i} style={{ fontSize: 9, color: t.muted, textAlign: 'center', paddingBottom: 2 }}>{d}</div>
                  ))}
                  {cells.map((d, i) => {
                    if (d == null) return <div key={'b' + i} />
                    const guest = GUEST_NIGHTS.has(d)
                    const mine = inStay(d)
                    return (
                      <button key={d} onClick={() => pick(d)} disabled={guest || done}
                        title={guest ? 'Booked by a guest' : 'Free'}
                        style={{
                          fontSize: 10.5, borderRadius: 5, padding: '5px 0', textAlign: 'center',
                          cursor: guest || done ? 'default' : 'pointer',
                          border: '1px solid ' + (mine ? t.accent : t.rule),
                          background: mine ? t.accent : guest ? t.chip : t.bg,
                          color: mine ? '#fff' : guest ? t.muted : t.body,
                          fontWeight: mine && isEdge(d) ? 700 : 400,
                        }}>{d}</button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 9.5, color: t.muted }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, background: t.chip, border: '1px solid ' + t.rule, borderRadius: 2, marginRight: 4 }} />Guest booked</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, background: t.accent, borderRadius: 2, marginRight: 4 }} />Your stay</span>
                </div>
              </div>

              {/* the right-hand panel: the form, then the confirmation */}
              <div style={{ borderLeft: '1px solid ' + t.rule, paddingLeft: 14, minWidth: 0 }}>
                {done ? (
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: t.accent }}>Reservation created</p>
                    <p style={{ fontSize: 11, color: t.body, marginTop: 8, lineHeight: 1.5 }}>
                      April {from}&ndash;{to} · {nights} {nights === 1 ? 'night' : 'nights'}
                      {ff ? ' · friends & family' : ''}
                    </p>
                    <p style={{ fontSize: 10.5, color: t.muted, marginTop: 10, lineHeight: 1.5 }}>
                      It is on our calendar too. No guest booking can land on those nights, and we
                      schedule the turnover around you.
                    </p>
                    <p style={{ fontSize: 10.5, color: t.muted, marginTop: 8, lineHeight: 1.5 }}>
                      The clean after your stay is billed to you at cost &mdash; no guest cleaning
                      fee covers it.
                    </p>
                    <div style={{ marginTop: 12 }}>{btn('Start over', reset)}</div>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: t.ink }}>New owner reservation</p>
                    <div style={{ fontSize: 10.5, color: t.muted, marginTop: 10 }}>Dates</div>
                    <p style={{ fontSize: 11.5, color: from != null ? t.ink : t.muted, marginTop: 2 }}>
                      {from == null ? 'Pick a first night' : to == null ? `April ${from} → pick the last night` : `April ${from}–${to} · ${nights} ${nights === 1 ? 'night' : 'nights'}`}
                    </p>
                    <button onClick={() => { setFf(!ff); if (from != null && to != null) setStep(3) }}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 12, cursor: 'pointer',
                        background: 'none', border: 0, padding: 0, textAlign: 'left',
                      }}>
                      <span style={{
                        width: 13, height: 13, borderRadius: 3, flex: '0 0 auto', marginTop: 1,
                        border: '1px solid ' + (ff ? t.accent : t.cardBorder), background: ff ? t.accent : 'transparent',
                        color: '#fff', fontSize: 9, lineHeight: '12px', textAlign: 'center',
                      }}>{ff ? '✓' : ''}</span>
                      <span style={{ fontSize: 10.5, color: t.body, lineHeight: 1.4 }}>Reserve for friends &amp; family</span>
                    </button>
                    {/* No check-in/check-out time control: that setting is off for our owners, so
                        showing one would send them hunting for a field that is not there. */}
                    <p style={{ fontSize: 9.5, color: t.muted, marginTop: 10, lineHeight: 1.45 }}>
                      Check-in and check-out times are set by us.
                    </p>
                    <div style={{ marginTop: 12 }}>
                      {btn('Create reservation', create, true, from == null || to == null)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── the steps, alongside ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: t.muted }}>
          Making an owner stay
        </p>
        <div style={{ marginTop: 12, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {STEPS.map((s, i) => {
            const on = i === step
            return (
              <button key={s.k} onClick={() => { if (i <= step) setStep(i) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0,
                  padding: '9px 0 9px 12px', borderLeft: '2px solid ' + (on ? t.accent : t.rule),
                  cursor: i <= step ? 'pointer' : 'default',
                }}>
                <p style={{ fontSize: 12.5, fontWeight: on ? 700 : 500, color: on ? t.ink : t.muted }}>
                  {i + 1}. {s.k}
                </p>
                {on ? <p style={{ fontSize: 11, lineHeight: 1.5, color: t.body, marginTop: 3 }}>{s.d}</p> : null}
              </button>
            )
          })}
        </div>
        <p style={{ fontSize: 9.5, color: t.muted, lineHeight: 1.45, marginTop: 10 }}>
          A simplified illustration of your Guesty Owners Portal, for the walkthrough. The real
          portal is at {host}.
        </p>
      </div>
    </div>
  )
}
