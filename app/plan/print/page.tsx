'use client'
// DAY SHEET (print) — the ops manager's paper copy of the day. Everything that matters on one
// document: arrivals, departures, owner stays, work orders, open glitches, vacant units, and
// ruled space to write on. Screen shows a toolbar; @media print hides it and prints clean.
import { useCallback, useEffect, useState } from 'react'
import { Printer, RefreshCw, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

function todayET() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function longDate(d: string) {
  const x = new Date(d + 'T12:00:00')
  return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}
function shortDate(d: string | null) {
  if (!d) return '—'
  const x = new Date(d + 'T12:00:00')
  return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Ruled lines the manager writes on — the whole point of a paper sheet.
function Lines({ n = 3 }: { n?: number }) {
  return <div className="ds-lines">{Array.from({ length: n }).map((_, i) => <div key={i} className="ds-line" />)}</div>
}
function Box({ label }: { label: string }) { return <span className="ds-box" title={label} /> }

export default function DaySheetPage() {
  const [date, setDate] = useState(todayET())
  const [market, setMarket] = useState('all')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async (dt: string, mk: string) => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/ops-today/daysheet?date=' + encodeURIComponent(dt) + '&market=' + encodeURIComponent(mk), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not build the day sheet')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [])
  useEffect(() => { load(date, market) }, [date, market, load])

  const c = (d && d.counts) || {}
  return (
    <div className="ds-root">
      {/* toolbar — screen only */}
      <div className="ds-toolbar">
        <Link href="/plan" className="ds-btn"><ArrowLeft size={14} /> Today in Ops</Link>
        <input type="date" value={date} onChange={e => setDate(e.target.value || todayET())} className="ds-input" />
        <select value={market} onChange={e => setMarket(e.target.value)} className="ds-input">
          <option value="all">All markets</option>
          {((d && d.markets) || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={() => load(date, market)} className="ds-btn"><RefreshCw size={14} /> Refresh</button>
        <button onClick={() => window.print()} className="ds-btn ds-btn-dark"><Printer size={14} /> Print</button>
        {loading && <span className="ds-muted">Building…</span>}
        {err && <span className="ds-err">{err}</span>}
      </div>

      <div className="ds-page">
        {/* header */}
        <div className="ds-head">
          <div>
            <div className="ds-brand">STAY HOSPITALITY</div>
            <div className="ds-title">Daily Operations Sheet</div>
          </div>
          <div className="ds-headright">
            <div className="ds-date">{longDate(date)}</div>
            <div className="ds-meta">{market === 'all' ? 'All markets' : market} · printed {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            <div className="ds-sign">Manager on duty: <span className="ds-fill" /></div>
          </div>
        </div>

        {/* at a glance */}
        <div className="ds-stats">
          <div className="ds-stat"><div className="ds-statn">{c.departures ?? '—'}</div><div className="ds-statl">Departures</div></div>
          <div className="ds-stat"><div className="ds-statn">{c.arrivals ?? '—'}</div><div className="ds-statl">Arrivals</div></div>
          <div className="ds-stat"><div className="ds-statn">{c.sameDayTurns ?? '—'}</div><div className="ds-statl">Same-day turns</div></div>
          <div className="ds-stat"><div className="ds-statn">{c.cleansDone ?? 0}/{c.cleansTotal ?? 0}</div><div className="ds-statl">Cleans done</div></div>
          <div className="ds-stat"><div className="ds-statn">{c.work ?? '—'}</div><div className="ds-statl">Work orders</div></div>
          <div className="ds-stat"><div className="ds-statn">{c.ownerStays ?? '—'}</div><div className="ds-statl">Owner stays</div></div>
          <div className="ds-stat"><div className="ds-statn">{c.vacants ?? '—'}</div><div className="ds-statl">Vacant</div></div>
        </div>

        {/* priorities — written by hand each morning */}
        <section className="ds-sec ds-avoid">
          <h2 className="ds-h2">Today&rsquo;s priorities</h2>
          <Lines n={3} />
        </section>

        {/* DEPARTURES */}
        <section className="ds-sec">
          <h2 className="ds-h2">Departures <span className="ds-count">{(d?.departures || []).length}</span></h2>
          <table className="ds-table">
            <thead><tr><th className="ds-w1">✓</th><th>Unit</th><th>Guest out</th><th>Out by</th><th>Clean / assigned</th><th>Next arrival</th><th className="ds-wn">Notes</th></tr></thead>
            <tbody>
              {(d?.departures || []).map((r: any, i: number) => (
                <tr key={i}>
                  <td><Box label="done" /></td>
                  <td className="ds-unit">{r.unit}{r.sameDayTurn && <span className="ds-tag ds-hot">SAME-DAY TURN</span>}{r.vendor && <span className="ds-tag">{r.vendor}</span>}</td>
                  <td>{r.guest}{r.nights != null ? <span className={'ds-tag ' + (r.nights >= 10 ? 'ds-hot' : '')}>{r.nights} NT{r.nights >= 10 ? ' LONG STAY' : ''}</span> : null}</td>
                  <td>{r.checkOutTime || '11:00 AM'}</td>
                  <td>{r.clean ? (r.clean.assignees?.length ? r.clean.assignees.join(', ') : 'unassigned') + ' · ' + r.clean.status : <span className="ds-warn">no clean on the board</span>}</td>
                  <td>{shortDate(r.nextArrival)}</td>
                  <td />
                </tr>
              ))}
              {(d?.departures || []).length === 0 && <tr><td colSpan={7} className="ds-empty">No departures.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* ARRIVALS */}
        <section className="ds-sec">
          <h2 className="ds-h2">Arrivals <span className="ds-count">{(d?.arrivals || []).length}</span></h2>
          <table className="ds-table">
            <thead><tr><th className="ds-w1">✓</th><th>Unit</th><th>Guest in</th><th>In after</th><th>Nights</th><th>Source</th><th className="ds-wn">Notes</th></tr></thead>
            <tbody>
              {(d?.arrivals || []).map((r: any, i: number) => (
                <tr key={i}>
                  <td><Box label="ready" /></td>
                  <td className="ds-unit">{r.unit}{r.sameDayTurn && <span className="ds-tag ds-hot">SAME-DAY TURN</span>}{r.ownerFlag && <span className="ds-tag ds-own">OWNER</span>}</td>
                  <td>{r.guest}{r.phone ? <span className="ds-sub"> {r.phone}</span> : null}</td>
                  <td>{r.checkInTime || '4:00 PM'}</td>
                  <td>{r.nights ?? '\u2014'}{r.nights != null && r.nights >= 10 ? <span className="ds-tag ds-hot">CHECK READY</span> : null}</td>
                  <td className="ds-sub">{r.source || '—'}</td>
                  <td />
                </tr>
              ))}
              {(d?.arrivals || []).length === 0 && <tr><td colSpan={7} className="ds-empty">No arrivals.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* OWNER STAYS */}
        <section className="ds-sec ds-avoid">
          <h2 className="ds-h2">Owner stays in house <span className="ds-count">{(d?.ownerStays || []).length}</span></h2>
          <table className="ds-table">
            <thead><tr><th className="ds-w1">✓</th><th>Unit</th><th>Guest</th><th>Owner on file</th><th>Why flagged</th><th>Dates</th><th className="ds-wn">Notes</th></tr></thead>
            <tbody>
              {(d?.ownerStays || []).map((r: any, i: number) => (
                <tr key={i}>
                  <td><Box label="checked" /></td>
                  <td className="ds-unit">{r.unit}</td>
                  <td>{r.guest}</td>
                  <td>{r.owner || '—'}</td>
                  <td className="ds-sub">{r.ownerFlag}</td>
                  <td className="ds-sub">{shortDate(r.checkIn)} – {shortDate(r.checkOut)}</td>
                  <td />
                </tr>
              ))}
              {(d?.ownerStays || []).length === 0 && <tr><td colSpan={7} className="ds-empty">No owner stays today.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* WORK ORDERS */}
        <section className="ds-sec">
          <h2 className="ds-h2">Maintenance, inspections &amp; other work <span className="ds-count">{(d?.work || []).length}</span></h2>
          <table className="ds-table">
            <thead><tr><th className="ds-w1">✓</th><th>Unit</th><th>Task</th><th>Dept</th><th>Assigned</th><th>Status</th><th className="ds-wn">Notes</th></tr></thead>
            <tbody>
              {(d?.work || []).map((r: any, i: number) => (
                <tr key={i}>
                  <td><Box label="done" /></td>
                  <td className="ds-unit">{r.unit}</td>
                  <td>{r.name}</td>
                  <td className="ds-sub">{r.dept || '—'}</td>
                  <td>{r.assignees?.length ? r.assignees.join(', ') : <span className="ds-warn">unassigned</span>}</td>
                  <td className="ds-sub">{r.status}{r.startedAt ? ' · ' + r.startedAt : ''}</td>
                  <td />
                </tr>
              ))}
              {(d?.work || []).length === 0 && <tr><td colSpan={7} className="ds-empty">No other work scheduled.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* GLITCHES */}
        <section className="ds-sec ds-avoid">
          <h2 className="ds-h2">Open guest issues <span className="ds-count">{(d?.glitches || []).length}</span></h2>
          <table className="ds-table">
            <thead><tr><th className="ds-w1">✓</th><th>Unit</th><th>Issue</th><th>Stage</th><th>Raised</th><th className="ds-wn">Notes</th></tr></thead>
            <tbody>
              {(d?.glitches || []).slice(0, 14).map((g: any, i: number) => (
                <tr key={i}>
                  <td><Box label="handled" /></td>
                  <td className="ds-unit">{g.unit || '—'}</td>
                  <td>{g.overview}</td>
                  <td className="ds-sub">{g.status}</td>
                  <td className="ds-sub">{shortDate(g.at)}</td>
                  <td />
                </tr>
              ))}
              {(d?.glitches || []).length === 0 && <tr><td colSpan={6} className="ds-empty">Nothing open.</td></tr>}
            </tbody>
          </table>
        </section>

        {/* VACANTS */}
        <section className="ds-sec">
          <h2 className="ds-h2">Vacant units <span className="ds-count">{(d?.vacants || []).length}</span></h2>
          <div className="ds-vac">
            {(d?.vacants || []).map((v: any, i: number) => (
              <div key={i} className="ds-vacrow"><Box label="checked" /><span className="ds-unit">{v.unit}</span><span className="ds-sub">{v.bedrooms != null ? (v.bedrooms === 0 ? 'Studio' : v.bedrooms + 'BR') : ''}</span><span className="ds-sub ds-right">next in {shortDate(v.nextArrival)}</span></div>
            ))}
            {(d?.vacants || []).length === 0 && <div className="ds-empty">Nothing vacant.</div>}
          </div>
        </section>

        {/* NOTES */}
        <section className="ds-sec ds-avoid">
          <h2 className="ds-h2">Notes, follow-ups &amp; escalations</h2>
          <Lines n={8} />
          <div className="ds-signrow">
            <div>Completed by: <span className="ds-fill" /></div>
            <div>Time finished: <span className="ds-fillsm" /></div>
            <div>Reviewed by: <span className="ds-fill" /></div>
          </div>
        </section>
      </div>

      <style jsx global>{`
        .ds-root { background:#f4f4f5; min-height:100vh; padding:16px; }
        .ds-toolbar { max-width:1000px; margin:0 auto 12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .ds-btn { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; padding:7px 12px; border-radius:9px; border:1px solid #d4d4d8; background:#fff; color:#3f3f46; text-decoration:none; cursor:pointer; }
        .ds-btn:hover { background:#fafafa; }
        .ds-btn-dark { background:#18181b; color:#fff; border-color:#18181b; }
        .ds-input { font-size:13px; padding:6px 10px; border-radius:9px; border:1px solid #d4d4d8; background:#fff; }
        .ds-muted { font-size:12px; color:#71717a; }
        .ds-err { font-size:12px; color:#b91c1c; }
        .ds-page { max-width:1000px; margin:0 auto; background:#fff; padding:28px 32px 36px; box-shadow:0 1px 3px rgba(0,0,0,.1); color:#18181b; font-size:11.5px; line-height:1.35; }
        .ds-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2.5px solid #18181b; padding-bottom:10px; margin-bottom:12px; gap:16px; }
        .ds-brand { font-size:10px; font-weight:800; letter-spacing:.16em; color:#71717a; }
        .ds-title { font-size:23px; font-weight:800; letter-spacing:-.02em; margin-top:2px; }
        .ds-headright { text-align:right; }
        .ds-date { font-size:14px; font-weight:700; }
        .ds-meta { font-size:10.5px; color:#71717a; margin-top:2px; }
        .ds-sign { font-size:10.5px; color:#52525b; margin-top:8px; white-space:nowrap; }
        .ds-fill { display:inline-block; width:150px; border-bottom:1px solid #a1a1aa; height:12px; margin-left:4px; }
        .ds-fillsm { display:inline-block; width:80px; border-bottom:1px solid #a1a1aa; height:12px; margin-left:4px; }
        .ds-stats { display:grid; grid-template-columns:repeat(7,1fr); gap:8px; margin-bottom:14px; }
        .ds-stat { border:1px solid #e4e4e7; border-radius:7px; padding:6px 4px; text-align:center; }
        .ds-statn { font-size:17px; font-weight:800; line-height:1.1; }
        .ds-statl { font-size:8.5px; text-transform:uppercase; letter-spacing:.06em; color:#71717a; margin-top:1px; }
        .ds-sec { margin-bottom:14px; }
        .ds-h2 { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.1em; border-bottom:1.5px solid #18181b; padding-bottom:3px; margin-bottom:6px; }
        .ds-count { float:right; font-weight:700; color:#71717a; letter-spacing:0; }
        .ds-table { width:100%; border-collapse:collapse; }
        .ds-table th { text-align:left; font-size:8.5px; text-transform:uppercase; letter-spacing:.07em; color:#71717a; font-weight:700; padding:3px 5px; border-bottom:1px solid #d4d4d8; }
        .ds-table td { padding:4px 5px; border-bottom:1px solid #ededf0; vertical-align:top; }
        .ds-table tr:nth-child(even) td { background:#fafafa; }
        .ds-w1 { width:18px; }
        .ds-wn { width:150px; }
        .ds-unit { font-weight:700; white-space:nowrap; }
        .ds-sub { color:#71717a; font-size:10.5px; }
        .ds-right { margin-left:auto; }
        .ds-warn { color:#b45309; font-weight:600; }
        .ds-empty { color:#a1a1aa; font-style:italic; padding:6px 5px; }
        .ds-tag { display:inline-block; margin-left:5px; font-size:8px; font-weight:800; letter-spacing:.05em; border:1px solid #a1a1aa; border-radius:3px; padding:0 3px; vertical-align:middle; color:#3f3f46; }
        .ds-hot { border-color:#18181b; background:#18181b; color:#fff; }
        .ds-own { border-color:#3f3f46; }
        .ds-box { display:inline-block; width:11px; height:11px; border:1.2px solid #52525b; border-radius:2px; }
        .ds-lines { margin-top:4px; }
        .ds-line { border-bottom:1px solid #d4d4d8; height:19px; }
        .ds-vac { columns:3; column-gap:18px; }
        .ds-vacrow { display:flex; align-items:center; gap:6px; padding:2px 0; border-bottom:1px dotted #e4e4e7; break-inside:avoid; }
        .ds-signrow { display:flex; gap:24px; margin-top:10px; font-size:10.5px; color:#52525b; }
        @media print {
          @page { size: letter portrait; margin: 0.45in; }
          .ds-root { background:#fff; padding:0; }
          .ds-toolbar { display:none !important; }
          .ds-page { box-shadow:none; max-width:none; padding:0; font-size:9.5px; }
          .ds-sec { margin-bottom:11px; }
          .ds-avoid, .ds-table thead { break-inside:avoid; }
          .ds-table tr { break-inside:avoid; }
          .ds-line { height:17px; }
          .ds-table tr:nth-child(even) td { background:#f7f7f7 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .ds-hot { background:#18181b !important; color:#fff !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        }
      `}</style>
    </div>
  )
}
