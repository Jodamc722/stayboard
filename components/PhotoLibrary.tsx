'use client'
// THE PHOTO LIBRARY — /photos (Jon, 2026-10-27: "a library of photos with links that allow you to
// download the photos … like a drive: property, unit number … view and download … zip files, high
// quality").
//
// Three levels, like folders: Properties → Units → Photos. Every level has a download: a unit or a
// picked set or a whole property comes down as one ZIP (streamed from /api/photos/zip, the files
// byte-for-byte Guesty's originals), a single photo through /api/photos/file. The URL carries where
// you are (?b=Property&u=<unit id>), so a unit's photos are one link to send a teammate.
// Clean rows and tags, buttons not menus, every icon says what it does on hover (lib/lean rules).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, Home, Images, Link2, Search, X, Check, CheckSquare, Square, RefreshCw, FolderDown } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { LeanHead, Pill, Tag, LeanEmpty, IconBtn, LeanPick, Tip } from '@/components/lean'

type Photo = { id: string; url: string; thumb: string; view: string; caption: string; width: number | null; height: number | null }
type Unit = { id: string; name: string; title: string | null; building: string; market: string; active: boolean; photos: number; cover: string | null }
type Building = { name: string; market: string; units: Unit[]; photos: number }
type IndexRes = { ok: boolean; error?: string; at: string; buildings: Building[]; units: number; photos: number }
type UnitRes = { ok: boolean; error?: string; unit: Unit; photos: Photo[] }

const LIB = '/api/photos/library'
const zipHref = (q: string) => '/api/photos/zip?' + q
const fileHref = (listing: string, pic: string) => '/api/photos/file?listing=' + encodeURIComponent(listing) + '&pic=' + encodeURIComponent(pic)
const btn = 'inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] font-bold hover:opacity-90 shrink-0 disabled:opacity-40'
const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:border-ink/40 shrink-0 disabled:opacity-40'
/** What the long side says about the file (same rule as lib/photo-library resolutionGrade). */
const grade = (w: number | null, h: number | null): 'high' | 'web' | 'low' | null => { if (!w || !h) return null; const l = Math.max(w, h); return l >= 2000 ? 'high' : l >= 1200 ? 'web' : 'low' }
const GRADE_LABEL = { high: 'high-res', web: 'web size', low: 'low-res' } as const
const GRADE_TONE = { high: 'emerald', web: 'slate', low: 'rose' } as const
const agoText = (iso?: string | null) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago' }

