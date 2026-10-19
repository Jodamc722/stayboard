'use client'
// THE PRINT SHEET (Jon, 2026-10-19: "have a print out sheet for my ops manager").
//
// The same day the Open & Close tab shows, as one sheet of paper: every gate, its rows with a box
// to tick, the flags as plain words, a line for notes, and signature lines at the foot. Black on
// white, nothing that needs a screen. ?mode=open|close picks the sheet, ?date= the day, ?all=1
// prints done rows too (the default is what still needs a hand).
import { useEffect, useMemo, useState } from 'react'
import type { OcDay, OcRow } from '@/lib/open-close'

const first = (s: string | null | undefined) => String(s || '').split(/[\s@]/)[0]
const timeOf = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) }
const dayLabel = (ymd: string) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''
const clock = (t: string | null) => { if (!t) return ''; const m = /^(\d{1,2}):(\d{2})/.exec(t); if (!m) return t; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}` }

export default function PrintSheet() {
  const [data, setData] = useState<OcDay | null>(null)
  const [err, setErr] = useState('')
  const [all, setAll] = useState(false)
  const [mode, setMode] = useState<'open' | 'close'>('open')
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const m = sp.get('mode') === 'close' ? 'close' : 'open'
    setMode(m); setAll(sp.get('all') === '1')
    const qs = new URLSearchParams({ mode: m }); const d = sp.get('date'); if (d) qs.set('date', d)
    fetch('/api/open-close?' + qs.toString(), { cache: 'no-store' }).then(async r => { const j = await r.json(); if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not read the day'); setData(j) }).catch(e => setErr(String(e?.message || e)))
  }, [])
  const printedAt = useMemo(() => new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }), [])
  if (err) return <main style={{ fontFamily: 'Geist, system-ui, sans-serif', padding: 32 }}>{err}</main>
  if (!data) return <main style={{ fontFamily: 'Geist, system-ui, sans-serif', padding: 32, color: '#666' }}>Reading the day…</main>
  const rowsOf = (rows: OcRow[]) => all ? rows : rows.filter(r => r.state !== 'done')
  const sections: { title: string; key: 'field' | 'guests' }[] = [{ title: 'The field', key: 'field' }, { title: 'The guests', key: 'guests' }]
  const rec = data.today
  return (
    <main className="sheet">
      <style>{`
        .sheet{font-family:Geist,system-ui,sans-serif;color:#111;max-width:8.5in;margin:0 auto;padding:28px 32px;font-size:11.5px;line-height:1.35;background:#fff}
        .sheet h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:26px;margin:0}
        .sheet h2{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;margin:18px 0 6px;color:#111;border-bottom:1.5px solid #111;padding-bottom:3px}
        .sheet h3{font-size:12.5px;font-weight:700;margin:12px 0 4px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
        .sheet h3 small{font-weight:500;color:#555;font-size:11px}
        .sheet table{width:100%;border-collapse:collapse;page-break-inside:auto}
        .sheet tr{page-break-inside:avoid}
        .sheet th{text-align:left;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#555;padding:3px 6px;border-bottom:1px solid #999}
        .sheet td{padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top}
        .sheet td.box{width:18px}.sheet td.box span{display:inline-block;width:11px;height:11px;border:1.4px solid #111;border-radius:2px;margin-top:2px}
        .sheet td.u{font-weight:600;white-space:nowrap}
        .sheet td.st{white-space:nowrap;text-transform:uppercase;font-size:9.5px;font-weight:700;letter-spacing:.05em;color:#333}
        .sheet td.notes{width:28%;border-bottom:1px solid #ddd;color:#bbb}
        .sheet .meta{color:#444}
        .sheet .flags{font-size:10.5px;color:#111}
        .sheet .flags b{font-weight:700}
        .sheet .sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:26px}
        .sheet .sig div{border-top:1px solid #111;padding-top:4px;font-size:10.5px;color:#444}
        .sheet .bar{display:flex;gap:10px;align-items:center;margin-bottom:14px}
        .sheet .bar button,.sheet .bar label{font:inherit;font-size:12px;padding:6px 10px;border:1px solid #bbb;border-radius:6px;background:#fff;cursor:pointer}
        .sheet .note{border:1px solid #bbb;border-radius:6px;padding:8px 10px;margin:6px 0 2px;white-space:pre-line}
        .sheet .lines{height:54px;border-bottom:1px solid #ccc;background:repeating-linear-gradient(to bottom,transparent,transparent 17px,#ddd 17px,#ddd 18px)}
        @media print{.sheet{padding:0;max-width:none}.sheet .bar{display:none}@page{margin:.6in .6in}}
      `}</style>
      <div className="bar">
        <button onClick={() => window.print()}>Print</button>
        <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> include done rows</label>
        <span style={{ color: '#666', fontSize: 12 }}>Printed {printedAt}</span>
      </div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, borderBottom: '2px solid #111', paddingBottom: 8 }}>
        <div>
          <h1>Open &amp; Close — {mode === 'open' ? 'Opening' : 'Closing'} sheet</h1>
          <div style={{ marginTop: 3, color: '#444' }}>{dayLabel(data.day)} · {data.summary.cleans ? `${data.summary.cleansDone} of ${data.summary.cleans} cleans done · ` : ''}{data.summary.arrivals} arrivals · {data.summary.onShift} on shift · {data.summary.gatesClear} of {data.summary.gatesTotal} gates clear</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10.5, color: '#444' }}>
          {mode === 'open' ? (rec?.openedAt ? `Opened ${timeOf(rec.openedAt)} by ${first(rec.openedBy)}` : 'Opened by ____________ at ______') : (rec?.closedAt ? `Closed ${timeOf(rec.closedAt)} by ${first(rec.closedBy)}` : 'Closed by ____________ at ______')}
          <br />{data.degraded.length ? `${data.degraded.length} source${data.degraded.length === 1 ? '' : 's'} unavailable when printed` : 'all sources read'}
        </div>
      </header>

      {mode === 'open' && data.handover && (data.handover.note || data.handover.closedAt) && (
        <section>
          <h2>Handover from {first(data.handover.closedBy) || 'last night'} · {timeOf(data.handover.closedAt)}</h2>
          <div className="note">{data.handover.note || 'No note was left.'}</div>
        </section>
      )}
      {data.carried.length > 0 && (
        <section>
          <h2>Carried from earlier days · {data.carried.length}</h2>
          <table><thead><tr><th></th><th>Unit</th><th>What</th><th>Note</th><th>From</th></tr></thead><tbody>
            {data.carried.map(c => <tr key={c.id}><td className="box"><span /></td><td className="u">{c.unit || ''}</td><td className="meta">{c.title}</td><td>{c.note || ''}</td><td style={{ whiteSpace: 'nowrap' }}>{c.fromDay.slice(5)}{c.by ? ' · ' + first(c.by) : ''}</td></tr>)}
          </tbody></table>
        </section>
      )}

      {sections.map(sec => (
        <section key={sec.key}>
          <h2>{sec.title}</h2>
          {data.gates.filter(g => g.section === sec.key).map(g => {
            const rows = rowsOf(g.rows)
            return (
              <div key={g.key}>
                <h3>
                  <span style={{ display: 'inline-block', width: 11, height: 11, border: '1.4px solid #111', borderRadius: 999, marginRight: 2, background: g.auto || g.signed ? '#111' : '#fff' }} />
                  {g.label}
                  <small>by {clock(g.due)}{g.signed ? ` · signed ${first(g.signed.by)} ${timeOf(g.signed.at)}` : g.auto ? ' · cleared itself' : ''} · {g.counts.pending} pending · {g.counts.active} active{g.counts.done ? ` · ${g.counts.done} done` : ''}{g.note ? ' · ' + g.note : ''}{g.degraded ? ' · SOURCE UNAVAILABLE' : ''}</small>
                </h3>
                {rows.length === 0 ? <div style={{ color: '#666', padding: '2px 6px 6px' }}>{g.counts.pending + g.counts.active === 0 ? 'Nothing left to do.' : 'Nothing open to print.'}</div> : (
                  <table>
                    <thead><tr><th></th><th>Unit / who</th><th>Details</th><th>Flags</th><th>State</th><th>Notes</th></tr></thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.key}>
                          <td className="box"><span /></td>
                          <td className="u">{r.unit}</td>
                          <td className="meta">{r.meta}{r.task ? <div style={{ fontSize: 10.5, color: '#333' }}>Task: {r.task.name} · {r.task.who || 'unassigned'} · {r.task.status}</div> : null}</td>
                          <td className="flags">{r.tags.map(t => t.label).join(' · ')}</td>
                          <td className="st">{r.state}</td>
                          <td className="notes">&nbsp;</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </section>
      ))}

      <section>
        <h2>{mode === 'open' ? 'Notes for the day' : 'Handover for the morning'}</h2>
        {mode === 'close' && rec?.note ? <div className="note">{rec.note}</div> : <div className="lines" />}
      </section>
      <div className="sig">
        <div>{mode === 'open' ? 'Opening completed by' : 'Closing completed by'} · time</div>
        <div>Operations manager</div>
        <div>Field coordinator</div>
      </div>
    </main>
  )
}
