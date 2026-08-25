'use client'
// THE FIELD BOARD — the morning brief, alive (Jon, 2026-08-25: "it should look a lot like the
// daily brief"). Same furniture as the emails on purpose: dark masthead, a row of tiles, cards
// with a coloured left rule, people and areas as banded headers. The crew reads the brief at 7am
// and this page all day; making them look like two different products would be a tax on them.
//
// It refreshes itself every three minutes while the tab is actually visible — a field page left
// open on a phone all morning is worse than no page, because it looks current.
import { useCallback, useEffect, useState } from 'react'

const bzUrl = (id: string) => 'https://app.breezeway.io/task/' + id
const ago = (iso: string | null) => {
  if (!iso) return 'unknown'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (isNaN(m)) return 'unknown'
  return m < 60 ? m + ' min ago' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm ago'
}

export default function FieldBoardPage({ params }: { params: { code: string } }) {
  const code = params.code
  const [d, setD] = useState<any>(null)
  const [locked, setLocked] = useState<any>(null)
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (pw?: string) => {
    setLoading(true)
    try {
      // The passcode is kept on this device only, so the crew types it once per phone.
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
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') load() }
    const id = window.setInterval(tick, 180000)
    document.addEventListener('visibilitychange', tick)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [load])

  if (locked) {
    return (
      <div style={S.page}>
        <div style={S.wrap}>
          <div style={S.band}>
            <div style={S.brand}>S T A Y &nbsp; H O S P I T A L I T Y</div>
            <div style={S.title}>{locked.label || 'Field board'}</div>
            <div style={S.sub}>Enter the code your supervisor gave you</div>
          </div>
          <div style={{ ...S.card, padding: '18px 20px' }}>
            <input value={pass} onChange={e => setPass(e.target.value)} placeholder="Passcode"
              onKeyDown={e => { if (e.key === 'Enter') load(pass) }}
              style={S.input} />
            <button onClick={() => load(pass)} style={S.btn}>Open the board</button>
            {err && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 10 }}>{err}</div>}
          </div>
        </div>
      </div>
    )
  }

  const sec = d?.sections || {}
  const crew = d?.crew
  const deps: any[] = d?.departures || []
  const arrs: any[] = d?.arrivals || []
  const work: any[] = d?.work || []
  const issues: any[] = [...(d?.exceptions || []), ...(d?.glitches || [])]
  const sameDayIds = new Set(arrs.map(a => String(a.listingId)))
  const cleansDone = deps.filter(r => /done|complete|finish/i.test(String(r.clean?.status || ''))).length
  const dateNice = d?.date ? new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''

  const tile = (label: string, value: string | number, note?: string, tone?: string) => (
    <td style={S.tile}>
      <div style={S.tileLabel}>{label}</div>
      <div style={{ ...S.tileValue, ...(tone ? { color: tone } : {}) }}>{value}</div>
      {note ? <div style={S.tileNote}>{note}</div> : null}
    </td>
  )

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.band}>
          <div style={S.brand}>S T A Y &nbsp; H O S P I T A L I T Y</div>
          <div style={S.title}>{d?.label || 'Field board'}</div>
          <div style={S.sub}>{dateNice}{d?.scopeLabel ? ' · ' + d.scopeLabel : ''} · live</div>
        </div>

        <div style={S.tilesOuter}>
          <table width="100%" cellSpacing={0} cellPadding={0}><tbody><tr>
            {sec.crew ? tile('Clocked in', `${crew?.clockedIn ?? 0}/${crew?.onShift ?? 0}`, crew?.notClocked?.length ? crew.notClocked.length + ' not in yet' : 'on shift', crew && crew.clockedIn < crew.onShift ? '#b45309' : '#047857') : null}
            {sec.cleans ? tile('Cleans', deps.length, `${cleansDone} done`) : null}
            {sec.cleans ? tile('Same-day', deps.filter(r => sameDayIds.has(String(r.listingId))).length, 'turns', '#b91c1c') : null}
            {sec.work ? tile('Work', work.length, 'jobs today') : null}
            {sec.issues ? tile('Issues', issues.length, 'open') : null}
          </tr></tbody></table>
          <div style={{ ...S.tileNote, padding: '6px 10px 0' }}>
            {loading ? 'refreshing…' : `updated ${ago(d?.sync?.breezewayAt || d?.lastSync || null)} · refreshes itself`}
            <button onClick={() => load()} style={S.refresh}>Refresh</button>
          </div>
        </div>

        <div style={S.notice}>
          <b>Confirm access before entering any unit.</b> Guests extend and plans change after this
          page loads — always confirm the unit is clear before you enter.
        </div>

        {sec.crew && crew ? (
          <div style={S.card}>
            <div style={{ ...S.cardHead, borderLeft: '3px solid #0891b2' }}>
              <div style={S.h2}>Crew right now <span style={S.h2n}>· {crew.clockedIn} of {crew.onShift} clocked in</span></div>
              {crew.elsewhere ? <div style={S.when}>{crew.elsewhere} more on shift in another area</div> : null}
            </div>
            <div style={S.cardBody}>
              {(crew.people || []).map((p: any, i: number) => (
                <div key={i} style={S.person}>
                  <div style={S.personHead}>
                    <b>{p.name}</b>
                    <span style={p.clockedIn ? S.pillOk : S.pillOff}>{p.clockedIn ? 'clocked in' : 'not clocked in'}</span>
                  </div>
                  <div style={S.muted}>{p.role || 'crew'}{p.shift ? ' · ' + p.shift : ''} · {p.done} done · {p.left} left</div>
                  {p.onNow?.length ? p.onNow.map((j: any, k: number) => (
                    <div key={k} style={S.onNow}>▶ on now: {j.unit} — {j.task} <a href={bzUrl(j.id)} target="_blank" rel="noreferrer" style={S.link}>open ↗</a></div>
                  )) : <div style={S.muted}>nothing started right now</div>}
                  {(p.jobs || []).map((j: any, k: number) => (
                    <div key={'j' + k} style={S.row}>
                      <span>{j.unit} <span style={S.muted}>{j.task}</span></span>
                      <span style={S.muted}>{j.state === 'done' ? 'done' : j.state === 'running' ? 'in progress' : 'to do'} <a href={bzUrl(j.id)} target="_blank" rel="noreferrer" style={S.link}>↗</a></span>
                    </div>
                  ))}
                </div>
              ))}
              {!(crew.people || []).length && <div style={S.muted}>Nobody on the schedule for these units today.</div>}
            </div>
          </div>
        ) : null}

        {sec.cleans ? (
          <div style={S.card}>
            <div style={{ ...S.cardHead, borderLeft: '3px solid #6366f1' }}>
              <div style={S.h2}>Cleans <span style={S.h2n}>· {cleansDone} of {deps.length} done</span></div>
            </div>
            <div style={S.cardBody}>
              {deps.map((r: any, i: number) => {
                const hot = sameDayIds.has(String(r.listingId))
                return (
                  <div key={i} style={{ ...S.row, ...(hot ? S.hot : {}) }}>
                    <span><b>{r.unit}</b>{hot ? <span style={S.pillRed}>SAME-DAY</span> : null}
                      <div style={S.muted}>{r.clean?.assignees?.join(', ') || 'nobody assigned'} · out {r.checkOutTime || 'today'}</div></span>
                    <span style={S.muted}>{r.clean?.status || 'no clean'}{r.clean?.id ? <> <a href={bzUrl(r.clean.id)} target="_blank" rel="noreferrer" style={S.link}>↗</a></> : null}</span>
                  </div>
                )
              })}
              {!deps.length && <div style={S.muted}>No checkouts on these units today.</div>}
            </div>
          </div>
        ) : null}

        {sec.work ? (
          <div style={S.card}>
            <div style={{ ...S.cardHead, borderLeft: '3px solid #7c2d12' }}>
              <div style={S.h2}>Work today <span style={S.h2n}>· {work.length}</span></div>
            </div>
            <div style={S.cardBody}>
              {work.map((w: any, i: number) => (
                <div key={i} style={S.row}>
                  <span><b>{w.unit}</b> <span style={S.muted}>{w.name || w.task}</span></span>
                  <span style={S.muted}>{w.assignees?.join(', ') || 'unassigned'}{w.id ? <> <a href={bzUrl(w.id)} target="_blank" rel="noreferrer" style={S.link}>↗</a></> : null}</span>
                </div>
              ))}
              {!work.length && <div style={S.muted}>Nothing else on the board for these units.</div>}
            </div>
          </div>
        ) : null}

        {sec.issues ? (
          <div style={S.card}>
            <div style={{ ...S.cardHead, borderLeft: '3px solid #dc2626' }}>
              <div style={S.h2}>Issues <span style={S.h2n}>· {issues.length}</span></div>
            </div>
            <div style={S.cardBody}>
              {issues.map((g: any, i: number) => (
                <div key={i} style={S.row}>
                  <span><b>{g.unit}</b> <span style={S.muted}>{g.detail || g.overview}</span></span>
                  <span style={S.muted}>{g.action || g.status || ''}</span>
                </div>
              ))}
              {!issues.length && <div style={S.muted}>Nothing open.</div>}
            </div>
          </div>
        ) : null}

        <div style={S.foot}>Live board · refreshes every 3 minutes · questions go to your supervisor.</div>
      </div>
    </div>
  )
}