export function PhotoLibrary({ canEdit }: { canEdit: boolean }) {
  const sp = useSearchParams()
  const router = useRouter()
  const b = sp?.get('b') || ''
  const u = sp?.get('u') || ''
  const idx = useCachedFetch<IndexRes>(LIB, { ttl: 600_000 })
  const [q, setQ] = useState('')
  const [market, setMarket] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const go = useCallback((next: { b?: string; u?: string }) => {
    const p = new URLSearchParams()
    if (next.b) p.set('b', next.b)
    if (next.u) p.set('u', next.u)
    router.replace('/photos' + (p.toString() ? '?' + p.toString() : ''), { scroll: false })
  }, [router])
  const buildings = useMemo(() => (idx.data?.buildings || []).filter(x => market === 'all' || x.market === market), [idx.data, market])
  const markets = useMemo(() => Array.from(new Set((idx.data?.buildings || []).map(x => x.market).filter(Boolean))).sort(), [idx.data])
  const building = useMemo(() => (idx.data?.buildings || []).find(x => x.name === b) || null, [idx.data, b])
  const unitMeta = useMemo(() => { for (const bb of idx.data?.buildings || []) { const hit = bb.units.find(x => x.id === u); if (hit) return hit } return null }, [idx.data, u])
  // Search cuts across every level: "511" finds the unit wherever it is.
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return null
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const out: Unit[] = []
    for (const bb of buildings) for (const un of bb.units) {
      const hay = un.name + ' ' + un.building + ' ' + (un.title || '')
      if (words.every(w => squash(hay).includes(squash(w)) || hay.toLowerCase().includes(w))) out.push(un)
    }
    return out.slice(0, 60)
  }, [buildings, q])
  const refresh = async () => { setRefreshing(true); try { await fetch(LIB + '?refresh=1', { cache: 'no-store' }); invalidateCache(LIB); await idx.refresh() } finally { setRefreshing(false) } }

  return (
    <div className="max-w-[1400px]">
      <LeanHead title="Photo library" sub={idx.data ? `${idx.data.buildings.length} properties · ${idx.data.units} units · ${idx.data.photos.toLocaleString()} photos · as Guesty holds them, full size · updated ${agoText(idx.data.at)}` : idx.error ? 'Could not load: ' + idx.error : 'Reading the library…'}>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit or property…" className="w-56 rounded-lg border border-line bg-white pl-7 pr-7 py-1.5 text-[12.5px]" />
          {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-ink" title="Clear"><X size={12} /></button>}
        </div>
        {markets.length > 1 && <LeanPick size="sm" value={market} onPick={setMarket} options={[{ v: 'all', label: 'All' }, ...markets.map(m => ({ v: m, label: m }))]} />}
        {canEdit && <IconBtn title={refreshing ? 'Rebuilding…' : 'Re-read the listings now (otherwise every 10 minutes)'} onClick={refresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /></IconBtn>}
      </LeanHead>

      {/* Where you are */}
      <nav className="flex items-center gap-1 text-[12.5px] mb-3 flex-wrap" aria-label="Folder path">
        <button onClick={() => go({})} className={'font-semibold ' + (!b && !u ? 'text-ink' : 'text-muted hover:text-ink')}>Properties</button>
        {(b || unitMeta) && <><span className="text-muted">/</span><button onClick={() => go({ b: b || unitMeta?.building })} className={'font-semibold ' + (b && !u ? 'text-ink' : 'text-muted hover:text-ink')}>{b || unitMeta?.building}</button></>}
        {u && <><span className="text-muted">/</span><span className="font-semibold text-ink">{unitMeta?.name || 'Unit'}</span></>}
      </nav>

      {hits ? (
        <UnitGrid units={hits} empty="No unit matches." onOpen={un => { setQ(''); go({ b: un.building, u: un.id }) }} showBuilding />
      ) : u ? (
        <UnitView id={u} meta={unitMeta} />
      ) : b ? (
        building ? <BuildingView b={building} onOpen={un => go({ b: building.name, u: un.id })} /> : (idx.data ? <LeanEmpty>No property called “{b}”.</LeanEmpty> : <LeanEmpty>Reading the library…</LeanEmpty>)
      ) : (
        idx.loading && !idx.data ? <LeanEmpty>Reading the library…</LeanEmpty> : buildings.length === 0 ? <LeanEmpty>No photos yet.</LeanEmpty> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {buildings.map(bb => {
              const cover = bb.units.find(x => x.cover)?.cover || null
              const active = bb.units.filter(x => x.active).length
              return (
                <button key={bb.name} onClick={() => go({ b: bb.name })} className="text-left rounded-2xl border border-line bg-white overflow-hidden hover:border-ink/40 transition group">
                  <div className="aspect-[4/3] bg-slate-100 overflow-hidden">{cover ? <img src={cover} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.02] transition" /> : <div className="w-full h-full flex items-center justify-center text-muted"><Images size={22} /></div>}</div>
                  <div className="px-3 py-2">
                    <div className="text-[13.5px] font-semibold text-ink truncate">{bb.name}</div>
                    <div className="text-[11.5px] text-muted flex items-center gap-1.5 flex-wrap mt-0.5"><span>{active} unit{active === 1 ? '' : 's'}{bb.units.length > active ? ' · ' + (bb.units.length - active) + ' offline' : ''}</span><span>·</span><span>{bb.photos.toLocaleString()} photos</span><Tag>{bb.market}</Tag></div>
                  </div>
                </button>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}

function BuildingView({ b, onOpen }: { b: Building; onOpen: (u: Unit) => void }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-ink">{b.name}</div>
          <div className="text-[12px] text-muted">{b.units.length} units · {b.photos.toLocaleString()} photos · {b.market}</div>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {!confirm ? (
            <button onClick={() => setConfirm(true)} className={ghost} title="One ZIP with a folder per unit — large: every photo at full size"><FolderDown size={13} /> Download property (ZIP)</button>
          ) : (
            <span className="inline-flex items-center gap-2 text-[12px] text-muted">
              {b.photos.toLocaleString()} full-size photos in one file — it can run to gigabytes.
              <a href={zipHref('building=' + encodeURIComponent(b.name))} onClick={() => setConfirm(false)} className={btn}><Download size={13} /> Download anyway</a>
              <button onClick={() => setConfirm(false)} className={ghost}>Cancel</button>
            </span>
          )}
          <CopyLink title="Copy a link to this property in the library" />
        </div>
      </div>
      <UnitGrid units={b.units} empty="No units in this property." onOpen={onOpen} />
    </div>
  )
}

function UnitGrid({ units, onOpen, empty, showBuilding }: { units: Unit[]; onOpen: (u: Unit) => void; empty: string; showBuilding?: boolean }) {
  if (!units.length) return <LeanEmpty>{empty}</LeanEmpty>
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      {units.map(un => (
        <div key={un.id} className="rounded-2xl border border-line bg-white overflow-hidden group relative">
          <button onClick={() => onOpen(un)} className="block w-full text-left">
            <div className="aspect-[4/3] bg-slate-100 overflow-hidden">{un.cover ? <img src={un.cover} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-[1.02] transition" /> : <div className="w-full h-full flex items-center justify-center text-muted"><Images size={20} /></div>}</div>
            <div className="px-2.5 py-2">
              <div className="text-[13px] font-semibold text-ink truncate" title={un.title || un.name}>{un.name}</div>
              <div className="text-[11px] text-muted flex items-center gap-1.5 flex-wrap mt-0.5">{showBuilding && <span>{un.building} ·</span>}<span>{un.photos} photo{un.photos === 1 ? '' : 's'}</span>{!un.active && <Tag>offline</Tag>}</div>
            </div>
          </button>
          {un.photos > 0 && <a href={zipHref('listing=' + encodeURIComponent(un.id))} className="absolute top-2 right-2 rounded-lg bg-white/90 border border-line p-1.5 text-ink opacity-0 group-hover:opacity-100 transition" title={'Download all ' + un.photos + ' photos of ' + un.name + ' as a ZIP'}><Download size={13} /></a>}
        </div>
      ))}
    </div>
  )
}

function UnitView({ id, meta }: { id: string; meta: Unit | null }) {
  const r = useCachedFetch<UnitRes>(LIB + '?listing=' + encodeURIComponent(id), { ttl: 600_000 })
  const photos = r.data?.photos || []
  const unit = r.data?.unit || meta
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [picking, setPicking] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => { setPicked(new Set()); setPicking(false); setOpen(null) }, [id])
  const toggle = (pid: string) => setPicked(prev => { const n = new Set(prev); if (n.has(pid)) n.delete(pid); else n.add(pid); return n })
  const pickedList = photos.filter(p => picked.has(p.id)).map(p => p.id)
  // The quality on hand: the longest side across the unit, and how many photos are only web size or less.
  const res = useMemo(() => {
    const measured = photos.filter(p => p.width && p.height)
    if (!measured.length) return null
    const maxLong = Math.max(...measured.map(p => Math.max(p.width!, p.height!)))
    const low = measured.filter(p => grade(p.width, p.height) === 'low').length
    const web = measured.filter(p => grade(p.width, p.height) === 'web').length
    const high = measured.filter(p => grade(p.width, p.height) === 'high').length
    return { measured: measured.length, maxLong, low, web, high }
  }, [photos])
  // keyboard: arrows in the lightbox
  useEffect(() => {
    if (open == null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); if (e.key === 'ArrowRight') setOpen(o => (o == null ? 0 : (o + 1) % photos.length)); if (e.key === 'ArrowLeft') setOpen(o => (o == null ? 0 : (o - 1 + photos.length) % photos.length)) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, photos.length])

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[15px] font-bold text-ink flex items-center gap-2 flex-wrap">{unit?.name || 'Unit'}{unit && !unit.active && <Tag>offline in Guesty</Tag>}</div>
          <div className="text-[12px] text-muted flex items-center gap-1.5 flex-wrap">
            <span>{unit?.building}{unit?.title ? ' · ' + unit.title : ''} · {photos.length} photo{photos.length === 1 ? '' : 's'} · full size as Guesty holds them</span>
            {res && res.high > 0 && <Tag tone="emerald" title={res.high + ' photos with a long side of 2000 px or more — print and OTA grade'}>{res.high} high-res</Tag>}
            {res && res.web > 0 && <Tag title={res.web + ' photos between 1200 and 1999 px on the long side — fine on screen, not for print'}>{res.web} web size</Tag>}
            {res && res.low > 0 && <Tag tone="rose" title={res.low + ' photos under 1200 px on the long side — Guesty only has a small file; re-upload the originals to improve the listing'}>{res.low} low-res</Tag>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {photos.length > 0 && <a href={zipHref('listing=' + encodeURIComponent(id))} className={btn} title={'One ZIP, every photo at full size, named in order with its caption'}><Download size={13} /> Download all (ZIP)</a>}
          {photos.length > 0 && (
            <button onClick={() => { setPicking(p => !p); setPicked(new Set()) }} aria-pressed={picking} className={ghost + (picking ? ' !bg-ink !text-white' : '')} title="Tick the photos you want, then download just those"><CheckSquare size={13} /> {picking ? 'Done picking' : 'Pick photos'}</button>
          )}
          {picking && pickedList.length > 0 && <a href={zipHref('listing=' + encodeURIComponent(id) + '&pics=' + encodeURIComponent(pickedList.join(',')))} className={btn}><Download size={13} /> Download {pickedList.length} picked (ZIP)</a>}
          {picking && photos.length > 0 && <button onClick={() => setPicked(new Set(photos.map(p => p.id)))} className={ghost}>All</button>}
          <CopyLink title="Copy a link to this unit's photos" />
          {unit && <IconBtn title="Open the unit page" href={'/listings/' + encodeURIComponent(unit.id)}><Home size={14} /></IconBtn>}
        </div>
      </div>

      {r.loading && !r.data ? <LeanEmpty>Reading the photos…</LeanEmpty> : r.error && !r.data ? <LeanEmpty>Could not read the photos: {r.error}</LeanEmpty> : photos.length === 0 ? <LeanEmpty>This listing has no photos in Guesty.</LeanEmpty> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
          {photos.map((p, i) => {
            const on = picked.has(p.id)
            return (
              <div key={p.id} className={'relative rounded-xl overflow-hidden border bg-slate-100 group ' + (on ? 'border-ink ring-2 ring-brand-100' : 'border-line')}>
                <button onClick={() => picking ? toggle(p.id) : setOpen(i)} className="block w-full aspect-[4/3]" title={(p.caption || 'No caption') + (p.width && p.height ? ' · ' + p.width + '×' + p.height : '')}>
                  <img src={p.thumb} alt={p.caption} loading="lazy" className="w-full h-full object-cover" />
                </button>
                <span className="absolute top-1.5 left-1.5 rounded-md bg-ink/70 text-white text-[10px] font-bold px-1.5 py-0.5 tabular-nums">{i + 1}</span>
                {picking && <button onClick={() => toggle(p.id)} className="absolute top-1.5 right-1.5 rounded-md bg-white/90 border border-line p-1 text-ink" title={on ? 'Unpick' : 'Pick'}>{on ? <CheckSquare size={13} /> : <Square size={13} />}</button>}
                {!picking && <a href={fileHref(id, p.id)} className="absolute top-1.5 right-1.5 rounded-md bg-white/90 border border-line p-1 text-ink opacity-0 group-hover:opacity-100 transition" title="Download this photo, full size"><Download size={13} /></a>}
                {(p.caption || p.width) && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/70 to-transparent px-2 pt-4 pb-1.5 text-[10.5px] text-white flex items-center gap-1.5 pointer-events-none">
                    <span className="truncate flex-1">{p.caption}</span>
                    {p.width && p.height && <span className={'shrink-0 tabular-nums ' + (grade(p.width, p.height) === 'low' ? 'text-rose-200 font-semibold' : 'text-white/80')} title={GRADE_LABEL[grade(p.width, p.height)!]}>{p.width}×{p.height}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {open != null && photos[open] && (
        <Lightbox p={photos[open]} i={open} n={photos.length} listing={id} onClose={() => setOpen(null)} onPrev={() => setOpen((open - 1 + photos.length) % photos.length)} onNext={() => setOpen((open + 1) % photos.length)} />
      )}
    </div>
  )
}

function Lightbox({ p, i, n, listing, onClose, onPrev, onNext }: { p: Photo; i: number; n: number; listing: string; onClose: () => void; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-ink/90 flex flex-col" onClick={onClose} role="dialog" aria-label="Photo">
      <div className="flex items-center gap-2 px-4 h-12 text-white/90 text-[12.5px]" onClick={e => e.stopPropagation()}>
        <span className="font-semibold tabular-nums">{i + 1} / {n}</span>
        <span className="truncate">{p.caption || 'No caption'}</span>
        {p.width && p.height && <span className="text-white/60">{p.width}×{p.height}</span>}
        {grade(p.width, p.height) && <Tag tone={GRADE_TONE[grade(p.width, p.height)!]}>{GRADE_LABEL[grade(p.width, p.height)!]}</Tag>}
        <span className="flex-1" />
        <a href={fileHref(listing, p.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-white text-ink px-2.5 py-1.5 text-[12px] font-bold" title="Download this photo, full size"><Download size={13} /> Download</a>
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-white/30 px-2.5 py-1.5 text-[12px] font-semibold" title="Open the original in a new tab">Open original</a>
        <button onClick={onClose} className="rounded-lg border border-white/30 p-1.5" title="Close (Esc)"><X size={14} /></button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center px-12 pb-6 relative" onClick={e => e.stopPropagation()}>
        <button onClick={onPrev} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 text-white p-2" title="Previous (←)"><ChevronLeft size={18} /></button>
        <img src={p.view} alt={p.caption} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
        <button onClick={onNext} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 hover:bg-white/20 text-white p-2" title="Next (→)"><ChevronRight size={18} /></button>
      </div>
    </div>
  )
}

function CopyLink({ title }: { title: string }) {
  const [done, setDone] = useState(false)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setDone(true); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked: the address bar has it */ }
  }
  return <Tip label={done ? 'Copied' : title}><button onClick={copy} className={ghost}>{done ? <Check size={13} /> : <Link2 size={13} />} {done ? 'Copied' : 'Copy link'}</button></Tip>
}
