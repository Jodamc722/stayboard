'use client'
// CHANNEL CONNECTIONS — the matrix (Jon, 2026-09-18: "shows our listings and whether we are
// connected to channels… need to identify listings not connected").
//
// Reads /api/channels (ten-minute cache). The page is built to be read top-down in the order a GM
// actually asks the questions:
//   1. the tiles — per channel, how many are live and how many are not (the tone says which matters)
//   2. the matrix — every active listing × every channel; a pill per cell, tap it for the detail
//      (status, Airbnb's approval text, sync category, last booking, 90-day count, the public link)
//   3. "Not connected" — the plain list of listings off a MAJOR channel, which is the thing he asked for
//   4. inactive listings, folded — reported, never alerted
//
// Deep links: /channels?listing=<id> (from the Command Center and the audit finding) scrolls to and
// highlights that row; /channels?problems=1 (from the Slack message) opens with the problems filter on.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, RefreshCw, Download, ExternalLink, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { Sheet } from '@/components/Sheet'
import {
  CHANNELS, MAJOR_KEYS, VERDICT_LABEL, VERDICT_ORDER, isProblem, verdictRank,
  type Cell, type CellVerdict, type ChannelHealth, type ListingHealth,
} from '@/lib/channel-types'

type Data = ChannelHealth & { ok: boolean; snapshotAt: string | null; error?: string }

const PILL: Record<CellVerdict, string> = {
  live: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  stale: 'bg-sky-50 text-sky-800 border-sky-200',
  unknown: 'bg-amber-50 text-amber-800 border-amber-200',
  missing: 'bg-app text-muted border-line',
  disconnected: 'bg-rose-50 text-rose-700 border-rose-200',
  failed: 'bg-rose-100 text-rose-800 border-rose-300',
  suspended: 'bg-rose-600 text-white border-rose-700',
}
const SHORT: Record<CellVerdict, string> = { live: 'Live', stale: 'Quiet', unknown: '?', missing: '—', disconnected: 'Disc.', failed: 'Failed', suspended: 'Susp.' }

