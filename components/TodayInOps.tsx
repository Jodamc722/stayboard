'use client'
// Today in Ops — live view of everything happening in the field right now, by market.
import { useEffect, useState, useCallback } from 'react'
import { Sparkles, RefreshCw, AlertTriangle } from 'lucide-react'

type Task = { id: string; unit: string; market: string; dept: string; name: string; status: string; assignees: string[]; startedAt: string | null; finishedAt: string | null; minutes: number | null; reportUrl: string | null }
type Qc = { unit: string; market: string; issue: string; dept: string | null; status: string; reportUrl: string | null; createdAt: string | null }
type MarketRow = { market: string; total: number; cleans: number; cleansDone: number; cleansRunning: number; maintenance: number; inspection: number; unassigned: number }
type Data = { ok: boolean; today: string; totals: any; byMarket: MarketRow[]; tasks: Task[]; qc: Qc[]; error?: string }

const DEPTS: { key: string; label: string }[] = [
  { key: 'housekeeping', label: 'Departure cleans' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'inspection', label: 'Inspections' },
  { key: 'other', label: 'Other' },
]
function hhmm(iso: string | null) { if (!iso) return ''; const d = new Date(iso); if (isNaN(d.getTime())) return ''; return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) }
function statusChip(s: string) {
  if (/complete|finish/.test(s)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (/progress|started/.test(s)) return 'bg-sky-50 text-sky-700 border-sky-200'
  return 'bg-app text-muted border-line'
}
function statusLabel(s: string) { if (/complete|finish/.test(s)) return 'Done'; if (/progress|started/.test(s)) return 'In progress'; return 'Not started' }

export function TodayInOps() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/ops-today', { cache: 'no-store' })
      const j: Data = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5 * 60 * 1000); return () => clearInterval(t) }, [load])

  if (loading && !data) return <div className="text-sm text-muted py-10 text-center">Loading today&rsquo;s operations&hellip;</div>
  if (err) return <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>
  if (!data) return null

  const tasks = market === 'all' ? data.tasks : data.tasks.filter(t => t.market === market)
  const qc = market === 'all' ? data.qc : data.qc.filter(q => q.market === market)
  const markets = ['all'].concat(data.byMarket.map(m => m.market))
  const cleans = tasks.filter(t => t.dept === 'housekeeping')
  const cleansDone = cleans.filter(t => /complete|finish/.test(t.status)).length
  const unassigned = tasks.filter(t => t.assignees.length === 0 && !/complete|finish/.test(t.status))

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {markets.map(m => (
          <button key={m} onClick={() => setMarket(m)} className={'text-sm font-medium px-3 py-1.5 rounded-lg border transition ' + (market === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:bg-app')}>{m === 'all' ? 'All markets' : m}</button>
        ))}
        <button onClick={() => { setLoading(true); load() }} className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5"><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
        <Stat label="Cleans today" value={cleans.length + ''} sub={cleansDone + ' done'} />
        <Stat label="In progress" value={cleans.filter(t => /progress|started/.test(t.status)).length + ''} />
        <Stat label="Maintenance" value={tasks.filter(t => t.dept === 'maintenance').length + ''} />
        <Stat label="Inspections" value={tasks.filter(t => t.dept === 'inspection').length + ''} />
        <Stat label="Unassigned" value={unassigned.length + ''} warn={unassigned.length > 0} />
      </div>

      {qc.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-5">
          <div className="flex items-center gap-1.5 mb-2 text-amber-800 font-semibold text-sm"><AlertTriangle size={14} /> Needs attention &middot; {qc.length} open QC</div>
          <div className="space-y-1">
            {qc.slice(0, 8).map((q, i) => (
              <div key={i} className="text-[13px] text-amber-900 flex items-center gap-2">
                <span className="font-medium">{q.unit}</span>
                <span className="text-amber-700">{q.issue}</span>
                {q.reportUrl && <a href={q.reportUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted">open</a>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tasks.length === 0 && <div className="text-sm text-muted py-10 text-center">Nothing scheduled in Breezeway for today.</div>}

      <div className="space-y-5">
        {DEPTS.map(dp => {
          const rows = tasks.filter(t => t.dept === dp.key)
          if (rows.length === 0) return null
          return (
            <div key={dp.key}>
              <div className="flex items-baseline gap-2 mb-2">
                <h2 className="text-sm font-bold text-ink">{dp.label}</h2>
                <span className="text-xs text-muted">{rows.length}</span>
              </div>
              <div className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
                {rows.map(t => (
                  <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-ink truncate">{t.unit}</div>
                      <div className="text-xs text-muted truncate">{t.name}{t.market ? ' · ' + t.market : ''}</div>
                    </div>
                    <div className="text-xs text-muted shrink-0 hidden sm:block">{t.assignees.length ? t.assignees.join(', ') : <span className="text-amber-700 font-medium">Unassigned</span>}</div>
                    <div className="text-[11px] text-muted shrink-0 w-20 text-right hidden md:block">{t.finishedAt ? hhmm(t.finishedAt) : t.startedAt ? hhmm(t.startedAt) : ''}</div>
                    <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ' + statusChip(t.status)}>{statusLabel(t.status)}</span>
                    {t.reportUrl && <a href={t.reportUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 hover:underline shrink-0">open</a>}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={'rounded-2xl border p-3 ' + (warn ? 'border-amber-200 bg-amber-50' : 'border-line bg-white')}>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={'text-2xl font-bold ' + (warn ? 'text-amber-800' : 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}
