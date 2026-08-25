'use client'
// THE DAY LINK — one standing, password-protected URL the field opens on a phone.
// Read-only about the day itself (status comes from Breezeway/Guesty, not from a tap in a pocket),
// but anyone can leave a NOTE, which lands in the same thread the office sees.
// Tap through to the Guesty reservation or the Breezeway task; prints from the phone too.
import { useCallback, useEffect, useState } from 'react'

// CREW is a tab, not a footnote (Jon, 2026-08-25: "shows active status, who clocked in, what
// people are working on"). The market comes off the URL — /day?market=Miami is Miami's board —
// so each crew opens their own link and sees only their own day.
type Tab = 'crew' | 'cleans' | 'verify' | 'work' | 'issues'
function marketFromUrl(): string {
  if (typeof window === 'undefined') return ''
  const m = new URLSearchParams(window.location.search).get('market') || ''
  return /^(miami|broward|north)$/i.test(m) ? m[0].toUpperCase() + m.slice(1).toLowerCase() : ''
}
function todayET() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function shortDate(d: string | null) { if (!d) return '—'; const x = new Date(d + 'T12:00:00'); return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function ago(iso: string | null) { if (!iso) return 'unknown'; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); if (isNaN(m)) return 'unknown'; if (m < 60) return m + ' min ago'; return Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago' }
const bzUrl = (id: string) => 'https://app.breezeway.io/task/' + id
const gyUrl = (id: string) => 'https://app.guesty.com/reservations/' + id + '/summary'

export default function DayLinkPage() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [d, setD] = useState<any>(null)
  const [tab, setTab] = useState<Tab>('cleans')
  const [date, setDate] = useState(todayET())
  const [market, setMarket] = useState('')
  useEffect(() => { setMarket(marketFromUrl()) }, [])
  const [loading, setLoading] = useState(false)
  const [noteFor, setNoteFor] = useState('')
  const [noteBy, setNoteBy] = useState('')
  const [noteTxt, setNoteTxt] = useState('')
  const [noteMsg, setNoteMsg] = useState('')

  const load = useCallback(async (dt: string) => {
    setLoading(true)
    try {
      const mk = marketFromUrl()
      const r = await fetch('/api/public/daysheet?date=' + encodeURIComponent(dt) + (mk ? '&market=' + encodeURIComponent(mk) : ''), { cache: 'no-store' })
      if (r.status === 401) { setAuthed(false); setLoading(false); return }
      const j = await r.json()
      if (j.ok) { setD(j); setAuthed(true) }
    } catch { /* keep the last good copy on screen */ }
    setLoading(false)
  }, [])
  useEffect(() => { load(date) }, [date, load])
  // KEEP THE PHONE HONEST. A field sheet left open on a phone all morning is worse than no sheet:
  // it looks current. Refresh every 3 minutes while the page is actually visible, and immediately
  // when the phone wakes or the tab comes back to the front.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load(date) }
    const t = setInterval(tick, 3 * 60 * 1000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick) }
  }, [date, load])

  const signIn = async () => {
    setPwErr('')
    const r = await fetch('/api/public/share-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.ok) { setPwErr(j.error || 'Wrong password'); return }
    setPw(''); load(date)
  }
  const sendNote = async (taskId: string, unit: string) => {
    if (!noteTxt.trim()) return
    setNoteMsg('')
    const r = await fetch('/api/public/daysheet-note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, unit, by: noteBy, body: noteTxt }) })
    const j = await r.json().catch(() => ({}))
    setNoteMsg(r.ok && j.ok ? 'Sent to the office' : (j.error || 'Could not send'))
    if (r.ok && j.ok) { setNoteTxt(''); setTimeout(() => { setNoteFor(''); setNoteMsg('') }, 1200) }
  }

  if (authed === false) {
    return (
      <div className="dl-root dl-center">
        <div className="dl-card dl-pw">
          <div className="dl-brand">STAY HOSPITALITY</div>
          <h1 className="dl-h1">Today in the field</h1>
          <p className="dl-muted">Enter the team password to see today&rsquo;s cleans and arrivals.</p>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') signIn() }} placeholder="Password" className="dl-input" />
          <button onClick={signIn} className="dl-btn dl-btn-dark">Open</button>
          {pwErr && <div className="dl-err">{pwErr}</div>}
        </div>
        <style jsx global>{CSS}</style>
      </div>
    )
  }

  const departures = (d?.departures || [])
  const arrivals = (d?.arrivals || [])
  // An extension never leaves the unit, so it must not appear under "walk these before check-in".
  const noClean = arrivals.filter((a: any) => !a.cleanToday && !a.extension)
  const work = (d?.work || [])
  const issues = (d?.exceptions || [])
  const c = d?.counts || {}
  const crew = d?.crew || null
  // Both feeds decide whether this page can be trusted: Breezeway for the work, Guesty for who is
  // actually arriving. A stale reservation feed is how a walk-in gets missed.
  const sync = d?.sync || {}
  const stale = !!sync.stale

  const NoteBox = ({ id, unit }: { id: string; unit: string }) => (
    noteFor === id ? (
      <div className="dl-note">
        <input value={noteBy} onChange={e => setNoteBy(e.target.value)} placeholder="Your name" className="dl-input dl-input-sm" />
        <textarea value={noteTxt} onChange={e => setNoteTxt(e.target.value)} rows={2} placeholder="What did you find?" className="dl-input" />
        <div className="dl-row">
          <button onClick={() => { setNoteFor(''); setNoteTxt(''); setNoteMsg('') }} className="dl-btn">Cancel</button>
          <button onClick={() => sendNote(id.startsWith('u:') ? '' : id, unit)} className="dl-btn dl-btn-dark">Send note</button>
        </div>
        {noteMsg && <div className="dl-ok">{noteMsg}</div>}
      </div>
    ) : <button onClick={() => { setNoteFor(id); setNoteMsg('') }} className="dl-notebtn">+ note</button>
  )

  return (
    <div className="dl-root">
      <div className="dl-top">
        <div>
          <div className="dl-brand">STAY HOSPITALITY {'·'} {market ? market.toUpperCase() : 'THE DAY'}</div>
          <div className="dl-date">{new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <div className={'dl-fresh ' + (stale ? 'dl-stale' : '')}>Tasks {ago(sync.breezewayAt || d?.lastSync)} {'·'} bookings {ago(sync.reservationsAt)}</div>
          {stale && <div className="dl-stalebar">{sync.staleReason || 'a feed is behind'} — anything booked since then is not on this page</div>}
        </div>
        <div className="dl-topbtns">
          <input type="date" value={date} onChange={e => setDate(e.target.value || todayET())} className="dl-input dl-input-sm" />
          <button onClick={() => load(date)} className="dl-btn">{loading ? '…' : 'Refresh'}</button>
          <button onClick={() => window.print()} className="dl-btn dl-print">Print</button>
        </div>
      </div>

      <div className="dl-tabs">
        <button onClick={() => setTab('crew')} className={'dl-tab ' + (tab === 'crew' ? 'dl-tabon' : '')}>Crew <b>{crew?.clockedIn ?? 0}/{crew?.onShift ?? 0}</b></button>
        <button onClick={() => setTab('cleans')} className={'dl-tab ' + (tab === 'cleans' ? 'dl-tabon' : '')}>Cleans <b>{departures.length}</b></button>
        <button onClick={() => setTab('verify')} className={'dl-tab ' + (tab === 'verify' ? 'dl-tabon' : '')}>Verify <b>{noClean.length}</b></button>
        <button onClick={() => setTab('work')} className={'dl-tab ' + (tab === 'work' ? 'dl-tabon' : '')}>Work <b>{work.length}</b></button>
        <button onClick={() => setTab('issues')} className={'dl-tab ' + (tab === 'issues' ? 'dl-tabon' : '')}>Issues <b>{issues.length + (d?.glitches || []).length}</b></button>
      </div>

      {tab === 'crew' && (
        <div className="dl-list">
          {!crew ? (
            <div className="dl-sec">Live crew status is only available for today.</div>
          ) : (
            <>
              <div className="dl-sec">
                {crew.clockedIn} of {crew.onShift} clocked in
                {crew.openShifts ? ' · ' + crew.openShifts + ' shift' + (crew.openShifts === 1 ? '' : 's') + ' unfilled' : ''}
                {crew.notClocked?.length ? ' · not clocked in: ' + crew.notClocked.join(', ') : ''}
              </div>
              {(crew.people || []).map((p: any, i: number) => (
                <div key={i} className="dl-card">
                  <div className="dl-row">
                    <b>{p.name}</b>
                    <span className={p.clockedIn ? 'dl-pill dl-pill-ok' : 'dl-pill'}>{p.clockedIn ? 'clocked in' : 'not clocked in'}</span>
                  </div>
                  <div className="dl-sub">{p.role || 'crew'}{p.shift ? ' · ' + p.shift : ''} · {p.done} done · {p.left} left</div>
                  {p.onNow?.length ? p.onNow.map((j: any, k: number) => (
                    <div key={k} className="dl-sub"><b>on now:</b> {j.unit} — {j.task} <a href={bzUrl(j.id)} target="_blank" rel="noreferrer">open task ↗</a></div>
                  )) : <div className="dl-sub">nothing started right now</div>}
                  {/* Tap any job to open it in Breezeway — the link is the whole point of a live board. */}
                  {(p.jobs || []).slice(0, 8).map((j: any, k: number) => (
                    <div key={'j' + k} className="dl-row">
                      <span>{j.unit} <span className="dl-sub">{j.task}</span></span>
                      <span className="dl-sub">{j.state === 'done' ? 'done' : j.state === 'running' ? 'in progress' : 'to do'} <a href={bzUrl(j.id)} target="_blank" rel="noreferrer">↗</a></span>
                    </div>
                  ))}
                  {(p.jobs || []).length > 8 && <div className="dl-sub">+{p.jobs.length - 8} more</div>}
                </div>
              ))}
              {!(crew.people || []).length && <div className="dl-sec">Nobody on the schedule for today.</div>}
            </>
          )}
        </div>
      )}

      {tab === 'cleans' && (
        <div className="dl-list">
          <div className="dl-sec">{c.cleansDone ?? 0} of {c.cleansTotal ?? 0} done {'·'} {c.sameDayTurns ?? 0} same-day</div>
          {departures.map((r: any, i: number) => (
            <div key={i} className={'dl-card ' + (r.sameDayTurn ? 'dl-hot' : '')}>
              <div className="dl-cardtop">
                <div className="dl-unit">{r.unit}</div>
                <div className="dl-when">out {r.checkOutTime || '11:00 AM'}</div>
              </div>
              {r.extension && <div className="dl-sd dl-ext">EXTENSION {'\u2014'} {r.guest} re-booked {'\u00b7'} ask if they want a clean, do not strip</div>}
              {r.sameDayTurn && !r.extension && <div className="dl-sd">SAME DAY {'→'} {r.sameDayGuest || 'guest'} in {r.sameDayIn}{r.sameDayNights ? ' · ' + r.sameDayNights + ' nt' : ''}</div>}
              <div className="dl-line"><span className="dl-lbl">Cleaner</span>{r.clean ? (r.clean.assignees?.length ? r.clean.assignees.join(', ') : <b className="dl-warn">unassigned</b>) : (r.vendor ? <span className="dl-muted">{r.vendor} cleans this</span> : <b className="dl-warn">no clean on the board</b>)}{r.clean && <span className="dl-muted"> {'·'} {r.clean.status}</span>}</div>
              <div className="dl-line"><span className="dl-lbl">Out</span>{r.guest}{r.nights != null && <span className="dl-muted"> {'·'} {r.nights} nt{r.nights >= 10 ? ' · LONG STAY' : ''}</span>}</div>
              {r.doorCode && <div className="dl-line"><span className="dl-lbl">Code</span><b>{r.doorCode}</b></div>}
              <div className="dl-actions">
                {r.address && <a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.address)} target="_blank" rel="noreferrer" className="dl-link">Map</a>}
                {r.clean && r.clean.id && <a href={bzUrl(r.clean.id)} target="_blank" rel="noreferrer" className="dl-link">Breezeway task</a>}
                {r.reservationId && <a href={gyUrl(r.reservationId)} target="_blank" rel="noreferrer" className="dl-link">Reservation</a>}
                <NoteBox id={r.clean && r.clean.id ? String(r.clean.id) : 'u:' + r.unit} unit={r.unit} />
              </div>
            </div>
          ))}
          {departures.length === 0 && <div className="dl-empty">No departure cleans today.</div>}
        </div>
      )}

      {tab === 'verify' && (
        <div className="dl-list">
          <div className="dl-sec">Guests arriving into units nobody is cleaning today — walk these before check-in</div>
          {noClean.map((r: any, i: number) => (
            <div key={i} className="dl-card dl-check">
              <div className="dl-cardtop"><div className="dl-unit">{r.unit}</div><div className="dl-when">in {r.checkInTime || '4:00 PM'}</div></div>
              {(r.bookedToday || r.bookedAfterSync) && <div className="dl-sd dl-walkin">BOOKED TODAY {'·'} walk-in — confirm the unit is ready</div>}
              <div className="dl-line"><span className="dl-lbl">Guest</span>{r.guest}{r.nights != null && <span className="dl-muted"> {'·'} {r.nights} nt{r.nights >= 10 ? ' · BIG' : ''}</span>}</div>
              <div className="dl-line"><span className="dl-lbl">Last check</span>{
                r.lastTouch
                  ? <>{shortDate(r.lastTouch.at)}<span className="dl-muted"> {'·'} {r.lastTouch.kind}{r.lastTouch.daysAgo != null ? ' · ' + (r.lastTouch.daysAgo === 0 ? 'today' : r.lastTouch.daysAgo === 1 ? 'yesterday' : r.lastTouch.daysAgo + 'd ago') : ''}</span></>
                  : r.vendor ? <span className="dl-muted">{r.vendor} cleans this</span>
                  : r.lastTouchReason === 'lookup-failed' ? <b className="dl-warn">lookup failed</b>
                  : <b className="dl-warn">nothing logged in 400 days</b>
              }</div>
              {r.doorCode && <div className="dl-line"><span className="dl-lbl">Code</span><b>{r.doorCode}</b></div>}
              <div className="dl-actions">
                {r.phone && <a href={'tel:' + r.phone} className="dl-link">Call guest</a>}
                {r.address && <a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(r.address)} target="_blank" rel="noreferrer" className="dl-link">Map</a>}
                {r.reservationId && <a href={gyUrl(r.reservationId)} target="_blank" rel="noreferrer" className="dl-link">Reservation</a>}
                <NoteBox id={'u:' + r.unit} unit={r.unit} />
              </div>
            </div>
          ))}
          {noClean.length === 0 && <div className="dl-empty">Every arrival follows a clean today.</div>}
        </div>
      )}

      {tab === 'work' && (
        <div className="dl-list">
          {work.map((r: any, i: number) => (
            <div key={i} className="dl-card">
              <div className="dl-cardtop"><div className="dl-unit">{r.unit}</div><div className="dl-when">{r.status}</div></div>
              <div className="dl-line">{r.name}</div>
              <div className="dl-line"><span className="dl-lbl">Who</span>{r.assignees?.length ? r.assignees.join(', ') : <b className="dl-warn">unassigned</b>}<span className="dl-muted"> {'·'} {r.dept || ''}</span></div>
              <div className="dl-actions">
                <a href={bzUrl(r.id)} target="_blank" rel="noreferrer" className="dl-link">Breezeway task</a>
                {r.reportUrl && <a href={r.reportUrl} target="_blank" rel="noreferrer" className="dl-link">Report</a>}
                <NoteBox id={String(r.id)} unit={r.unit} />
              </div>
            </div>
          ))}
          {work.length === 0 && <div className="dl-empty">No other work today.</div>}
        </div>
      )}

      {tab === 'issues' && (
        <div className="dl-list">
          {issues.map((x: any, i: number) => (
            <div key={i} className={'dl-card ' + (x.severity === 'high' ? 'dl-check' : '')}>
              <div className="dl-cardtop"><div className="dl-unit">{x.unit}</div><div className="dl-when">{x.severity === 'high' ? 'urgent' : ''}</div></div>
              <div className="dl-line"><b>{x.kind}</b></div>
              <div className="dl-line dl-muted">{x.detail}{x.action ? <div className="dl-do">{x.action}</div> : null}</div>
              <div className="dl-actions"><NoteBox id={'u:' + x.unit} unit={x.unit} /></div>
            </div>
          ))}
          {(d?.glitches || []).map((g: any, i: number) => (
            <div key={'g' + i} className="dl-card">
              <div className="dl-cardtop"><div className="dl-unit">{g.unit || '—'}</div><div className="dl-when">{g.status}</div></div>
              <div className="dl-line">{g.overview}</div>
              <div className="dl-actions">{g.taskId && <a href={bzUrl(g.taskId)} target="_blank" rel="noreferrer" className="dl-link">Breezeway task</a>}<NoteBox id={g.taskId ? String(g.taskId) : 'u:' + (g.unit || 'issue')} unit={g.unit || ''} /></div>
            </div>
          ))}
          {issues.length === 0 && (d?.glitches || []).length === 0 && <div className="dl-empty">Nothing flagged. Good day.</div>}
        </div>
      )}

      <div className="dl-foot">Notes you leave here go straight to the office thread for that task.</div>
      <style jsx global>{CSS}</style>
    </div>
  )
}

