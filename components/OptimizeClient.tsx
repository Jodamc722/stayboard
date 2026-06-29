'use client'
import { useMemo, useState } from 'react'
import {
  Search, Sparkles, Wand2, Building2, BedDouble, Bath, Users,
  AlertTriangle, Info, UploadCloud, Check, RotateCcw,
} from 'lucide-react'

type Listing = {
  id: string
  title: string | null
  nickname: string | null
  building: string | null
  unit: string | null
  room_type: string | null
  address_city: string | null
  bedrooms: number | null
  bathrooms: number | null
  max_occupancy: number | null
  amenities: any
  status: string | null
}

type Content = { title: string; summary: string; space: string; access: string; neighborhood: string; transit: string; notes: string }
type Result = {
  listingId: string
  titleMax: number
  sections: { key: string; label: string }[]
  current: Content
  proposed: Content
  rationale: string
  warnings: string[]
}

const FIELDS: { key: keyof Content; label: string; rows: number }[] = [
  { key: 'title', label: 'Title', rows: 2 },
  { key: 'summary', label: 'Summary', rows: 5 },
  { key: 'space', label: 'The space', rows: 6 },
  { key: 'access', label: 'Guest access', rows: 4 },
  { key: 'neighborhood', label: 'Neighborhood', rows: 5 },
  { key: 'transit', label: 'Getting around', rows: 4 },
  { key: 'notes', label: 'Other notes', rows: 4 },
]

function nameOf(l: Listing) {
  return l.title || l.nickname || l.building || l.unit || 'Untitled listing'
}

