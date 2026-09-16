'use client'
// THE PARKING BOARD — what a garage vendor sees, on a phone, with one job on it.
//
// Jon, 2026-09-16: "a shareable link that's password protected for all reservations at 17 West…
// send this to a parking vendor that needs to generate QR codes. We should have them upload a QR
// code into the system for that reservation."
//
// FOUR DECISIONS THAT SHAPED THIS PAGE:
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
// 3. THE SPARE DRAWER IS A FIRST-CLASS THING. "They're going to provide a couple of extra codes
//    just in case for the weekends." So the pool has its own card with its own count, and it warns
//    when it is running low — a pool nobody tops up is a pool that is empty the Saturday it matters.
//
// 4. THE PASSCODE IS NOT REMEMBERED FOREVER. It lives in sessionStorage: it survives a reload and
//    a tab navigation, and it is gone when the tab closes. A garage office machine is shared.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Permit = { id: string; label: string | null; uploadedAt: string; uploadedBy: string | null; wasSpare: boolean }
type Row = {
  reservationId: string; unit: string; listingId: string; guest: string; confirmation: string
  checkIn: string; checkOut: string; nights: number; arrivingIn: number; inHouse: boolean
  parkingBooked: number | null; permit: Permit | null
}
type Board = {
  ok: true; label: string; building: string; scopeLabel: string; today: string; windowDays: number
  rows: Row[]
  counts: { stays: number; withPermit: number; needPermit: number; parkingBooked: number }
  truncated?: boolean
  pool: { spare: number; items: { id: string; label: string | null; uploadedAt: string }[] }
  canAssign?: boolean
}

const PASS_KEY = 'pk_pass'
const WHO_KEY = 'pk_who'
/** Below this the pool cannot cover a weekend, which is the only reason it exists. */
const POOL_LOW = 3

