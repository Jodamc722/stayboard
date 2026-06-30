'use client'
import { useState } from 'react'
import { Images, Wand2, Sparkles, AlertTriangle, Check, RotateCcw, UploadCloud, Star, ArrowUp, ArrowDown, Crown, Gauge, Trash2, MapPinned } from 'lucide-react'

type Photo = { _id: string; url: string; caption?: string; category?: string; reason?: string; kind?: string }
type Result = {
  heroId: string
  proposedOrder: string[]
  photos: Photo[]
  heroSuggestion?: { _id: string; why: string } | null
  assessment?: { quality: number | null; coverage: string; notes: string[] } | null
  recommendRemove?: { _id: string; reason: string }[]
  overflow?: number
}

const CAT_COLORS: Record<string, string> = {
  living: 'bg-sky-100 text-sky-700', kitchen: 'bg-amber-100 text-amber-700', dining: 'bg-orange-100 text-orange-700',
  bedroom: 'bg-violet-100 text-violet-700', bathroom: 'bg-cyan-100 text-cyan-700', outdoor: 'bg-emerald-100 text-emerald-700',
  view: 'bg-blue-100 text-blue-700', amenity: 'bg-teal-100 text-teal-700', exterior: 'bg-slate-100 text-slate-700',
  detail: 'bg-zinc-100 text-zinc-600', other: 'bg-zinc-100 text-zinc-600',
}

const CATS = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'outdoor', 'view', 'amenity', 'exterior', 'detail', 'other']

