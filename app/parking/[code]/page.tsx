'use client'
// THE PARKING BOARD — what a garage vendor sees, on a phone, with one job on it.
//
// Jon, 2026-09-16: "a shareable link that's password protected for all reservations at 17 West…
// send this to a parking vendor that needs to generate QR codes. We should have them upload a QR
// code into the system for that reservation." And then: "it should look like Salados, but it
// should say 'QR code needed' until the QR code is uploaded."
//
// SO THIS PAGE IS THE SALATO FRONT-DESK BOARD, WEARING A DIFFERENT JOB. Same shell, same dark
// gradient header, same tab strip, same day headings, and — the part Jon pointed at — the same
// right-hand button pair: a dark call to action while something is outstanding, an emerald tick
// once it is done. There "Verify" becomes "✓ Verified"; here "QR code needed" becomes "✓ QR code".
// A supervisor who can read one board can read the other without being taught it.
//
// FIVE DECISIONS THAT SHAPED THE CONTENT:
//
// 1. WHAT IS MISSING IS THE PAGE. The vendor's job is "which stays have no code yet", so the board
//    opens on exactly those. Stays that already have a permit collapse behind a count, the way the
//    field board hides finished work — a list of 60 rows when 6 need doing is hiding the 6.
//
// 2. EVERY UPCOMING STAY, NOT JUST THE PAID ONES. Jon's call, and his reason: "it's better to have
//    the QR codes generated versus waiting for the vendor, in case the guest books last minute and
//    the vendor doesn't work weekends." Whether parking was actually paid for is a badge on the
//    row, not a filter on the list — it is the office's signal, not the vendor's instruction.
//
// 3. NO SPARE DRAWER ON THIS PAGE (Jon, 2026-09-16: "remove this section"). The pool was built for
//    the weekend case and it was the busiest thing on a page whose whole job is "which stays have
//    no code" — a card, a stat tile and a per-row alternative, all for an exception. The server
//    side is untouched: the upload route still takes spare=1 and the assign route still binds one,
//    so bringing the drawer back is UI, not a rebuild.
//
// 4. THE GUESTY MAPPING IS VISIBLE. An uploaded code that never reached the reservation is the
//    quiet failure on this page, so a permit that has not been written shows it on the row rather
//    than in a log nobody opens.
//
// 5. THE PASSCODE IS NOT REMEMBERED FOREVER. It lives in sessionStorage: it survives a reload and
//    a tab navigation, and it is gone when the tab closes. A garage office machine is shared.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Permit = {
  id: string; label: string | null; uploadedAt: string; uploadedBy: string | null; wasSpare: boolean
  inGuesty?: boolean; guestyError?: string | null
}
type Row = {
  reservationId: string; unit: string; listingId: string; guest: string; confirmation: string
  checkIn: string; checkOut: string; nights: number; arrivingIn: number; inHouse: boolean
  parkingBooked: number | null; permit: Permit | null
}
type Board = {
  ok: true; label: string; building: string; scopeLabel: string; today: string; windowDays: number
  rows: Row[]
  counts: { stays: number; withPermit: number; needPermit: number; parkingBooked: number; inGuesty?: number }
  truncated?: boolean
  pool: { spare: number; items: { id: string; label: string | null; uploadedAt: string }[] }
  canAssign?: boolean
}

const PASS_KEY = 'pk_pass'
const WHO_KEY = 'pk_who'
type TabKey = 'need' | 'done' | 'all'

const fmtDate = (iso: string) => {
  if (!iso) return ''
  try { return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return iso }
}
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US')

/** A day heading reads better than a date on every row — Salato's rule, same reason. */
function dayLabel(iso: string, today: string) {
  if (!iso) return ''
  if (iso === today) return 'Today'
  const dd = Math.round((+new Date(iso + 'T12:00:00') - +new Date(today + 'T12:00:00')) / 86400000)
  if (dd === 1) return 'Tomorrow'
  if (dd === -1) return 'Yesterday'
  return fmtDate(iso)
}
/**
 * ONE HEADING PER ARRIVAL DAY — except for the people already here.
 *
 * An in-house guest checked in days ago, so keying them on check_in sorted a heading dated last
 * Friday ABOVE "Today" at the top of the default tab: the most prominent thing on the vendor's
 * page would have been a date that means nothing to them. Everyone still in the building shares
 * one bucket that sorts first, because "already here with no code" is genuinely the most urgent
 * row on this board.
 */