const CSS = `
  /* This page has no app Shell around it, so it pads for the iPhone itself. 100vh counts Safari's
     URL bar, which pushed the footer below the glass; dvh is what you can actually see. The
     safe-area insets are 0 everywhere except an iPhone, so the desktop/print render is unchanged. */
  .dl-root { background:#f4f4f5; min-height:100vh; min-height:100dvh; padding:12px;
             padding-top:calc(12px + env(safe-area-inset-top,0px));
             padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));
             padding-left:calc(12px + env(safe-area-inset-left,0px));
             padding-right:calc(12px + env(safe-area-inset-right,0px));
             font-family:ui-sans-serif,system-ui,-apple-system,sans-serif; color:#18181b; -webkit-text-size-adjust:100%; }
  .dl-center { display:flex; align-items:center; justify-content:center; }
  .dl-pw { max-width:340px; width:100%; text-align:center; }
  .dl-h1 { font-size:22px; font-weight:800; margin:4px 0 6px; }
  .dl-brand { font-size:9.5px; font-weight:800; letter-spacing:.16em; color:#71717a; }
  .dl-date { font-size:19px; font-weight:800; letter-spacing:-.01em; }
  .dl-fresh { font-size:11px; color:#71717a; margin-top:1px; }
  .dl-do { margin-top:3px; font-weight:700; }
        .dl-ext { background:#ede9fe !important; color:#5b21b6 !important; }
        .dl-walkin { background:#fee2e2 !important; color:#991b1b !important; }
        .dl-stalebar { margin-top:4px; font-size:11px; font-weight:700; color:#b91c1c; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:5px 8px; }
        .dl-stale { color:#b91c1c; font-weight:700; }
  .dl-top { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
  .dl-topbtns { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .dl-tabs { display:flex; gap:6px; margin-bottom:10px; overflow-x:auto; padding-bottom:2px; }
  .dl-tab { flex:1; min-width:78px; font-size:12.5px; font-weight:700; padding:9px 8px; border-radius:10px; border:1px solid #d4d4d8; background:#fff; color:#52525b; }
  .dl-tab b { display:block; font-size:16px; }
  .dl-tabon { background:#18181b; color:#fff; border-color:#18181b; }
  .dl-sec { font-size:11.5px; color:#71717a; margin:2px 2px 8px; }
  .dl-list { display:flex; flex-direction:column; gap:8px; }
  .dl-card { background:#fff; border:1px solid #e4e4e7; border-radius:12px; padding:11px 12px; }
  .dl-hot { border-color:#f59e0b; border-left:4px solid #f59e0b; }
  .dl-check { border-color:#ef4444; border-left:4px solid #ef4444; }
  .dl-cardtop { display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
  .dl-unit { font-size:15px; font-weight:800; }
  .dl-when { font-size:12px; color:#71717a; white-space:nowrap; }
  .dl-sd { margin-top:5px; font-size:11.5px; font-weight:800; color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:7px; padding:4px 7px; }
  .dl-line { font-size:13px; margin-top:4px; }
  .dl-lbl { display:inline-block; width:74px; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:#a1a1aa; font-weight:700; }
  .dl-muted { color:#71717a; } .dl-warn { color:#b45309; }
  .dl-actions { display:flex; gap:7px; flex-wrap:wrap; margin-top:9px; align-items:center; }
  .dl-link { font-size:12px; font-weight:700; color:#4f46e5; text-decoration:none; border:1px solid #c7d2fe; background:#eef2ff; padding:6px 10px; border-radius:8px; }
  .dl-notebtn { font-size:12px; font-weight:700; color:#52525b; border:1px solid #d4d4d8; background:#fff; padding:6px 10px; border-radius:8px; }
  .dl-note { width:100%; display:flex; flex-direction:column; gap:6px; margin-top:6px; }
  .dl-row { display:flex; gap:6px; }
  .dl-input { width:100%; font-size:14px; padding:9px 10px; border-radius:9px; border:1px solid #d4d4d8; background:#fff; }
  .dl-input-sm { font-size:12.5px; padding:6px 8px; width:auto; }
  .dl-btn { font-size:12.5px; font-weight:700; padding:8px 12px; border-radius:9px; border:1px solid #d4d4d8; background:#fff; color:#3f3f46; }
  .dl-btn-dark { background:#18181b; color:#fff; border-color:#18181b; }
  .dl-ok { font-size:12px; color:#15803d; } .dl-err { font-size:12.5px; color:#b91c1c; margin-top:6px; }
  .dl-empty { color:#a1a1aa; font-style:italic; padding:16px; text-align:center; }
  .dl-foot { margin-top:14px; font-size:11px; color:#a1a1aa; text-align:center; }
  @media (max-width: 640px) {
    /* The four tabs are the only navigation on this page. On a 40-card cleans list they scrolled
       away, so switching to Issues meant thumbing all the way back to the top. Pin them. The
       negative margin lets the strip bleed to the screen edge instead of ending in the gutter. */
    .dl-tabs { position:sticky; top:env(safe-area-inset-top,0px); z-index:5; background:#f4f4f5;
               margin:0 -12px 10px; padding:2px 12px 8px; }
    /* Map / Breezeway / Reservation are the point of the page and were 30px pills — under the
       thumb-target floor for someone holding a phone in one hand in a stairwell. */
    .dl-link, .dl-notebtn { padding:9px 11px; }
  }
  @media print {
    @page { size: letter portrait; margin: 0.4in; }
    .dl-root { background:#fff; padding:0; }
    .dl-topbtns, .dl-tabs, .dl-notebtn, .dl-note, .dl-foot { display:none !important; }
    .dl-card { break-inside:avoid; border-color:#d4d4d8; }
    .dl-link { border:none; background:none; padding:0; color:#3f3f46; }
  }
`
