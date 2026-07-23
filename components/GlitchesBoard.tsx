'use client'
// Glitches — guest-reported problems logged in Breezeway. The stuff that's actively hurting a
// guest's stay, so it gets its own tab: most urgent (unassigned + oldest) first.
import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

type Person = { id: number; name: string; departments: string[] }
type Glitch = { id: string; unit: string; market: string; issue: string; rawName: string; status: string; scheduledDate: string; ageDays: number | null; running: boolean; unassigned: boolean; assignees: string[]; reportUrl: string | null }
type Data = { ok: boolean; today: string; count: number; unassigned: number; olderOpen?: number; windowDays?: number; glitches: Glitch[]; error?: string }

function adminUrl(id: string) { return 'https://app.breezeway.io/task/' + id }

export function GlitchesBoard() {
  const [data, setData] = useState<Data | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [market, setMarket] = useState('all')

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/ops-today/glitches', { cache: 'no-store' })
      const j: Data = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => setPeople(Array.isArray(j.people) ? j.people : [])).catch(() => {}) }, [])
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 5 * 60 * 1000); return () => clearInterval(t) }, [load])

  const assign = async (taskId: string, personId: number) => {
    try {
      const r = await fetch('/api/breezeway/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, assigneeIds: [personId] }) })
      const j = await r.json(); if (!r.ok || !j.ok) { setErr(j.error || 'Assign failed'); return }
      load()
    } catch (e: any) { setErr(String(e?.message || e)) }
  }

  if (loading && !data) return <div className="text-sm text-muted py-10 text-center">Loading glitches…</div>
  if (err) return <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</div>
  if (!data) return null

  const markets = ['all', 'Miami', 'Broward', 'North', 'Vendor']
  const rows = market === 'all' ? data.glitches : data.glitches.filter(g => g.market === market)

  const ageCls = (n: number | null) => n == null ? 'bg-app text-muted border-line' : n >= 2 ? 'bg-rose-100 text-rose-800 border-rose-300' : n >= 1 ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-app text-muted border-line'
  const ageText = (n: number | null) => n == null ? '' : n <= 0 ? 'today' : n === 1 ? '1 day' : n + ' days'

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {markets.map(m => (
          <button key={m} onClick={() => setMarket(m)} className={'text-sm font-medium px-3 py-1.5 rounded-lg border transition ' + (market === m ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:bg-app')}>{m === 'all' ? 'All markets' : m}</button>
        ))}
        <button onClick={() => { setLoading(true); load() }} className="ml-auto text-sm font-medium px-3 py-1.5 rounded-lg border border-line bg-white hover:bg-app inline-flex items-center gap-1.5"><RefreshCw size={13} /> Refresh</button>
      </div>

      <div className={'rounded-2xl border p-4 mb-4 flex items-center gap-2 ' + (data.count > 0 ? 'border-rose-300 bg-rose-50' : 'border-line bg-white')}>
        <AlertTriangle size={16} className={data.count > 0 ? 'text-rose-700' : 'text-muted'} />
        <span className="font-semibold text-ink">{data.count} open glitch{data.count === 1 ? '' : 'es'}</span>
        {data.unassigned > 0 && <span className="text-sm font-medium text-rose-700">· {data.unassigned} unassigned</span>}
        <span className="text-sm text-muted">— guest-reported issues in Breezeway (last 14 days)</span>
      </div>

      {rows.length === 0 && <div className="text-sm text-muted py-10 text-center">No open glitches{market === 'all' ? '' : ' in ' + market}. Nice.</div>}
      <div className="space-y-2">
        {rows.map(g => (
          <div key={g.id} className={'rounded-2xl border bg-white px-4 py-3 flex items-center gap-3 ' + (g.unassigned ? 'border-rose-200' : 'border-line')}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-ink">{g.issue}</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 border-line text-muted">{g.unit}</span>
                <span className="text-[11px] text-muted">{g.market}</span>
                {g.ageDays != null && <span className={'text-[10px] font-semibold px-1.5 py-0.5 rounded border ' + ageCls(g.ageDays)}>{ageText(g.ageDays)}</span>}
                {g.running && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200">In progress</span>}
              </div>
            </div>
            <input list="glitch-ppl" defaultValue="" placeholder={g.assignees.length ? g.assignees.join(', ') : 'assign…'} onChange={e => { const inp = e.target as HTMLInputElement; const nm = inp.value.trim().replace(/\s*\([^)]*\)\s*$/, ''); const p = people.find(x => x.name === nm); if (p) { inp.value = ''; assign(g.id, p.id) } }} className={'text-xs rounded border px-1.5 py-1 bg-white w-[132px] shrink-0 ' + (g.assignees.length ? 'border-line text-ink placeholder:text-ink' : 'border-rose-300 text-rose-800 placeholder:text-rose-800 font-medium')} />
            <a href={adminUrl(g.id)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline shrink-0">open</a>
          </div>
        ))}
      </div>
      <datalist id="glitch-ppl">
        {people.map(p => <option key={p.id} value={p.name + (p.departments && p.departments.length ? ' (' + p.departments.join('/') + ')' : '')} />)}
      </datalist>
    </div>
  )
}