export function PhotoOrganizer({ listingId, name }: { listingId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pushedMsg, setPushedMsg] = useState<string | null>(null)
  const [photos, setPhotos] = useState<Record<string, Photo>>({})
  const [heroId, setHeroId] = useState<string | null>(null)
  const [order, setOrder] = useState<string[]>([])           // working order incl. hero at index 0
  const [proposed, setProposed] = useState<string[]>([])      // AI's proposed order (for reset)
  const [heroSug, setHeroSug] = useState<Result['heroSuggestion']>(null)
  const [overflow, setOverflow] = useState(0)
  const [assessment, setAssessment] = useState<Result['assessment']>(null)
  const [removeList, setRemoveList] = useState<{ _id: string; reason: string }[]>([])
  const [toRemove, setToRemove] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [guidance, setGuidance] = useState('')

  async function analyze(hero?: string, guidanceText?: string) {
    setBusy(true); setError(null); setPushedMsg(null)
    try {
      const r = await fetch('/api/optimize-photos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, ...(hero ? { heroId: hero } : {}), ...(guidanceText && guidanceText.trim() ? { guidance: guidanceText.trim() } : {}) }),
      })
      const raw = await r.text()
      let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || (r.status === 504 ? 'The photo organizer timed out - this listing may have a lot of photos. Try again, or hide a few first.' : 'Failed to analyze photos. Please try again.'))
      const map: Record<string, Photo> = {}
      ;(j.photos || []).forEach((p: Photo) => { map[p._id] = p })
      setPhotos(map); setHeroId(j.heroId); setOrder(j.proposedOrder); setProposed(j.proposedOrder)
      setHeroSug(j.heroSuggestion || null); setOverflow(j.overflow || 0); setAssessment(j.assessment || null); setRemoveList(j.recommendRemove || [])
    } catch (e: any) { setError(e.message || String(e)) } finally { setBusy(false) }
  }

  function move(id: string, dir: -1 | 1) {
    setOrder(prev => {
      const i = prev.indexOf(id)
      const j = i + dir
      if (i <= 0 || j <= 0 || j >= prev.length) return prev // never move into hero slot (0)
      const next = prev.slice(); [next[i], next[j]] = [next[j], next[i]]; return next
    })
  }
  function setAsHero(id: string) {
    // Make this photo the hero (#1). Re-run analysis with the new hero so the rest re-orders around it.
    setHeroId(id); analyze(id)
  }
  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); return }
    setOrder(prev => {
      const from = prev.indexOf(dragId); const to = prev.indexOf(targetId)
      if (from <= 0 || to <= 0) return prev // hero slot is locked
      const next = prev.slice(); next.splice(from, 1); next.splice(to, 0, dragId); return next
    })
    setDragId(null)
  }

  function toggleRemove(id: string) {
    setToRemove(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function setCaption(id: string, v: string) {
    setPhotos(prev => ({ ...prev, [id]: { ...prev[id], caption: v } }))
  }
  function setCategory(id: string, v: string) {
    setPhotos(prev => ({ ...prev, [id]: { ...prev[id], category: v } }))
  }

  async function push() {
    const remove = Array.from(toRemove)
    if (remove.length > 0 && !window.confirm(`This reorders the photos AND permanently removes ${remove.length} photo(s) from this listing on every channel (Airbnb, Vrbo, etc.). Continue?`)) return
    setPushing(true); setError(null); setPushedMsg(null)
    try {
      const captions: Record<string, string> = {}
      order.forEach(id => { const c = photos[id]?.caption; if (typeof c === 'string') captions[id] = c })
      const r = await fetch('/api/photo-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, order, remove: Array.from(toRemove), captions }),
      })
      const raw = await r.text()
      let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Failed to push order. Please try again.')
      const base = `${j.count} photos (order + descriptions)${j.removed ? `, ${j.removed} removed` : ''}`
      setPushedMsg(j.verified
        ? `\u2713 Pushed to Guesty and verified live: ${base}. Now syncing to all channels (Airbnb, Vrbo, etc.).`
        : `Pushed to Guesty: ${base}. ${j.verifyNote || 'Guesty is applying it across channels \u2014 give it a moment.'}`)
      setToRemove(new Set())
    } catch (e: any) { setError(e.message || String(e)) } finally { setPushing(false) }
  }

  const changed = order.length > 0 && JSON.stringify(order) !== JSON.stringify(proposed)

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-brand-50 to-white flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><Images size={15} className="text-brand-600" /> Organize photos with AI</h2>
          <p className="text-[12px] text-muted mt-0.5">AI studies every photo, orders them to maximize bookings, and writes a guest-facing description for each. You pick the cover photo (#1); AI orders the rest. Edit anything, then push the order + descriptions to Guesty.</p>
        </div>
        <button onClick={() => { setOpen(o => !o); if (!open && order.length === 0) analyze() }} disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex-shrink-0">
          {busy ? <Sparkles size={15} className="animate-pulse" /> : <Wand2 size={15} />}
          {busy ? 'Analyzing…' : open ? 'Hide' : 'Analyze order'}
        </button>
      </div>

      {open && (
        <div className="px-4 py-4 border-t border-line space-y-4">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
          {pushedMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {pushedMsg}</div>}
          {busy && order.length === 0 && <div className="rounded-xl border border-line bg-app/40 px-4 py-10 text-center text-sm text-muted">Studying every photo and ranking the best order…</div>}

          {assessment && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-3.5 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Gauge size={15} className="text-brand-600" />
                <span className="text-[13px] font-semibold text-ink">Photo quality score</span>
                {assessment.quality != null && (
                  <span className={`text-[13px] font-bold px-2 py-0.5 rounded-md ${assessment.quality >= 75 ? 'bg-emerald-100 text-emerald-700' : assessment.quality >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{assessment.quality}/100</span>
                )}
                <span className="text-[11px] text-muted ml-auto">feeds the listing &amp; health score</span>
              </div>
              {assessment.coverage && <p className="text-[12px] text-ink/80 mb-1">{assessment.coverage}</p>}
              {assessment.notes.length > 0 && (
                <ul className="text-[12px] text-muted space-y-0.5">
                  {assessment.notes.map((n, i) => <li key={i} className="flex items-start gap-1.5"><span className="mt-0.5 text-brand-500">+</span> {n}</li>)}
                </ul>
              )}
            </div>
          )}

          {removeList.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-3.5 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Trash2 size={15} className="text-rose-600" />
                <span className="text-[13px] font-semibold text-ink">Recommended to remove ({removeList.length})</span>
                <span className="text-[11px] text-muted ml-auto">delete these in Guesty &mdash; StayBoard never deletes photos for you</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {removeList.map(r => { const p = photos[r._id]; if (!p) return null; const marked = toRemove.has(r._id); return (
                  <div key={r._id} className="rounded-lg border border-rose-200 overflow-hidden bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="remove candidate" className="w-full aspect-[4/3] object-cover opacity-80" loading="lazy" />
                    <p className="text-[10px] text-rose-700 leading-snug px-1.5 pt-1.5">{r.reason}</p>
                    <button onClick={() => toggleRemove(r._id)} className={`w-full text-[10px] font-semibold py-1 ${marked ? 'bg-rose-600 text-white' : 'text-rose-700 hover:bg-rose-50'}`}>{marked ? 'Marked to remove' : 'Mark to remove'}</button>
                  </div>
                )})}
              </div>
            </div>
          )}

          {order.length > 0 && (
            <>
              {heroSug && heroSug._id !== heroId && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 flex items-start justify-between gap-3 flex-wrap">
                  <span className="flex items-start gap-1.5"><Crown size={14} className="mt-0.5 flex-shrink-0" /> AI thinks a different photo would be a stronger cover: {heroSug.why}</span>
                  <button onClick={() => setAsHero(heroSug._id)} className="text-amber-900 font-semibold underline whitespace-nowrap">Make it the cover</button>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 flex-wrap text-[12px] text-muted">
                <span><span className="font-semibold text-ink">{order.length}</span> photos · cover photo locked at #1{overflow > 0 ? ` · ${overflow} extra kept at the end` : ''}</span>
                <div className="flex items-center gap-2">
                  {changed && <button onClick={() => setOrder(proposed)} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"><RotateCcw size={12} /> Reset to AI order</button>}
                  <button onClick={() => analyze(heroId || undefined)} disabled={busy} className="inline-flex items-center gap-1 text-[12px] text-brand-600 hover:text-brand-700 disabled:opacity-50"><Wand2 size={12} /> Re-run</button>
                </div>
              </div>

              <div className="rounded-xl border border-brand-200 bg-brand-50/40 px-3 py-2.5 flex items-center gap-2 flex-wrap">
                <Wand2 size={14} className="text-brand-600 shrink-0" />
                <input value={guidance} onChange={e => setGuidance(e.target.value)}
                  placeholder="Tell the AI what to fix — e.g. &lsquo;the dining photos are tagged amenity, classify them as dining&rsquo;"
                  className="flex-1 min-w-[220px] text-[12px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-200" />
                <button onClick={() => analyze(heroId || undefined, guidance)} disabled={busy || !guidance.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-50">
                  <Wand2 size={13} /> Apply correction &amp; re-run
                </button>
              </div>

              <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {order.map((id, idx) => {
                  const p = photos[id]; if (!p) return null
                  const isHero = idx === 0
                  return (
                    <li key={id}
                      draggable={!isHero}
                      onDragStart={() => !isHero && setDragId(id)}
                      onDragOver={e => { if (!isHero) e.preventDefault() }}
                      onDrop={() => onDrop(id)}
                      className={`relative rounded-xl border overflow-hidden bg-app/30 ${isHero ? 'border-amber-300 ring-1 ring-amber-200' : 'border-line cursor-move'} ${dragId === id ? 'opacity-50' : ''}`}>
                      <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${isHero ? 'bg-amber-500 text-white' : 'bg-black/60 text-white'}`}>{idx + 1}</span>
                        {isHero && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 inline-flex items-center gap-0.5"><Star size={10} /> Cover</span>}
                        {p.kind === 'stock' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-800 inline-flex items-center gap-0.5"><MapPinned size={10} /> Stock</span>}
                        {removeList.some(r => r._id === id) && !toRemove.has(id) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 inline-flex items-center gap-0.5"><Trash2 size={10} /> Suggest</span>}
                        {toRemove.has(id) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-600 text-white inline-flex items-center gap-0.5"><Trash2 size={10} /> Removing</span>}
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.caption || `photo ${idx + 1}`} className="w-full aspect-[4/3] object-cover" loading="lazy" />
                      <div className="p-2 space-y-1">
                        <select value={p.category || 'other'} onChange={e => setCategory(id, e.target.value)} title="Photo category — correct the AI's tag" className={`text-[10px] font-semibold pl-1.5 pr-4 py-0.5 rounded border-0 cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-brand-300 ${CAT_COLORS[p.category || 'other'] || CAT_COLORS.other}`}>
                          {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {p.reason && <p className="text-[11px] text-muted leading-snug">{p.reason}</p>}
                        <input value={p.caption || ''} onChange={e => setCaption(id, e.target.value)} placeholder="Add a description…" title="Guest-facing photo description — pushed to Guesty" className="w-full text-[11px] rounded border border-line bg-white px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-200" />
                        {!isHero && (
                          <div className="flex items-center gap-1 pt-0.5">
                            <button onClick={() => move(id, -1)} disabled={idx <= 1} title="Move earlier" className="p-1 rounded border border-line text-muted hover:text-ink disabled:opacity-30"><ArrowUp size={12} /></button>
                            <button onClick={() => move(id, 1)} disabled={idx >= order.length - 1} title="Move later" className="p-1 rounded border border-line text-muted hover:text-ink disabled:opacity-30"><ArrowDown size={12} /></button>
                            <button onClick={() => setAsHero(id)} title="Make this the cover photo" className="ml-auto p-1 rounded border border-line text-amber-600 hover:text-amber-700"><Star size={12} /></button>
                            <button onClick={() => toggleRemove(id)} title={toRemove.has(id) ? 'Keep this photo' : 'Remove this photo from the listing'} className={`p-1 rounded border ${toRemove.has(id) ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-line text-muted hover:text-rose-600'}`}><Trash2 size={12} /></button>
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={push} disabled={pushing || busy}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
                  {pushing ? <Sparkles size={15} className="animate-pulse" /> : <UploadCloud size={15} />}
                  {pushing ? 'Pushing…' : 'Push to Guesty'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
