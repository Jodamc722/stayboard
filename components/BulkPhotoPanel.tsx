'use client'
// Bulk "organize photos by room" for a building. For each selected unit it runs the AI photo
// categoriser (/api/optimize-photos), then builds a new order = the first 5 photos UNCHANGED
// followed by the remaining photos grouped by room type. Nothing is written to Guesty until you
// approve; pushing sends the new order via /api/photo-order (reorder only, captions untouched).
import { useState } from 'react'
import { Images, RefreshCw, Check, X, Lock, UploadCloud, AlertTriangle, Wand2 } from 'lucide-react'

type Unit = { id: string; name: string }
type Photo = { _id: string; url: string; category?: string }
type Plan = { name: string; photos: Photo[]; order: string[]; changed: boolean; pushed?: boolean; error?: string }

const ROOM_RANK: Record<string, number> = {
  living: 0, 'living area': 0, 'living room': 0, lounge: 0,
  dining: 1, 'dining area': 1,
  kitchen: 2, kitchenette: 2,
  bedroom: 3, bed: 3,
  bathroom: 4, bath: 4,
  balcony: 5, patio: 5, outdoor: 5, terrace: 5, view: 5,
  pool: 6, gym: 6, amenity: 6, amenities: 6, common: 6,
  exterior: 7, building: 7, entrance: 7, lobby: 7,
  other: 9,
}
const rankOf = (c?: string) => ROOM_RANK[String(c || 'other').toLowerCase()] ?? 9

