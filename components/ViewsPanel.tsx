'use client'
// THE VIEWS PANEL (Jon, 2026-10-29: "give us data to make enhancements"). Everything here comes
// from report_views — sessions on the share link by people who were not signed in. Opens, people,
// time, how far they got, where they lingered, where they dropped off, and what they clicked.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

type Any = any
const secs = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's' }
const ago = (iso: string) => {
  const m = Math.round((Date.now() - +new Date(iso)) / 60000)
  if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'
  const h = Math.round(m / 60); if (h < 24) return h + ' h ago'
  const d = Math.round(h / 24); return d + (d === 1 ? ' day ago' : ' days ago')
}
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function ViewsPanel({ id, t, onClose }: { id: string; t: Any; onClose: () => void }) {
  const [rows, setRows] = useState<Any[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    fetch('/api/reports/views?id=' + encodeURIComponent(id)).then(r => r.json()).then(d => {
      if (d?.ok) setRows(d.views || [])
      else { setRows([]); setErr(d?.needsMigration ? 'View tracking is switched on once the report_views table is created (migration 167_report_views.sql).' : String(d?.error || 'Could not load views.')) }
    }).catch(() => { setRows([]); setErr('Could not load views.') })
  }, [id])

  const v = (rows || []).filter((r: Any) => (r.total_ms || 0) >= 2000 || (r.clicks || []).length)
  const opens = (rows || []).length
  const people = new Set((rows || []).map((r: Any) => r.visitor_id || r.session_id)).size
  const avg = v.length ? v.reduce((a: number, r: Any) => a + (r.total_ms || 0), 0) / v.length : 0
  const finished = v.filter((r: Any) => r.slide_count && r.max_slide >= r.slide_count).length
  const withClick = v.filter((r: Any) => (r.clicks || []).length > 0).length
  // Per slide: average time among sessions that reached it, and the share of sessions that did.
  const per: Record<string, { ix: number; ms: number; n: number }> = {}
  v.forEach((r: Any) => Object.entries(r.slides || {}).forEach(([k, x]: Any) => {
    const p = per[k] || (per[k] = { ix: x.ix || 0, ms: 0, n: 0 }); p.ms += x.ms || 0; p.n += 1; p.ix = Math.min(p.ix, x.ix || 0)
  }))
  const slides = Object.entries(per).map(([k, p]) => ({ k, ix: p.ix, avg: p.n ? p.ms / p.n : 0, reach: v.length ? p.n / v.length : 0 })).sort((a, b) => a.ix - b.ix)
  const maxAvg = Math.max(1, ...slides.map(s => s.avg))
  const top = slides.slice().sort((a, b) => b.avg - a.avg)[0]
  let drop: { k: string; d: number } | null = null
  for (let i = 1; i < slides.length; i++) { const d = slides[i - 1].reach - slides[i].reach; if (d > 0.15 && (!drop || d > drop.d)) drop = { k: slides[i - 1].k, d } }
  const clickCount: Record<string, { n: number; s: string }> = {}
  v.forEach((r: Any) => (r.clicks || []).forEach((c: Any) => { const key = c.l; const x = clickCount[key] || (clickCount[key] = { n: 0, s: c.s }); x.n += 1 }))
  const clickList = Object.entries(clickCount).sort((a, b) => b[1].n - a[1].n).slice(0, 10)
  const devices: Record<string, number> = {}
  v.forEach((r: Any) => { devices[r.device || 'Unknown'] = (devices[r.device || 'Unknown'] || 0) + 1 })

  const tile = (l: string, val: string, sub?: string) => (
    <div style={{ background: t.chip, borderRadius: 12, padding: '12px 14px', minWidth: 0 }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.muted, margin: 0 }}>{l}</p>
      <p style={{ fontSize: 22, fontWeight: 600, color: t.ink, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{val}</p>
      {sub ? <p style={{ fontSize: 11, color: t.muted, margin: '2px 0 0' }}>{sub}</p> : null}
    </div>
  )
  const H = (s: string) => <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: t.muted, margin: '22px 0 8px' }}>{s}</p>

  return (
    <div className="sb-noprint fixed inset-0 z-[85] flex items-center justify-center p-4" style={{ background: 'rgba(10,14,20,0.6)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-auto p-5" style={{ background: t.card, border: '1px solid ' + t.cardBorder, color: t.ink }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div>
            <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Views on the share link</p>
            <p style={{ fontSize: 12, color: t.muted, margin: '2px 0 0' }}>People who opened the link without signing in. Your team&rsquo;s own visits are not counted.</p>
          </div>
          <button onClick={onClose} title="Close" style={{ color: t.muted }}><X size={16} /></button>
        </div>
        {rows === null ? <p style={{ fontSize: 13, color: t.muted }}>Loading&hellip;</p> : err ? <p style={{ fontSize: 13, color: t.accent }}>{err}</p> : !opens ? (
          <p style={{ fontSize: 13, color: t.muted }}>No one has opened this link yet. Opens, time per slide and clicks show up here as soon as they do.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              {tile('Opens', String(opens), rows && rows[0] ? 'last ' + ago(rows[0].last_seen || rows[0].started_at) : '')}
              {tile('People', String(people), 'by device')}
              {tile('Avg time', secs(avg), v.length + ' real visits')}
              {tile('Saw it all', v.length ? Math.round((finished / v.length) * 100) + '%' : '–', finished + ' of ' + v.length)}
              {tile('Click rate', v.length ? Math.round((withClick / v.length) * 100) + '%' : '–', 'visits with a click')}
            </div>
            {(top || drop) ? (
              <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
                {top ? <p style={{ fontSize: 13, margin: 0 }}><b>Most time:</b> {top.k} ({secs(top.avg)} on average)</p> : null}
                {drop ? <p style={{ fontSize: 13, margin: 0 }}><b>Biggest drop-off:</b> after {drop.k} &mdash; {Math.round(drop.d * 100)}% of viewers stop there</p> : null}
              </div>
            ) : null}
            {H('Time on each slide · share who reached it')}
            <div style={{ display: 'grid', gap: 6 }}>
              {slides.map(s => (
                <div key={s.k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 64px 44px', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.k}</span>
                  <span style={{ height: 10, borderRadius: 5, background: t.chip, position: 'relative', overflow: 'hidden' }}>
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (s.avg / maxAvg * 100) + '%', background: t.accent, borderRadius: 5 }} />
                  </span>
                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{secs(s.avg)}</span>
                  <span style={{ textAlign: 'right', color: t.muted, fontVariantNumeric: 'tabular-nums' }}>{Math.round(s.reach * 100)}%</span>
                </div>
              ))}
            </div>
            {clickList.length ? (
              <>
                {H('What they clicked')}
                <div style={{ display: 'grid', gap: 4 }}>
                  {clickList.map(([l, x]) => (
                    <div key={l} className="flex items-center justify-between" style={{ fontSize: 12.5, gap: 10 }}>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l} <span style={{ color: t.muted }}>· {x.s}</span></span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{x.n}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
            {H('Each visit')}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ color: t.muted, textAlign: 'left' }}>{['When', 'Device', 'Where', 'Time', 'Reached', 'Clicks', 'Presented'].map(h => <th key={h} style={{ padding: '4px 6px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {(rows || []).slice(0, 60).map((r: Any) => (
                    <tr key={r.session_id} style={{ borderTop: '1px solid ' + t.rule }}>
                      <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{when(r.started_at)}</td>
                      <td style={{ padding: '5px 6px' }}>{r.device || ''}</td>
                      <td style={{ padding: '5px 6px', whiteSpace: 'nowrap' }}>{[r.city, r.region, r.country].filter(Boolean).join(', ')}</td>
                      <td style={{ padding: '5px 6px', fontVariantNumeric: 'tabular-nums' }}>{secs(r.total_ms || 0)}</td>
                      <td style={{ padding: '5px 6px', fontVariantNumeric: 'tabular-nums' }}>{r.slide_count ? r.max_slide + ' / ' + r.slide_count : ''}</td>
                      <td style={{ padding: '5px 6px', fontVariantNumeric: 'tabular-nums' }}>{(r.clicks || []).length}</td>
                      <td style={{ padding: '5px 6px' }}>{r.presented ? 'Yes' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 11, color: t.muted, marginTop: 12 }}>Devices: {Object.entries(devices).map(([k, n]) => k + ' ' + n).join(' · ')}. A visit under 2 seconds with no clicks counts as an open only.</p>
          </>
        )}
      </div>
    </div>
  )
}