const IN_HOUSE = 'in-house'
function groupByDay(rows: Row[]) {
  const m: Record<string, Row[]> = {}
  for (const r of rows) { const k = r.inHouse ? IN_HOUSE : r.checkIn; (m[k] = m[k] || []).push(r) }
  return Object.keys(m)
    .sort((a, b) => (a === IN_HOUSE ? -1 : b === IN_HOUSE ? 1 : a.localeCompare(b)))
    .map(d => ({ date: d, rows: m[d] }))
}

/** When this stay lands, in the words somebody standing at a gate would use. */
function whenWord(r: Row): string {
  if (r.inHouse) return 'in house now'
  // A stay whose check-out is today is still in the window (they are here this morning) but their
  // check-in was days ago. Without this branch they rendered as "arrives today", sat in the
  // Need-a-code tab and got the red border — the most urgent-looking row on the page belonged to
  // somebody driving away.
  if (r.arrivingIn < 0) return 'checking out today'
  if (r.arrivingIn === 0) return 'arrives today'
  if (r.arrivingIn === 1) return 'arrives tomorrow'
  return 'in ' + r.arrivingIn + ' days'
}
/** Leaving today: nobody needs to issue them a code now. */
const leavingToday = (r: Row) => !r.inHouse && r.arrivingIn < 0

