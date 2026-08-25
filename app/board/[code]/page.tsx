'use client'
// THE FIELD BOARD — what a crew actually needs on a phone, in the brief's clothes.
//
// REBUILT 2026-08-25 after Jon saw v1: "this is so so bad… make way better and more organized and
// visual." He was right. v1 printed every job — done and not-done — as identical grey rows of raw
// Breezeway strings, one endless scroll. Four rules came out of that:
//   1. WHAT IS LEFT IS THE PAGE. Finished work collapses behind a count. A board that shows 40
//      rows when 6 need doing is hiding the 6.
//   2. ONE VIEW AT A TIME. Sticky tabs (Crew · Cleans · Work · Issues) instead of one column of
//      everything; a thumb reaches a tab, a scroll never ends.
//   3. PROGRESS, NOT JUST COUNTS. A bar you can read at a glance beats "14 done · 5 left".
//   4. TASK NAMES ARE NOT LABELS. "Field Reported Priority/Replace door lock battery" becomes a
//      FIELD chip plus "Replace door lock battery". The tag carries the source, the text carries
//      the job.
import { useCallback, useEffect, useMemo, useState } from 'react'

const bzUrl = (id: string) => 'https://app.breezeway.io/task/' + id
const ago = (iso: string | null) => {
  if (!iso) return 'unknown'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (isNaN(m)) return 'unknown'
  return m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago'
}
const initials = (n: string) => String(n || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase()
/** Split a Breezeway task name into its source tag and the job itself. */
function splitTask(raw: string): { tag: '' | 'GUEST' | 'FIELD'; text: string } {
  const s = String(raw || '').trim()
  const guest = /^guest\s*reported\s*(\/\s*glitch)?\s*[-/:]*\s*/i
  const field = /^field\s*reported\s*(priority)?\s*[-/:]*\s*/i
  if (guest.test(s)) return { tag: 'GUEST', text: s.replace(guest, '') || 'Guest issue' }
  if (field.test(s)) return { tag: 'FIELD', text: s.replace(field, '') || 'Field request' }
  return { tag: '', text: s }
}

type Tab = 'crew' | 'cleans' | 'work' | 'issues'

export default function FieldBoardPage({ params }: { params: { code: string } }) {
  const code = params.code
  const [d, setD] = useState<any>(null)
  const [locked, setLocked] = useState<any>(null)
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('crew')
  const [showDone, setShowDone] = useState<Record<string, boolean>>({})

  const load = useCallback(async (pw?: string) => {
    setLoading(true)
    try {
      const saved = pw ?? (typeof window !== 'undefined' ? window.localStorage.getItem('board:' + code) || '' : '')
      const r = await fetch(`/api/public/field-board/${code}` + (saved ? '?pass=' + encodeURIComponent(saved) : ''), { cache: 'no-store' })
      const j = await r.json()
      if (j.locked) { setLocked(j); setD(null); if (j.error) setErr(j.error) }
      else if (j.ok) {
        setLocked(null); setErr(''); setD(j)
        try { if (saved) window.localStorage.setItem('board:' + code, saved) } catch { /* private window */ }
      } else setErr(j.error || 'Could not load this board.')
    } catch { setErr('Could not reach the board — check the signal and try again.') }
    setLoading(false)
  }, [code])

  useEffect(() => { load() }, [load])
  // A field page left open on a phone all morning is worse than no page: it looks current.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const id = window.setInterval(tick, 180000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  const sec = d?.sections || {}
  const crew = d?.crew
  const deps: any[] = useMemo(() => d?.departures || [], [d])
  const arrs: any[] = useMemo(() => d?.arrivals || [], [d])
  const work: any[] = useMemo(() => d?.work || [], [d])
  const issues: any[] = useMemo(() => [...(d?.exceptions || []), ...(d?.glitches || [])], [d])
  const sameDayIds = useMemo(() => new Set(arrs.map(a => String(a.listingId))), [arrs])
  const cleanState = (r: any) => String(r.clean?.status || 'no clean')
  const cleansDone = deps.filter(r => /done/i.test(cleanState(r))).length
  const pct = deps.length ? Math.round((cleansDone / deps.length) * 100) : 0

  // Default to the tab that has something to say.
  useEffect(() => {
    if (!d) return
    const first: Tab | null = sec.crew ? 'crew' : sec.cleans ? 'cleans' : sec.work ? 'work' : sec.issues ? 'issues' : null
    if (first) setTab(t => (sec[t] ? t : first))
  }, [d, sec])

  if (locked) {
    return (
      <div className="fb">
        <Style />
        <div className="fb-wrap">
          <div className="fb-band">
            <div className="fb-brand">STAY HOSPITALITY</div>
            <h1 className="fb-title">{locked.label || 'Field board'}</h1>
            <div className="fb-sub">Enter the code your supervisor gave you</div>
          </div>
          <div className="fb-card fb-pad">
            <input className="fb-input" value={pass} onChange={e => setPass(e.target.value)} placeholder="Passcode"
              onKeyDown={e => { if (e.key === 'Enter') load(pass) }} />
            <button className="fb-btn" onClick={() => load(pass)}>Open the board</button>
            {err && <p className="fb-err">{err}</p>}
          </div>
        </div>
      </div>
    )
  }

  const dateNice = d?.date ? new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''
  const ALL_TABS: { key: Tab; label: string; n: number }[] = [
    { key: 'crew', label: 'Crew', n: crew?.onShift ?? 0 },
    { key: 'cleans', label: 'Cleans', n: deps.length },
    { key: 'work', label: 'Work', n: work.filter((w: any) => w.status !== 'done').length },
    { key: 'issues', label: 'Issues', n: issues.length },
  ]
  const TABS = ALL_TABS.filter(t => sec[t.key])

  return (
    <div className="fb">
      <Style />
      <div className="fb-wrap">
        <div className="fb-band">
          <div className="fb-brandrow">
            <span className="fb-brand">STAY HOSPITALITY</span>
            <span className="fb-live"><i className="fb-dot" />live</span>
          </div>
          <h1 className="fb-title">{d?.label || 'Field board'}</h1>
          <div className="fb-sub">{dateNice}{d?.scopeLabel ? ' · ' + d.scopeLabel : ''}</div>

          {sec.cleans && deps.length ? (
            <div className="fb-prog">
              <div className="fb-progtop">
                <span><b>{cleansDone}</b> of <b>{deps.length}</b> cleans done</span>
                <span>{pct}%</span>
              </div>
              <div className="fb-bar"><i style={{ width: pct + '%' }} /></div>
            </div>
          ) : null}
        </div>

        <div className="fb-stats">
          {sec.crew ? <Stat label="Clocked in" value={`${crew?.clockedIn ?? 0}/${crew?.onShift ?? 0}`} tone={crew && crew.clockedIn < crew.onShift ? 'warn' : 'ok'} note={crew?.notClocked?.length ? crew.notClocked.length + ' not in' : 'all in'} /> : null}
          {sec.cleans ? <Stat label="Same-day" value={String(deps.filter(r => sameDayIds.has(String(r.listingId))).length)} tone="hot" note="turns" /> : null}
          {sec.cleans ? <Stat label="Left" value={String(deps.length - cleansDone)} note="to clean" /> : null}
          {sec.work ? <Stat label="Work" value={String(work.filter(w => w.status !== 'done').length)} note="open" /> : null}
          {sec.issues ? <Stat label="Issues" value={String(issues.length)} tone={issues.length ? 'hot' : 'ok'} note="open" /> : null}
        </div>

        <div className="fb-meta">
          {loading ? 'refreshing…' : `updated ${ago(d?.sync?.breezewayAt || d?.lastSync || null)}`}
          <button className="fb-mini" onClick={() => load()}>Refresh</button>
        </div>

        <div className="fb-notice"><b>Confirm access before entering any unit.</b> Guests extend and plans change after this page loads.</div>

        {TABS.length > 1 ? (
          <div className="fb-tabs">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} className={'fb-tab' + (tab === t.key ? ' on' : '')}>
                {t.label}<span className="fb-tabn">{t.n}</span>
              </button>
            ))}
          </div>
        ) : null}

        {/* ── CREW ─────────────────────────────────────────────────────────── */}
        {tab === 'crew' && sec.crew ? (
          <>
            {crew?.elsewhere ? <p className="fb-note">{crew.elsewhere} more on shift in another area.</p> : null}
            {(crew?.people || []).map((p: any, i: number) => {
              const total = p.done + p.left
              const ppct = total ? Math.round((p.done / total) * 100) : 0
              const left = (p.jobs || []).filter((j: any) => j.state !== 'done')
              const done = (p.jobs || []).filter((j: any) => j.state === 'done')
              const key = 'p' + i
              return (
                <div key={i} className="fb-card">
                  <div className="fb-person">
                    <span className={'fb-av' + (p.clockedIn ? ' in' : '')}>{initials(p.name)}</span>
                    <span className="fb-pinfo">
                      <b>{p.name}</b>
                      <span className="fb-psub">{p.role || 'crew'}{p.shift ? ' · ' + p.shift : ''}</span>
                    </span>
                    <span className={p.clockedIn ? 'fb-pill ok' : 'fb-pill off'}>{p.clockedIn ? 'clocked in' : 'not in'}</span>
                  </div>
                  {total ? (
                    <div className="fb-prog sm">
                      <div className="fb-progtop"><span>{p.done} done · <b>{p.left} left</b></span><span>{ppct}%</span></div>
                      <div className="fb-bar"><i style={{ width: ppct + '%' }} /></div>
                    </div>
                  ) : <p className="fb-note">Nothing assigned yet.</p>}

                  {p.onNow?.length ? (
                    <div className="fb-now">
                      <span className="fb-nowlab">ON NOW</span>
                      {p.onNow.map((j: any, k: number) => {
                        const t = splitTask(j.task)
                        return (
                          <a key={k} className="fb-nowrow" href={bzUrl(j.id)} target="_blank" rel="noreferrer">
                            <b>{j.unit}</b><span>{t.text}</span><i>open ↗</i>
                          </a>
                        )
                      })}
                    </div>
                  ) : null}

                  {left.map((j: any, k: number) => <JobRow key={'l' + k} job={j} />)}

                  {done.length ? (
                    <button className="fb-more" onClick={() => setShowDone(s => ({ ...s, [key]: !s[key] }))}>
                      {showDone[key] ? 'Hide' : 'Show'} {done.length} finished
                    </button>
                  ) : null}
                  {showDone[key] ? done.map((j: any, k: number) => <JobRow key={'d' + k} job={j} />) : null}
                </div>
              )
            })}
            {!(crew?.people || []).length && <div className="fb-card fb-pad fb-note">Nobody on the schedule for these units today.</div>}
          </>
        ) : null}

        {/* ── CLEANS ───────────────────────────────────────────────────────── */}
        {tab === 'cleans' && sec.cleans ? (
          <>
            {[
              { key: 'hot', label: 'Same-day turns — guest lands today', rows: deps.filter(r => sameDayIds.has(String(r.listingId)) && !/done/i.test(cleanState(r))), tone: 'hot' },
              { key: 'todo', label: 'Still to clean', rows: deps.filter(r => !sameDayIds.has(String(r.listingId)) && !/done/i.test(cleanState(r))), tone: '' },
              { key: 'done', label: 'Finished', rows: deps.filter(r => /done/i.test(cleanState(r))), tone: 'ok' },
            ].filter(g => g.rows.length).map(g => (
              <div key={g.key} className={'fb-card' + (g.tone === 'hot' ? ' hot' : '')}>
                <div className="fb-cardhead"><b>{g.label}</b><span className="fb-cnt">{g.rows.length}</span></div>
                {g.rows.map((r: any, i: number) => {
                  const st = cleanState(r)
                  const who = (r.clean?.assignees || []).join(', ')
                  return (
                    <div key={i} className="fb-unit">
                      <div className="fb-unittop">
                        <b>{r.unit}</b>
                        <span className={'fb-pill ' + (/done/i.test(st) ? 'ok' : /progress/i.test(st) ? 'warn' : 'off')}>{st}</span>
                      </div>
                      <div className="fb-unitsub">
                        <span>{who || 'nobody assigned'}</span>
                        <span>out {r.checkOutTime || 'today'}</span>
                        {r.clean?.id ? <a href={bzUrl(r.clean.id)} target="_blank" rel="noreferrer">open ↗</a> : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
            {!deps.length && <div className="fb-card fb-pad fb-note">No checkouts on these units today.</div>}
          </>
        ) : null}

        {/* ── WORK, grouped by building ────────────────────────────────────── */}
        {tab === 'work' && sec.work ? (
          <>
            {groupByBuilding(work.filter(w => w.status !== 'done')).map(g => (
              <div key={g.area} className="fb-card">
                <div className="fb-cardhead"><b>{g.area}</b><span className="fb-cnt">{g.rows.length}</span></div>
                {g.rows.map((w: any, i: number) => <JobRow key={i} job={{ id: w.id, unit: w.unit, task: w.label || w.name, state: w.status === 'in progress' ? 'running' : 'open', who: (w.assignees || []).join(', ') }} />)}
              </div>
            ))}
            {!work.filter(w => w.status !== 'done').length && <div className="fb-card fb-pad fb-note">Nothing open on these units.</div>}
          </>
        ) : null}

        {/* ── ISSUES ───────────────────────────────────────────────────────── */}
        {tab === 'issues' && sec.issues ? (
          <>
            {issues.map((g: any, i: number) => (
              <div key={i} className="fb-card fb-pad">
                <div className="fb-unittop"><b>{g.unit}</b>{g.severity === 'high' ? <span className="fb-pill hot">urgent</span> : null}</div>
                <p className="fb-issue">{g.detail || g.overview}</p>
                {g.action ? <p className="fb-do">→ {g.action}</p> : null}
              </div>
            ))}
            {!issues.length && <div className="fb-card fb-pad fb-note">Nothing open.</div>}
          </>
        ) : null}

        <p className="fb-foot">Refreshes itself every 3 minutes · questions go to your supervisor.</p>
      </div>
    </div>
  )
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="fb-stat">
      <span className="fb-statlab">{label}</span>
      <span className={'fb-statval ' + (tone || '')}>{value}</span>
      {note ? <span className="fb-statnote">{note}</span> : null}
    </div>
  )
}

function JobRow({ job }: { job: any }) {
  const t = splitTask(job.task)
  return (
    <a className="fb-job" href={job.id ? bzUrl(job.id) : undefined} target="_blank" rel="noreferrer">
      <span className="fb-jobmain">
        <b>{job.unit}</b>
        <span className="fb-jobtask">{t.tag ? <i className={'fb-tag ' + t.tag.toLowerCase()}>{t.tag}</i> : null}{t.text}</span>
        {job.who ? <span className="fb-jobwho">{job.who}</span> : null}
      </span>
      <span className={'fb-state ' + (job.state === 'done' ? 'ok' : job.state === 'running' ? 'warn' : '')}>
        {job.state === 'done' ? 'done' : job.state === 'running' ? 'in progress' : 'to do'}
      </span>
    </a>
  )
}

/** Group work by the first word of the unit name — the building, the way a tech drives it. */
function groupByBuilding(rows: any[]): { area: string; rows: any[] }[] {
  const by: Record<string, any[]> = {}
  for (const r of rows) {
    const area = String(r.unit || 'Other').split(/[\s\-\/]/)[0] || 'Other'
    ;(by[area] = by[area] || []).push(r)
  }
  return Object.keys(by).sort((a, b) => by[b].length - by[a].length || a.localeCompare(b)).map(area => ({ area, rows: by[area] }))
}

function Style() {
  return <style dangerouslySetInnerHTML={{ __html: `
.fb{margin:0;background:#eef0f3;min-height:100dvh;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b1220;-webkit-font-smoothing:antialiased}
.fb-wrap{max-width:680px;margin:0 auto;padding:16px 12px 40px}
.fb-band{background:#0b1220;border-radius:16px;padding:18px 20px 16px;color:#fff}
.fb-brandrow{display:flex;justify-content:space-between;align-items:center}
.fb-brand{font-size:10px;font-weight:700;letter-spacing:.2em;color:#a5b4fc}
.fb-live{font-size:10.5px;color:#86efac;display:inline-flex;align-items:center;gap:5px;letter-spacing:.08em;text-transform:uppercase}
.fb-dot{width:7px;height:7px;border-radius:99px;background:#22c55e;display:inline-block;animation:fbp 2s infinite}
@keyframes fbp{0%,100%{opacity:1}50%{opacity:.35}}
.fb-title{font-size:22px;font-weight:800;margin:8px 0 0;letter-spacing:-.01em}
.fb-sub{font-size:12.5px;color:#94a3b8;margin-top:4px}
.fb-prog{margin-top:14px}
.fb-prog.sm{margin:10px 0 2px}
.fb-progtop{display:flex;justify-content:space-between;font-size:12px;color:#cbd5e1;margin-bottom:5px}
.fb-prog.sm .fb-progtop{color:#6b7280}
.fb-bar{height:7px;border-radius:99px;background:rgba(255,255,255,.15);overflow:hidden}
.fb-prog.sm .fb-bar{background:#eef0f3}
.fb-bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#4338ca,#22c55e);transition:width .4s ease}
.fb-stats{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px;margin:12px 0 6px}
.fb-stat{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:10px 6px;text-align:center}
.fb-statlab{display:block;font-size:9.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em}
.fb-statval{display:block;font-size:22px;font-weight:700;margin-top:2px}
.fb-statval.ok{color:#047857}.fb-statval.warn{color:#b45309}.fb-statval.hot{color:#b91c1c}
.fb-statnote{display:block;font-size:10px;color:#9ca3af}
.fb-meta{display:flex;align-items:center;gap:8px;font-size:11px;color:#9ca3af;padding:2px 4px 10px}
.fb-mini{font-size:11px;border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:3px 10px;cursor:pointer;color:#374151}
.fb-notice{border:1px solid #fcd34d;background:#fffbeb;border-radius:12px;padding:11px 14px;font-size:12.5px;line-height:1.55;color:#92400e;margin-bottom:12px}
.fb-tabs{position:sticky;top:0;z-index:5;display:flex;gap:6px;background:#eef0f3;padding:8px 0 10px;overflow-x:auto}
.fb-tab{flex:1;min-width:84px;border:1px solid #e5e7eb;background:#fff;border-radius:11px;padding:9px 8px;font-size:13px;font-weight:700;color:#6b7280;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.fb-tab.on{background:#0b1220;border-color:#0b1220;color:#fff}
.fb-tabn{font-size:11px;font-weight:700;background:rgba(0,0,0,.06);border-radius:99px;padding:1px 7px}
.fb-tab.on .fb-tabn{background:rgba(255,255,255,.18)}
.fb-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;margin-bottom:10px;overflow:hidden}
.fb-card.hot{border-color:#fecaca}
.fb-pad{padding:14px 16px}
.fb-cardhead{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;font-size:13px;background:#f8fafc;border-bottom:1px solid #eef0f3}
.fb-card.hot .fb-cardhead{background:#fef2f2;color:#b91c1c}
.fb-cnt{font-size:11.5px;font-weight:700;color:#6b7280;background:#fff;border:1px solid #e5e7eb;border-radius:99px;padding:1px 9px}
.fb-person{display:flex;align-items:center;gap:10px;padding:13px 16px 2px}
.fb-av{width:38px;height:38px;border-radius:99px;background:#e5e7eb;color:#6b7280;font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
.fb-av.in{background:#dcfce7;color:#166534}
.fb-pinfo{flex:1;min-width:0;display:flex;flex-direction:column}
.fb-pinfo b{font-size:15px;font-weight:700}
.fb-psub{font-size:11.5px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fb-pill{font-size:10px;font-weight:700;border-radius:99px;padding:3px 9px;text-transform:lowercase;white-space:nowrap}
.fb-pill.ok{background:#dcfce7;color:#166534}
.fb-pill.off{background:#f3f4f6;color:#6b7280}
.fb-pill.warn{background:#fef3c7;color:#b45309}
.fb-pill.hot{background:#fee2e2;color:#b91c1c}
.fb-person+.fb-prog.sm{padding:0 16px}
.fb-now{margin:10px 12px 4px;background:#fffbeb;border:1px solid #fde68a;border-radius:11px;padding:9px 12px}
.fb-nowlab{font-size:9.5px;font-weight:800;letter-spacing:.1em;color:#b45309}
.fb-nowrow{display:flex;gap:8px;align-items:baseline;text-decoration:none;color:#0b1220;font-size:13.5px;margin-top:4px}
.fb-nowrow b{white-space:nowrap}
.fb-nowrow span{flex:1;color:#78350f;overflow:hidden;text-overflow:ellipsis}
.fb-nowrow i{font-style:normal;font-size:11.5px;color:#4338ca;white-space:nowrap}
.fb-job{display:flex;gap:10px;align-items:center;padding:11px 16px;border-top:1px solid #f3f4f6;text-decoration:none;color:inherit}
.fb-jobmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.fb-jobmain b{font-size:14px}
.fb-jobtask{font-size:12.5px;color:#6b7280;display:flex;gap:6px;align-items:center}
.fb-jobwho{font-size:11px;color:#9ca3af}
.fb-tag{font-style:normal;font-size:9px;font-weight:800;letter-spacing:.05em;border-radius:4px;padding:1px 5px;flex:none}
.fb-tag.guest{background:#fee2e2;color:#b91c1c}
.fb-tag.field{background:#e0e7ff;color:#4338ca}
.fb-state{font-size:11px;color:#9ca3af;white-space:nowrap}
.fb-state.ok{color:#047857}.fb-state.warn{color:#b45309;font-weight:700}
.fb-more{width:100%;border:0;border-top:1px solid #f3f4f6;background:#fff;padding:10px;font-size:12px;color:#6b7280;cursor:pointer}
.fb-unit{padding:12px 16px;border-top:1px solid #f3f4f6}
.fb-unittop{display:flex;justify-content:space-between;align-items:center;gap:8px}
.fb-unittop b{font-size:15px}
.fb-unitsub{display:flex;gap:12px;font-size:12px;color:#6b7280;margin-top:3px;flex-wrap:wrap}
.fb-unitsub a{color:#4338ca;text-decoration:none;font-weight:600}
.fb-issue{margin:6px 0 0;font-size:13.5px;line-height:1.5}
.fb-do{margin:4px 0 0;font-size:12.5px;color:#b45309}
.fb-note{font-size:12.5px;color:#9ca3af;padding:8px 16px}
.fb-foot{font-size:11px;color:#9ca3af;text-align:center;margin-top:14px}
.fb-input{width:100%;font-size:16px;padding:11px 12px;border:1px solid #e5e7eb;border-radius:11px;margin-bottom:10px}
.fb-btn{width:100%;background:#0b1220;color:#fff;border:0;border-radius:11px;padding:13px;font-size:14.5px;font-weight:700;cursor:pointer}
.fb-err{color:#b91c1c;font-size:13px;margin:10px 0 0}
@media(max-width:420px){.fb-stats{grid-auto-flow:row;grid-template-columns:1fr 1fr;grid-auto-columns:unset}}
` }} />
}