export function OptimizeClient({ listings }: { listings: Listing[] }) {
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [edited, setEdited] = useState<Content | null>(null)
  const [include, setInclude] = useState<Record<string, boolean>>({})
  const [pushedMsg, setPushedMsg] = useState<string | null>(null)

  const selected = useMemo(() => listings.find(l => l.id === selectedId) || null, [listings, selectedId])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return listings.slice(0, 200)
    return listings.filter(l =>
      nameOf(l).toLowerCase().includes(s) ||
      (l.building || '').toLowerCase().includes(s) ||
      (l.unit || '').toLowerCase().includes(s) ||
      (l.address_city || '').toLowerCase().includes(s)
    ).slice(0, 200)
  }, [listings, q])

  function pick(l: Listing) {
    setSelectedId(l.id); setResult(null); setEdited(null); setInclude({}); setError(null); setPushedMsg(null)
  }

  async function generate() {
    if (!selected || busy) return
    setBusy(true); setError(null); setResult(null); setEdited(null); setPushedMsg(null)
    try {
      const res = await fetch('/api/optimize-listing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: selected.id }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      const r = d as Result
      setResult(r)
      setEdited({ ...r.proposed })
      const inc: Record<string, boolean> = {}
      for (const f of FIELDS) inc[f.key] = !!(r.proposed as any)[f.key]?.trim()
      setInclude(inc)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  function setField(k: keyof Content, v: string) {
    setEdited(prev => prev ? { ...prev, [k]: v } : prev); setPushedMsg(null)
  }
  function resetField(k: keyof Content) {
    if (result) setField(k, (result.proposed as any)[k] || '')
  }
  function toggle(k: string) { setInclude(p => ({ ...p, [k]: !p[k] })); setPushedMsg(null) }

  const approvedCount = FIELDS.filter(f => include[f.key] && (edited as any)?.[f.key]?.trim()).length

  async function pushApproved() {
    if (!selected || !edited || pushing || approvedCount === 0) return
    const titleApproved = include.title && edited.title.trim()
    if (titleApproved && edited.title.trim().length > (result?.titleMax || 50)) {
      setError(`Title is over the ${result?.titleMax || 50}-char limit. Trim it before pushing.`); return
    }
    const sections: Record<string, string> = {}
    for (const f of FIELDS) {
      if (f.key === 'title') continue
      if (include[f.key] && (edited as any)[f.key]?.trim()) sections[f.key] = (edited as any)[f.key].trim()
    }
    const ok = window.confirm(`Push ${approvedCount} approved field(s) to Guesty for "${nameOf(selected)}"? This updates the live listing on every connected channel.`)
    if (!ok) return
    setPushing(true); setError(null); setPushedMsg(null)
    try {
      const res = await fetch('/api/listing-content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: selected.id, title: titleApproved ? edited.title.trim() : undefined, publicDescription: sections }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      const parts = [d.pushed?.title ? 'title' : null, ...(d.pushed?.sections || [])].filter(Boolean)
      setPushedMsg(`Pushed to Guesty: ${parts.join(', ')}.`)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
      {/* Listing picker */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden flex flex-col max-h-[78vh]">
        <div className="px-3 py-3 border-b border-line">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search listings…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-white text-sm focus:outline-none focus:border-brand-500" />
          </div>
          <div className="text-[11px] text-muted mt-2">{filtered.length} of {listings.length} active</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted">No listings match.</div>
          ) : filtered.map(l => {
            const active = l.id === selectedId
            return (
              <button key={l.id} onClick={() => pick(l)}
                className={`w-full text-left px-4 py-2.5 border-b border-line last:border-0 transition-colors ${active ? 'bg-brand-50' : 'hover:bg-app'}`}>
                <div className={`text-sm font-medium truncate ${active ? 'text-brand-700' : 'text-ink'}`}>{nameOf(l)}</div>
                <div className="text-[11px] text-muted truncate">
                  {l.building || 'Unassigned'}{l.unit ? ` · ${l.unit}` : ''}{l.address_city ? ` · ${l.address_city}` : ''}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Editor */}
      <div className="min-w-0">
        {!selected ? (
          <div className="rounded-2xl border border-line bg-white px-6 py-20 text-center">
            <span className="inline-flex w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 items-center justify-center text-white shadow-soft"><Wand2 size={22} /></span>
            <h3 className="mt-4 text-lg font-bold text-ink tracking-tight">Pick a listing to optimize</h3>
            <p className="mt-1.5 text-sm text-muted max-w-md mx-auto">Choose any active listing, then generate. I&apos;ll rewrite the title and all six Guesty sections from the listing&apos;s real data — you approve each one before it pushes to Guesty.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Header card */}
            <div className="rounded-2xl border border-line bg-white p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Optimizing</div>
                  <div className="text-lg font-bold text-ink mt-0.5 break-words">{nameOf(selected)}</div>
                  <div className="text-[12px] text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1"><Building2 size={12} />{selected.building || 'Unassigned'}{selected.unit ? ` · ${selected.unit}` : ''}</span>
                    {selected.bedrooms != null && <span className="inline-flex items-center gap-1"><BedDouble size={12} />{selected.bedrooms} bd</span>}
                    {selected.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath size={12} />{selected.bathrooms} ba</span>}
                    {selected.max_occupancy != null && <span className="inline-flex items-center gap-1"><Users size={12} />sleeps {selected.max_occupancy}</span>}
                  </div>
                  <a href={`https://app.guesty.com/properties/${selected.id}/property/v2`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-600 hover:text-brand-700">Open property in Guesty ↗</a>
                </div>
                <button onClick={generate} disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex-shrink-0">
                  {busy ? <Sparkles size={15} className="animate-pulse" /> : <Wand2 size={15} />}
                  {busy ? 'Generating…' : result ? 'Regenerate' : 'Generate with AI'}
                </button>
              </div>
              <p className="text-[12px] text-muted mt-3 flex items-start gap-1.5 max-w-2xl">
                <Info size={13} className="mt-0.5 flex-shrink-0" /> This writes Guesty&apos;s master content (title + the six description sections), which syncs to Airbnb, Vrbo, Expedia and Booking.com. Written to Airbnb&apos;s stricter standard. Nothing pushes until you approve.
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2">
                <AlertTriangle size={14} /> {error}
              </div>
            )}
            {busy && !result && (
              <div className="rounded-2xl border border-line bg-white px-4 py-12 text-center text-sm text-muted">Writing fresh copy from this listing&apos;s real data…</div>
            )}

            {result && edited && (
              <>
                {result.warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800">
                    <div className="font-semibold flex items-center gap-1.5 mb-1"><AlertTriangle size={14} /> Before you push</div>
                    <ul className="space-y-0.5">{result.warnings.map((w, i) => <li key={i} className="flex items-start gap-1.5"><span className="mt-0.5">•</span> {w}</li>)}</ul>
                  </div>
                )}

                {FIELDS.map(f => {
                  const cur = (result.current as any)[f.key] || ''
                  const val = (edited as any)[f.key] || ''
                  const isTitle = f.key === 'title'
                  const over = isTitle && val.length > result.titleMax
                  const on = !!include[f.key]
                  return (
                    <div key={f.key} className={`rounded-2xl border bg-white p-4 ${on ? 'border-brand-200' : 'border-line'}`}>
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                          <input type="checkbox" checked={on} onChange={() => toggle(f.key)} className="accent-brand-600 w-4 h-4" />
                          <span className="text-sm font-semibold text-ink">{f.label}</span>
                          <span className="text-[11px] text-muted">{on ? 'will push' : 'skipped'}</span>
                        </label>
                        <button onClick={() => resetField(f.key)} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-brand-700">
                          <RotateCcw size={11} /> reset to AI
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">Current</div>
                          <div className="text-[13px] text-muted whitespace-pre-wrap leading-relaxed rounded-lg bg-app border border-line px-3 py-2 min-h-[44px]">{cur || <span className="italic">empty</span>}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-brand-700 font-semibold mb-1 flex items-center gap-1"><Sparkles size={10} /> Proposed (editable)</div>
                          <textarea value={val} onChange={e => setField(f.key, e.target.value)} rows={f.rows}
                            className={`w-full text-[13px] text-ink leading-relaxed rounded-lg border px-3 py-2 focus:outline-none ${over ? 'border-rose-300 focus:border-rose-500' : 'border-line focus:border-brand-500'}`} />
                          <div className={`text-[11px] mt-1 ${over ? 'text-rose-600 font-semibold' : 'text-muted'}`}>
                            {val.length}{isTitle ? ` / ${result.titleMax}` : ''} chars{over ? ' · over limit' : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                )
                })}

                {result.rationale && (
                  <div className="rounded-xl border border-line bg-app/50 px-4 py-3 text-[12px] text-muted">
                    <span className="font-semibold text-ink">Why this converts better: </span>{result.rationale}
                  </div>
                )}

                {pushedMsg && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2">
                    <Check size={14} /> {pushedMsg}
                  </div>
                )}

                <div className="sticky bottom-0 bg-gradient-to-t from-app via-app to-transparent pt-3 pb-1">
                  <div className="rounded-2xl border border-line bg-white px-4 py-3 flex items-center justify-between gap-3 shadow-soft">
                    <div className="text-[13px] text-muted">{approvedCount} of {FIELDS.length} field(s) approved</div>
                    <button onClick={pushApproved} disabled={pushing || approvedCount === 0}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                      {pushing ? <Sparkles size={15} className="animate-pulse" /> : <UploadCloud size={15} />}
                      {pushing ? 'Pushing…' : 'Push approved to Guesty'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
