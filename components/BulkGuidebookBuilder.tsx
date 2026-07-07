'use client'
import { useEffect, useState } from 'react'
import { Loader2, Check, AlertTriangle, ArrowRight } from 'lucide-react'

type Listing = { id: string; name: string }
type Bld = { name: string; listings: Listing[] }
type Rec = { name: string; type?: string; blurb?: string; area?: string }
type Res = { id: string; name: string; status: 'pending' | 'running' | 'done' | 'err' | 'skip'; bookId?: string }

const SHARED = [
  { key: 'entry', label: 'Building access & elevator', hint: 'Lobby entry, fob or code, elevator, which floors — the parts every unit shares.' },
  { key: 'parking', label: 'Parking', hint: 'Garage, valet, guest spots, permits.' },
  { key: 'trash', label: 'Trash & disposal', hint: 'Chute floors, bag rules, recycling.' },
  { key: 'quietHours', label: 'Building rules', hint: 'Quiet hours, amenity hours, pool or gym floor.' },
  { key: 'gettingAround', label: 'Getting around', hint: 'Rideshare pickup, transit, walkability.' },
  { key: 'addons', label: 'Add-on services', hint: 'Comma-separated; leave blank to omit.' },
]

export function BulkGuidebookBuilder() {
  const [buildings, setBuildings] = useState<Bld[]>([])
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState('')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [recs, setRecs] = useState<Rec[]>([])
  const [recPick, setRecPick] = useState<Record<number, boolean>>({})
  const [recBusy, setRecBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [results, setResults] = useState<Res[]>([])

  useEffect(() => {
    fetch('/api/guidebook/buildings').then((r) => r.json()).then((d) => setBuildings(Array.isArray(d?.buildings) ? d.buildings : [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const building = buildings.find((b) => b.name === sel)
  const listings = building?.listings || []
  const chosen = listings.filter((l) => picked[l.id])

  function selectBuilding(name: string) {
    setSel(name)
    const b = buildings.find((x) => x.name === name)
    const p: Record<string, boolean> = {}
    ;(b?.listings || []).forEach((l) => { p[l.id] = true })
    setPicked(p); setResults([])
  }

  async function suggestRecs() {
    if (!listings.length) return
    setRecBusy(true)
    try {
      const r = await fetch('/api/guidebook/suggest-recs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingId: listings[0].id }) })
      const d = await r.json(); const list: Rec[] = Array.isArray(d?.recs) ? d.recs : []
      setRecs(list); const pk: Record<number, boolean> = {}; list.forEach((_, i) => { pk[i] = i < 6 }); setRecPick(pk)
    } catch {}
    setRecBusy(false)
  }

  async function generateAll() {
    if (!chosen.length || running) return
    setRunning(true)
    const selectedRecs = recs.filter((_, i) => recPick[i]).map((r) => (r.blurb ? r.name + ' — ' + r.blurb : r.name))
    setResults(chosen.map((l) => ({ id: l.id, name: l.name, status: 'pending' as const })))
    for (const l of chosen) {
      setResults((rs) => rs.map((x) => (x.id === l.id ? { ...x, status: 'running' } : x)))
      try {
        const r = await fetch('/api/guidebook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingId: l.id, answers, theme: 'editorial', tone: 'warm', audience: 'all guests', highlights: '', selectedRecs, force: overwrite }) })
        const d = await r.json().catch(() => ({}))
        const skipped = !!(d?.exists && !d?.id)
        const ok = r.ok && d?.id
        setResults((rs) => rs.map((x) => (x.id === l.id ? { ...x, status: skipped ? 'skip' : (ok ? 'done' : 'err'), bookId: d?.id } : x)))
      } catch {
        setResults((rs) => rs.map((x) => (x.id === l.id ? { ...x, status: 'err' } : x)))
      }
    }
    setRunning(false)
  }

  const doneCount = results.filter((r) => r.status === 'done').length

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-line bg-white p-4">
        <label className="text-xs font-semibold text-ink">1 &middot; Pick a building</label>
        <select value={sel} onChange={(e) => selectBuilding(e.target.value)} className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm">
          <option value="">{loading ? 'Loading buildings…' : 'Select a building…'}</option>
          {buildings.map((b) => (<option key={b.name} value={b.name}>{b.name} ({b.listings.length})</option>))}
        </select>
        {!!listings.length && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{chosen.length} of {listings.length} units selected</span>
              <button type="button" onClick={() => { const all = chosen.length !== listings.length; const p: Record<string, boolean> = {}; listings.forEach((l) => (p[l.id] = all)); setPicked(p) }} className="font-semibold text-neutral-700 hover:underline">{chosen.length === listings.length ? 'Clear all' : 'Select all'}</button>
            </div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-auto">
              {listings.map((l) => (
                <label key={l.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm cursor-pointer hover:bg-app">
                  <input type="checkbox" checked={!!picked[l.id]} onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.checked }))} className="accent-ink" />
                  <span className="truncate">{l.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {!!listings.length && (
        <div className="rounded-2xl border border-line bg-white p-4 space-y-3">
          <label className="text-xs font-semibold text-ink">2 &middot; Building info (applied to every unit)</label>
          {SHARED.map((q) => (
            <div key={q.key}>
              <label className="text-xs font-semibold text-ink">{q.label}</label>
              <textarea rows={2} value={answers[q.key] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} placeholder={q.hint} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </div>
          ))}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-ink">Things to do nearby</label>
              <button type="button" onClick={suggestRecs} disabled={recBusy} className="text-xs font-semibold text-brand-700 hover:underline disabled:opacity-50">{recBusy ? 'Finding…' : (recs.length ? 'Refresh' : 'Suggest spots')}</button>
            </div>
            {recs.length > 0 && (
              <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {recs.map((r, i) => (
                  <label key={i} className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-2 text-sm cursor-pointer hover:bg-app">
                    <input type="checkbox" checked={!!recPick[i]} onChange={(e) => setRecPick((p) => ({ ...p, [i]: e.target.checked }))} className="mt-0.5 accent-ink" />
                    <span className="leading-tight"><span className="font-medium text-ink">{r.name}</span>{r.blurb ? <span className="text-neutral-500"> &mdash; {r.blurb}</span> : null}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted">Wi-Fi, door codes, bedrooms and photos are pulled per unit automatically.</p>
        </div>
      )}

      {!!listings.length && (
        <div className="rounded-2xl border border-line bg-white p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-muted">{running ? ('Generating… ' + doneCount + ' of ' + results.length) : (chosen.length + ' guidebook' + (chosen.length === 1 ? '' : 's') + ' will be created')}</div>
            <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer select-none">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} disabled={running} className="accent-neutral-900" />
              Overwrite existing
            </label>
            <button type="button" onClick={generateAll} disabled={!chosen.length || running} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 text-white px-4 py-2 text-sm font-semibold hover:bg-neutral-700 disabled:opacity-50">
              {running ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              {running ? 'Working…' : 'Generate all'}
            </button>
          </div>
          {results.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {results.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-sm rounded-lg border border-line px-2.5 py-1.5">
                  {r.status === 'done' ? <Check size={14} className="text-emerald-600" /> : r.status === 'running' ? <Loader2 size={14} className="animate-spin text-neutral-400" /> : r.status === 'skip' ? <AlertTriangle size={14} className="text-amber-500" /> : r.status === 'err' ? <AlertTriangle size={14} className="text-rose-500" /> : <span className="h-3.5 w-3.5" />}
                  <span className="flex-1 truncate">{r.name}</span>
                  {r.bookId ? <a href={'/guidebooks/' + r.bookId} className="text-xs font-semibold text-brand-700 hover:underline">Open</a> : r.status === 'skip' ? <span className="text-xs text-amber-600">already has one</span> : r.status === 'err' ? <span className="text-xs text-rose-500">failed</span> : null}
                </div>
              ))}
            </div>
          )}
          {running && <p className="mt-2 text-[11px] text-muted">Keep this tab open — each book takes a moment to write.</p>}
        </div>
      )}
    </div>
  )
}
