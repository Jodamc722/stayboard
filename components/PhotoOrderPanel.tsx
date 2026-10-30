'use client'
// PHOTO ORDER, BY NUMBER (Jon, 2026-10-30: "a more simple reorder process for photos at the property
// level … once it's organized … just pick a number: 1 is the hero photo, 2 is the second … once we
// select it, it moves it to the correct spot … across the entire photo catalog").
//
// The live photos in their live order. Every photo carries a number; pick a different number and
// the photo moves there, everything between shifting by one. 1–5 are marked — 1 is the cover (hero),
// 2–5 the rest of the first five a guest sees. Nothing goes to Guesty until "Save order".
//
// Per photo, two tools (Jon, same day): FLIP turns the photo left-to-right ("mirror"), and OPTIONS
// makes several enhanced versions to choose from. Either becomes the photo's new image on save.
import { useMemo, useState } from 'react'
import { Check, Crown, FlipHorizontal2, Loader2, RotateCcw, Save, Sparkles, X } from 'lucide-react'

type Pic = { _id?: string; thumbnail?: string; original?: string; large?: string; caption?: string }
type Variant = { preset: string; name: string; url: string; why?: string }

const OPTION_PRESETS = ['auto', 'natural', 'bright', 'warm', 'crisp']
const ghost = 'inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 py-0.5 text-[11px] font-semibold text-ink hover:border-ink/40 disabled:opacity-40'

