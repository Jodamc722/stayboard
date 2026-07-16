'use client'
// Bulk fix - type one correction in plain English and apply it with AI to every
// guidebook in a building (or all books). Runs /api/guidebook/revise per book.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Check, AlertTriangle, Sparkles } from 'lucide-react'

type Building = { name: string; listings: { id: string; name: string }[] }
type Book = { id: string; listing_id: string; listing_name: string }
type RowState = { id: string; name: string; status: 'pending' | 'running' | 'done' | 'error'; msg?: string }

export function BulkFixPanel() {
  const [buildings, setBuildings] = useState<Building[]>([])
  const [books, setBooks] = useState<Book[]>([])
  const [sel, setSel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [rows, setRows] = useState<RowState[]>([])
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/guidebook/buildings').then(r => r.json()).catch(() => ({})),
      fetch('/api/guidebook').then(r => r.json()).catch(() => ({})),
    ]).then((res) => {
      const b: any = res[0]; const g: any = res[1]
      setBuildings(Array.isArray(b?.buildings) ? b.buildings : [])
      setBooks(Array.isArray(g?.guidebooks) ? g.guidebooks : [])
    }).finally(() => setLoading(false))
  }, [])

  const targets = useMemo(() => {
    if (!sel) return [] as { id: string; name: string }[]
    if (sel === '__all__') return books.map(g => ({ id: g.id, name: g.listing_name || g.id }))
    const b = buildings.find(x => x.name === sel)
    if (!b) return [] as { id: string; name: string }[]
    const ids = new Set(b.listings.map(l => l.id))
    return books.filter(g => ids.has(g.listing_id)).map(g => {
      const unit = b.listings.find(l => l.id === g.listing_id)
      return { id: g.id, name: (unit && unit.name) || g.listing_name || g.id }
    })
  }, [sel, buildings, books])

  async function run() {
    const p = prompt.trim()
    if (!p || targets.length === 0 || busy) return
    setBusy(true)
    const st: RowState[] = targets.map(t => ({ id: t.id, name: t.name, status: 'pending' as const }))
    setRows(st.slice())
    let idx = 0
    const worker = async () => {
      while (true) {
        const i = idx; idx = idx + 1
        if (i >= st.length) return
        st[i] = { ...st[i], status: 'running' }; setRows(st.slice())
        try {
          const r = await fetch('/api/guidebook/revise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: st[i].id, prompt: p }) })
          const j: any = await r.json().catch(() => ({}))
          st[i] = r.ok && j?.ok ? { ...st[i], status: 'done' } : { ...st[i], status: 'error', msg: String(j?.error || ('HTTP ' + r.status)).slice(0, 90) }
        } catch (e: any) {
          st[i] = { ...st[i], status: 'error', msg: String(e?.message || e).slice(0, 90) }
        }
        setRows(st.slice())
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setBusy(false)
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-white p-4">
        <label className="text-xs font-semibold text-ink">1 &middot; Which guidebooks?</label>
        <select value={sel} onChange={e => { setSel(e.target.value); setRows([]) }} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm">
          <option value="">{loading ? 'Loading...' : 'Pick a building...'}</option>
          <option value="__all__">All guidebooks ({books.length})</option>
          {buildings.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
        </select>
        {sel ? <p className="mt-2 text-xs text-muted">{targets.length} guidebook{targets.length === 1 ? '' : 's'} will be updated.</p> : null}
      </div>
      <div className="rounded-2xl border border-line bg-white p-4">
        <label className="text-xs font-semibold text-ink">2 &middot; What needs fixing?</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} placeholder="e.g. There are no key fobs - building and elevator access is by door code only. Remove every fob mention." className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        <p className="mt-1.5 text-[11px] text-muted">Plain English. State the correct fact - the AI rewrites whatever contradicts it in every book, and touches nothing else.</p>
        <button onClick={run} disabled={busy || !prompt.trim() || targets.length === 0} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-neutral-900 text-white px-3.5 py-2 text-sm font-semibold hover:bg-neutral-700 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {busy ? 'Fixing...' : 'Fix ' + targets.length + ' guidebook' + (targets.length === 1 ? '' : 's')}
        </button>
      </div>
      {rows.length > 0 ? (
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="text-xs font-semibold text-ink mb-2">Progress: {rows.filter(r => r.status === 'done').length}/{rows.length} done{rows.some(r => r.status === 'error') ? ' - ' + rows.filter(r => r.status === 'error').length + ' failed' : ''}</div>
          <div className="space-y-1 max-h-72 overflow-auto">
            {rows.map(r => (
              <div key={r.id} className="flex items-center gap-2 text-sm rounded-lg border border-line px-2.5 py-1.5">
                {r.status === 'done' ? <Check size={14} className="text-emerald-600" /> : r.status === 'error' ? <AlertTriangle size={14} className="text-rose-600" /> : r.status === 'running' ? <Loader2 size={14} className="animate-spin text-neutral-500" /> : <span className="w-3.5" />}
                <span className="truncate flex-1">{r.name}</span>
                {r.status === 'error' ? <span className="text-[11px] text-rose-600 truncate max-w-[220px]">{r.msg}</span> : null}
                {r.status === 'done' ? <a href={'/guidebooks/' + r.id} target="_blank" className="text-[11px] font-semibold text-neutral-500 hover:underline">Open</a> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
