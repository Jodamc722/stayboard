'use client'
// Glitches — the full record of guest-reported problems, open and resolved.
// The Today-in-Ops tab shows what needs eyes NOW; this page is for managing the pattern:
// what's still open regardless of age, what got resolved, and which units keep glitching.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Shell } from '@/components/Shell'
import { GlitchBoard } from '@/components/GlitchBoard'
import { AlertTriangle, RefreshCw, Search } from 'lucide-react'

type Person = { id: number; name: string; departments: string[] }
type Glitch = { id: string; unit: string; market: string; issue: string; rawName: string; status: string; done: boolean; resolvedDate: string | null; scheduledDate: string | null; reportedDate: string | null; ageDays: number | null; running: boolean; unassigned: boolean; assignees: string[]; reportUrl: string | null }
type Data = { ok: boolean; today: string; count: number; unassigned: number; glitches: Glitch[]; error?: string }

function adminUrl(id: string) { return 'https://app.breezeway.io/task/' + id }
function fmtShort(iso: string | null) { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); if (isNaN(d.getTime())) return iso; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) }

export default function GlitchesPage() {
  const [tab, setTab] = useState<'board' | 'history'>('board')
  const [data, setData] = useState<Data | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    try {
      setErr('')
      if (tab === 'board') { setLoading(false); return }
      const r = await fetch('/api/ops-today/glitches?history=1', { cache: 'no-store' })
      const j: Data = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [tab])
  useEffect(() => { setLoading(true); load() }, [load])
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setPeople(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])
  // board glitches (with category + $) power the insights strip on History
  const [board, setBoard] = useState<any>(null)
  useEffect(() => { fetch('/api/glitches', { cache: 'no-store' }).then(r => r.json()).then(setBoard).catch(() => {}) }, [])

  const assign = async (taskId: string, personId: number) => {
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, assigneeIds: [personId] }) })
      const j = await r.json(); if (!r.ok || !j.ok) { setErr(j.error || 'Assign failed'); return }
      load()
    } catch (e: any) { setErr(String(e?.message || e)) }
  }

  const all: Glitch[] = (data && data.glitches) || []
  const rows = useMemo(() => {
    let list = market === 'all' ? all : all.filter(g => g.market === market)
    const needle = q.trim().toLowerCase()
    if (needle) list = list.filter(g => g.unit.toLowerCase().includes(needle) || g.issue.toLowerCase().includes(needle))
    return list
  }, [all, market, q])

  // repeat offenders: units with 2+ glitches in the loaded set (most useful on History)
  const repeats = useMemo(() => {
    const byUnit: Record<string, number> = {}
    for (const g of all) byUnit[g.unit] = (byUnit[g.unit] || 0) + 1
    return Object.keys(byUnit).map(u => ({ unit: u, n: byUnit[u] })).filter(x => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 6)
  }, [all])

  const markets = ['all', 'Miami', 'Broward', 'North', 'Vendor']
  const openCount = all.filter(g => !g.done).length

  return (
    <Shell>
      <header className="mb-5">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted flex items-center gap-1.5"><AlertTriangle size={12} /> Operations</div>
        <h1 className="text-3xl font-bold text-ink mt-1">Glitches</h1>
        <p className="text-sm text-muted mt-1">Every guest-reported problem — what&rsquo;s open, what got resolved, and which units keep having issues. Current ones also show on Today in Ops.</p>
      </header>

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="inline-flex rounded-lg border border-line overflow-hidden divide-x divide-line">
          <button onClick={() => setTab('board')} className={'text-sm font-medium px-3 py-1.5 ' + (tab === 'board' ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')}>Board</button>
          <button onClick={() => setTab('history')} className={'text-sm font-medium px-3 py-1.5 ' + (tab === 'history' ? 'bg-ink text-white' : 'bg-white text-muted hover:bg-app')}>History &amp; insights</button>
        </span>
        {tab === 'board' && <span className="text-xs text-muted">Escalation board &mdash; every Breezeway guest-reported task ever is under History &amp; insights.</span>}
        {tab !== 'board' && (<>
        {markets.map(m => (
          <button key={m} onClick={() => setMarket(m)} className={'text-sm font-medium px-3 py-1.5 rounded-lg border transition ' + (market === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:bg-app')}>{m === 'all' ? 'All markets' : m}</button>
        ))}
        <span className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit or issue…" className="text-sm border border-line rounded-lg pl-7 pr-2 py-1.5 bg-white w-56 focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </span>
        <button onClick={() => { setLoading(true); load() }} className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5"><RefreshCw size={13} /> Refresh</button>
        </>)}
      </div>

      {tab === 'board' && <GlitchBoard />}
      {tab !== 'board' && loading && !data && <div className="text-sm text-muted py-10 text-center">Loading glitches…</div>}
      {err && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{err}</div>}

      {tab !== 'board' && data && (
        <>
          <div className={'rounded-2xl border p-4 mb-4 flex items-center gap-2 flex-wrap ' + (openCount > 0 ? 'border-rose-300 bg-rose-50' : 'border-line bg-white')}>
            <AlertTriangle size={16} className={openCount > 0 ? 'text-rose-700' : 'text-muted'} />
            <span className="font-semibold text-ink">{all.length + ' glitches on record · ' + openCount + ' still open'}</span>
            {(() => {
              const bg: any[] = board && Array.isArray(board.glitches) ? board.glitches : []
              if (!bg.length) return null
              const rec = bg.reduce((s, g) => s + (Number(g.recovery_cost) || 0), 0)
              const ref = bg.reduce((s, g) => s + (Number(g.refund_approved) || 0), 0)
              const byCat: Record<string, number> = {}
              for (const g of bg) if (g.category) byCat[g.category] = (byCat[g.category] || 0) + 1
              const top = Object.keys(byCat).map(k => ({ k, n: byCat[k] })).sort((a, b) => b.n - a.n).slice(0, 3)
              return (
                <span className="text-sm text-muted w-full mt-1 flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-ink">Board:</span>
                  <span>{bg.filter(g => g.status !== 'closed').length} in play</span>
                  {rec > 0 && <span>· ${Math.round(rec).toLocaleString()} recovery cost</span>}
                  {ref > 0 && <span>· ${Math.round(ref).toLocaleString()} refunds approved</span>}
                  {top.length > 0 && <span>· top: {top.map(t => t.k.replace('Maintenance - ', '') + ' ×' + t.n).join(', ')}</span>}
                </span>
              )
            })()}
            {repeats.length > 0 && (
              <span className="text-sm text-muted w-full mt-1">
                Repeat units: {repeats.map((r, i) => <button key={r.unit} onClick={() => setQ(r.unit)} className="underline decoration-dotted hover:text-ink">{r.unit} ×{r.n}{i < repeats.length - 1 ? '' : ''}</button>).reduce((acc: any[], el, i) => acc.concat(i ? [<span key={'s' + i}> · </span>, el] : [el]), [])}
              </span>
            )}
          </div>

          {rows.length === 0 && <div className="text-sm text-muted py-10 text-center">Nothing matches.</div>}
          <div className="space-y-2">
            {rows.map(g => (
              <div key={g.id} className={'rounded-2xl border bg-white px-4 py-3 flex items-center gap-3 ' + (g.done ? 'border-line opacity-80' : g.unassigned ? 'border-rose-200' : 'border-line')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink">{g.issue}</span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 border-line text-muted">{g.unit}</span>
                    <span className="text-[11px] text-muted">{g.market}</span>
                    {g.reportedDate && <span className="text-[11px] text-muted">reported {fmtShort(g.reportedDate)}</span>}
                    {g.done
                      ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">Resolved{g.resolvedDate ? ' ' + fmtShort(g.resolvedDate) : ''}</span>
                      : g.running
                        ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200">In progress</span>
                        : <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border ' + ((g.ageDays || 0) >= 2 ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-200')}>Open{g.ageDays != null && g.ageDays > 0 ? ' · ' + g.ageDays + 'd' : ''}</span>}
                  </div>
                </div>
                {!g.done && <input list="glitch-page-ppl" defaultValue="" placeholder={g.assignees.length ? g.assignees.join(', ') : 'assign…'} onChange={e => { const inp = e.target as HTMLInputElement; const nm = inp.value.trim().replace(/\s*\([^)]*\)\s*$/, ''); const p = people.find(x => x.name === nm); if (p) { inp.value = ''; assign(g.id, p.id) } }} className={'text-xs rounded border px-2 py-1.5 bg-white w-[150px] shrink-0 ' + (g.assignees.length ? 'border-line text-ink placeholder:text-ink' : 'border-rose-300 text-rose-800 placeholder:text-rose-800 font-medium')} />}
                {g.done && g.assignees.length > 0 && <span className="text-xs text-muted shrink-0">{g.assignees.join(', ')}</span>}
                <a href={adminUrl(g.id)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline shrink-0">open</a>
              </div>
            ))}
          </div>
          <datalist id="glitch-page-ppl">
            {people.map(p => <option key={p.id} value={p.name + (p.departments && p.departments.length ? ' (' + p.departments.join('/') + ')' : '')} />)}
          </datalist>
        </>
      )}
    </Shell>
  )
}