export function BulkPhotoPanel({ units }: { units: Unit[] }) {
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set(units.map(u => u.id)))
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [plans, setPlans] = useState<Record<string, Plan>>({})
  const [pushing, setPushing] = useState<Set<string>>(new Set())

  const toggleU = (id: string) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  function buildOrder(photos: Photo[]): string[] {
    const first = photos.slice(0, 5)
    const rest = photos.slice(5).map((p, i) => ({ p, i }))
      .sort((a, b) => rankOf(a.p.category) - rankOf(b.p.category) || a.i - b.i)
      .map(x => x.p)
    return [...first, ...rest].map(p => p._id)
  }

  async function analyze() {
    const ids = units.filter(u => sel.has(u.id))
    if (!ids.length) return
    setRunning(true); setPlans({})
    const next: Record<string, Plan> = {}
    for (let i = 0; i < ids.length; i++) {
      const u = ids[i]
      setProgress('Analysing ' + u.name + ' — ' + (i + 1) + ' of ' + ids.length)
      try {
        const r = await fetch('/api/optimize-photos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: u.id }) })
        const j = await r.json().catch(() => null)
        if (!r.ok || !j) throw new Error((j && j.error) || ('HTTP ' + r.status))
        const photos: Photo[] = Array.isArray(j.photos) ? j.photos.map((p: any) => ({ _id: String(p._id), url: String(p.url || ''), category: p.category })) : []
        if (photos.length < 2) {
          next[u.id] = { name: u.name, photos, order: photos.map(p => p._id), changed: false, error: 'fewer than 2 photos' }
        } else {
          const order = buildOrder(photos)
          const ordered = order.map(id => photos.find(p => p._id === id)!).filter(Boolean)
          const changed = order.some((id, idx) => id !== photos[idx]?._id)
          next[u.id] = { name: u.name, photos: ordered, order, changed }
        }
      } catch (e: any) {
        next[u.id] = { name: u.name, photos: [], order: [], changed: false, error: e?.message || String(e) }
      }
      setPlans({ ...next })
    }
    setProgress(''); setRunning(false)
  }

  async function push(id: string) {
    const plan = plans[id]
    if (!plan || plan.order.length === 0) return
    setPushing(p => new Set(p).add(id))
    try {
      const r = await fetch('/api/photo-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: id, order: plan.order }) })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j) throw new Error((j && j.error) || ('HTTP ' + r.status))
      setPlans(prev => ({ ...prev, [id]: { ...prev[id], pushed: true, error: undefined } }))
    } catch (e: any) {
      setPlans(prev => ({ ...prev, [id]: { ...prev[id], error: e?.message || String(e) } }))
    } finally {
      setPushing(p => { const n = new Set(p); n.delete(id); return n })
    }
  }

  async function pushAll() {
    for (const id of Object.keys(plans)) {
      const pl = plans[id]
      if (pl.changed && !pl.pushed && !pl.error) await push(id)
    }
  }

  const planList = Object.entries(plans)
  const pushable = planList.filter(([, p]) => p.changed && !p.pushed && !p.error).length

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg border border-brand-200 text-brand-700 bg-brand-50 px-3 py-2 hover:bg-brand-100">
        <Images size={14} /> Organize photos by room
      </button>
    )
  }

  return (
    <section className="rounded-2xl border border-brand-200 bg-white p-4 mb-5 w-full">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><Images size={14} className="text-brand-600" /> Organize photos by room</h2>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X size={16} /></button>
      </div>
      <p className="text-[12px] text-muted mb-3">Groups each unit's photos by room type. The first 5 photos always stay exactly as they are. Nothing changes on Guesty until you push.</p>

      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">Units <span className="text-brand-700">· {sel.size}/{units.length}</span></div>
        <div className="flex gap-2 text-[11px]">
          <button onClick={() => setSel(new Set(units.map(u => u.id)))} className="text-brand-700 hover:underline">All</button>
          <button onClick={() => setSel(new Set())} className="text-muted hover:underline">None</button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-3 max-h-40 overflow-y-auto">
        {units.map(u => { const on = sel.has(u.id); return (
          <button key={u.id} onClick={() => toggleU(u.id)} className={'text-left text-[12px] px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-2 ' + (on ? 'bg-app border-line text-ink' : 'bg-white border-line text-muted')}>
            {on ? <Check size={12} className="text-brand-600 shrink-0" /> : <span className="w-3 shrink-0" />}
            <span className="truncate">{u.name}</span>
          </button>
        )})}
      </div>

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-line mb-3">
        <button onClick={analyze} disabled={running || sel.size === 0} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-brand-600 text-white px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
          {running ? <RefreshCw size={14} className="animate-spin" /> : <Wand2 size={14} />} {running ? 'Analysing…' : 'Analyze photos'}
        </button>
        {pushable > 0 && !running && (
          <button onClick={pushAll} className="inline-flex items-center gap-1.5 text-[13px] font-semibold rounded-lg bg-emerald-600 text-white px-3 py-2 hover:bg-emerald-700">
            <UploadCloud size={14} /> Push all ({pushable}) to Guesty
          </button>
        )}
        {progress && <span className="text-[12px] text-muted">{progress}</span>}
      </div>

      {planList.length > 0 && (
        <div className="space-y-3 max-h-[28rem] overflow-y-auto">
          {planList.map(([id, p]) => (
            <div key={id} className="border border-line rounded-xl p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[12px] font-semibold text-ink truncate">{p.name}</span>
                {p.error ? <span className="text-[11px] text-rose-600 inline-flex items-center gap-1 shrink-0" title={p.error}><AlertTriangle size={12} /> {p.error.slice(0, 40)}</span>
                  : p.pushed ? <span className="text-[11px] text-emerald-700 inline-flex items-center gap-1 shrink-0"><Check size={12} /> Pushed to Guesty</span>
                  : !p.changed ? <span className="text-[11px] text-muted shrink-0">Already grouped</span>
                  : <button onClick={() => push(id)} disabled={pushing.has(id)} className="text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md px-2 py-1 inline-flex items-center gap-1 disabled:opacity-50">{pushing.has(id) ? <RefreshCw size={11} className="animate-spin" /> : <UploadCloud size={11} />} Push</button>}
              </div>
              {p.photos.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {p.photos.map((ph, idx) => (
                    <div key={ph._id} className="relative shrink-0">
                      <img src={ph.url} alt="" className="w-16 h-16 object-cover rounded-md border border-line" />
                      {idx < 5 && <span className="absolute top-0.5 left-0.5 bg-black/60 text-white rounded px-1 text-[8px] inline-flex items-center gap-0.5"><Lock size={7} /> {idx + 1}</span>}
                      {idx >= 5 && ph.category && <span className="absolute bottom-0.5 left-0.5 right-0.5 bg-black/55 text-white rounded px-1 text-[8px] truncate text-center">{ph.category}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
