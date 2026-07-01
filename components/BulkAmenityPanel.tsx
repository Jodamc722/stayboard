'use client'
// Bulk amenity add for a building: pick amenities, pick which units, apply to all selected at
// once. The amenity catalog is the union of amenities already in use across the building's units
// (so every value is a valid Guesty amenity). Writes to Guesty after you confirm.
import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, Sparkles, AlertTriangle, RefreshCw, Search, X } from 'lucide-react'

type Unit = { id: string; name: string; amenityCount: number ; amenities?: string[] }
type Res = { id: string; name: string; ok: boolean; added: number; total: number; error?: string }

export function BulkAmenityPanel({ units, addable }: { units: Unit[]; addable: string[] }) {
  const [openPanel, setOpenPanel] = useState(false)
  const [amen, setAmen] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<Set<string>>(new Set(units.map(u => u.id)))
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [results, setResults] = useState<Res[] | null>(null)
  const [extra, setExtra] = useState<string[]>([])  // full Guesty supported-amenities catalog

  useEffect(() => {
    let alive = true
    fetch('/api/amenities-catalog').then(r => r.json()).then(d => { if (alive && Array.isArray(d?.names)) setExtra(d.names) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const allAddable = useMemo(() => Array.from(new Set([...addable, ...extra])).sort((a, b) => a.localeCompare(b)), [addable, extra])
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [rem, setRem] = useState<Set<string>>(new Set())
  const appliedList = useMemo(() => { const m = new Map<string, number>(); for (const u of units) { if (!sel.has(u.id)) continue; const seen = new Set<string>(); for (const a of (((u as any).amenities as string[]) || [])) { const s = String(a).trim(); if (!s) continue; const k = s.toLowerCase(); if (seen.has(k)) continue; seen.add(k); m.set(s, (m.get(s) || 0) + 1) } } return Array.from(m.entries()).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])) }, [units, sel])
  const toggleR = (a: string) => setRem(p => { const n = new Set(p); n.has(a) ? n.delete(a) : n.add(a); return n })

  const toggleA = (a: string) => setAmen(s => { const n = new Set(s); n.has(a) ? n.delete(a) : n.add(a); return n })
  const toggleU = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const filtered = q.trim() ? allAddable.filter(a => a.toLowerCase().includes(q.toLowerCase())) : allAddable
  const canApply = amen.size > 0 && sel.size > 0

  async function apply() {
    setBusy(true); setErr(null); setResults(null)
    try {
      const res = await fetch('/api/bulk-amenities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingIds: Array.from(sel), add: mode === 'add' ? Array.from(amen) : [], remove: mode === 'remove' ? Array.from(rem) : [] }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setResults(d.results || [])
      setConfirming(false)
    } catch (e: any) { setErr(e?.message || String(e)) }
    finally { setBusy(false) }
  }

  if (!openPanel) {
    return (
      <button onClick={() => setOpenPanel(true)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg border border-brand-200 text-brand-700 bg-brand-50 px-3 py-2 hover:bg-brand-100">
        <Sparkles size={14} /> Bulk amenities
      </button>
    )
  }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white p-4 mb-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><Sparkles size={14} className="text-brand-600" /> Bulk amenities</h2>
        <button onClick={() => setOpenPanel(false)} className="text-muted hover:text-ink"><X size={16} /></button>
      </div>

      {!results && (
        <div className="flex gap-1 mb-3 text-[12px]">
          <button onClick={() => setMode('add')} className={mode === 'add' ? 'px-2.5 py-1 rounded-lg border font-semibold bg-brand-600 text-white border-brand-600' : 'px-2.5 py-1 rounded-lg border font-semibold bg-white text-brand-700 border-brand-200'}>Add</button>
          <button onClick={() => setMode('remove')} className={mode === 'remove' ? 'px-2.5 py-1 rounded-lg border font-semibold bg-rose-600 text-white border-rose-600' : 'px-2.5 py-1 rounded-lg border font-semibold bg-white text-rose-700 border-rose-200'}>Remove</button>
        </div>
      )}
      {results ? (
        <div>
          <div className="text-[13px] font-semibold text-ink mb-2">Done — {results.filter(r => r.ok).length}/{results.length} units updated.</div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {results.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-[12px] border border-line rounded-lg px-2.5 py-1.5">
                <span className="text-ink truncate">{r.name}</span>
                {r.ok ? <span className="text-emerald-700 inline-flex items-center gap-1 shrink-0"><Check size={12} /> +{r.added} ({r.total} total)</span>
                  : <span className="text-rose-600 inline-flex items-center gap-1 shrink-0" title={r.error}><AlertTriangle size={12} /> failed</span>}
              </div>
            ))}
          </div>
          <button onClick={() => location.reload()} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 underline underline-offset-2"><RefreshCw size={12} /> Refresh scores</button>
        </div>
      ) : (
        <>
          {mode === 'add' ? (<>
          {/* amenity picker */}
          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">1. Amenities to add {amen.size > 0 && <span className="text-brand-700">· {amen.size} selected</span>}</div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search amenities…" className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-lg border border-line bg-app focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </div>
          <div className="flex flex-wrap gap-1.5 mb-4 max-h-40 overflow-y-auto">
            {filtered.length === 0 && <span className="text-[12px] text-muted italic">No amenities in this building's catalog.</span>}
            {filtered.map(a => {
              const on = amen.has(a)
              return (
                <button key={a} onClick={() => toggleA(a)} className={`text-[12px] px-2 py-1 rounded-lg inline-flex items-center gap-1 border transition-colors ${on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-brand-700 border-brand-200 hover:bg-brand-50'}`}>
                  {on ? <Check size={11} /> : <Plus size={11} />} {a}
                </button>
              )
            })}
          </div>

          </>) : (
            <div className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1.5">Amenities on the selected units — tap to remove</div>
              {appliedList.length === 0 ? <div className="text-[12px] text-muted">No amenities found on the selected units.</div> : (
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                  {appliedList.map(([a, cnt]) => { const on = rem.has(a); return (
                    <button key={a} onClick={() => toggleR(a)} className={on ? 'text-[12px] px-2 py-1 rounded-lg inline-flex items-center gap-1 border bg-rose-600 text-white border-rose-600' : 'text-[12px] px-2 py-1 rounded-lg inline-flex items-center gap-1 border bg-white text-rose-700 border-rose-200 hover:bg-rose-50'}>
                      {on ? <X size={11} /> : null} {a} <span className={on ? 'text-[10px] text-white/80' : 'text-[10px] text-muted'}>· {cnt}/{sel.size}</span>
                    </button>
                  )})}
                </div>
              )}
            </div>
          )}
          {/* unit selector */}
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">2. Apply to units <span className="text-brand-700">· {sel.size}/{units.length}</span></div>
            <div className="flex gap-2 text-[11px]">
              <button onClick={() => setSel(new Set(units.map(u => u.id)))} className="text-brand-700 hover:underline">All</button>
              <button onClick={() => setSel(new Set())} className="text-muted hover:underline">None</button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-4 max-h-48 overflow-y-auto">
            {units.map(u => {
              const on = sel.has(u.id)
              return (
                <button key={u.id} onClick={() => toggleU(u.id)} className={`text-left text-[12px] px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-2 ${on ? 'bg-app border-line text-ink' : 'bg-white border-line text-muted'}`}>
                  <span className={`w-4 h-4 rounded border inline-flex items-center justify-center shrink-0 ${on ? 'bg-brand-600 border-brand-600 text-white' : 'border-line'}`}>{on && <Check size={11} />}</span>
                  <span className="truncate">{u.name}</span>
                  <span className="ml-auto text-[10px] text-muted shrink-0">{u.amenityCount}</span>
                </button>
              )
            })}
          </div>

          {err && <div className="text-[12px] text-rose-600 mb-2 inline-flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {err}</div>}

          <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-line">
            {!confirming ? (
              <button onClick={() => setConfirming(true)} disabled={mode === 'add' ? !canApply : (rem.size === 0 || sel.size === 0)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
                Review & apply to Guesty
              </button>
            ) : (
              <>
                <span className="text-[12px] text-ink">{mode === 'add' ? <>Add <b>{amen.size}</b> amenit{amen.size === 1 ? 'y' : 'ies'} to <b>{sel.size}</b> unit{sel.size === 1 ? '' : 's'} on Guesty?</> : <>Remove <b>{rem.size}</b> amenit{rem.size === 1 ? 'y' : 'ies'} from <b>{sel.size}</b> unit{sel.size === 1 ? '' : 's'} on Guesty?</>}</span>
                <button onClick={apply} disabled={busy} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700 disabled:opacity-50">{busy ? 'Applying…' : 'Yes, apply'}</button>
                <button onClick={() => setConfirming(false)} disabled={busy} className="text-[12px] text-muted hover:text-ink">Cancel</button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  )
}
