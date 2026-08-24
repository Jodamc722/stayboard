'use client'
// Revenue App ↔ Lighthouse — status card, the source flag, and the month reconcile table.
//
// Read top-down: is the feed alive → which feeds he has wired → do his numbers agree with ours →
// then, and only then, the flag. The flag control sits LAST on purpose.
import { useCallback, useEffect, useState } from 'react'

type Feed = { feed: string; wired: 'live' | 'requested'; status: string; last_sync_at: string | null; last_ok_at: string | null; items: number; http: number | null; error: string | null; columns: string[] }
type Status = { configured: boolean; url: string | null; authHeader: string; setting: { source: 'lighthouse' | 'revenue_app'; maxStaleHours: number }; feeds: Feed[]; tables: Record<string, number | null>; probe: any }
type Recon = any

const money = (n: number | null | undefined) => n == null ? '—' : (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US')
const int = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString('en-US')
const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 2 ? 'just now' : m < 90 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'
}
function statusChip(s: string, wired: string) {
  const cls = s === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : s === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200'
    : s === 'missing' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-slate-50 text-muted border-line'
  const label = s === 'ok' ? 'OK' : s === 'error' ? 'Error' : s === 'missing' ? (wired === 'requested' ? 'Not built yet' : 'Missing') : 'Never synced'
  return <span className={'inline-block text-[10.5px] font-semibold px-2 py-0.5 rounded-full border ' + cls}>{label}</span>
}
function deltaCell(n: number | null, p?: number | null) {
  if (n == null) return <td className="px-3 py-2 text-right text-muted tabular-nums">—</td>
  const big = Math.abs(p ?? 0) >= 2 || Math.abs(n) >= 250
  const cls = n === 0 ? 'text-muted' : big ? 'text-rose-700 font-semibold' : 'text-ink'
  return <td className={'px-3 py-2 text-right tabular-nums ' + cls}>{money(n)}{p != null ? <span className="text-[10.5px] text-muted ml-1">{p > 0 ? '+' : ''}{p}%</span> : null}</td>
}

