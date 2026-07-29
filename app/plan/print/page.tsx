'use client'
// DAY SHEETS — the ops manager's paper. Five short sheets, each answering ONE question, each
// printable on its own page. Roberto carries these; if a number here is wrong the day goes wrong,
// so every sheet carries a freshness stamp, a reconciliation count, and explicit "unknown" text
// instead of blank cells.
//   1 Turn sheet     — departures by AREA, who cleans what, in driving order
//   2 Arrivals       — who is coming, is the unit ready
//   3 Work orders    — maintenance / inspections / everything that is not a turn
//   4 Exceptions     — only what is wrong or could go wrong today
//   5 Vacants, owner stays & handover
import { useCallback, useEffect, useState } from 'react'
import { Printer, RefreshCw, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { clusterAreas } from '@/lib/geo-areas'

function todayET() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
function longDate(d: string) { const x = new Date(d + 'T12:00:00'); return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) }
function shortDate(d: string | null) { if (!d) return '—'; const x = new Date(d + 'T12:00:00'); return isNaN(x.getTime()) ? d : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function minsAgo(iso: string | null): number | null { if (!iso) return null; const t = new Date(iso).getTime(); return isNaN(t) ? null : Math.round((Date.now() - t) / 60000) }
function ago(iso: string | null) { const m = minsAgo(iso); if (m == null) return 'unknown'; if (m < 60) return m + ' min ago'; const h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm ago' }

function Lines({ n = 3 }: { n?: number }) { return <div className="ds-lines">{Array.from({ length: n }).map((_, i) => <div key={i} className="ds-line" />)}</div> }
function Box() { return <span className="ds-box" /> }

const SHEETS = [
  { key: 'turn', name: 'Departure cleans' },
  { key: 'arrivals', name: 'Arrivals to verify' },
  { key: 'work', name: 'Work orders' },
  { key: 'exceptions', name: 'Exceptions' },
  { key: 'closeout', name: 'Vacants, owner stays & handover' },
]

export default function DaySheetsPage() {
  const [date, setDate] = useState(todayET())
  const [market, setMarket] = useState('all')
  const [on, setOn] = useState<Record<string, boolean>>({ turn: true, arrivals: true, work: true, exceptions: true, closeout: true })
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async (dt: string, mk: string) => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/ops-today/daysheet?date=' + encodeURIComponent(dt) + '&market=' + encodeURIComponent(mk), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not build the day sheets')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [])
  useEffect(() => { load(date, market) }, [date, market, load])

  const c = (d && d.counts) || {}
  const sync = (d && d.sync) || {}
  const stale = minsAgo(d && d.lastSync)
  // Freshness is now judged on BOTH feeds. Breezeway decides what work exists; Guesty decides who
  // is arriving. A fresh task list over a stale reservation list still hides a walk-in.
  const isStale = !!sync.stale || (stale != null && stale > 150)
  const freshLine = 'Breezeway ' + ago(sync.breezewayAt || (d && d.lastSync)) + ' · reservations ' + ago(sync.reservationsAt)
  const active = SHEETS.filter(s => on[s.key])
  const sheetNo = (key: string) => active.findIndex(s => s.key === key) + 1
  const departures = (d?.departures || [])
  const areas = clusterAreas(departures as any, 4)

  // Every sheet carries the same header: what, when, how fresh, which page.
  const Head = ({ title, sub, count }: { title: string; sub?: string; count?: string }) => (
    <div className="ds-head">
      <div>
        <div className="ds-brand">STAY HOSPITALITY {'·'} DAILY OPERATIONS</div>
        <div className="ds-title">{title}</div>
        {sub && <div className="ds-sub">{sub}</div>}
      </div>
      <div className="ds-headright">
        <div className="ds-date">{longDate(date)}</div>
        <div className="ds-meta">{market === 'all' ? 'All markets' : market}{count ? ' · ' + count : ''}</div>
        <div className={'ds-fresh ' + (isStale ? 'ds-freshbad' : '')}>{freshLine} {'·'} printed {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}{isStale ? ' — STALE, SYNC BEFORE USING' : ''}</div>
        {isStale && <div className="ds-freshwarn">{sync.staleReason || 'a feed is behind'} — anything booked or changed since is NOT on this sheet</div>}
        <div className="ds-page">Sheet {sheetNo(titleKey(title))} of {active.length}</div>
      </div>
    </div>
  )
  // WHEN WAS SOMEBODY LAST IN THIS UNIT? A clean, an inspection, a unit check, an audit or a
  // maintenance visit all count — and the sheet says WHICH, because "cleaned 3 days ago" and
  // "an electrician was in 3 days ago" are not the same assurance.
  const LastTouch = ({ r }: { r: any }) => {
    const t = r.lastTouch
    if (t) return (
      <>
        <b className={t.daysAgo >= 14 ? 'ds-warn' : ''}>{shortDate(t.at)}</b>
        <div className="ds-sub">{t.kind}{t.daysAgo != null ? ' · ' + (t.daysAgo === 0 ? 'today' : t.daysAgo === 1 ? 'yesterday' : t.daysAgo + 'd ago') : ''}{t.who && t.who.length ? ' · ' + t.who[0] : ''}</div>
      </>
    )
    if (r.lastTouchReason === 'vendor' || r.vendor) return <span className="ds-vendorclean">{r.vendor} cleans this</span>
    if (r.lastTouchReason === 'lookup-failed') return <span className="ds-warn">lookup failed — check Breezeway</span>
    return <span className="ds-warn">nothing logged in 400 days</span>
  }

  function titleKey(t: string) { const s = SHEETS.filter(x => t.startsWith(x.name.split(' ')[0]))[0]; return s ? s.key : 'turn' }

  return (
    <div className="ds-root">
      <div className="ds-toolbar">
        <Link href="/plan" className="ds-btn"><ArrowLeft size={14} /> Today in Ops</Link>
        <input type="date" value={date} onChange={e => setDate(e.target.value || todayET())} className="ds-input" />
        <select value={market} onChange={e => setMarket(e.target.value)} className="ds-input">
          <option value="all">All markets</option>
          {((d && d.markets) || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="ds-picker">
          {SHEETS.map(s => (
            <label key={s.key} className={'ds-pick ' + (on[s.key] ? 'ds-pickon' : '')}>
              <input type="checkbox" checked={!!on[s.key]} onChange={e => setOn(prev => ({ ...prev, [s.key]: e.target.checked }))} />{s.name}
            </label>
          ))}
        </span>
        <button onClick={() => load(date, market)} className="ds-btn"><RefreshCw size={14} /> Refresh</button>
        <button onClick={() => window.print()} className="ds-btn ds-btn-dark"><Printer size={14} /> Print {active.length} sheet{active.length === 1 ? '' : 's'}</button>
        {loading && <span className="ds-muted">Building…</span>}
        {err && <span className="ds-err">{err}</span>}
      </div>

      {/* 1 — DEPARTURE CLEANS */}
      {on.turn && (
        <section className="ds-page-wrap">
          <Head title="Departure cleans" sub="Every clean today, in driving order — same-day arrivals called out on the row" count={departures.length + ' cleans · ' + (c.cleansDone ?? 0) + ' done · ' + (c.sameDayTurns ?? 0) + ' same-day'} />
          {areas.map((a: any) => (
            <div key={a.key} className="ds-area">
              <div className="ds-areahead"><span className="ds-arealabel">{a.label}</span><span className="ds-areacity">{a.city || ''}</span><span className="ds-areacount">{a.units.length}</span></div>
              <table className="ds-table">
                <thead><tr><th className="ds-w1">DONE</th><th>Unit</th><th>Cleaner</th><th>Out by</th><th>Guest leaving</th><th className="ds-wsd">Arriving today</th><th className="ds-wn">Notes</th></tr></thead>
                <tbody>
                  {a.units.map((r: any, i: number) => (
                    <tr key={i} className={r.sameDayTurn ? 'ds-rowsd' : ''}>
                      <td><Box /></td>
                      <td className="ds-unit">{r.unit}
                        {r.nights != null && r.nights >= 10 && <span className="ds-tag ds-warnTag">{r.nights}NT LONG</span>}
                        {r.vendor && <span className="ds-tag">{r.vendor}</span>}
                        {r.doorCode && <div className="ds-sub">code {r.doorCode}</div>}
                      </td>
                      <td className="ds-who">{r.clean
                        ? (r.clean.assignees?.length ? r.clean.assignees.join(', ') : <span className="ds-warn">UNASSIGNED</span>)
                        : r.vendor
                          ? <span className="ds-vendorclean">{r.vendor} cleans this</span>
                          : <span className="ds-warn">NO CLEAN ON THE BOARD</span>}
                        {r.clean && <div className="ds-sub">{r.clean.status}{r.clean.instructions ? ' · ' + r.clean.instructions : ''}</div>}
                        {!r.clean && r.vendor && <div className="ds-sub">not tracked in Breezeway</div>}
                        {(r.prep || []).map((p: any) => (
                          <div key={p.id} className="ds-sub">also today: {p.label}{p.assignees?.length ? ' — ' + p.assignees.join(', ') : ''}</div>
                        ))}
                      </td>
                      <td className="ds-num">{r.checkOutTime || '11:00 AM'}</td>
                      <td>{r.guest}<div className="ds-sub">{r.nights != null ? r.nights + ' nights' : ''}</div></td>
                      <td>{r.extension
                        ? <span className="ds-ext"><b>EXTENSION</b> {'\u2014'} same guest re-booked<div className="ds-sub">ask the guest if they want a clean {'\u2014'} do not strip</div></span>
                        : r.sameDayTurn
                        ? <span className="ds-sd"><b>SAME DAY</b> {'\u2192'} {r.sameDayGuest || 'guest'} in {r.sameDayIn}{r.sameDayNights ? ' · ' + r.sameDayNights + ' nt' : ''}{r.sameDayNights >= 10 ? ' · BIG BOOKING' : ''}</span>
                        : <span className="ds-sub">{r.nextArrival ? 'next ' + shortDate(r.nextArrival) : 'no arrival booked'}</span>}</td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {departures.length === 0 && <div className="ds-empty">No departure cleans today.</div>}
          <div className="ds-recon">Reconciliation: {departures.length} cleans printed {'·'} {areas.length} area{areas.length === 1 ? '' : 's'} {'·'} {(c.sameDayTurns ?? 0)} same-day turns {'·'} vendor-cleaned units included and labelled</div>
          <div className="ds-notes"><div className="ds-h3">Notes</div><Lines n={4} /></div>
        </section>
      )}

      {/* 2 — ARRIVALS TO VERIFY */}
      {on.arrivals && (() => {
        const arr = (d?.arrivals || [])
        const noClean = arr.filter((a: any) => !a.cleanToday)
        const withClean = arr.filter((a: any) => a.cleanToday)
        return (
          <section className="ds-page-wrap">
            <Head title="Arrivals to verify" sub="Guests arriving into units nobody is cleaning today — walk these before check-in" count={noClean.length + ' to verify · ' + arr.length + ' arrivals total'} />
            <div className="ds-h3">Nobody is cleaning these today ({noClean.length})</div>
            <table className="ds-table">
              <thead><tr><th className="ds-w1">READY</th><th>Unit</th><th>Guest in</th><th>In after</th><th>Nights</th><th>Last checked / cleaned</th><th>Code</th><th className="ds-wn">What you found</th></tr></thead>
              <tbody>
                {noClean.map((r: any, i: number) => (
                  <tr key={i} className="ds-rowcheck">
                    <td><Box /></td>
                    <td className="ds-unit">{r.unit}{r.ownerFlag && <span className="ds-tag">OWNER</span>}{(r.bookedToday || r.bookedAfterSync) && <span className="ds-tag ds-hot">BOOKED TODAY</span>}</td>
                    <td>{r.guest}{r.phone ? <div className="ds-sub">{r.phone}</div> : null}</td>
                    <td className="ds-num">{r.checkInTime || '4:00 PM'}</td>
                    <td className="ds-num">{r.nights ?? '—'}{r.nights != null && r.nights >= 10 && <span className="ds-tag ds-warnTag">BIG</span>}</td>
                    <td className="ds-sub"><LastTouch r={r} /></td>
                    <td className="ds-sub">{r.doorCode || '—'}</td>
                    <td />
                  </tr>
                ))}
                {noClean.length === 0 && <tr><td colSpan={8} className="ds-empty">Every arrival today follows a clean — nothing to verify.</td></tr>}
              </tbody>
            </table>
            <div className="ds-h3">Arriving after a clean today ({withClean.length}) — covered on the departure sheet</div>
            <table className="ds-table">
              <thead><tr><th className="ds-w1">✓</th><th>Unit</th><th>Guest in</th><th>In after</th><th>Nights</th><th>Clean status</th><th className="ds-wn">Notes</th></tr></thead>
              <tbody>
                {withClean.map((r: any, i: number) => (
                  <tr key={i}>
                    <td><Box /></td>
                    <td className="ds-unit">{r.unit}<span className="ds-tag ds-hot">SAME-DAY</span></td>
                    <td>{r.guest}</td>
                    <td className="ds-num">{r.checkInTime || '4:00 PM'}</td>
                    <td className="ds-num">{r.nights ?? '—'}</td>
                    <td className="ds-sub">{r.cleanToday.status}{r.cleanToday.assignees?.length ? ' · ' + r.cleanToday.assignees.join(', ') : ' · unassigned'}</td>
                    <td />
                  </tr>
                ))}
                {withClean.length === 0 && <tr><td colSpan={7} className="ds-empty">None.</td></tr>}
              </tbody>
            </table>
            <div className="ds-recon">Reconciliation: {arr.length} arrivals {'='} {noClean.length} to verify {'+'} {withClean.length} following a clean</div>
            <div className="ds-notes"><div className="ds-h3">Early check-ins, VIPs, anything the front desk should know</div><Lines n={5} /></div>
          </section>
        )
      })()}

      {/* 3 — WORK ORDERS */}
      {on.work && (
        <section className="ds-page-wrap">
          <Head title="Work orders" sub="Maintenance, inspections and everything that is not a turn" count={(d?.work || []).length + ' tasks'} />
          <table className="ds-table">
            <thead><tr><th className="ds-w1">✓</th><th>Unit</th><th>Task</th><th>Dept</th><th>Assigned</th><th>Status</th><th className="ds-wn">Notes</th></tr></thead>
            <tbody>
              {(d?.work || []).map((r: any, i: number) => (
                <tr key={i}>
                  <td><Box /></td>
                  <td className="ds-unit">{r.unit}</td>
                  <td>{r.name}</td>
                  <td className="ds-sub">{r.dept || '—'}</td>
                  <td>{r.assignees?.length ? r.assignees.join(', ') : <span className="ds-warn">UNASSIGNED</span>}</td>
                  <td className="ds-sub">{r.status}{r.startedAt ? ' · ' + r.startedAt : ''}</td>
                  <td />
                </tr>
              ))}
              {(d?.work || []).length === 0 && <tr><td colSpan={7} className="ds-empty">No other work scheduled.</td></tr>}
            </tbody>
          </table>
          <div className="ds-recon">Reconciliation: {(d?.work || []).length} work orders printed</div>
        </section>
      )}

      {/* 4 — EXCEPTIONS */}
      {on.exceptions && (
        <section className="ds-page-wrap">
          <Head title="Exceptions" sub="Only what is wrong, or could go wrong today" count={(d?.exceptions || []).length + ' to resolve'} />
          {(d?.exceptions || []).length === 0 && (d?.glitches || []).length === 0
            ? <div className="ds-clear">Nothing flagged. Every departure has a clean, everything is assigned, no open guest issues.</div>
            : (
              <table className="ds-table">
                <thead><tr><th className="ds-w1">✓</th><th className="ds-wu">Unit</th><th>What is wrong</th><th>What to do</th><th className="ds-wn">Done by / when</th></tr></thead>
                <tbody>
                  {(d?.exceptions || []).map((x: any, i: number) => (
                    <tr key={i} className={x.severity === 'high' ? 'ds-rowhot' : ''}>
                      <td><Box /></td>
                      <td className="ds-unit">{x.unit}</td>
                      <td><b>{x.severity === 'high' ? '● ' : ''}{x.kind}</b><div className="ds-sub">{x.detail}</div></td>
                      <td className="ds-do">{x.action}</td>
                      <td />
                    </tr>
                  ))}
                  {(d?.glitches || []).map((g: any, i: number) => (
                    <tr key={'g' + i}>
                      <td><Box /></td>
                      <td className="ds-unit">{g.unit || '—'}</td>
                      <td><b>Guest reported a problem</b><div className="ds-sub">{g.overview}</div></td>
                      <td className="ds-do">Still open since {shortDate(g.at)} ({g.status}) — close it out or say why it is waiting.</td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          <div className="ds-recon">Checked for: a checkout with no clean booked {'·'} a clean with nobody on it {'·'} a same-day turn running late {'·'} a job booked while the guest is in house {'·'} a guest who never actually left {'·'} a stay booked today {'·'} a unit nobody has been inside {'·'} two cleans on one unit {'·'} stale data {'·'} open guest problems</div>
          <div className="ds-notes"><div className="ds-h3">Escalations</div><Lines n={4} /></div>
        </section>
      )}

      {/* 5 — CLOSE-OUT */}
      {on.closeout && (
        <section className="ds-page-wrap">
          <Head title="Vacants, owner stays & handover" sub="What is empty, who is in house, what rolls over" count={(d?.vacants || []).length + ' vacant'} />
          <div className="ds-h3">Owner stays in house ({(d?.ownerStays || []).length})</div>
          <table className="ds-table">
            <thead><tr><th className="ds-w1">✓</th><th>Unit</th><th>Guest</th><th>Owner on file</th><th>Why flagged</th><th>Dates</th><th className="ds-wn">Notes</th></tr></thead>
            <tbody>
              {(d?.ownerStays || []).map((r: any, i: number) => (
                <tr key={i}><td><Box /></td><td className="ds-unit">{r.unit}</td><td>{r.guest}</td><td>{r.owner || '—'}</td><td className="ds-sub">{r.ownerFlag}</td><td className="ds-sub">{shortDate(r.checkIn)} – {shortDate(r.checkOut)}</td><td /></tr>
              ))}
              {(d?.ownerStays || []).length === 0 && <tr><td colSpan={7} className="ds-empty">No owner stays today.</td></tr>}
            </tbody>
          </table>
          <div className="ds-h3">Vacant units ({(d?.vacants || []).length})</div>
          <div className="ds-vac">
            {(d?.vacants || []).map((v: any, i: number) => (
              <div key={i} className={'ds-vacrow' + (v.arrivingSoon ? ' ds-vacsoon' : '')}>
                <Box />
                <span className="ds-unit">{v.unit}</span>
                <span className="ds-sub">{v.bedrooms != null ? (v.bedrooms === 0 ? 'Studio' : v.bedrooms + 'BR') : ''}{v.departedToday ? ' · out today' : ''}</span>
                <span className="ds-sub ds-right">
                  {v.nextArrival
                    ? <b className={v.arrivingSoon ? 'ds-soon' : ''}>{'in ' + (v.daysUntilArrival === 0 ? 'today' : v.daysUntilArrival === 1 ? 'tomorrow' : v.daysUntilArrival + 'd') + ' · ' + shortDate(v.nextArrival)}</b>
                    : <span className="ds-muted2">no booking in 45 days</span>}
                  {v.idleDays != null && v.idleDays >= 21 ? <span className="ds-sub"> {'·'} idle {v.idleDays}d</span> : null}
                </span>
              </div>
            ))}
            {(d?.vacants || []).length === 0 && <div className="ds-empty">Nothing vacant.</div>}
          </div>
          {d?.audit && (
            <div className={'ds-recon ' + (d.audit.balances ? '' : 'ds-freshbad')}>
              Reconciliation: {d.audit.activeListings} active listings = {d.audit.occupiedTonight} occupied tonight + {d.audit.vacantTonight} vacant
              {d.audit.balances ? ' ✓ balances' : ' ✗ DOES NOT BALANCE — do not trust this list, re-sync'}
              {' · '}{d.audit.vacantsWithArrivalWithin7} of the vacants have a guest inside 7 days
              {' · '}{d.audit.vacantsNoFutureBooking} have nothing booked in 45 days
              {' · '}read from {d.audit.reservationsRead} current + {d.audit.futureReservationsRead} upcoming reservations
            </div>
          )}
          <div className="ds-notes"><div className="ds-h3">Handover — what rolls into tomorrow</div><Lines n={6} />
            <div className="ds-signrow"><div>Completed by: <span className="ds-fill" /></div><div>Time: <span className="ds-fillsm" /></div><div>Reviewed by: <span className="ds-fill" /></div></div>
          </div>
        </section>
      )}

      <style jsx global>{`
        .ds-root { background:#f4f4f5; min-height:100vh; padding:16px; }
        .ds-toolbar { max-width:1000px; margin:0 auto 12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .ds-btn { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; padding:7px 12px; border-radius:9px; border:1px solid #d4d4d8; background:#fff; color:#3f3f46; text-decoration:none; cursor:pointer; }
        .ds-btn-dark { background:#18181b; color:#fff; border-color:#18181b; }
        .ds-input { font-size:13px; padding:6px 10px; border-radius:9px; border:1px solid #d4d4d8; background:#fff; }
        .ds-picker { display:inline-flex; gap:4px; flex-wrap:wrap; }
        .ds-pick { display:inline-flex; align-items:center; gap:4px; font-size:11.5px; font-weight:600; padding:5px 8px; border-radius:8px; border:1px solid #d4d4d8; background:#fff; color:#71717a; cursor:pointer; }
        .ds-pickon { background:#18181b; color:#fff; border-color:#18181b; }
        .ds-muted { font-size:12px; color:#71717a; } .ds-err { font-size:12px; color:#b91c1c; }
        .ds-page-wrap { max-width:1000px; margin:0 auto 16px; background:#fff; padding:26px 30px 30px; box-shadow:0 1px 3px rgba(0,0,0,.1); color:#18181b; font-size:11.5px; line-height:1.35; }
        .ds-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2.5px solid #18181b; padding-bottom:9px; margin-bottom:11px; gap:16px; }
        .ds-brand { font-size:9px; font-weight:800; letter-spacing:.16em; color:#71717a; }
        .ds-title { font-size:22px; font-weight:800; letter-spacing:-.02em; margin-top:2px; }
        .ds-sub { font-size:11px; color:#71717a; }
        .ds-freshwarn { font-size:10px; font-weight:700; color:#b91c1c; margin-top:3px; max-width:320px; }
        .ds-vacsoon { background:#fef3c7; }
        .ds-ext { font-weight:800; color:#5b21b6; }
        .ds-soon { color:#b45309; }
        .ds-muted2 { color:#a1a1aa; }
        .ds-do { font-weight:600; }
        .ds-wu { width:15%; }
        .ds-headright { text-align:right; }
        .ds-date { font-size:13px; font-weight:700; }
        .ds-meta { font-size:10.5px; color:#52525b; margin-top:1px; }
        .ds-fresh { font-size:9.5px; color:#71717a; margin-top:3px; }
        .ds-freshbad { color:#b91c1c; font-weight:800; }
        .ds-page { font-size:9.5px; color:#a1a1aa; margin-top:2px; }
        .ds-area { margin-bottom:10px; break-inside:avoid; }
        .ds-areahead { display:flex; align-items:baseline; gap:8px; border-bottom:1.5px solid #18181b; padding-bottom:2px; margin-bottom:3px; }
        .ds-arealabel { font-size:12px; font-weight:800; }
        .ds-areacity { font-size:10px; color:#71717a; }
        .ds-areacount { font-size:10px; color:#71717a; margin-left:auto; }
        .ds-h3 { font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.09em; margin:10px 0 4px; }
        .ds-table { width:100%; border-collapse:collapse; }
        .ds-table th { text-align:left; font-size:8px; text-transform:uppercase; letter-spacing:.07em; color:#71717a; font-weight:700; padding:3px 5px; border-bottom:1px solid #d4d4d8; }
        .ds-table td { padding:4.5px 6px; border-bottom:1px solid #ededf0; vertical-align:top; }
        .ds-table tr:nth-child(even) td { background:#fafafa; }
        .ds-rowhot td { background:#fff1f2 !important; }
        .ds-w1 { width:34px; } .ds-wn { width:140px; } .ds-wsd { width:190px; }
        .ds-num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
        .ds-who { font-weight:600; }
        .ds-rowsd td { background:#fffbeb !important; }
        .ds-rowcheck td { background:#fef2f2 !important; }
        .ds-sd { font-size:10px; color:#92400e; }
        .ds-sd b { font-size:9px; letter-spacing:.05em; }
        .ds-vendorclean { color:#52525b; font-weight:600; }
        .ds-warnTag { border-color:#b45309; background:#b45309; color:#fff; }
        .ds-unit { font-weight:700; white-space:nowrap; }
        .ds-sub { color:#71717a; font-size:10px; }
        .ds-right { margin-left:auto; }
        .ds-warn { color:#b45309; font-weight:800; }
        .ds-empty { color:#a1a1aa; font-style:italic; padding:6px 5px; }
        .ds-clear { border:1.5px solid #16a34a; color:#15803d; font-weight:700; padding:10px; border-radius:6px; }
        .ds-tag { display:inline-block; margin-left:4px; font-size:8px; font-weight:800; letter-spacing:.04em; border:1px solid #a1a1aa; border-radius:3px; padding:0 3px; vertical-align:middle; color:#3f3f46; }
        .ds-hot { border-color:#18181b; background:#18181b; color:#fff; }
        .ds-box { display:inline-block; width:11px; height:11px; border:1.2px solid #52525b; border-radius:2px; }
        .ds-lines { margin-top:3px; } .ds-line { border-bottom:1px solid #d4d4d8; height:18px; }
        .ds-notes { margin-top:10px; break-inside:avoid; }
        .ds-recon { margin-top:8px; font-size:9px; color:#a1a1aa; border-top:1px dotted #d4d4d8; padding-top:4px; }
        .ds-vac { columns:3; column-gap:16px; }
        .ds-vacrow { display:flex; align-items:center; gap:6px; padding:2px 0; border-bottom:1px dotted #e4e4e7; break-inside:avoid; }
        .ds-fill { display:inline-block; width:140px; border-bottom:1px solid #a1a1aa; height:12px; margin-left:4px; }
        .ds-fillsm { display:inline-block; width:70px; border-bottom:1px solid #a1a1aa; height:12px; margin-left:4px; }
        .ds-signrow { display:flex; gap:22px; margin-top:9px; font-size:10.5px; color:#52525b; }
        @media print {
          @page { size: letter portrait; margin: 0.45in; }
          .ds-root { background:#fff; padding:0; }
          .ds-toolbar { display:none !important; }
          .ds-page-wrap { box-shadow:none; max-width:none; padding:0; margin:0; font-size:9.5px; break-after:page; }
          .ds-page-wrap:last-of-type { break-after:auto; }
          .ds-table tr, .ds-area, .ds-notes { break-inside:avoid; }
          .ds-table tr:nth-child(even) td { background:#f7f7f7 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
          .ds-hot, .ds-rowhot td { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
        }
      `}</style>
    </div>
  )
}
