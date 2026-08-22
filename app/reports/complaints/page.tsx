'use client'
// THE OWNER'S COPY. Written to be printed and handed over, so it opens with the gap against the rest
// of the portfolio, then the guests' own words, then what it costs to fix — in that order, because
// that is the order an owner asks the questions in.
import { useCallback, useEffect, useState } from 'react'
import { Printer, Star } from 'lucide-react'

export default function OwnerComplaintReport() {
  const [units, setUnits] = useState<{ id: string; name: string }[]>([])
  const [listingId, setListingId] = useState('')
  const [days, setDays] = useState(365)
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetch('/api/ops-today', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const seen: Record<string, string> = {}
      for (const u of (j.units || [])) if (u.listingId && u.unit) seen[String(u.listingId)] = u.unit
      const list = Object.keys(seen).map(id => ({ id, name: seen[id] })).sort((a, b) => a.name.localeCompare(b.name))
      setUnits(list)
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!listingId) return
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/reviews/owner-report?listingId=' + encodeURIComponent(listingId) + '&days=' + days, { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Could not build the report')
      setD(j)
    } catch (e: any) { setErr(String(e?.message || e)); setD(null) }
    setLoading(false)
  }, [listingId, days])
  useEffect(() => { load() }, [load])

  const gap = d?.gap
  const behind = gap != null && gap < -0.05

  return (
    <div className="oc-root">
      <div className="oc-bar">
        <select value={listingId} onChange={e => setListingId(e.target.value)} className="oc-input">
          <option value="">Choose a unit…</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="oc-input">
          <option value={180}>Last 6 months</option>
          <option value={365}>Last 12 months</option>
          <option value={730}>Last 2 years</option>
        </select>
        <button onClick={async () => { await load(); setTimeout(() => window.print(), 250) }} className="oc-btn"><Printer size={14} /> Print / PDF</button>
        {loading && <span className="oc-muted">Building…</span>}
        {err && <span className="oc-err">{err}</span>}
      </div>

      {!d && !loading && <div className="oc-empty">Pick a unit to build its report.</div>}

      {d && (
        <section className="oc-page">
          <div className="oc-head">
            <div>
              <div className="oc-brand">STAY HOSPITALITY</div>
              <h1 className="oc-title">{d.scope.unit}</h1>
              <div className="oc-sub">What guests told us, and what we recommend</div>
            </div>
            <div className="oc-headright">
              <div className="oc-date">{new Date(d.from + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} — {new Date(d.to + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
              <div className="oc-muted">{d.reviews} guest reviews</div>
            </div>
          </div>

          {/* WHERE THE UNIT STANDS */}
          <div className="oc-stats">
            <div className="oc-stat">
              <div className="oc-lbl">This unit</div>
              <div className="oc-big">{d.avg ?? '—'} <Star size={14} className="oc-star" /></div>
              <div className="oc-muted">{d.fiveShare != null ? d.fiveShare + '% five-star' : ''}</div>
            </div>
            <div className="oc-stat">
              <div className="oc-lbl">Rest of the portfolio</div>
              <div className="oc-big">{d.portfolioAvg ?? '—'}</div>
              <div className="oc-muted">{d.portfolioFiveShare != null ? d.portfolioFiveShare + '% five-star' : ''}</div>
            </div>
            <div className={'oc-stat ' + (behind ? 'oc-bad' : '')}>
              <div className="oc-lbl">Difference</div>
              <div className="oc-big">{gap != null ? (gap > 0 ? '+' : '') + gap : '—'}</div>
              <div className="oc-muted">{behind ? 'below the portfolio' : gap != null && gap > 0.05 ? 'above the portfolio' : 'in line'}</div>
            </div>
          </div>

          {behind && (
            <p className="oc-lede">
              This unit is running <b>{Math.abs(gap).toFixed(2)} of a star below</b> the rest of the portfolio, cleaned by the
              same team to the same standard. The reasons guests give are below, in their own words. Closing that gap is
              what protects the nightly rate and the ranking.
            </p>
          )}

          {/* WHAT GUESTS RAISED */}
          <h2 className="oc-h2">What guests raised</h2>
          {!d.themes.length && <p className="oc-muted">No recurring complaints in this period — nothing to act on.</p>}
          {(d.ownerThemes || []).map((t: any) => (
            <div key={t.key} className="oc-theme">
              <div className="oc-themehead">
                <span className="oc-themename">{t.label}</span>
                <span className="oc-count">{t.guests} of {d.reviews} guests mentioned it{t.worsening && t.prevGuests > 0 ? ' · up from ' + t.prevGuests : ''}</span>
                {t.avgWhenMentioned != null && <span className="oc-when">they rated {t.avgWhenMentioned} on average</span>}
              </div>
              {t.quotes.map((q: any, i: number) => (
                <div key={i} className="oc-quote">&ldquo;{q.text}&rdquo; <span className="oc-muted">— {q.rating}★, {q.at}</span></div>
              ))}
              <div className="oc-fix"><b>Recommended:</b> {t.fix}</div>
            </div>
          ))}

          {(d.oursThemes || []).length > 0 && (
            <>
              <h2 className="oc-h2">On us, not on you</h2>
              <p className="oc-muted">These came up too, and they are ours to fix at no cost to you:</p>
              {(d.oursThemes || []).map((t: any) => (
                <div key={t.key} className="oc-ours"><b>{t.label}</b> — {t.guests} guest{t.guests === 1 ? '' : 's'}. {t.fix}</div>
              ))}
            </>
          )}

          {/* CATEGORY SCORES */}
          {!!(d.categories || []).length && (
            <>
              <h2 className="oc-h2">Scores by category</h2>
              <table className="oc-table">
                <thead><tr><th>Category</th><th>This unit</th><th>Portfolio</th><th>Difference</th></tr></thead>
                <tbody>
                  {d.categories.map((c: any) => {
                    const diff = c.portfolio != null ? Math.round((c.avg - c.portfolio) * 100) / 100 : null
                    return (
                      <tr key={c.key}>
                        <td>{c.label}</td>
                        <td className="oc-num">{c.avg}</td>
                        <td className="oc-num oc-muted">{c.portfolio ?? '—'}</td>
                        <td className={'oc-num ' + (diff != null && diff < -0.05 ? 'oc-red' : '')}>{diff != null ? (diff > 0 ? '+' : '') + diff : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}

          <div className="oc-foot">
            Every line here comes from a verified guest review of this unit between {d.from} and {d.to}. Quotes are the
            guests&rsquo; own words, shortened to the sentence that mentions the issue. Happy to walk through any of it.
          </div>
        </section>
      )}

      <style jsx global>{`
        .oc-root { background:#f4f4f5; min-height:100vh; padding:16px; }
        .oc-bar { max-width:900px; margin:0 auto 12px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .oc-input { font-size:13px; padding:6px 10px; border-radius:9px; border:1px solid #d4d4d8; background:#fff; }
        .oc-btn { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:600; padding:7px 12px; border-radius:9px; border:1px solid #18181b; background:#18181b; color:#fff; cursor:pointer; }
        .oc-muted { font-size:11.5px; color:#71717a; }
        .oc-err { font-size:12px; color:#b91c1c; }
        .oc-empty { max-width:900px; margin:40px auto; text-align:center; color:#71717a; font-size:14px; }
        .oc-page { max-width:900px; margin:0 auto; background:#fff; padding:30px 34px 34px; box-shadow:0 1px 3px rgba(0,0,0,.1); color:#18181b; }
        .oc-head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2.5px solid #18181b; padding-bottom:10px; margin-bottom:16px; }
        .oc-brand { font-size:9px; font-weight:800; letter-spacing:.18em; color:#71717a; }
        .oc-title { font-size:26px; font-weight:800; letter-spacing:-.02em; margin:2px 0 0; }
        .oc-sub { font-size:12.5px; color:#71717a; margin-top:2px; }
        .oc-headright { text-align:right; }
        .oc-date { font-size:12.5px; font-weight:700; }
        .oc-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:14px; }
        .oc-stat { border:1px solid #e4e4e7; border-radius:10px; padding:10px 12px; }
        .oc-bad { border-color:#fecaca; background:#fef2f2; }
        .oc-lbl { font-size:9.5px; text-transform:uppercase; letter-spacing:.08em; color:#71717a; font-weight:700; }
        .oc-big { font-size:24px; font-weight:800; display:flex; align-items:center; gap:4px; }
        .oc-star { color:#f59e0b; fill:#fbbf24; }
        .oc-lede { font-size:13px; line-height:1.5; background:#fafafa; border-left:3px solid #18181b; padding:9px 12px; margin:0 0 16px; }
        .oc-h2 { font-size:14px; font-weight:800; margin:18px 0 8px; padding-bottom:4px; border-bottom:1px solid #e4e4e7; }
        .oc-theme { border:1px solid #e4e4e7; border-radius:10px; padding:11px 13px; margin-bottom:10px; break-inside:avoid; }
        .oc-themehead { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; margin-bottom:6px; }
        .oc-themename { font-size:14px; font-weight:800; }
        .oc-count { font-size:12px; font-weight:600; color:#b91c1c; }
        .oc-when { font-size:11.5px; color:#71717a; }
        .oc-quote { font-size:12.5px; line-height:1.5; color:#3f3f46; padding:3px 0 3px 10px; border-left:2px solid #e4e4e7; margin-bottom:3px; }
        .oc-fix { font-size:12.5px; margin-top:7px; background:#f4f4f5; border-radius:7px; padding:7px 9px; }
        .oc-ours { font-size:12.5px; padding:5px 0; border-bottom:1px solid #f4f4f5; }
        .oc-table { width:100%; border-collapse:collapse; font-size:12.5px; }
        .oc-table th { text-align:left; font-size:9.5px; text-transform:uppercase; letter-spacing:.06em; color:#71717a; border-bottom:1px solid #e4e4e7; padding:5px 6px; }
        .oc-table td { padding:5px 6px; border-bottom:1px solid #f4f4f5; }
        .oc-num { text-align:right; font-variant-numeric:tabular-nums; }
        .oc-red { color:#b91c1c; font-weight:700; }
        .oc-foot { margin-top:18px; padding-top:10px; border-top:1px solid #e4e4e7; font-size:11px; color:#71717a; line-height:1.5; }
        /* PHONE. This page is its own document — no Shell, its own stylesheet — so its phone
           layout lives here too. The A4-ish 34px page margins and the three-across stat row were
           built for paper: on a 375px screen they left ~90px per stat card, which is not enough
           for "Rest of the portfolio" plus a number plus a sub-label. Print is unaffected: a
           printed page is far wider than 640px, so none of this matches. */
        @media (max-width: 640px) {
          .oc-root { padding:10px; }
          .oc-page { padding:20px 16px 24px; }
          .oc-title { font-size:22px; }
          .oc-head { flex-wrap:wrap; gap:8px; }
          .oc-headright { text-align:left; }
          .oc-stats { grid-template-columns:1fr; }
          /* Four score columns keep their widths and scroll rather than wrapping every heading. */
          .oc-table { display:block; overflow-x:auto; -webkit-overflow-scrolling:touch; }
        }
        @media print {
          .oc-root { background:#fff; padding:0; }
          .oc-bar { display:none; }
          .oc-page { box-shadow:none; max-width:none; padding:0; }
          .oc-theme { break-inside:avoid; }
        }
      `}</style>
    </div>
  )
}