export function RevenueAppReconcile({ initialMonth }: { initialMonth: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [recon, setRecon] = useState<Recon | null>(null)
  const [month, setMonth] = useState(initialMonth)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showUnits, setShowUnits] = useState(false)

  const loadStatus = useCallback(async (probe = false) => {
    const r = await fetch('/api/revenue-app/status' + (probe ? '?probe=1' : ''), { cache: 'no-store' })
    if (r.ok) setStatus(await r.json()); else setErr('Could not load status (' + r.status + ')')
  }, [])
  const loadRecon = useCallback(async (m: string) => {
    const r = await fetch('/api/revenue-app/reconcile?month=' + m, { cache: 'no-store' })
    if (r.ok) setRecon(await r.json()); else setErr('Could not load reconcile (' + r.status + ')')
  }, [])
  useEffect(() => { loadStatus() }, [loadStatus])
  useEffect(() => { loadRecon(month) }, [month, loadRecon])

  async function syncNow() {
    setBusy('sync'); setErr(null)
    try {
      const r = await fetch('/api/cron/revenue-sync', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) setErr(j?.error || 'Sync failed (' + r.status + ')')
      await loadStatus(); await loadRecon(month)
    } finally { setBusy(null) }
  }
  async function setSource(source: 'lighthouse' | 'revenue_app') {
    if (source === 'revenue_app' && !confirm('Switch every money surface in Lighthouse to the Revenue App\'s numbers? Our own math stays as a labelled fallback.')) return
    setBusy('flag'); setErr(null)
    try {
      const r = await fetch('/api/revenue-app/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, maxStaleHours: status?.setting.maxStaleHours || 6 }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) setErr(j?.message || j?.error || 'Could not save')
      await loadStatus()
    } finally { setBusy(null) }
  }

  const s = status
  const live = s?.feeds.filter(f => f.wired === 'live') || []
  const requested = s?.feeds.filter(f => f.wired === 'requested') || []

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-brand-600 font-semibold">Money source</div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Revenue App ↔ Lighthouse</h1>
          <p className="text-sm text-muted mt-1 max-w-[70ch]">The Revenue App owns every dollar; Lighthouse owns every hour, clean and task. This page shows whether his feed is alive, which feeds he has wired, and whether his numbers agree with ours — before any page switches over.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => loadStatus(true)} disabled={!!busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-slate-50 disabled:opacity-50">Test key</button>
          <button onClick={syncNow} disabled={!!busy || !s?.configured} title={!s?.configured ? 'Set REVENUE_APP_URL and REVENUE_APP_API_KEY in Vercel first' : ''} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
        </div>
      </div>

      {err ? <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-sm px-4 py-3">{err}</div> : null}

      {/* Connection */}
      <div className="rounded-2xl border border-line bg-white shadow-soft p-4 sm:p-5">
        {!s ? <div className="text-sm text-muted">Loading…</div> : !s.configured ? (
          <div className="text-sm">
            <span className="inline-block text-[10.5px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 mr-2">Not configured</span>
            Add <code className="text-xs bg-slate-100 px-1 rounded">REVENUE_APP_URL</code> and <code className="text-xs bg-slate-100 px-1 rounded">REVENUE_APP_API_KEY</code> in Vercel → Environment Variables, then redeploy. Nothing syncs until then.
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div><span className="text-muted">App</span> <span className="font-semibold text-ink">{s.url}</span></div>
            <div><span className="text-muted">Auth header</span> <span className="font-mono text-xs">{s.authHeader}</span></div>
            <div><span className="text-muted">Raw rows landed</span> <span className="font-semibold tabular-nums">{int(s.tables.rev_feed_row)}</span></div>
            <div><span className="text-muted">Unit-months</span> <span className="font-semibold tabular-nums">{int(s.tables.rev_unit_month)}</span></div>
            <div><span className="text-muted">P&amp;L lines</span> <span className="font-semibold tabular-nums">{int(s.tables.rev_pnl_line)}</span></div>
            {s.probe ? (
              <div className={'w-full mt-1 rounded-lg px-3 py-2 text-xs ' + (s.probe.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>
                {s.probe.ok ? `Key works — ${s.probe.feed} answered ${s.probe.http} in ${s.probe.ms} ms with ${s.probe.rows} rows.` : `Key test failed on ${s.probe.feed}: ${s.probe.error}`}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Feeds */}
      {s ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[{ title: 'Feeds his app already serves', list: live, note: 'Verified live 2026-08-24 from the app itself.' },
            { title: 'Feeds on the request list', list: requested, note: '“Not built yet” is expected here until he ships them — it is not an error.' }].map(sec => (
            <div key={sec.title} className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
              <div className="px-4 py-3 border-b border-line">
                <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted font-bold">{sec.title}</div>
                <div className="text-[11.5px] text-muted mt-0.5">{sec.note}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {sec.list.map(f => (
                      <tr key={f.feed} className="border-b border-line last:border-b-0 align-top">
                        <td className="px-4 py-2 font-mono text-xs text-ink whitespace-nowrap">{f.feed}</td>
                        <td className="px-2 py-2">{statusChip(f.status, f.wired)}</td>
                        <td className="px-2 py-2 text-xs text-muted whitespace-nowrap tabular-nums">{f.items ? int(f.items) + ' rows · ' : ''}{ago(f.last_ok_at || f.last_sync_at)}</td>
                        <td className="px-2 py-2 text-[11px] text-muted">
                          {f.error ? <span className="text-rose-700">{f.error}</span> : f.columns.length ? <span title={f.columns.join(', ')}>{f.columns.length} columns: {f.columns.slice(0, 6).join(', ')}{f.columns.length > 6 ? '…' : ''}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Reconcile */}
      <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted font-bold">His numbers vs ours</div>
            <div className="text-[11.5px] text-muted mt-0.5">{recon?.hisUnits ? `Revenue App ${recon.hisKind === 'eom' ? 'closed month' : 'live view'} · synced ${ago(recon.hisSyncedAt)} · ${recon.hisUnits} units vs our ${recon.ourUnits}` : 'No Revenue App rows for this month yet — run a sync, or he has not exposed it.'}</div>
          </div>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="text-sm border border-line rounded-lg px-2 py-1" />
        </div>
        {recon ? (
          <>
            <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
              {[['Net + channel fees', 'netota'], ['Net (after OTA)', 'net'], ['Nights', 'nights']].map(([label, k]) => (
                <div key={k} className="px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.13em] text-muted font-bold">{label}</div>
                  <div className="text-lg font-bold text-ink tabular-nums mt-1">{k === 'nights' ? int(recon.totals.his[k]) : money(recon.totals.his[k])} <span className="text-xs text-muted font-normal">his</span></div>
                  <div className="text-sm text-muted tabular-nums">{k === 'nights' ? int(recon.totals.ours[k]) : money(recon.totals.ours[k])} <span className="text-xs">ours</span> · <span className={Math.abs(recon.delta[k]) > 0 ? 'text-rose-700 font-semibold' : ''}>{k === 'nights' ? int(recon.delta[k]) : money(recon.delta[k])}</span></div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.12em] text-muted">
                    <th className="text-left px-3 py-2">Building</th><th className="text-right px-3 py-2">Units</th>
                    <th className="text-right px-3 py-2">His net+fees</th><th className="text-right px-3 py-2">Ours</th><th className="text-right px-3 py-2">Δ</th>
                    <th className="text-right px-3 py-2">His net</th><th className="text-right px-3 py-2">Ours</th><th className="text-right px-3 py-2">Δ</th>
                    <th className="text-right px-3 py-2">Δ nights</th><th className="text-left px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {recon.buildings.map((b: any) => (
                    <tr key={b.building} className="border-t border-line">
                      <td className="px-3 py-2 font-semibold text-ink">{b.building}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.units}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(b.his.netota)}</td><td className="px-3 py-2 text-right tabular-nums text-muted">{money(b.ours.netota)}</td>{deltaCell(b.delta.netota, b.delta.netotaPct)}
                      <td className="px-3 py-2 text-right tabular-nums">{money(b.his.net)}</td><td className="px-3 py-2 text-right tabular-nums text-muted">{money(b.ours.net)}</td>{deltaCell(b.delta.net)}
                      <td className={'px-3 py-2 text-right tabular-nums ' + (b.delta.nights ? 'text-rose-700' : 'text-muted')}>{int(b.delta.nights)}</td>
                      <td className="px-3 py-2 text-[11px] text-muted">
                        {b.onlyHis ? <span className="mr-2">{b.onlyHis} only in his</span> : null}
                        {b.onlyOurs ? <span className="mr-2">{b.onlyOurs} only in ours</span> : null}
                        {b.hisLabels.length > 1 || (b.hisLabels[0] && b.hisLabels[0] !== b.building) ? <span>his label: {b.hisLabels.join(', ')}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-line flex items-center justify-between">
              <button onClick={() => setShowUnits(v => !v)} className="text-xs font-semibold text-brand-700">{showUnits ? 'Hide units' : `Show all ${recon.rows.length} units (largest deltas first)`}</button>
              <span className="text-[11px] text-muted">{recon.legend.netota}</span>
            </div>
            {showUnits ? (
              <div className="overflow-x-auto border-t border-line">
                <table className="w-full text-xs">
                  <thead><tr className="text-[10px] uppercase tracking-[0.12em] text-muted"><th className="text-left px-3 py-2">Unit</th><th className="text-left px-3 py-2">Building (his)</th><th className="text-right px-3 py-2">His net+fees</th><th className="text-right px-3 py-2">Ours</th><th className="text-right px-3 py-2">Δ</th><th className="text-right px-3 py-2">His nights</th><th className="text-right px-3 py-2">Ours</th><th className="text-left px-3 py-2">Flag</th></tr></thead>
                  <tbody>
                    {recon.rows.map((r: any) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className="px-3 py-1.5 text-ink">{r.unit}</td>
                        <td className="px-3 py-1.5 text-muted">{r.building || '—'}{r.hisBuilding && r.hisBuilding !== r.building ? <span className="ml-1 text-amber-700">({r.hisBuilding})</span> : null}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{money(r.his?.netota)}</td><td className="px-3 py-1.5 text-right tabular-nums text-muted">{money(r.ours?.netota)}</td>{deltaCell(r.delta.netota, r.delta.netotaPct)}
                        <td className="px-3 py-1.5 text-right tabular-nums">{int(r.his?.nights)}</td><td className="px-3 py-1.5 text-right tabular-nums text-muted">{int(r.ours?.nights)}</td>
                        <td className="px-3 py-1.5 text-[11px]">{!r.inHis ? <span className="text-amber-700">not in Revenue App</span> : !r.inOurs ? <span className="text-amber-700">not in Lighthouse</span> : r.buildingMismatch ? <span className="text-amber-700">building label differs</span> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : <div className="p-4 text-sm text-muted">Loading…</div>}
      </div>

      {/* The flag — last, on purpose */}
      {s ? (
        <div className="rounded-2xl border border-line bg-white shadow-soft p-4 sm:p-5">
          <div className="text-[10.5px] uppercase tracking-[0.14em] text-muted font-bold">Which numbers do Lighthouse pages show?</div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {(['lighthouse', 'revenue_app'] as const).map(v => (
              <button key={v} onClick={() => setSource(v)} disabled={!!busy || s.setting.source === v}
                className={'text-xs font-semibold px-3 py-1.5 rounded-lg border ' + (s.setting.source === v ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line hover:bg-slate-50')}>
                {v === 'lighthouse' ? 'Lighthouse (our Guesty math)' : 'Revenue App (his numbers)'}
              </button>
            ))}
            <span className="text-[11.5px] text-muted">Fallback after {s.setting.maxStaleHours} h without a sync — always labelled on the page, never blended.</span>
          </div>
          <p className="text-xs text-muted mt-3 max-w-[80ch]">Flip only after one full month reconciles above with every delta explained. Pages switch one at a time as they adopt <code className="bg-slate-100 px-1 rounded">lib/revenue-source.ts</code>; until a page adopts it, it keeps showing Lighthouse numbers regardless of this switch.</p>
        </div>
      ) : null}
    </div>
  )
}
