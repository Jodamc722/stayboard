'use client'
// THE SMART BUILDING FIELD ON THE NEW SALES DECK FORM (lib/sales-lookup). Type a building or an address:
// suggestions come from the Projections library, our portfolio and real South Florida addresses. Pick one and
// it fills the form: the verified address, the market, the building's website, type and selling points found
// on the web, its brand theme and photos, and its projections when the library holds them. Everything it
// fills can be changed; facts from the web show their sources.
import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, Check, Sparkles, MapPin, Globe, ExternalLink } from 'lucide-react'

type Any = any
type Sug = { kind: 'library' | 'portfolio' | 'address'; name: string; address: string; area: string; libId?: string; plans?: number; lat?: number; lng?: number }
export type SmartBrand = { theme: Any; logo: string; image: string; source: string } | null

const lab = 'text-[11px] uppercase tracking-wider text-muted font-semibold'
export function SmartBuilding({ building, address, setField, onLibrary, onNoLibrary, onHero, onBrand, hero, brand }: {
  building: string; address: string; setField: (k: string, v: string) => void
  onLibrary: (id: string) => void; onNoLibrary: () => void
  onHero: (h: { name: string; url: string } | null) => void; onBrand: (b: SmartBrand) => void
  hero: { name: string; url: string } | null; brand: SmartBrand
}) {
  const [q, setQ] = useState('')
  const [sugs, setSugs] = useState<Sug[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [res, setRes] = useState<Any>(null)
  const [err, setErr] = useState('')
  const [website, setWebsite] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const id = setTimeout(() => { if (q.trim().length < 2) { setSugs([]); return } fetch('/api/sales/lookup?q=' + encodeURIComponent(q)).then(r => r.json()).then(d => { setSugs(d?.suggestions || []); setOpen(true) }).catch(() => {}) }, 280)
    return () => clearTimeout(id)
  }, [q])
  useEffect(() => { const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])

  async function readBrand(url: string) {
    setBusy('Reading the website for its look and photos…')
    try {
      const d = await fetch('/api/sales/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }).then(r => r.json())
      if (d?.ok && d.theme) onBrand({ theme: { ...d.theme, label: d.theme.label || 'From the building' }, logo: d.logo || '', image: d.image || '', source: url })
    } catch { /* the deck still builds in the house look */ }
  }
  async function run(s: Partial<Sug> & { name?: string; address?: string }, site = '') {
    setOpen(false); setErr(''); setRes(null); onBrand(null)
    const b = s.name || building, a = s.address || address
    if (s.name) setField('building', s.name)
    if (s.address) setField('address', s.address)
    setBusy('Finding the building: address, website and details…')
    try {
      const d = await fetch('/api/sales/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ building: b, address: a, libId: s.libId, lat: s.lat, lng: s.lng, website: site || undefined }) }).then(r => r.json())
      if (!d?.ok) throw new Error(d?.error || 'The lookup failed.')
      const r = d.result; setRes(r)
      // fill what the form does not have yet (never overwrite what was typed)
      if (r.building && !b) setField('building', r.building)
      if (r.address) setField('address', r.address)
      if (r.market) setField('market', r.market)
      const f = r.facts
      if (f) { if (f.kind) setField('kind', f.kind); if (f.sellsOn) setField('goal', f.sellsOn); if (f.homes && /whole|hotel/i.test(f.kind)) setField('units', String(f.homes)) }
      if (r.library) onLibrary(r.library.id); else onNoLibrary()
      const w = site || f?.website || r.library?.website || ''
      setWebsite(w)
      if (r.library?.photo && !hero) onHero({ name: r.library.name, url: r.library.photo })
      if (w) await readBrand(w)
    } catch (e: Any) { setErr(e.message) } finally { setBusy('') }
  }
  const f = res?.facts
  const photos: { url: string; label: string }[] = [
    ...(res?.library?.photo ? [{ url: res.library.photo, label: 'Our photo' }] : []),
    ...(brand?.image ? [{ url: brand.image, label: 'From the website' }] : []),
    ...((res?.stock || []) as Any[]).map(h => ({ url: h.view || h.url, label: 'Stock · ' + h.source })),
  ]

  return (
    <div className="basis-full" ref={box}>
      <span className={lab}>Building or address</span>
      <div className="relative mt-1 max-w-[720px]">
        <div className="flex items-center gap-2 rounded-xl border-2 border-ink/70 bg-white px-3 py-2">
          <Search size={15} className="text-muted shrink-0" />
          <input value={q} onChange={e => setQ(e.target.value)} onFocus={() => sugs.length && setOpen(true)} onKeyDown={e => { if (e.key === 'Enter' && q.trim()) { e.preventDefault(); run(/\d/.test(q) ? { address: q.trim() } : { name: q.trim() }) } }}
            placeholder="Start typing: Elser, Domus Brickell Park, or 1611 SW 2nd Ave" className="w-full min-w-0 bg-transparent text-sm text-ink outline-none" />
          {busy ? <Loader2 size={15} className="animate-spin text-muted shrink-0" /> : null}
        </div>
        {open && sugs.length ? (
          <ul className="absolute z-30 left-0 right-0 mt-1 max-h-80 overflow-auto rounded-xl border border-line bg-white shadow-xl">
            {sugs.map((s, i) => (
              <li key={i}><button type="button" onClick={() => { setQ(s.name || s.address); run(s) }} className="w-full text-left px-3 py-2 hover:bg-app flex items-start gap-2">
                <MapPin size={14} className="mt-0.5 text-muted shrink-0" />
                <span className="min-w-0 flex-1"><b className="block text-[13.5px] text-ink truncate">{s.name || s.address}</b><span className="block text-[12px] text-muted truncate">{[s.name ? s.address : '', s.area].filter(Boolean).join(' · ')}</span></span>
                {s.kind === 'library' ? <span className="shrink-0 rounded-full bg-emerald-50 text-emerald-800 px-2 py-0.5 text-[11px] font-semibold">{s.plans} projections</span> : s.kind === 'portfolio' ? <span className="shrink-0 rounded-full bg-app text-ink px-2 py-0.5 text-[11px] font-semibold">We manage it</span> : null}
              </button></li>
            ))}
            <li><button type="button" onClick={() => run(/\d/.test(q) ? { address: q.trim() } : { name: q.trim() })} className="w-full text-left px-3 py-2 text-[12.5px] font-semibold text-ink border-t border-line hover:bg-app"><Sparkles size={12} className="inline mr-1" /> Look up “{q.trim()}” on the web</button></li>
          </ul>
        ) : null}
      </div>
      {busy ? <p className="mt-2 text-[12.5px] text-muted">{busy}</p> : null}
      {err ? <p className="mt-2 text-[12.5px] text-red-700">{err}</p> : null}

      {res ? (
        <div className="mt-3 rounded-2xl border border-line bg-white p-4 max-w-[1100px]">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="font-serif text-[22px] leading-tight text-ink">{res.building || res.address}</p>
              <p className="text-[12.5px] text-muted">{[res.address, res.area, res.beachMi != null ? (res.beachMi < 0.95 ? res.beachMi.toFixed(1) : Math.round(res.beachMi)) + ' mi to the beach' : ''].filter(Boolean).join(' · ')}</p>
              {f?.summary ? <p className="text-[13px] text-ink mt-2">{f.summary}</p> : null}
              {f ? (
                <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 text-[12.5px]">
                  {([['Type', f.kind], ['Homes', f.homes ? String(f.homes) : ''], ['Storeys', f.storeys ? String(f.storeys) : ''], ['Built', f.year ? String(f.year) : ''], ['Developer', f.developer]] as [string, string][]).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className={lab}>{k}</dt><dd className="text-ink">{v}</dd></div>)}
                </dl>
              ) : null}
              {f?.amenities?.length ? <p className="mt-2 flex flex-wrap gap-1">{f.amenities.map((a: string) => <span key={a} className="rounded-full bg-app px-2 py-0.5 text-[11.5px] text-ink">{a}</span>)}</p> : null}
              {f?.shortTermRentals ? <p className="mt-2 text-[12.5px] text-ink"><b>Short-term rentals:</b> {f.shortTermRentals}</p> : null}
              {res.places?.length ? <p className="mt-2 text-[12px] text-muted">Nearby: {res.places.slice(0, 4).map((p: Any) => p.name + ' ' + p.mi + ' mi').join(' · ')}</p> : null}
              {res.factsError ? <p className="mt-2 text-[12px] text-amber-700">The web lookup did not finish ({res.factsError}). The address and library match still apply.</p> : null}
              {f?.sources?.length ? <p className="mt-2 text-[11.5px] text-muted">Sources: {f.sources.slice(0, 4).map((s: Any, i: number) => <a key={i} href={s.url} target="_blank" rel="noreferrer" className="underline mr-2">{s.title.slice(0, 40)}</a>)}</p> : null}
              <p className="mt-2 text-[11.5px] text-muted">Found on the web: check before it goes to an owner. Everything it filled in can be changed below.</p>
            </div>
            <div className="min-w-0 space-y-3">
              <div className={'rounded-xl p-3 ' + (res.library ? 'bg-emerald-50' : 'bg-amber-50')}>
                <p className={lab}>Projections</p>
                {res.library ? <p className="text-[13px] text-ink mt-0.5"><Check size={13} className="inline text-emerald-700" /> In the library: <b>{res.library.plans} unit types</b>. The deck uses them; pick which below.</p>
                  : <p className="text-[13px] text-ink mt-0.5">Not in the library yet. The deck starts with empty floor plans; add comparables below, or <a href="/sales/projections" target="_blank" rel="noreferrer" className="underline font-semibold">build its projections</a> first.</p>}
              </div>
              <div>
                <p className={lab}><Globe size={11} className="inline" /> Website and look</p>
                <div className="flex gap-2 mt-1">
                  <input value={website} onChange={e => setWebsite(e.target.value)} placeholder="thebuilding.com" className="min-w-0 flex-1 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] text-ink" />
                  <button type="button" disabled={!website.trim() || !!busy} onClick={() => readBrand(website.trim()).finally(() => setBusy(''))} className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-50">Read it</button>
                  {website ? <a href={/^https?:/.test(website) ? website : 'https://' + website} target="_blank" rel="noreferrer" className="grid place-items-center text-muted"><ExternalLink size={14} /></a> : null}
                </div>
                {brand ? <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink"><Check size={12} className="text-emerald-700" /> Theme read:{[brand.theme.navy, brand.theme.warm, brand.theme.sand].filter(Boolean).map((c: string, i: number) => <span key={i} className="inline-block w-4 h-4 rounded-full border border-line" style={{ background: c }} />)}<button type="button" onClick={() => onBrand(null)} className="text-muted underline ml-1">Use the house look</button></p>
                  : <p className="mt-1.5 text-[12px] text-muted">No theme read: the deck uses the house look.</p>}
              </div>
            </div>
          </div>
          {photos.length ? (
            <div className="mt-3">
              <p className={lab}>Cover photo <span className="normal-case tracking-normal font-normal">· pick one, or upload your own below</span></p>
              <div className="mt-1.5 flex gap-2 overflow-x-auto pb-1">
                {photos.map((p, i) => { const on = hero?.url === p.url; return (
                  <button key={i} type="button" onClick={() => onHero(on ? null : { name: p.label, url: p.url })} className={'relative shrink-0 w-[150px] h-[96px] rounded-lg overflow-hidden border-2 ' + (on ? 'border-ink' : 'border-transparent')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className="w-full h-full object-cover" />
                    <span className="absolute left-1 bottom-1 rounded bg-black/65 text-white px-1.5 py-0.5 text-[10px]">{p.label}</span>
                    {on ? <span className="absolute right-1 top-1 rounded-full bg-ink text-white p-0.5"><Check size={11} /></span> : null}
                  </button>
                ) })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