const day = (d: string) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return d } }
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US')

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
  const [view, setView] = useState<'need' | 'all' | 'done'>('need')
  const [qr, setQr] = useState<{ url: string; row: Row; mime: string | null } | null>(null)
  const [openRow, setOpenRow] = useState<string | null>(null)
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

  const rows = useMemo(() => {
    const all = (d?.rows || []).slice().sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.unit.localeCompare(b.unit))
    if (view === 'all') return all
    if (view === 'done') return all.filter(r => !!r.permit)
    return all.filter(r => !r.permit && !leavingToday(r))
  }, [d, view])

  // ── upload ────────────────────────────────────────────────────────────────────────────────────
  const send = async (file: File, label: string, row: Row | null) => {
    if (!who.trim()) { setErr('Add your name first — we need to know who sent the code.'); return }
    setBusy(true); setErr(''); setNote('')
    try {
      const fd = new FormData()
      fd.set('who', who.trim()); fd.set('file', file)
      if (label.trim()) fd.set('label', label.trim())
      if (row) fd.set('reservationId', row.reservationId); else fd.set('spare', '1')
      // The passcode is a header, not a form field, so the server can check it before it buffers
      // the file. It is still never in the URL.
      const r = await fetch('/api/public/parking/' + code + '/upload', {
        method: 'POST', body: fd, cache: 'no-store', headers: { 'x-parking-pass': passRef.current },
      })
      const j = await r.json().catch(() => ({} as any))
      if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed.')
      setNote(row ? (j.replaced ? 'Replaced the code on ' + row.unit + '.' : 'Code saved for ' + row.unit + '.') : 'Spare code added to the pool.')
      setOpenRow(null)
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

  const useSpare = async (row: Row) => {
    const spare = d?.pool.items[0]
    if (!spare) return
    setBusy(true); setErr(''); setNote('')
    const { j } = await post('/assign', { permitId: spare.id, reservationId: row.reservationId })
    setBusy(false)
    if (j && j.ok) { setNote('Spare code assigned to ' + row.unit + '. ' + j.left + ' left in the pool.'); await load() }
    else setErr((j && j.error) || 'Could not assign that spare.')
  }

  // ── locked ────────────────────────────────────────────────────────────────────────────────────
  if (locked) {
    return (
      <div className="pk"><Style />
        <div className="pk-wrap">
          <div className="pk-band">
            <p className="pk-brand">S T A Y &nbsp; H O S P I T A L I T Y</p>
            <h1 className="pk-title">{locked.label || 'Parking'}</h1>
            <p className="pk-sub">Enter the passcode you were sent.</p>
          </div>
          <div className="pk-card pk-pad">
            <input className="pk-input" type="password" value={pass} placeholder="Passcode" autoFocus
              onChange={e => setPass(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(pass) }} />
            <button className="pk-btn" onClick={() => load(pass)} disabled={busy || !pass}>{busy ? 'Checking…' : 'Open'}</button>
            {err && <p className="pk-err">{err}</p>}
          </div>
        </div>
      </div>
    )
  }

  if (!d) {
    return (
      <div className="pk"><Style />
        <div className="pk-wrap"><div className="pk-card pk-pad"><p className="pk-muted">{err || 'Loading…'}</p></div></div>
      </div>
    )
  }

  const poolLow = d.pool.spare < POOL_LOW
  // The tab count has to be the length of the list behind it, not a number computed server-side
  // over a slightly different set.
  const needN = d.rows.filter(r => !r.permit && !leavingToday(r)).length

  return (
    <div className="pk"><Style />
      <div className="pk-wrap">
        <div className="pk-band">
          <p className="pk-brand">S T A Y &nbsp; H O S P I T A L I T Y</p>
          <h1 className="pk-title">{d.label}</h1>
          <p className="pk-sub">{d.building} · every stay through the next {d.windowDays} days</p>
        </div>

        <div className="pk-stats">
          <Stat label="Need a code" value={String(needN)} tone={needN ? 'hot' : 'ok'} />
          <Stat label="On file" value={String(d.counts.withPermit)} note={'of ' + d.counts.stays} />
          <Stat label="Spare pool" value={String(d.pool.spare)} tone={poolLow ? 'warn' : 'ok'} note={poolLow ? 'running low' : 'in the drawer'} />
        </div>

        {/* WHO SENT IT. There is no login behind this link, so an unattributed code is a code
            nobody can ask about. Asked once, remembered on this device. */}
        <div className="pk-card pk-pad">
          <label className="pk-lab">Your name</label>
          <input className="pk-input" value={who} placeholder="who is uploading"
            onChange={e => { setWho(e.target.value); try { localStorage.setItem(WHO_KEY, e.target.value) } catch { /* fine */ } }} />
          <p className="pk-hint">Goes on every code you send, so we know who to ask if a gate turns someone away.</p>
        </div>

        {d.truncated && (
          <div className="pk-err pk-err-box">
            This list came back short, so some stays may be missing. Reload in a minute rather than
            working from it — a stay that is not here still needs a code.
          </div>
        )}
        {note && <div className="pk-ok">{note}</div>}
        {err && <div className="pk-err pk-err-box">{err}</div>}

        {/* THE SPARE DRAWER. Jon: the vendor does not work weekends, so a few unassigned codes sit
            here and the office binds one when a late booking lands. */}
        <div className={'pk-card' + (poolLow ? ' hot' : '')}>
          <div className="pk-cardhead">
            <span><b>Spare codes</b> · not tied to a stay</span>
            <span className="pk-cnt">{d.pool.spare}</span>
          </div>
          <div className="pk-pad">
            <p className="pk-muted">
              {poolLow
                ? 'Running low. These are what cover a guest who books on a Saturday — a few in hand means nobody waits for Monday.'
                : 'Held for last-minute bookings when you are not working. The office assigns one and it stops being spare.'}
            </p>
            {/* Re-keyed on the pool size so a successful upload gives a fresh, empty control —
                otherwise the file stayed selected and one more tap filed a duplicate code. */}
            <Upload key={'spare-' + d.pool.spare} id="spare" busy={busy} onSend={(f, l) => send(f, l, null)} cta="Add a spare code" />
          </div>
        </div>

        <div className="pk-tabs">
          <button className={'pk-tab' + (view === 'need' ? ' on' : '')} onClick={() => setView('need')}>
            Need a code <span className="pk-tabn">{needN}</span>
          </button>
          <button className={'pk-tab' + (view === 'done' ? ' on' : '')} onClick={() => setView('done')}>
            Sent <span className="pk-tabn">{d.counts.withPermit}</span>
          </button>
          <button className={'pk-tab' + (view === 'all' ? ' on' : '')} onClick={() => setView('all')}>
            All <span className="pk-tabn">{d.counts.stays}</span>
          </button>
        </div>

        {!rows.length && (
          <div className="pk-card pk-pad">
            <p className="pk-muted">{view === 'need' ? 'Every stay in the window has a code. Nothing to do.' : 'Nothing here yet.'}</p>
          </div>
        )}

        {rows.map(r => (
          <div key={r.reservationId} className={'pk-card' + (!r.permit && !leavingToday(r) && r.arrivingIn <= 2 ? ' hot' : '')}>
            <div className="pk-row">
              <div className="pk-rowmain">
                <b className="pk-unit">{r.unit}</b>
                <div className="pk-rowsub">
                  {day(r.checkIn)} → {day(r.checkOut)} · {r.nights}n · {r.guest}
                  {r.confirmation ? ' · ' + r.confirmation : ''}
                </div>
                <div className="pk-chips">
                  <span className={'pk-pill ' + (r.inHouse ? 'now' : r.arrivingIn <= 2 ? 'soon' : 'off')}>{whenWord(r)}</span>
                  {/* BOOKED, not paid. The folio carries a parking line; whether the guest has
                      settled it is a different field nobody here reads. */}
                  {r.parkingBooked != null && <span className="pk-pill paid">parking booked {r.parkingBooked ? money(r.parkingBooked) : ''}</span>}
                  {r.permit && <span className="pk-pill ok">code on file{r.permit.wasSpare ? ' · spare' : ''}</span>}
                </div>
              </div>
            </div>

            <div className="pk-actions">
              {r.permit ? (
                <>
                  <button className="pk-mini" onClick={() => showQr(r)} disabled={busy}>View code</button>
                  <button className="pk-mini" onClick={() => setOpenRow(openRow === r.reservationId ? null : r.reservationId)}>Replace</button>
                  <span className="pk-by">
                    {r.permit.label ? r.permit.label + ' · ' : ''}{r.permit.uploadedBy || 'vendor'}
                  </span>
                </>
              ) : (
                <>
                  <button className="pk-mini go" onClick={() => setOpenRow(openRow === r.reservationId ? null : r.reservationId)}>
                    {openRow === r.reservationId ? 'Close' : 'Upload a code'}
                  </button>
                  {d.canAssign && d.pool.spare > 0 && (
                    <button className="pk-mini" onClick={() => useSpare(r)} disabled={busy}>Use a spare</button>
                  )}
                </>
              )}
            </div>

            {openRow === r.reservationId && (
              <div className="pk-pad pk-drop">
                <Upload id={r.reservationId} busy={busy} onSend={(f, l) => send(f, l, r)}
                  cta={r.permit ? 'Replace the code' : 'Send this code'} />
              </div>
            )}
          </div>
        ))}

        <p className="pk-foot">
          PNG, JPG or PDF. Codes are stored privately and opened through a link that expires in five
          minutes — they are never on a public web address.
        </p>
      </div>

      {qr && (
        <div className="pk-scrim" onClick={() => setQr(null)}>
          <div className="pk-modal" onClick={e => e.stopPropagation()}>
            <div className="pk-cardhead"><span><b>{qr.row.unit}</b> · {day(qr.row.checkIn)}</span>
              <button className="pk-mini" onClick={() => setQr(null)}>Close</button></div>
            <div className="pk-pad pk-qr">
              {/* A PDF never loads in an <img>, so the old version relied on the error handler
                  calling window.open — several async hops after the click, which is exactly when a
                  popup blocker stops it. The mime comes back with the URL now, so a PDF is a link
                  the person taps themselves. */}
              {qr.mime === 'application/pdf'
                ? <a className="pk-btn pk-a" href={qr.url} target="_blank" rel="noreferrer">Open the PDF</a>
                : <img src={qr.url} alt={'Parking code for ' + qr.row.unit} />}
              <p className="pk-hint">This view expires in five minutes.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'ok' | 'warn' | 'hot' }) {
  return (
    <div className="pk-stat">
      <span className="pk-statlab">{label}</span>
      <span className={'pk-statval' + (tone ? ' ' + tone : '')}>{value}</span>
      {note ? <span className="pk-statnote">{note}</span> : null}
    </div>
  )
}

/** One file, one optional reference of the vendor's own. Kept dumb on purpose. */
function Upload({ id, busy, onSend, cta }: { id: string; busy: boolean; onSend: (f: File, label: string) => void; cta: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  return (
    <div className="pk-up">
      <input id={'f-' + id} className="pk-file" type="file" accept="image/png,image/jpeg,application/pdf"
        onChange={e => setFile(e.target.files?.[0] || null)} />
      <label htmlFor={'f-' + id} className="pk-filebtn">{file ? file.name : 'Choose a file'}</label>
      <input className="pk-input" value={label} placeholder="your reference (optional)" onChange={e => setLabel(e.target.value)} />
      <button className="pk-btn" disabled={busy || !file} onClick={() => file && onSend(file, label)}>{busy ? 'Sending…' : cta}</button>
    </div>
  )
}

function Style() {
  return <style dangerouslySetInnerHTML={{ __html: `
.pk{margin:0;background:#eef0f3;min-height:100dvh;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b1220;-webkit-font-smoothing:antialiased}
.pk-wrap{max-width:680px;margin:0 auto;padding:16px 12px 40px}
.pk-band{background:#0b1220;border-radius:16px;padding:18px 20px 16px;color:#fff}
.pk-brand{font-size:10px;font-weight:700;letter-spacing:.2em;color:#a5b4fc;margin:0}
.pk-title{font-size:22px;font-weight:800;margin:8px 0 0;letter-spacing:-.01em}
.pk-sub{font-size:12.5px;color:#94a3b8;margin-top:4px}
.pk-stats{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;margin:12px 0 10px}
.pk-stat{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px 6px;text-align:center}
.pk-statlab{display:block;font-size:9.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em}
.pk-statval{display:block;font-size:22px;font-weight:700;margin-top:2px}
.pk-statval.ok{color:#047857}.pk-statval.warn{color:#b45309}.pk-statval.hot{color:#b91c1c}
.pk-statnote{display:block;font-size:10px;color:#9ca3af}
.pk-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;margin-bottom:10px;overflow:hidden}
.pk-card.hot{border-color:#fecaca}
.pk-pad{padding:14px 16px}
.pk-cardhead{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 16px;font-size:13px;background:#f8fafc;border-bottom:1px solid #eef0f3}
.pk-card.hot .pk-cardhead{background:#fef2f2;color:#b91c1c}
.pk-cnt{font-size:11.5px;font-weight:700;color:#6b7280;background:#fff;border:1px solid #e5e7eb;border-radius:99px;padding:1px 9px}
.pk-row{padding:13px 16px 4px}
.pk-rowmain{min-width:0}
.pk-unit{font-size:15.5px;font-weight:700}
.pk-rowsub{font-size:12px;color:#6b7280;margin-top:2px}
.pk-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.pk-pill{font-size:10.5px;font-weight:700;border-radius:99px;padding:3px 9px;white-space:nowrap}
.pk-pill.now{background:#dbeafe;color:#1e40af}
.pk-pill.soon{background:#fef3c7;color:#92400e}
.pk-pill.off{background:#f3f4f6;color:#6b7280}
.pk-pill.ok{background:#dcfce7;color:#166534}
.pk-pill.paid{background:#ede9fe;color:#5b21b6}
.pk-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 16px 14px}
.pk-mini{font-size:12px;border:1px solid #e5e7eb;background:#fff;border-radius:9px;padding:6px 12px;cursor:pointer;color:#374151;font-weight:600}
.pk-mini.go{background:#0b1220;border-color:#0b1220;color:#fff}
.pk-mini:disabled{opacity:.5}
.pk-by{font-size:11px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-drop{border-top:1px solid #eef0f3;background:#f8fafc}
.pk-tabs{position:sticky;top:0;z-index:5;display:flex;gap:6px;background:#eef0f3;padding:8px 0 10px}
.pk-tab{flex:1;border:1px solid #e5e7eb;background:#fff;border-radius:11px;padding:9px 8px;font-size:13px;font-weight:700;color:#6b7280;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.pk-tab.on{background:#0b1220;border-color:#0b1220;color:#fff}
.pk-tabn{font-size:11px;font-weight:700;background:rgba(0,0,0,.06);border-radius:99px;padding:1px 7px}
.pk-tab.on .pk-tabn{background:rgba(255,255,255,.18)}
.pk-lab{display:block;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px}
.pk-input{width:100%;box-sizing:border-box;font-size:16px;border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;background:#fff;margin-bottom:8px}
.pk-btn{width:100%;font-size:14px;font-weight:700;border:0;border-radius:10px;padding:11px 12px;background:#0b1220;color:#fff;cursor:pointer}
.pk-btn:disabled{opacity:.45}
.pk-file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.pk-filebtn{display:block;font-size:13px;border:1px dashed #cbd5e1;border-radius:10px;padding:14px 12px;text-align:center;color:#475569;cursor:pointer;margin-bottom:8px;background:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pk-up{margin-top:10px}
.pk-hint{font-size:11px;color:#9ca3af;margin:6px 0 0}
.pk-muted{font-size:12.5px;color:#6b7280;margin:0;line-height:1.55}
.pk-err{font-size:12.5px;color:#b91c1c;margin:8px 0 0}
.pk-err-box{background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 14px;margin-bottom:10px}
.pk-ok{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:10px 14px;font-size:12.5px;color:#065f46;margin-bottom:10px}
.pk-foot{font-size:11px;color:#9ca3af;text-align:center;line-height:1.6;margin-top:16px}
.pk-scrim{position:fixed;inset:0;background:rgba(2,6,23,.6);display:flex;align-items:center;justify-content:center;padding:16px;z-index:20}
.pk-modal{background:#fff;border-radius:14px;width:100%;max-width:420px;overflow:hidden}
.pk-qr{text-align:center}
.pk-qr img{max-width:100%;height:auto;border-radius:8px}
.pk-a{display:block;text-decoration:none;text-align:center;box-sizing:border-box}
` }} />
}