const when = (iso: string | null | undefined) => {
  if (!iso) return null
  const t = Date.parse(iso); if (!Number.isFinite(t)) return null
  return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const dayOf = (iso: string | null | undefined) => {
  if (!iso) return 'none on file'
  const t = Date.parse(iso); if (!Number.isFinite(t)) return 'none on file'
  const d = Math.round((Date.now() - t) / 86400000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'
}

function Tile({ label, live, bad, missing, unknown, stale, total, major, active, onClick }: {
  label: string; live: number; bad: number; missing: number; unknown: number; stale: number; total: number; major: boolean; active: boolean; onClick: () => void
}) {
  const tone = bad > 0 ? (major ? 'hot' : 'warn') : unknown > 0 ? 'warn' : 'ok'
  const num = tone === 'hot' ? 'text-rose-700' : tone === 'warn' ? 'text-amber-800' : 'text-emerald-700'
  const dot = tone === 'hot' ? 'bg-rose-500' : tone === 'warn' ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <button onClick={onClick} aria-pressed={active}
      className={'shrink-0 text-left rounded-xl border px-3 py-2 min-w-[132px] snap-start transition-colors ' + (active ? 'border-ink bg-white ring-1 ring-ink' : 'border-line bg-white hover:border-ink/30')}>
      <div className="flex items-center gap-1.5">
        <span className={'w-1.5 h-1.5 rounded-full ' + dot} aria-hidden />
        <span className="text-[10.5px] uppercase tracking-wide text-muted font-semibold whitespace-nowrap">{label}{major ? '' : ' ·'}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className={'text-[17px] font-bold tabular-nums leading-none ' + num}>{live}</span>
        <span className="text-[10.5px] text-muted leading-none whitespace-nowrap">of {total} live</span>
      </div>
      <div className="mt-1 text-[10.5px] leading-none text-muted whitespace-nowrap">
        {bad ? <span className="text-rose-700 font-semibold">{bad} broken</span> : <span>0 broken</span>}
        {' · '}{missing} not connected
        {unknown ? <span className="text-amber-800"> · {unknown} unknown</span> : null}
        {stale ? <span className="text-sky-800"> · {stale} quiet</span> : null}
      </div>
    </button>
  )
}

function Pill({ cell, onClick, ariaLabel }: { cell: Cell; onClick: () => void; ariaLabel: string }) {
  return (
    <button onClick={onClick} aria-label={ariaLabel} title={VERDICT_LABEL[cell.verdict] + (cell.status ? ' · ' + cell.status : '')}
      className={'inline-flex items-center justify-center min-w-[44px] h-7 px-1.5 rounded-md border text-[10.5px] font-semibold ' + PILL[cell.verdict]}>
      {SHORT[cell.verdict]}
    </button>
  )
}

export function ChannelConnections({ canRun }: { canRun: boolean }) {
  const params = useSearchParams()
  const focusId = params.get('listing') || ''
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState('')
  const [err, setErr] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(params.get('problems') === '1')
  const [channel, setChannel] = useState<string>('all')
  const [market, setMarket] = useState('all')
  const [building, setBuilding] = useState('all')
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [sel, setSel] = useState<{ l: ListingHealth; key: string } | null>(null)
  const focusRef = useRef<HTMLTableRowElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/channels', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || j?.message || 'Could not load channel connections.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!data || !focusId) return
    const t = setTimeout(() => { focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, 50)
    return () => clearTimeout(t)
  }, [data, focusId])

  const runCheck = async () => {
    setRunning(true); setRunNote('')
    try {
      const r = await fetch('/api/channels/check', { method: 'POST' })
      const j = await r.json()
      if (!r.ok || (j && j.error && !j.at)) throw new Error(j?.error || j?.message || 'Check failed.')
      const n = Array.isArray(j.alerts) ? j.alerts.length : 0
      setRunNote(j.firstRun ? 'First run — snapshot saved, ' + j.problems + ' problem cells recorded on Audits.'
        : n ? n + ' listing' + (n === 1 ? '' : 's') + ' dropped off a channel since the last check — posted to Slack.'
        : 'Checked. ' + j.problems + ' problem cell' + (j.problems === 1 ? '' : 's') + ', nothing new since ' + (when(data?.snapshotAt) || 'the last run') + '.')
      await load()
      if (Array.isArray(j.errors) && j.errors.length) setErr('The check ran, but: ' + j.errors.join('; '))
    } catch (e: any) { setRunNote('Could not run the check: ' + String(e?.message || e)) }
    setRunning(false)
  }

  const markets = useMemo(() => Array.from(new Set((data?.listings || []).map(l => l.market))).sort(), [data])
  const buildings = useMemo(() => Array.from(new Set((data?.listings || []).filter(l => market === 'all' || l.market === market).map(l => l.building))).sort(), [data, market])
  const cols = useMemo(() => channel === 'all' ? CHANNELS : CHANNELS.filter(c => c.key === channel), [channel])

  const rows = useMemo(() => {
    const all = data?.listings || []
    const needle = q.trim().toLowerCase()
    return all.filter(l => {
      if (market !== 'all' && l.market !== market) return false
      if (building !== 'all' && l.building !== building) return false
      if (needle && (l.name + ' ' + l.building).toLowerCase().indexOf(needle) < 0) return false
      if (onlyProblems) {
        const keys = channel === 'all' ? CHANNELS.map(c => c.key) : [channel]
        if (!keys.some(k => { const v = l.cells[k]?.verdict; return v && v !== 'live' })) return false
      }
      return true
    })
  }, [data, market, building, q, onlyProblems, channel])

  // Grouped by building, worst row first inside each group; the groups themselves are alphabetical
  // — a GM scans by building, not by verdict.
  const groups = useMemo(() => {
    const m: Record<string, ListingHealth[]> = {}
    for (const l of rows) (m[l.building] ||= []).push(l)
    return Object.keys(m).sort().map(b => ({ building: b, rows: m[b].slice().sort((a, c) => verdictRank(a.verdict) - verdictRank(c.verdict) || a.name.localeCompare(c.name)) }))
  }, [rows])

  const notConnected = useMemo(() => (data?.listings || []).filter(l => l.missingMajor.length > 0)
    .filter(l => (market === 'all' || l.market === market) && (building === 'all' || l.building === building)), [data, market, building])

  const csv = () => {
    if (!data) return
    const head = ['Unit', 'Building', 'Market', 'Active', 'Verdict', 'Bookings 90d'].concat(CHANNELS.flatMap(c => [c.label, c.label + ' status', c.label + ' bookings 90d', c.label + ' last booking', c.label + ' link']))
    const line = (l: ListingHealth) => [l.name, l.building, l.market, l.active ? 'yes' : 'no', VERDICT_LABEL[l.verdict], String(l.bookings90d)]
      .concat(CHANNELS.flatMap(c => { const x = l.cells[c.key]; return [VERDICT_LABEL[x.verdict], (x.status || '') + (x.approval ? ' / ' + x.approval : ''), String(x.bookings90d), x.lastBookingAt ? x.lastBookingAt.slice(0, 10) : '', x.url || ''] }))
    const lines = [head].concat(rows.map(line)).concat(showInactive ? (data.inactive || []).map(line) : [])
      .map(r => r.map(v => '"' + String(v).replace(/"/g, '""').replace(/\s+/g, ' ') + '"').join(','))
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'channel-connections-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && !data) return <div className="flex items-center gap-2 text-sm text-muted py-10"><Loader2 size={16} className="animate-spin" /> Reading every listing&apos;s channels…</div>
  if (err && !data) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>
  if (!data) return null

  const total = data.listings.length
  const totalProblems = data.listings.filter(l => l.missingMajor.length > 0).length
  const selCell = sel ? sel.l.cells[sel.key] : null
  const selDef = sel ? CHANNELS.find(c => c.key === sel.key) : null
  const unknownStatuses = CHANNELS.flatMap(c => Object.keys(data.statusesSeen?.[c.key] || {}).filter(s => !/^(COMPLETED|FAILED|DISCONNECTED|\(none\))$/.test(s)).map(s => c.label + ': ' + s + ' ×' + data.statusesSeen[c.key][s]))

  return (
    <div className="space-y-5">
      {/* ── tiles ────────────────────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto snap-x pb-1 -mx-1 px-1 sm:flex-wrap">
        {CHANNELS.map(c => {
          const t = data.totals[c.key]
          return <Tile key={c.key} label={c.label} major={c.major} total={total} live={t.live + t.stale} stale={t.stale} bad={t.failed + t.disconnected + t.suspended} missing={t.missing} unknown={t.unknown}
            active={channel === c.key} onClick={() => setChannel(channel === c.key ? 'all' : c.key)} />
        })}
      </div>
      <p className="text-[11.5px] text-muted -mt-2">
        {total} active listings · <span className={totalProblems ? 'text-rose-700 font-semibold' : 'text-emerald-700 font-semibold'}>{totalProblems} off a major channel</span>
        {' · '}last checked {when(data.snapshotAt) || 'never'} · data as of {when(data.at)}
        {unknownStatuses.length ? <span className="text-amber-800"> · statuses this page does not recognise: {unknownStatuses.join(', ')}</span> : null}
        {' · '}channels marked · are minor: shown, never alerted.
      </p>

      {/* ── controls ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <label className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 cursor-pointer">
          <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> Only problems
        </label>
        <select value={channel} onChange={e => setChannel(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1.5" aria-label="Channel">
          <option value="all">All channels</option>
          {CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select value={market} onChange={e => { setMarket(e.target.value); setBuilding('all') }} className="rounded-lg border border-line bg-white px-2 py-1.5" aria-label="Market">
          <option value="all">All markets</option>
          {markets.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={building} onChange={e => setBuilding(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1.5" aria-label="Building">
          <option value="all">All buildings</option>
          {buildings.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit…" className="rounded-lg border border-line bg-white px-2.5 py-1.5 w-40" aria-label="Search unit" />
        <span className="flex-1" />
        <button onClick={csv} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold hover:bg-app"><Download size={13} /> CSV</button>
        {canRun ? (
          <button onClick={runCheck} disabled={running} className="inline-flex items-center gap-1.5 rounded-lg border border-ink bg-ink text-white px-2.5 py-1.5 font-semibold disabled:opacity-60">
            {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </button>
        ) : null}
      </div>
      {runNote ? <div className="rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] text-ink">{runNote}</div> : null}
      {err ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{err}</div> : null}

      {/* ── matrix ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
        {/* The matrix scrolls inside its own frame so the channel names stay pinned at the top
            while you scroll the units (Jon, 2026-09-18: "freeze the header so you can see the
            channel"); the Unit column stays pinned on the left the same way. */}
        <div className="overflow-auto max-h-[calc(100vh-190px)]">
          <table className="min-w-full text-[12.5px]">
            <thead className="text-[10.5px] uppercase tracking-wide text-muted">
              <tr>
                <th className="text-left px-3 py-2 sticky left-0 top-0 bg-app z-30 border-b border-line">Unit</th>
                {cols.map(c => <th key={c.key} className={'px-1.5 py-2 text-center whitespace-nowrap sticky top-0 bg-app z-20 border-b border-line ' + (c.major ? 'text-ink' : '')}>{c.label}</th>)}
                <th className="px-2 py-2 text-right whitespace-nowrap sticky top-0 bg-app z-20 border-b border-line">Bookings 90d</th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ? (
                <tr><td colSpan={cols.length + 2} className="px-3 py-6 text-center text-muted">Nothing matches — every listing in this view is live everywhere.</td></tr>
              ) : groups.map(g => (
                <GroupRows key={g.building} building={g.building} rows={g.rows} cols={cols} focusId={focusId} focusRef={focusRef} onCell={(l, key) => setSel({ l, key })} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-3 py-2 border-t border-line text-[11px] text-muted flex flex-wrap gap-x-3 gap-y-1">
          {VERDICT_ORDER.slice().reverse().map(v => <span key={v} className="inline-flex items-center gap-1"><span className={'inline-block w-3 h-3 rounded border ' + PILL[v]} /> {VERDICT_LABEL[v]}{v === 'stale' ? ' (connected, no booking in 90d)' : v === 'unknown' ? ' (a status we have not seen)' : ''}</span>)}
        </div>
      </div>

      {/* ── not connected ────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-line bg-white shadow-soft">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-[14px] font-bold text-ink">Not connected on a major channel</h2>
          <p className="text-[11.5px] text-muted mt-0.5">Active listings that are missing, failed, disconnected or suspended on Airbnb, Booking.com, Vrbo or Expedia. Fix: Guesty → Listings → Channels.</p>
        </div>
        {notConnected.length === 0 ? <div className="px-4 py-4 text-[12.5px] text-emerald-700 font-semibold">Every active listing is live on all four major channels.</div> : (
          <ul className="divide-y divide-line">
            {notConnected.map(l => (
              <li key={l.id} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                <Link href={'/listings/' + l.id} className="font-semibold text-ink hover:underline">{l.name}</Link>
                <span className="text-muted">{l.building} · {l.market}</span>
                <span className="flex flex-wrap gap-1">
                  {l.missingMajor.map(k => <button key={k} onClick={() => setSel({ l, key: k })} className={'rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold ' + PILL[l.cells[k].verdict]}>{CHANNELS.find(c => c.key === k)?.label}: {VERDICT_LABEL[l.cells[k].verdict]}</button>)}
                </span>
                <span className="ml-auto text-muted tabular-nums">{l.bookings90d} bookings 90d</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── inactive ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-line bg-white shadow-soft">
        <button onClick={() => setShowInactive(v => !v)} className="w-full px-4 py-3 flex items-center gap-2 text-left" aria-expanded={showInactive}>
          {showInactive ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[14px] font-bold text-ink">Inactive listings</span>
          <span className="text-[11.5px] text-muted">{data.inactive.length} · reported, never alerted</span>
        </button>
        {showInactive ? (
          <div className="overflow-x-auto border-t border-line">
            <table className="min-w-full text-[12.5px]">
              <tbody>
                {data.inactive.map(l => (
                  <tr key={l.id} className="border-b border-line/60">
                    <td className="px-3 py-1.5 whitespace-nowrap"><span className="font-semibold">{l.name}</span> <span className="text-muted">· {l.building} · {l.status}</span></td>
                    {cols.map(c => <td key={c.key} className="px-1.5 py-1.5 text-center"><Pill cell={l.cells[c.key]} onClick={() => setSel({ l, key: c.key })} ariaLabel={l.name + ' on ' + c.label + ': ' + VERDICT_LABEL[l.cells[c.key].verdict]} /></td>)}
                    <td className="px-2 py-1.5 text-right tabular-nums text-muted">{l.bookings90d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* ── cell detail ──────────────────────────────────────────────────── */}
      <Sheet open={!!sel} onClose={() => setSel(null)} title={sel ? sel.l.name + ' · ' + (selDef?.label || sel.key) : ''} subtitle={sel ? sel.l.building + ' · ' + sel.l.market + (sel.l.active ? '' : ' · inactive (' + sel.l.status + ')') : undefined}>
        {sel && selCell ? (
          <div className="space-y-3 text-[13px]">
            <div className={'inline-flex items-center rounded-md border px-2 py-1 font-semibold ' + PILL[selCell.verdict]}>{VERDICT_LABEL[selCell.verdict]}</div>
            <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 gap-x-3">
              <dt className="text-muted">Guesty status</dt><dd className="font-mono text-[12px]">{selCell.connected ? selCell.status : 'no integration on this channel'}</dd>
              {sel.key === 'airbnb2' ? <><dt className="text-muted">Airbnb approval</dt><dd>{selCell.approval || <span className="text-muted">nothing recorded</span>}</dd></> : null}
              <dt className="text-muted">Sync</dt><dd>{selCell.syncCategory || <span className="text-muted">—</span>}</dd>
              <dt className="text-muted">Last booking</dt><dd>{selCell.lastBookingAt ? when(selCell.lastBookingAt) + ' (' + dayOf(selCell.lastBookingAt) + ')' : <span className="text-muted">none in the last year</span>}</dd>
              <dt className="text-muted">Bookings, 90 days</dt><dd className="tabular-nums">{selCell.bookings90d} from this channel · {sel.l.bookings90d} in total</dd>
              <dt className="text-muted">Public page</dt><dd>{selCell.url ? <a href={selCell.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 font-semibold hover:underline">Open on {selDef?.label} <ExternalLink size={12} /></a> : <span className="text-muted">no link from Guesty</span>}</dd>
            </dl>
            {isProblem(selCell.verdict) ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-900">
                Guests cannot book this unit on {selDef?.label} while it reads {VERDICT_LABEL[selCell.verdict].toLowerCase()}. <b>Reconnect on Guesty → Listings → Channels.</b>
                {MAJOR_KEYS.indexOf(sel.key as any) < 0 ? ' Minor channel — shown here, never alerted.' : ''}
              </div>
            ) : selCell.verdict === 'stale' ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900">Connected and reporting fine, but nothing has booked through it in 90 days while the unit books elsewhere. Worth checking the listing is actually visible on {selDef?.label}.</div>
            ) : selCell.verdict === 'unknown' ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">Guesty is reporting a status this page has never seen. It is shown as-is rather than assumed fine.</div>
            ) : null}
            <div className="text-[11.5px] text-muted"><Link href={'/listings/' + sel.l.id} className="hover:underline">Open the listing →</Link></div>
          </div>
        ) : null}
      </Sheet>
    </div>
  )
}

function GroupRows({ building, rows, cols, focusId, focusRef, onCell }: {
  building: string; rows: ListingHealth[]; cols: typeof CHANNELS; focusId: string
  focusRef: React.MutableRefObject<HTMLTableRowElement | null>; onCell: (l: ListingHealth, key: string) => void
}) {
  const bad = rows.filter(r => r.missingMajor.length > 0).length
  return (
    <>
      <tr className="bg-app/40">
        <td colSpan={cols.length + 2} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/70 sticky left-0">
          {building} <span className="font-normal text-muted normal-case tracking-normal">· {rows.length} unit{rows.length === 1 ? '' : 's'}{bad ? ' · ' : ''}{bad ? <span className="text-rose-700 font-semibold">{bad} off a major channel</span> : null}</span>
        </td>
      </tr>
      {rows.map(l => {
        const focus = focusId && l.id === focusId
        return (
          <tr key={l.id} ref={focus ? focusRef : undefined} className={'border-b border-line/60 ' + (focus ? 'bg-amber-50 ring-1 ring-inset ring-amber-300' : '')}>
            <td className="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-white z-10">
              <Link href={'/listings/' + l.id} className="font-semibold text-ink hover:underline">{l.name}</Link>
            </td>
            {cols.map(c => <td key={c.key} className="px-1.5 py-1.5 text-center"><Pill cell={l.cells[c.key]} onClick={() => onCell(l, c.key)} ariaLabel={l.name + ' on ' + c.label + ': ' + VERDICT_LABEL[l.cells[c.key].verdict]} /></td>)}
            <td className="px-2 py-1.5 text-right tabular-nums text-muted">{l.bookings90d}</td>
          </tr>
        )
      })}
    </>
  )
}
