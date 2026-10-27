'use client'
// PICK PHOTOS FROM THE LIBRARY (Jon, 2026-10-27: "when adding a listing or wanting to update photos,
// it should allow me to search the photo library … we might have additional Elser units, and we use
// a lot of the same photos … instead of re-uploading, I should be able to select from our library").
//
// One picker, two homes: the new-unit intake (photos ride on the intake row until the listing
// exists) and the photo organizer on a unit page (picks are staged like uploads and go live on
// Push). The picker returns the photos' Guesty URLs and captions — Guesty fetches a URL itself when
// a picture is added, so a library pick costs no upload at all.
//
// Opens on the target's own property (the Elser case: the same lobby, pool and gym shots), then any
// property or unit by search. The search is smart (Jon: "17west pool", "elser pool"): every word has
// to land on the photo — its unit or property, its caption, or what the photo analysis saw — so the
// results are photos across units, grouped by unit, each one pickable (/api/photos/library?search=).
// Buttons, not menus; every icon says what it does.
import { useEffect, useMemo, useState } from 'react'
import { Check, CheckSquare, Images, Search, Square, X } from 'lucide-react'
import { useCachedFetch } from '@/lib/swr'
import { LeanPick, Tag } from '@/components/lean'

type Photo = { id: string; url: string; thumb: string; view: string; caption: string; width: number | null; height: number | null }
type Unit = { id: string; name: string; title: string | null; building: string; market: string; active: boolean; photos: number; cover: string | null }
type Building = { name: string; market: string; units: Unit[]; photos: number }
type IndexRes = { ok: boolean; error?: string; buildings: Building[] }
type UnitRes = { ok: boolean; error?: string; unit: Unit; photos: Photo[] }
type Hit = Photo & { listingId: string; unit: string; building: string; market: string; active: boolean; why: string[] }
type SearchRes = { ok: boolean; error?: string; q: string; hits: Hit[]; total: number; units: number; words: string[] }

export type LibraryPick = { url: string; caption: string; thumb: string; fromListingId: string; fromUnit: string; picId: string; width: number | null; height: number | null }

const btn = 'inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] font-bold hover:opacity-90 shrink-0 disabled:opacity-40'
const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:border-ink/40 shrink-0 disabled:opacity-40'