export function PhotoOrderPanel({ listingId, pictures }: { listingId: string; pictures: Pic[] }) {
  const pics = useMemo(() => pictures.map((p, i) => {
    // Guesty's picture objects carry the _id the order is saved by; a bare URL string (the summary
    // column) is a last resort and keeps its position key.
    const o: any = typeof p === 'string' ? (() => { const t = String(p); if (/^https?:/.test(t)) return { original: t }; try { return JSON.parse(t) } catch { return {} } })() : (p || {})
    return { id: String(o._id || 'idx-' + i), url: String(o.thumbnail || o.large || o.original || ''), caption: String(o.caption || '') }
  }).filter(p => p.url), [pictures])
  const start = useMemo(() => pics.map(p => p.id), [pics])
  const byId = useMemo(() => new Map(pics.map(p => [p.id, p])), [pics])
  const [order, setOrder] = useState<string[]>(start)
  const [swap, setSwap] = useState<Record<string, { url: string; label: string }>>({})   // new image per photo
  const [options, setOptions] = useState<Record<string, Variant[]>>({})
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(true)
  const changed = order.join() !== start.join() || Object.keys(swap).length > 0

  const moveTo = (id: string, pos: number) => setOrder(o => { const n = o.filter(x => x !== id); n.splice(Math.max(0, Math.min(n.length, pos - 1)), 0, id); return n })

  const call = async (body: any) => {
    const r = await fetch('/api/photo-enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, ...body }) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j || j.error) throw new Error((j && j.error) || 'The photo service did not answer — try again.')
    return j
  }
  const flip = async (id: string) => {
    setBusy(id + ':flip'); setErr(''); setMsg('')
    try {
      const j = await call({ photoIds: [id], flip: true })
      const u = j.photos?.[0]?.flippedUrl
      if (!u) throw new Error((j.errors && j.errors[0]?.error) || 'Could not flip that photo.')
      setSwap(s => ({ ...s, [id]: { url: u, label: 'Flipped' } }))
      setMsg('Flipped — it goes live when you save the order.')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const makeOptions = async (id: string) => {
    setBusy(id + ':opt'); setErr(''); setMsg('')
    try {
      const j = await call({ photoIds: [id], variants: OPTION_PRESETS })
      const v: Variant[] = j.photos?.[0]?.variants || []
      if (!v.length) throw new Error((j.errors && j.errors[0]?.error) || 'Could not make options for that photo.')
      setOptions(o => ({ ...o, [id]: v }))
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const save = async () => {
    setBusy('save'); setErr(''); setMsg('')
    try {
      const urls: Record<string, string> = {}
      for (const [id, s] of Object.entries(swap)) urls[id] = s.url
      const r = await fetch('/api/photo-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, order, ...(Object.keys(urls).length ? { urls } : {}) }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'Guesty would not take the order.')
      setMsg('Saved to Guesty — the channels pick it up on their next sync. Refreshing…'); setSwap({}); setTimeout(() => { try { window.location.reload() } catch { /* fine */ } }, 1500)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }

  if (!pics.length) return null
  const N = order.length
  return (
    <section className="rounded-2xl border border-line bg-white">
      <div className="px-4 py-3 flex items-center gap-2 flex-wrap">
        <span className="text-[14px] font-bold text-ink">Photo order</span>
        <span className="text-[12px] text-muted">Pick a number on any photo to move it there. 1 is the cover; 1–5 are what guests see first.</span>
        <span className="ml-auto flex items-center gap-2">
          {changed && <button onClick={() => { setOrder(start); setSwap({}) }} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"><RotateCcw size={12} /> Reset</button>}
          <button onClick={save} disabled={!changed || busy === 'save'} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-bold disabled:opacity-40">
            {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save order
          </button>
          <button onClick={() => setOpen(o => !o)} className="text-[12px] font-semibold text-muted hover:text-ink">{open ? 'Hide' : 'Show'}</button>
        </span>
      </div>
      {(err || msg) && <div className={'mx-4 mb-2 rounded-lg px-3 py-1.5 text-[12.5px] ' + (err ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200')}>{err || msg}</div>}
      {open && (
        <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {order.map((id, i) => {
            const p = byId.get(id); if (!p) return null
            const pos = i + 1, top = pos <= 5, sw = swap[id], opts = options[id]
            return (
              <div key={id} className={'rounded-xl overflow-hidden border ' + (pos === 1 ? 'border-amber-400 ring-2 ring-amber-200' : top ? 'border-amber-300' : 'border-line')}>
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sw ? sw.url : p.url} alt={p.caption || ''} className="w-full aspect-[4/3] object-cover" loading="lazy" />
                  <span className={'absolute top-1.5 left-1.5 text-[11px] font-bold px-1.5 py-0.5 rounded ' + (top ? 'bg-amber-500 text-white' : 'bg-black/60 text-white')}>{pos === 1 ? <span className="inline-flex items-center gap-0.5"><Crown size={10} /> 1 · cover</span> : pos}</span>
                  {sw && <span className="absolute top-1.5 right-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">{sw.label}</span>}
                </div>
                <div className="p-1.5 space-y-1">
                  <label className="flex items-center gap-1.5 text-[11.5px]">
                    <span className="text-muted">Position</span>
                    <select value={pos} onChange={e => moveTo(id, Number(e.target.value))} className="flex-1 min-w-0 rounded-md border border-line bg-white px-1 py-0.5 text-[12px] font-semibold">
                      {Array.from({ length: N }, (_, k) => k + 1).map(n => <option key={n} value={n}>{n === 1 ? '1 — Cover' : n <= 5 ? n + ' — first five' : String(n)}</option>)}
                    </select>
                  </label>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button onClick={() => flip(id)} disabled={!!busy} className={ghost} title="Mirror the photo left-to-right">{busy === id + ':flip' ? <Loader2 size={11} className="animate-spin" /> : <FlipHorizontal2 size={11} />} Flip</button>
                    <button onClick={() => makeOptions(id)} disabled={!!busy} className={ghost} title="Make several enhanced versions to choose from">{busy === id + ':opt' ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Enhance options</button>
                    {sw && <button onClick={() => setSwap(s => { const n = { ...s }; delete n[id]; return n })} className={ghost} title="Keep the original"><X size={11} /> Original</button>}
                  </div>
                  {opts && (
                    <div className="grid grid-cols-3 gap-1 pt-1">
                      {opts.map(v => (
                        <button key={v.preset} onClick={() => { setSwap(s => ({ ...s, [id]: { url: v.url, label: v.name } })); setOptions(o => { const n = { ...o }; delete n[id]; return n }) }} title={v.why || v.name}
                          className={'rounded-md overflow-hidden border text-left ' + (sw?.url === v.url ? 'border-emerald-500' : 'border-line hover:border-ink/40')}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={v.url} alt="" className="w-full aspect-[4/3] object-cover" />
                          <span className="block px-1 text-[9.5px] font-semibold truncate">{v.name}</span>
                        </button>
                      ))}
                      <button onClick={() => setOptions(o => { const n = { ...o }; delete n[id]; return n })} className="text-[10px] text-muted col-span-3 text-left inline-flex items-center gap-0.5"><Check size={10} /> Done — keep current</button>
                    </div>
                  )}
                  {p.caption && <div className="text-[10.5px] text-muted truncate" title={p.caption}>{p.caption}</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