export default function ParkingPage({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const [pass, setPass] = useState('')
  const [who, setWho] = useState('')
  const [d, setD] = useState<Board | null>(null)
  const [locked, setLocked] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<TabKey>('need')
  const [qr, setQr] = useState<{ url: string; row: Row; mime: string | null } | null>(null)
  /** null = closed; a Row = the upload sheet for that stay. */
  const [upload, _setUpload] = useState<Row | null>(null)
  // OPENING A SHEET CLEARS THE PAGE ERROR. `err` is page-wide — a failed "view code" on unit 401
  // would otherwise greet the vendor inside unit 512's upload sheet, in a red box, attached to an
  // upload nobody has attempted yet.
  const setUpload = useCallback((v: Row | null) => { if (v) { setErr(''); setNote('') } _setUpload(v) }, [])
  const [note, setNote] = useState<string>('')
  const passRef = useRef('')

  useEffect(() => {
    try {
      const p = sessionStorage.getItem(PASS_KEY) || ''
      const w = localStorage.getItem(WHO_KEY) || ''
      if (p) { passRef.current = p; setPass(p) }
      if (w) setWho(w)
    } catch { /* private mode — they type it again */ }
  }, [])

  const post = useCallback(async (path: string, body: any) => {
    const r = await fetch('/api/public/parking/' + code + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, pass: passRef.current }), cache: 'no-store',
    })
    return { status: r.status, j: await r.json().catch(() => ({})) as any }
  }, [code])

  const load = useCallback(async (p?: string) => {
    if (p != null) passRef.current = p
    setBusy(true); setErr('')
    try {
      const { j } = await post('', {})
      if (j && j.locked) { setLocked(j); setD(null); if (j.error) setErr(j.error) }
      else if (j && j.ok) {
        setLocked(null); setD(j)
        try { sessionStorage.setItem(PASS_KEY, passRef.current) } catch { /* fine */ }
      } else setErr((j && j.error) || 'Could not open this link.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }, [post])

  useEffect(() => { load() }, [load])

  // Escape closes whichever overlay is open. A modal that only closes by tapping a 12px glyph is a
  // modal somebody gets stuck in on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setQr(null); _setUpload(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const rows = useMemo(() => {
    const all = (d?.rows || []).slice().sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit))
    if (tab === 'all') return all
    if (tab === 'done') return all.filter(r => !!r.permit)
    return all.filter(r => !r.permit && !leavingToday(r))
  }, [d, tab])

  // ── upload ────────────────────────────────────────────────────────────────────────────────────
  const send = async (file: File, label: string, row: Row) => {
    if (!who.trim()) { setErr('Add your name first — we need to know who sent the code.'); return }
    setBusy(true); setErr(''); setNote('')
    try {
      const fd = new FormData()
      fd.set('who', who.trim()); fd.set('file', file)
      if (label.trim()) fd.set('label', label.trim())
      fd.set('reservationId', row.reservationId)
      // The passcode is a header, not a form field, so the server can check it before it buffers
      // the file. It is still never in the URL.
      const r = await fetch('/api/public/parking/' + code + '/upload', {
        method: 'POST', body: fd, cache: 'no-store', headers: { 'x-parking-pass': passRef.current },
      })
      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed.')
      // THE GUESTY WRITE IS REPORTED, NOT SWALLOWED. The code is stored either way — that is the
      // point of not letting Guesty fail an upload — but "saved" on its own would read as "the
      // guest can get this", which is only true once it is on the booking.
      const mapped = j.guesty ? (j.guesty.ok ? '' : ' Not on the reservation in Guesty yet — we will retry.') : ''
      setNote((j.replaced ? 'Replaced the code on ' + row.unit + '.' : 'Code saved for ' + row.unit + '.') + mapped)
      setUpload(null)
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const showQr = async (row: Row) => {
    if (!row.permit) return
    setBusy(true); setErr('')
    const { j } = await post('/qr', { id: row.permit.id })
    setBusy(false)
    if (j && j.ok && j.url) setQr({ url: j.url, row, mime: j.mime || null })
    else setErr((j && j.error) || 'Could not open that code.')
  }

  // ── locked ────────────────────────────────────────────────────────────────────────────────────
  if (locked) {
    return (
      <div className='min-h-screen bg-neutral-100 text-neutral-900 px-safe-keep grid place-items-center'>
        <div className='w-full max-w-sm rounded-2xl bg-white shadow-lg p-5'>
          <div className='text-[10px] uppercase tracking-[0.2em] text-amber-600 font-semibold mb-1.5'>Stay Hospitality</div>
          <div className='text-base font-bold mb-1'>{locked.label || 'Parking'}</div>
          <div className='text-sm text-neutral-600 mb-3'>Enter the passcode you were sent.</div>
          <input type='password' value={pass} autoFocus placeholder='Passcode'
            onChange={e => setPass(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(pass) }}
            className='w-full text-base border border-neutral-200 rounded-lg px-3 py-2' />
          {err && <div className='text-xs text-rose-600 mt-2'>{err}</div>}
          <button onClick={() => load(pass)} disabled={busy || !pass}
            className='mt-3 w-full rounded-lg bg-neutral-900 text-white text-sm font-semibold py-2 disabled:opacity-40'>
            {busy ? 'Checking…' : 'Open board'}
          </button>
        </div>
      </div>
    )
  }

  if (!d) {
    return (
      <div className='min-h-screen bg-neutral-100 text-neutral-900 px-safe-keep grid place-items-center'>
        <div className='text-neutral-400 text-sm'>{err || 'Loading…'}</div>
      </div>
    )
  }

  // The tab count has to be the length of the list behind it, not a number computed server-side
  // over a slightly different set.
  const needN = d.rows.filter(r => !r.permit && !leavingToday(r)).length
  const groups = groupByDay(rows)
  const stuck = d.rows.filter(r => r.permit && r.permit.inGuesty === false)
  const pendingGuesty = { n: stuck.length, why: stuck.find(r => r.permit?.guestyError)?.permit?.guestyError || '' }
  const TABS: { key: TabKey; label: string; n: number }[] = [
    { key: 'need', label: 'QR code needed', n: needN },
    { key: 'done', label: 'Sent', n: d.counts.withPermit },
    { key: 'all', label: 'All stays', n: d.counts.stays },
  ]

  return (
    // No app Shell on this link, so it pads for the phone itself. px-safe goes on the outer element
    // because it would replace the px-4 gutter if it shared one.
    <div className='min-h-screen bg-neutral-100 text-neutral-900 px-safe'>
      <div className='max-w-2xl mx-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]'>

        <div className='rounded-2xl bg-gradient-to-br from-neutral-900 via-neutral-900 to-neutral-800 shadow-lg overflow-hidden mb-4'>
          <div className='p-5'>
            <div className='flex items-start justify-between gap-3 flex-wrap'>
              <div className='min-w-0'>
                <div className='flex items-center gap-2.5'>
                  <span className='text-[10px] uppercase tracking-[0.2em] text-amber-300 font-semibold'>Stay Hospitality</span>
                  <span className='inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300'>
                    <span className='relative flex h-1.5 w-1.5'>
                      <span className='animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75'></span>
                      <span className='relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400'></span>
                    </span>LIVE
                  </span>
                </div>
                <h1 className='text-2xl sm:text-3xl font-bold text-white mt-1.5 tracking-tight'>{d.label}</h1>
                <p className='text-xs text-neutral-400 mt-1.5'>
                  {d.building} · every stay through the next {d.windowDays} days
                </p>
              </div>
              <button onClick={() => load()} disabled={busy}
                className='text-xs font-medium px-3 py-1.5 rounded-lg border border-white/15 bg-white/10 text-neutral-100 hover:bg-white/20 disabled:opacity-40 transition-colors'>
                {busy ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            <div className='grid grid-cols-2 gap-2 mt-4'>
              <Stat label='Needed' value={needN} tone={needN ? 'hot' : 'ok'} />
              <Stat label='Sent' value={d.counts.withPermit} note={'of ' + d.counts.stays} />
            </div>
          </div>
        </div>

        {/* WHO SENT IT. There is no login behind this link, so an unattributed code is a code
            nobody can ask about. Asked once, remembered on this device. */}
        <div className='rounded-2xl border border-neutral-200 bg-white shadow-sm p-4 mb-3'>
          <label className='block text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5'>Your name</label>
          <input value={who} placeholder='who is uploading'
            onChange={e => { setWho(e.target.value); try { localStorage.setItem(WHO_KEY, e.target.value) } catch { /* fine */ } }}
            className='w-full text-base border border-neutral-200 rounded-lg px-3 py-2' />
          <p className='text-xs text-neutral-400 mt-2'>Goes on every code you send, so we know who to ask if a gate turns someone away.</p>
        </div>

        {d.truncated && (
          <div className='text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-3'>
            This list came back short, so some stays may be missing. Reload in a minute rather than
            working from it — a stay that is not here still needs a code.
          </div>
        )}
        {note && <div className='text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 mb-3'>{note}</div>}
        {/* THE QUIET FAILURE, SAID OUT LOUD ONCE. Codes that are stored but never reached the
            reservation are invisible until a guest is at a gate, and the sentence that says how to
            fix it (usually: the Guesty field does not exist yet) was being sent to the browser and
            never rendered. */}
        {pendingGuesty.n > 0 && (
          <div className='text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-3'>
            <b>{pendingGuesty.n} {pendingGuesty.n === 1 ? 'code is' : 'codes are'} not on the reservation in Guesty yet.</b>{' '}
            The codes are saved and we retry every hour.
            {pendingGuesty.why ? <span className='block text-xs mt-1 text-amber-800'>{pendingGuesty.why}</span> : null}
          </div>
        )}
        {err && !upload && <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-3'>{err}</div>}

        <div className='sticky top-0 z-10 -mx-1 px-1 py-1 bg-neutral-100 flex gap-1 mb-4 overflow-x-auto'>
          <div className='flex gap-1 w-full bg-white border border-neutral-200 rounded-xl p-1 shadow-sm'>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={'flex-1 whitespace-nowrap text-sm font-medium px-3 py-2 rounded-lg transition-colors ' + (tab === t.key ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100')}>
              {t.label}
              <span className={'ml-1.5 text-xs ' + (tab === t.key ? 'text-neutral-300' : 'text-neutral-400')}>{t.n}</span>
            </button>
          ))}
          </div>
        </div>

        {!rows.length && (
          <div className='text-neutral-400 text-sm py-10 text-center'>
            {tab === 'need' ? 'Every stay in the window has a code. Nothing to do.' : 'Nothing here yet.'}
          </div>
        )}

        {/* Grouped under one heading per arrival day, so the garage reads "who needs a code today"
            at a glance instead of re-reading the date on every row. */}
        {groups.map(g => (
          <div key={g.date} className='mb-4'>
            <div className='flex items-baseline gap-2 px-1 mb-1.5'>
              <span className='text-sm font-bold text-neutral-900'>{g.date === IN_HOUSE ? 'In house now' : dayLabel(g.date, d.today)}</span>
              {g.date !== IN_HOUSE && dayLabel(g.date, d.today) !== fmtDate(g.date) && <span className='text-xs text-neutral-400'>{fmtDate(g.date)}</span>}
              <span className='flex-1' />
              <span className='text-xs text-neutral-400'>{g.rows.length}</span>
            </div>
            <div className='rounded-2xl border border-neutral-200 bg-white shadow-sm divide-y divide-neutral-100 overflow-hidden'>
              {g.rows.map(r => {
                const urgent = !r.permit && !leavingToday(r) && r.arrivingIn <= 2
                return (
                  <div key={r.reservationId} className={'px-4 py-3 ' + (urgent ? 'bg-amber-50/60' : '')}>
                    <div className='flex items-start gap-3'>
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2 flex-wrap'>
                          <span className='text-[15px] font-bold text-neutral-900 truncate'>{r.unit}</span>
                          {r.inHouse && <Chip tone='blue'>In house</Chip>}
                          {urgent && !r.inHouse && <Chip tone='amber'>{whenWord(r)}</Chip>}
                          {/* BOOKED, not paid. The folio carries a parking line; whether the guest
                              has settled it is a different field nobody here reads. */}
                          {r.parkingBooked != null && <Chip tone='violet'>Parking booked{r.parkingBooked ? ' ' + money(r.parkingBooked) : ''}</Chip>}
                        </div>
                        <div className='text-xs text-neutral-500 mt-0.5'>
                          {[fmtDate(r.checkIn) + ' → ' + fmtDate(r.checkOut),
                            r.nights ? r.nights + 'n' : null,
                            r.guest,
                            r.confirmation || null,
                            !urgent && !r.inHouse ? whenWord(r) : null,
                          ].filter(Boolean).join(' · ')}
                        </div>
                        {r.permit && (
                          <div className='text-xs text-neutral-400 mt-1'>
                            {[r.permit.label, r.permit.uploadedBy || 'vendor', r.permit.wasSpare ? 'from a spare' : null]
                              .filter(Boolean).join(' · ')}
                            {/* The quiet failure on this page: a code that never reached the
                                booking. Said on the row, not buried in a log. */}
                            {r.permit.inGuesty === false && (
                              <span className='ml-1 text-amber-700' title={r.permit.guestyError || undefined}>
                                · not on the reservation in Guesty yet
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* THE BUTTON JON ASKED FOR, in Salato's own pattern: dark while it is
                          outstanding, emerald tick once it is done. */}
                      {r.permit
                        ? <div className='shrink-0 flex flex-col items-end gap-1'>
                            <button onClick={() => showQr(r)} disabled={busy}
                              className='text-xs font-semibold px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 disabled:opacity-40'>
                              ✓ QR code
                            </button>
                            {/* Its own control, not a step inside the viewer. Reaching Replace only
                                through a SUCCESSFUL view meant a vendor who had just uploaded an
                                unreadable image could not fix it the moment the signed read failed. */}
                            <button onClick={() => setUpload(r)}
                              className='text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 underline underline-offset-2'>
                              Replace
                            </button>
                          </div>
                        : <button onClick={() => setUpload(r)}
                            className='shrink-0 text-xs font-semibold px-3 py-2 rounded-xl bg-neutral-900 text-white'>
                            QR code needed
                          </button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        <p className='text-[11px] text-neutral-400 text-center mt-6 leading-relaxed'>
          PNG, JPG or PDF. Codes are stored privately and opened through a link that expires in five
          minutes — they are never on a public web address.
        </p>
      </div>

      {/* ── the QR viewer ───────────────────────────────────────────────────────────────────── */}
      {qr && (
        <div role='dialog' aria-modal='true' aria-label='Parking code' className='fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4' onClick={() => setQr(null)}>
          <div className='bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90dvh] sm:max-h-[90vh] overflow-y-auto' onClick={e => e.stopPropagation()}>
            <div className='flex items-center justify-between px-5 py-4 border-b border-neutral-100 sticky top-0 bg-white rounded-t-2xl'>
              <div className='font-bold'>{qr.row.unit} <span className='font-normal text-neutral-500'>· {fmtDate(qr.row.checkIn)}</span></div>
              <button onClick={() => setQr(null)} aria-label='Close' className='text-neutral-400 hover:text-neutral-700 text-xl leading-none'>×</button>
            </div>
            <div className='p-5 text-center'>
              {/* A PDF never loads in an <img>, so the old version relied on the error handler
                  calling window.open — several async hops after the click, which is exactly when a
                  popup blocker stops it. The mime comes back with the URL now, so a PDF is a link
                  the person taps themselves. */}
              {qr.mime === 'application/pdf'
                ? <a href={qr.url} target='_blank' rel='noreferrer' className='block w-full rounded-xl bg-neutral-900 text-white text-sm font-semibold py-3'>Open the PDF</a>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={qr.url} alt={'Parking code for ' + qr.row.unit} className='w-full max-w-[280px] mx-auto rounded-xl' />}
              <p className='text-xs text-neutral-400 mt-4'>This view expires in five minutes.</p>
              <button onClick={() => { const row = qr.row; setQr(null); setUpload(row) }}
                className='mt-3 w-full text-sm font-semibold px-3 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-50'>
                Replace this code
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── the upload sheet ────────────────────────────────────────────────────────────────── */}
      {upload && (
        <div role='dialog' aria-modal='true' aria-label='Send a QR code' className='fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4' onClick={() => setUpload(null)}>
          <div className='bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90dvh] sm:max-h-[90vh] overflow-y-auto' onClick={e => e.stopPropagation()}>
            <div className='flex items-center justify-between px-5 py-4 border-b border-neutral-100 sticky top-0 bg-white rounded-t-2xl'>
              <div className='font-bold'>
                {upload.permit ? 'Replace the code' : 'Send a QR code'}
              </div>
              <button onClick={() => setUpload(null)} aria-label='Close' className='text-neutral-400 hover:text-neutral-700 text-xl leading-none'>×</button>
            </div>
            <div className='p-5'>
              <div className='text-sm mb-3'>
                <div className='font-semibold'>{upload.unit}</div>
                <div className='text-neutral-500 text-xs mt-0.5'>
                  {fmtDate(upload.checkIn)} → {fmtDate(upload.checkOut)} · {upload.guest}
                </div>
              </div>
              {/* Re-keyed on the permit so a successful replace gives a fresh, empty control —
                  otherwise the file stayed selected and one more tap filed a duplicate code. */}
              <Upload
                key={upload.reservationId + '-' + (upload.permit?.id || 'new')}
                id={upload.reservationId}
                busy={busy}
                onSend={(f, l) => send(f, l, upload)}
                cta={upload.permit ? 'Replace the code' : 'Send this code'}
              />
              {err && <div className='text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3'>{err}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: number; note?: string; tone?: 'ok' | 'warn' | 'hot' }) {
  const colour = tone === 'hot' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : 'text-white'
  return (
    <div className='rounded-xl border border-white/10 bg-white/5 px-3 py-2'>
      <div className='text-[10px] uppercase tracking-wide text-neutral-400 font-semibold'>{label}</div>
      <div className={'text-xl font-bold leading-tight mt-0.5 ' + colour}>{value}</div>
      {note ? <div className='text-[10px] text-neutral-500'>{note}</div> : null}
    </div>
  )
}

function Chip({ tone, children }: { tone: 'blue' | 'amber' | 'violet'; children: React.ReactNode }) {
  const c = tone === 'blue' ? 'bg-blue-100 text-blue-700'
    : tone === 'amber' ? 'bg-amber-100 text-amber-800'
    : 'bg-violet-100 text-violet-700'
  return <span className={'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ' + c}>{children}</span>
}

/** One file, one optional reference of the vendor's own. Kept dumb on purpose. */
function Upload({ id, busy, onSend, cta }: { id: string; busy: boolean; onSend: (f: File, label: string) => void; cta: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  return (
    <div>
      <input id={'f-' + id} type='file' accept='image/png,image/jpeg,application/pdf'
        className='sr-only' onChange={e => setFile(e.target.files?.[0] || null)} />
      <label htmlFor={'f-' + id}
        className='block text-sm text-center text-neutral-600 border border-dashed border-neutral-300 rounded-xl px-3 py-5 cursor-pointer truncate hover:bg-neutral-50'>
        {file ? file.name : 'Choose a file'}
      </label>
      <input value={label} placeholder='your reference (optional)' onChange={e => setLabel(e.target.value)}
        className='mt-2 w-full text-base border border-neutral-200 rounded-lg px-3 py-2' />
      <button disabled={busy || !file} onClick={() => file && onSend(file, label)}
        className='mt-3 w-full rounded-xl bg-neutral-900 text-white text-sm font-semibold py-2.5 disabled:opacity-40'>
        {busy ? 'Sending…' : cta}
      </button>
    </div>
  )
}
