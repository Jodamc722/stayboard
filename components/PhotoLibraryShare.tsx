'use client'
// THE PHOTO LIBRARY BY LINK (Jon, 2026-11-05) — /library/<code>. The passcode, then every property
// and its units with covers, a unit's photos in listing order, search across captions and units, a
// full-size viewer with download. Nothing on it changes anything.
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Download, Image as ImageIcon, Loader2, Lock, Search, X, ChevronLeft, ChevronRight } from 'lucide-react'

type Unit = { id: string; name: string; title: string | null; building: string; market: string; photos: number; cover: string | null }
type Building = { name: string; market: string; units: Unit[]; photos: number }
type Photo = { id: string; url: string; thumb: string; caption: string; unit?: string; building?: string }

const api = (code: string, q = '') => `/api/public/photo-library?code=${encodeURIComponent(code)}${q}`
const fileName = (p: Photo, i: number, unit?: string) => `${(unit || p.unit || 'photo').replace(/[^\w-]+/g, '-')}-${String(i + 1).padStart(2, '0')}.jpg`

export function PhotoLibraryShare({ code }: { code: string }) {
  const [state, setState] = useState<'loading' | 'locked' | 'gone' | 'ready'>('loading')
  const [err, setErr] = useState('')
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [idx, setIdx] = useState<{ title: string; buildings: Building[]; units: number; photos: number } | null>(null)
  const [unit, setUnit] = useState<{ unit: Unit; photos: Photo[] } | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Photo[] | null>(null)
  const [view, setView] = useState<{ list: Photo[]; i: number } | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(api(code), { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (r.status === 401 || j.needsPassword) { setErr(j.error && !j.unset ? '' : j.error || ''); setState('locked'); return }
    if (!j.ok) { setErr(j.error || 'This link is not active.'); setState('gone'); return }
    setIdx(j); setState('ready')
  }, [code])
  useEffect(() => { load() }, [load])

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    const r = await fetch('/api/public/link-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, password: pw }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (j.ok) { setPw(''); setState('loading'); load() } else setErr(j.error || 'Wrong passcode.')
  }
  const openUnit = async (u: Unit) => {
    setUnit({ unit: u, photos: [] }); window.scrollTo(0, 0)
    const j = await fetch(api(code, '&listing=' + encodeURIComponent(u.id))).then(r => r.json()).catch(() => ({}))
    if (j.ok) setUnit({ unit: j.unit, photos: j.photos })
  }
  useEffect(() => {
    const s = q.trim()
    if (s.length < 2) { setHits(null); return }
    const t = setTimeout(async () => {
      const j = await fetch(api(code, '&search=' + encodeURIComponent(s))).then(r => r.json()).catch(() => ({}))
      setHits(j.ok ? j.hits : [])
    }, 350)
    return () => clearTimeout(t)
  }, [q, code])
  useEffect(() => {
    if (!view) return
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView(null)
      if (e.key === 'ArrowRight') setView(v => v && { ...v, i: (v.i + 1) % v.list.length })
      if (e.key === 'ArrowLeft') setView(v => v && { ...v, i: (v.i - 1 + v.list.length) % v.list.length })
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [view])

  if (state === 'loading') return <div className="min-h-screen flex items-center justify-center text-muted text-[13px]"><Loader2 size={16} className="animate-spin mr-2" /> Loading…</div>
  if (state === 'gone') return <div className="min-h-screen flex items-center justify-center p-6 text-center text-[14px] text-muted">{err}</div>
  if (state === 'locked') return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={login} className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-ink"><Lock size={16} /><h1 className="text-[17px] font-semibold">Stay Hospitality · Photo library</h1></div>
        <p className="text-[13px] text-muted mt-1.5">Enter the passcode you were sent with this link.</p>
        <input type="password" autoFocus value={pw} onChange={e => setPw(e.target.value)} placeholder="Passcode" className="mt-4 h-10 w-full rounded-lg border border-line px-3 text-[14px]" />
        {err ? <p className="text-[12.5px] text-rose-700 mt-2">{err}</p> : null}
        <button disabled={busy || !pw} className="mt-4 h-10 w-full rounded-lg bg-ink text-white text-[14px] font-semibold disabled:opacity-50">{busy ? 'Checking…' : 'Open'}</button>
      </form>
    </div>
  )

  const grid = (list: Photo[], unitName?: string) => (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {list.map((p, i) => (
        <figure key={p.id + i} className="group relative rounded-xl overflow-hidden bg-app border border-line">
          <button onClick={() => setView({ list, i })} className="block w-full aspect-[4/3]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumb || p.url} alt={p.caption || ''} loading="lazy" className="w-full h-full object-cover" />
          </button>
          <figcaption className="px-2 py-1.5 text-[11.5px] text-muted flex items-center gap-1.5">
            <span className="truncate flex-1">{p.caption || (p.unit ? `${p.unit}` : ' ')}</span>
            <a href={p.url} download={fileName(p, i, unitName)} target="_blank" rel="noopener" title="Download full size" className="shrink-0 text-ink/60 hover:text-ink"><Download size={13} /></a>
          </figcaption>
        </figure>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen bg-app px-safe pb-safe">
      <div className="max-w-[1300px] mx-auto p-4 sm:p-6">
        <header className="flex items-center gap-3 flex-wrap mb-5">
          {unit ? <button onClick={() => setUnit(null)} className="h-9 w-9 rounded-lg border border-line bg-white inline-flex items-center justify-center" aria-label="Back"><ArrowLeft size={16} /></button> : null}
          <div className="min-w-0">
            <h1 className="text-[22px] leading-tight text-ink font-semibold truncate">{unit ? unit.unit.name : idx?.title || 'Photo library'}</h1>
            <p className="text-[12.5px] text-muted">{unit ? `${unit.unit.building} · ${unit.photos.length || unit.unit.photos} photos` : `${idx?.buildings.length} properties · ${idx?.units} units · ${idx?.photos.toLocaleString()} photos`}</p>
          </div>
          <div className="flex-1" />
          {!unit ? (
            <label className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search: pool, kitchen, Capri 110…" className="h-9 w-64 rounded-lg border border-line bg-white pl-8 pr-7 text-[13px]" />
              {q ? <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted" aria-label="Clear"><X size={13} /></button> : null}
            </label>
          ) : null}
        </header>

        {unit ? (
          unit.photos.length ? grid(unit.photos, unit.unit.name) : <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading photos…</p>
        ) : hits ? (
          hits.length ? (<><p className="text-[12.5px] text-muted mb-2">{hits.length} photos match “{q.trim()}”</p>{grid(hits)}</>) : <p className="text-[13px] text-muted">No photos match “{q.trim()}”.</p>
        ) : (
          <div className="space-y-7">
            {idx?.buildings.map(b => (
              <section key={b.name}>
                <div className="flex items-baseline gap-2 mb-2"><h2 className="text-[16px] font-semibold text-ink">{b.name}</h2><span className="text-[12px] text-muted">{b.market} · {b.units.length} units · {b.photos} photos</span></div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                  {b.units.map(u => (
                    <button key={u.id} onClick={() => openUnit(u)} className="text-left rounded-xl overflow-hidden border border-line bg-white hover:border-ink/30">
                      <div className="aspect-[4/3] bg-app">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {u.cover ? <img src={u.cover} alt="" loading="lazy" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted"><ImageIcon size={20} /></div>}
                      </div>
                      <div className="px-2.5 py-2"><div className="text-[13px] font-semibold text-ink truncate">{u.name}</div><div className="text-[11.5px] text-muted">{u.photos} photos</div></div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
        <div className="text-center text-[11px] text-muted py-8">Stay Hospitality · Lighthouse</div>
      </div>

      {view ? (() => {
        const p = view.list[view.i]
        return (
          <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={() => setView(null)}>
            <div className="flex items-center gap-3 px-4 h-12 text-white/90 text-[13px]" onClick={e => e.stopPropagation()}>
              <span className="truncate flex-1">{p.caption || p.unit || ''} <span className="text-white/50">· {view.i + 1} / {view.list.length}</span></span>
              <a href={p.url} download={fileName(p, view.i, unit?.unit.name)} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-white/15 hover:bg-white/25"><Download size={14} /> Download</a>
              <button onClick={() => setView(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-white/15" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="flex-1 flex items-center justify-center min-h-0 px-2 pb-4 relative">
              <button onClick={e => { e.stopPropagation(); setView({ ...view, i: (view.i - 1 + view.list.length) % view.list.length }) }} className="absolute left-2 h-10 w-10 rounded-full bg-white/15 text-white inline-flex items-center justify-center" aria-label="Previous"><ChevronLeft size={20} /></button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.caption || ''} className="max-h-full max-w-full object-contain" onClick={e => e.stopPropagation()} />
              <button onClick={e => { e.stopPropagation(); setView({ ...view, i: (view.i + 1) % view.list.length }) }} className="absolute right-2 h-10 w-10 rounded-full bg-white/15 text-white inline-flex items-center justify-center" aria-label="Next"><ChevronRight size={20} /></button>
            </div>
          </div>
        )
      })() : null}
    </div>
  )
}