// The brief's design system, as inline styles so this page cannot drift from the emails.
const S: Record<string, any> = {
  page: { margin: 0, padding: 0, background: '#eef0f3', minHeight: '100dvh', fontFamily: '-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif', color: '#0b1220' },
  wrap: { maxWidth: 680, margin: '0 auto', padding: '20px 14px' },
  band: { background: '#0b1220', borderRadius: '14px 14px 0 0', padding: '20px 24px 16px' },
  brand: { fontSize: 11, fontWeight: 700, letterSpacing: '.22em', color: '#a5b4fc', margin: '0 0 6px' },
  title: { fontSize: 21, fontWeight: 700, color: '#fff' },
  sub: { fontSize: 12, color: '#94a3b8', marginTop: 6 },
  tilesOuter: { background: '#fff', border: '1px solid #e5e7eb', borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '6px 10px 14px', marginBottom: 14 },
  tile: { padding: '10px 8px 0', textAlign: 'center', borderLeft: '1px solid #f3f4f6' },
  tileLabel: { fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em' },
  tileValue: { fontSize: 22, fontWeight: 600, color: '#0b1220', padding: '2px 0 0' },
  tileNote: { fontSize: 10, color: '#9ca3af' },
  refresh: { marginLeft: 8, fontSize: 10, border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, padding: '2px 8px', cursor: 'pointer' },
  notice: { border: '1px solid #fcd34d', background: '#fffbeb', borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 12.5, lineHeight: 1.6, color: '#92400e' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
  cardHead: { padding: '12px 20px 10px', borderBottom: '1px solid #f3f4f6' },
  cardBody: { padding: '6px 16px 14px' },
  h2: { fontSize: 13, fontWeight: 700, color: '#0b1220' },
  h2n: { fontWeight: 400, color: '#9ca3af' },
  when: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  person: { padding: '10px 0', borderTop: '1px solid #f3f4f6' },
  personHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13.5 },
  row: { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '8px 0', borderTop: '1px solid #f3f4f6', lineHeight: 1.5 },
  hot: { background: '#fff5f5' },
  muted: { color: '#6b7280', fontSize: 12 },
  onNow: { fontSize: 12.5, color: '#b45309', marginTop: 2 },
  link: { color: '#4338ca', textDecoration: 'none' },
  pillOk: { fontSize: 10, fontWeight: 700, background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '1px 7px' },
  pillOff: { fontSize: 10, fontWeight: 700, background: '#f3f4f6', color: '#6b7280', borderRadius: 999, padding: '1px 7px' },
  pillRed: { fontSize: 10, fontWeight: 700, background: '#fee2e2', color: '#b91c1c', borderRadius: 999, padding: '1px 7px', marginLeft: 6 },
  input: { width: '100%', fontSize: 16, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 10 },
  btn: { width: '100%', background: '#111827', color: '#fff', border: 0, borderRadius: 10, padding: '12px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  foot: { fontSize: 11, color: '#9ca3af', margin: '14px 4px 0', textAlign: 'center' },
}