export function LibraryPicker({ open, onClose, onPick, startBuilding, startListingId, excludeListingId, title, verb }: {
  open: boolean
  onClose: () => void
  /** The picked photos, in the order they were ticked. */
  onPick: (picks: LibraryPick[]) => void | Promise<void>
  /** Where to start: the target unit's own property — by name, or by the target listing's id. */
  startBuilding?: string | null
  startListingId?: string | null
  /** The target listing itself — its own photos are not offered back to it. */
  excludeListingId?: string | null
  title?: string
  verb?: string
}) {
  const idx = useCachedFetch<IndexRes>(open ? '/api/photos/library' : null, { ttl: 600_000 })
  const [b, setB] = useState<string>('')
  const [u, setU] = useState<string>('')
  const [q, setQ] = useState('')
  // The photo search waits for the typing to pause; the unit chips follow every keystroke.
  const [dq, setDq] = useState('')
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t) }, [q])
  const [picked, setPicked] = useState<Map<string, LibraryPick>>(new Map())
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setPicked(new Map()); setQ(''); setU(''); setB(startBuilding || '') } }, [open, startBuilding])
  const buildings = idx.data?.buildings || []
  useEffect(() => {
    if (!open || !buildings.length) return
    // A building name typed on an intake ("17 West") is matched loosely to the library's ("17WEST").
    const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const byId = startListingId ? buildings.find(x => x.units.some(un => un.id === startListingId)) : null
    const byName = startBuilding ? (buildings.find(x => x.name === startBuilding) || buildings.find(x => squash(x.name) === squash(startBuilding)) || buildings.find(x => squash(x.name).includes(squash(startBuilding)) || squash(startBuilding).includes(squash(x.name)))) : null
    const want = (byId || byName || null)?.name
    if (want && b !== want && !buildings.some(x => x.name === b && b !== (startBuilding || ''))) setB(want)
    else if (!buildings.some(x => x.name === b)) setB(want || buildings[0].name)
  }, [open, buildings, startBuilding, startListingId]) // eslint-disable-line react-hooks/exhaustive-deps
  const building = buildings.find(x => x.name === b) || null
  const units = useMemo(() => (building ? building.units : []).filter(x => x.id !== excludeListingId && x.photos > 0), [building, excludeListingId])
  useEffect(() => { if (units.length && !units.some(x => x.id === u)) setU(units[0].id) }, [units, u])
  // Search across every unit, wherever it lives.
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return null
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const out: Unit[] = []
    for (const bb of buildings) for (const un of bb.units) {
      if (un.id === excludeListingId || !un.photos) continue
      const hay = un.name + ' ' + un.building + ' ' + (un.title || '')
      if (words.every(w => squash(hay).includes(squash(w)) || hay.toLowerCase().includes(w))) out.push(un)
    }
    return out.slice(0, 40)
  }, [buildings, q, excludeListingId])
  const srch = useCachedFetch<SearchRes>(open && dq ? '/api/photos/library?search=' + encodeURIComponent(dq) : null, { ttl: 600_000, persist: false, live: false })
  const found = useMemo(() => (srch.data?.hits || []).filter(h => h.listingId !== excludeListingId), [srch.data, excludeListingId])
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; unit: string; building: string; active: boolean; hits: Hit[] }>()
    for (const h of found) { const g = m.get(h.listingId) || { id: h.listingId, unit: h.unit, building: h.building, active: h.active, hits: [] }; g.hits.push(h); m.set(h.listingId, g) }
    return Array.from(m.values())
  }, [found])
  const hkey = (h: Hit) => h.listingId + ':' + h.id
  const pickOf = (h: Hit): LibraryPick => ({ url: h.url, caption: h.caption, thumb: h.thumb, fromListingId: h.listingId, fromUnit: h.unit, picId: h.id, width: h.width, height: h.height })
  const toggleHit = (h: Hit) => setPicked(prev => { const n = new Map(prev); const k = hkey(h); if (n.has(k)) n.delete(k); else n.set(k, pickOf(h)); return n })
  const pickMany = (hs: Hit[]) => setPicked(prev => { const n = new Map(prev); const all = hs.every(h => n.has(hkey(h))); for (const h of hs) { const k = hkey(h); if (all) n.delete(k); else if (!n.has(k)) n.set(k, pickOf(h)) } return n })
  const searching = !!hits && (q.trim() !== dq || (srch.loading && !srch.data))
  const unitRes = useCachedFetch<UnitRes>(open && u ? '/api/photos/library?listing=' + encodeURIComponent(u) : null, { ttl: 600_000 })
  const photos = unitRes.data?.photos || []
  const unitMeta = unitRes.data?.unit || units.find(x => x.id === u) || null
  const key = (p: Photo) => u + ':' + p.id
  const toggle = (p: Photo) => setPicked(prev => {
    const n = new Map(prev); const k = key(p)
    if (n.has(k)) n.delete(k)
    else n.set(k, { url: p.url, caption: p.caption, thumb: p.thumb, fromListingId: u, fromUnit: unitMeta?.name || '', picId: p.id, width: p.width, height: p.height })
    return n
  })
  const allHere = photos.length > 0 && photos.every(p => picked.has(key(p)))
  const pickAllHere = () => setPicked(prev => { const n = new Map(prev); for (const p of photos) { const k = key(p); if (allHere) n.delete(k); else if (!n.has(k)) n.set(k, { url: p.url, caption: p.caption, thumb: p.thumb, fromListingId: u, fromUnit: unitMeta?.name || '', picId: p.id, width: p.width, height: p.height }) } return n })
  const confirm = async () => { setBusy(true); try { await onPick(Array.from(picked.values())) } finally { setBusy(false) } }
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[90] bg-ink/40 flex items-center justify-center p-3" onClick={onClose} role="dialog" aria-label="Pick photos from the library">
      <div className="w-full max-w-[1100px] max-h-[92vh] rounded-2xl bg-white border border-line shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap shrink-0">
          <Images size={15} className="text-ink" />
          <div className="min-w-0">
            <div className="text-[14px] font-bold text-ink">{title || 'Pick photos from the library'}</div>
            <div className="text-[11.5px] text-muted">Guesty copies each photo from its link — nothing is re-uploaded. Captions come along; the files are full size as Guesty holds them.</div>
          </div>
          <div className="ml-auto relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="elser pool · 17west gym · 511…" title="A unit, a property, or what the photo shows — every word has to match" className="w-60 rounded-lg border border-line bg-white pl-7 pr-7 py-1.5 text-[12.5px]" />
            {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink" title="Clear"><X size={12} /></button>}
          </div>
          <button onClick={onClose} className="rounded-lg border border-line p-1.5 text-muted hover:text-ink" title="Close"><X size={14} /></button>
        </div>

        <div className="px-4 py-2 border-b border-line space-y-1.5 max-h-[32vh] overflow-y-auto shrink-0">
          {hits ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Units</span>
              {hits.length === 0 ? <span className="text-[12px] text-muted">No unit by that name — the photos below are matched by what they show.</span> : (
                <LeanPick size="sm" value="" onPick={id => { const hit = hits.find(x => x.id === id); if (hit) { setQ(''); setB(hit.building); setU(hit.id) } }}
                  options={hits.map(h => ({ v: h.id, label: <>{h.name} <span className="opacity-60">{h.building} · {h.photos}</span></>, title: 'Browse ' + h.name }))} />
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Property</span>
                {idx.loading && !idx.data ? <span className="text-[12px] text-muted">Reading the library…</span> : (
                  <LeanPick size="sm" value={b} onPick={v => { setB(v); setU('') }} options={buildings.map(x => ({ v: x.name, label: <>{x.name} <span className="opacity-60 tabular-nums">{x.photos}</span></>, title: x.units.length + ' units · ' + x.photos + ' photos' }))} />
                )}
              </div>
              {building && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Unit</span>
                  {units.length === 0 ? <span className="text-[12px] text-muted">No other unit with photos in this property.</span> : (
                    <LeanPick size="sm" value={u} onPick={setU} options={units.map(x => ({ v: x.id, label: <>{x.name} <span className="opacity-60 tabular-nums">{x.photos}</span></>, title: x.title || x.name }))} />
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          {hits ? (
            searching ? <p className="text-[12.5px] text-muted">Searching the photos…</p>
            : srch.error && !srch.data ? <p className="text-[12.5px] text-rose-700">Could not search: {srch.error}</p>
            : found.length === 0 ? <p className="text-[12.5px] text-muted">No photo matches “{dq}”. Try a property and what the photo shows — <i>elser pool</i>, <i>17west gym</i>, <i>bedroom king</i>.</p> : (
              <>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[12.5px] font-semibold text-ink">{found.length}{srch.data && srch.data.total > srch.data.hits.length ? ' of ' + srch.data.total : ''} photo{found.length === 1 ? '' : 's'} in {groups.length} unit{groups.length === 1 ? '' : 's'}</span>
                  <span className="text-[11.5px] text-muted">match “{dq}” — tap to pick</span>
                  {srch.data && srch.data.total > srch.data.hits.length && <Tag title="Add a word to narrow it — the unit number, or what the photo shows">first {srch.data.hits.length} shown</Tag>}
                  <button onClick={() => pickMany(found)} className={ghost + ' ml-auto'}>{found.every(h => picked.has(hkey(h))) ? <Square size={13} /> : <CheckSquare size={13} />} {found.every(h => picked.has(hkey(h))) ? 'Unpick all found' : 'Pick all found'}</button>
                </div>
                <div className="space-y-3">
                  {groups.map(g => (
                    <div key={g.id}>
                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap text-[12px]">
                        <button onClick={() => { setQ(''); setB(g.building); setU(g.id) }} className="font-semibold text-ink hover:underline" title={'Browse every photo of ' + g.unit}>{g.unit}</button>
                        <span className="text-muted">{g.building} · {g.hits.length} photo{g.hits.length === 1 ? '' : 's'}</span>
                        {!g.active && <Tag title="This listing is not active in Guesty — its photos are still here to reuse">offline</Tag>}
                        <button onClick={() => pickMany(g.hits)} className="text-[11.5px] text-muted hover:text-ink ml-1" title={'Pick every matching photo of ' + g.unit}>{g.hits.every(h => picked.has(hkey(h))) ? 'Unpick these' : 'Pick these'}</button>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                        {g.hits.map(h => {
                          const on = picked.has(hkey(h))
                          return (
                            <button key={hkey(h)} onClick={() => toggleHit(h)} className={'relative rounded-xl overflow-hidden border aspect-[4/3] bg-slate-100 text-left ' + (on ? 'border-ink ring-2 ring-brand-100' : 'border-line hover:border-ink/40')} title={(h.caption || 'No caption') + ' · ' + h.unit + (h.width && h.height ? ' · ' + h.width + '×' + h.height : '') + ' · matched ' + h.why.join(', ')}>
                              <img src={h.thumb} alt={h.caption} loading="lazy" className="w-full h-full object-cover" />
                              <span className={'absolute top-1 right-1 rounded-md p-1 ' + (on ? 'bg-ink text-white' : 'bg-white/90 border border-line text-ink')}>{on ? <Check size={12} /> : <Square size={12} />}</span>
                              {(h.caption || h.width) && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent px-1.5 pt-3 pb-1 text-[10px] text-white flex items-center gap-1"><span className="truncate flex-1">{h.caption}</span>{h.width && h.height && <span className="shrink-0 text-white/80 tabular-nums">{h.width}×{h.height}</span>}</span>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          ) : !u ? <p className="text-[12.5px] text-muted">Pick a unit to see its photos.</p>
            : unitRes.loading && !unitRes.data ? <p className="text-[12.5px] text-muted">Reading the photos…</p>
            : unitRes.error && !unitRes.data ? <p className="text-[12.5px] text-rose-700">Could not read the photos: {unitRes.error}</p>
            : photos.length === 0 ? <p className="text-[12.5px] text-muted">No photos on this unit.</p> : (
              <>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-[12.5px] font-semibold text-ink">{unitMeta?.name}</span>
                  <span className="text-[11.5px] text-muted">{photos.length} photos — tap to pick</span>
                  <button onClick={pickAllHere} className={ghost + ' ml-auto'}>{allHere ? <Square size={13} /> : <CheckSquare size={13} />} {allHere ? 'Unpick all here' : 'Pick all here'}</button>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                  {photos.map((p, i) => {
                    const on = picked.has(key(p))
                    return (
                      <button key={p.id} onClick={() => toggle(p)} className={'relative rounded-xl overflow-hidden border aspect-[4/3] bg-slate-100 text-left ' + (on ? 'border-ink ring-2 ring-brand-100' : 'border-line hover:border-ink/40')} title={(p.caption || 'No caption') + (p.width && p.height ? ' · ' + p.width + '×' + p.height : '')}>
                        <img src={p.thumb} alt={p.caption} loading="lazy" className="w-full h-full object-cover" />
                        <span className="absolute top-1 left-1 rounded-md bg-ink/70 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums">{i + 1}</span>
                        <span className={'absolute top-1 right-1 rounded-md p-1 ' + (on ? 'bg-ink text-white' : 'bg-white/90 border border-line text-ink')}>{on ? <Check size={12} /> : <Square size={12} />}</span>
                        {(p.caption || p.width) && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent px-1.5 pt-3 pb-1 text-[10px] text-white flex items-center gap-1"><span className="truncate flex-1">{p.caption}</span>{p.width && p.height && <span className="shrink-0 text-white/80 tabular-nums">{p.width}×{p.height}</span>}</span>}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
        </div>

        <div className="px-4 py-3 border-t border-line flex items-center gap-2 flex-wrap shrink-0">
          <span className="text-[12.5px] text-muted">{picked.size ? <><b className="text-ink">{picked.size}</b> picked{Array.from(new Set(Array.from(picked.values()).map(x => x.fromUnit))).length > 1 ? ' from ' + Array.from(new Set(Array.from(picked.values()).map(x => x.fromUnit))).length + ' units' : ''}</> : 'Nothing picked yet'}</span>
          {picked.size > 0 && <button onClick={() => setPicked(new Map())} className="text-[12px] text-muted hover:text-ink">Clear</button>}
          <span className="flex-1" />
          <button onClick={onClose} className={ghost}>Cancel</button>
          <button onClick={confirm} disabled={!picked.size || busy} className={btn}><Check size={13} /> {busy ? 'Adding…' : (verb || 'Add') + (picked.size ? ' ' + picked.size + ' photo' + (picked.size === 1 ? '' : 's') : '')}</button>
        </div>
        {picked.size > 0 && (
          <div className="px-4 pb-3 flex items-center gap-1 flex-wrap">
            {Array.from(picked.values()).slice(0, 24).map(p => <img key={p.fromListingId + p.picId} src={p.thumb} alt="" className="w-9 h-7 object-cover rounded border border-line" title={p.fromUnit + (p.caption ? ' · ' + p.caption : '')} />)}
            {picked.size > 24 && <Tag>+{picked.size - 24}</Tag>}
          </div>
        )}
      </div>
    </div>
  )
}
