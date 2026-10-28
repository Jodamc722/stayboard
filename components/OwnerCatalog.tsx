'use client'
// THE OWNER CATALOG (Jon, 2026-10-28): "a full catalog we can send to owners, they can select their
// listing and approve items or the list, see comparables, or upload their own link of items they
// want us to order or purchase". What the owner sees at /catalog/o/<code> — no sign-in.
//
//   1. Their properties (only theirs), each with how far they have got.
//   2. One property's catalog: a tier (Standard / Mid-lux / Luxury) that prices everything;
//      ESSENTIALS in three groups — must-have (always in), recommended (in unless taken out),
//      suggested (out unless added); FURNITURE — Stay's pick per item with every comparable side by
//      side, "Choose this", "Not needed"; YOUR REQUESTS — anything they want us to buy, by link.
//   3. "Approve" per item or the whole set at once, then "Send to Stay".
// Saves as they go (lib/ffe-owner-catalog checks every write against their link).
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, BedDouble, Check, ChevronRight, ExternalLink, Link2, Loader2, Lock, Plus, Send, Sparkles, Star, Users, X, Bath, Package, Trash2,
} from 'lucide-react'

type Tier = 'standard' | 'midlux' | 'luxury'
type Opt = { src: string; vendor: string; name: string; url: string | null; price: number | null; each?: string; image: string | null; chips: string[]; fit: 'cover' | 'contain'; tier: Tier | null; own: boolean }
type Item = { key: string; group: 'essential' | 'furniture'; category: string; name: string; need: 'must' | 'recommended' | 'suggested' | null; qty: number; qtyPer: string
  options: Opt[]; estimate: Partial<Record<Tier, number>>; pick: string | null; ownerPicked: boolean; include: boolean | null; approvedByStay: boolean }
type Listing = { id: string; label: string; building: string | null; photo: string | null; photos: string[]; bedrooms: number | null; bathrooms: number | null; guests: number | null; slug?: string | null; submittedAt?: string | null; chosen?: number }
type Home = { ok: boolean; owner: string; message: string; tier: Tier | null; listings: Listing[]; error?: string }
type Cat = { ok: boolean; owner: string; message: string; tier: Tier; listing: Listing; started: boolean; submittedAt: string | null; ownerNote: string; items: Item[]; error?: string }

const TIERS: { k: Tier; label: string; blurb: string }[] = [
  { k: 'standard', label: 'Standard', blurb: 'Durable, value-first pieces' },
  { k: 'midlux', label: 'Mid-lux', blurb: 'Better materials, delivered and set up' },
  { k: 'luxury', label: 'Luxury', blurb: 'Designer and contract-grade' },
]
const TIER_ORDER: Tier[] = ['standard', 'midlux', 'luxury']
const TIER_LABEL: Record<string, string> = { standard: 'Standard', midlux: 'Mid-lux', luxury: 'Luxury' }
const NEED: Record<string, { label: string; hint: string }> = {
  must: { label: 'Must-haves', hint: 'Every Stay home has these — always included.' },
  recommended: { label: 'Recommended', hint: 'Included unless you take them out.' },
  suggested: { label: 'Suggested', hint: 'Nice extras guests love — add the ones you want.' },
}
const PER: Record<string, string> = { bedroom: 'per bedroom', bathroom: 'per bathroom', guest: 'per guest', unit: '' }
const usd = (v: number | null | undefined, cents = false) => v == null ? '—' : '$' + v.toLocaleString('en-US', cents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 })
const chipTone = (c: string) => /Owner/.test(c) ? 'bg-sky-50 text-sky-800' : /Assembly/.test(c) ? 'bg-amber-50 text-amber-800' : /Delivered/.test(c) ? 'bg-emerald-50 text-emerald-800' : 'bg-app text-muted'
const visibleChips = (o: Opt) => (o.chips || []).filter(c => !/^Search|^Estimate/.test(c)).slice(0, 3)

function tierPick(it: Item, tier: Tier): Opt | null {
  const list = it.options.filter(o => !o.own)
  if (!list.length) return null
  const d = (o: Opt) => (o.tier ? Math.abs(TIER_ORDER.indexOf(o.tier) - TIER_ORDER.indexOf(tier)) : 0.5)
  return [...list].sort((a, b) => d(a) - d(b) || (a.price ?? 1e9) - (b.price ?? 1e9))[0]
}
function estimateAt(it: Item, tier: Tier): number | null {
  if (it.estimate[tier] != null) return it.estimate[tier]!
  for (const t of [...TIER_ORDER].sort((a, b) => Math.abs(TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(tier)) - Math.abs(TIER_ORDER.indexOf(b) - TIER_ORDER.indexOf(tier)))) if (it.estimate[t] != null) return it.estimate[t]!
  return null
}
/** What the item will be bought as right now: their choice, else Stay's pick for the tier. */
function current(it: Item, tier: Tier): { opt: Opt | null; price: number | null; mine: boolean } {
  const chosen = it.pick ? it.options.find(o => o.src === it.pick) || null : null
  if (chosen) return { opt: chosen, price: chosen.price, mine: true }
  const p = tierPick(it, tier)
  return { opt: p, price: p?.price ?? estimateAt(it, tier), mine: false }
}
const included = (it: Item) => it.group === 'essential'
  ? (it.need === 'must' || it.ownerPicked || (it.include ?? it.need === 'recommended'))
  : (!!it.pick && it.include !== false)

export function OwnerCatalog({ code }: { code: string }) {
  const [listingId, setListingId] = useState<string>('')
  const [home, setHome] = useState<Home | null>(null)
  const [cat, setCat] = useState<Cat | null>(null)
  const [err, setErr] = useState('')
  const [tier, setTier] = useState<Tier>('midlux')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [compare, setCompare] = useState<Item | null>(null)
  const [own, setOwn] = useState<{ item: Item | null } | null>(null)
  const [submit, setSubmit] = useState(false)
  const api = `/api/public/owner-catalog/${code}`

  useEffect(() => {
    const read = () => setListingId(new URLSearchParams(window.location.search).get('listing') || '')
    read(); window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])
  useEffect(() => { fetch(api).then(r => r.json()).then((j: Home) => j.ok ? setHome(j) : setErr('This link is not active. Please ask your Stay contact for a new one.')).catch(() => setErr('Could not load. Please refresh.')) }, [api])
  const loadCat = useCallback(async (id: string, keepTier = false) => {
    const j: Cat = await fetch(`${api}?listing=${encodeURIComponent(id)}`).then(r => r.json()).catch(() => ({ ok: false, error: 'Could not load.' } as any))
    if (!j.ok) { setErr(j.error || 'Could not load.'); return }
    setErr(''); setCat(j); if (!keepTier) setTier(j.tier || 'midlux')
  }, [api])
  useEffect(() => { if (listingId) { setCat(null); loadCat(listingId) } }, [listingId, loadCat])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t) }, [toast])

  const open = (id: string) => { window.history.pushState(null, '', id ? `?listing=${encodeURIComponent(id)}` : window.location.pathname); setListingId(id); window.scrollTo({ top: 0 }) }
  const back = () => { open(''); fetch(api).then(r => r.json()).then((j: Home) => j.ok && setHome(j)).catch(() => {}) }

  /** One save. `patch` updates the screen at once; the server's answer then replaces it. */
  const act = async (body: any, patch?: (items: Item[]) => Item[], done?: string) => {
    if (!cat) return { ok: false }
    if (patch) setCat({ ...cat, items: patch(cat.items), started: true })
    setBusy(true)
    const j = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId: cat.listing.id, ...body }) }).then(r => r.json()).catch(() => ({ ok: false, error: 'That did not save.' }))
    setBusy(false)
    if (!j.ok) setToast(j.error || 'That did not save.')
    else if (done) setToast(done)
    await loadCat(cat.listing.id, true)
    return j
  }
  const setItem = (key: string, f: (i: Item) => Item) => (items: Item[]) => items.map(i => (i.key === key ? f(i) : i))
  const choose = (it: Item, src: string | null) => act({ action: 'pick', itemKey: it.key, src }, setItem(it.key, i => ({ ...i, pick: src, ownerPicked: !!src, include: src ? true : i.include })), src ? 'Saved — that’s your choice.' : 'Choice cleared.')
  const include = (it: Item, on: boolean) => act({ action: 'include', itemKey: it.key, on }, setItem(it.key, i => ({ ...i, include: on })))

  if (err && !cat && !home) return <Shell><div className="rounded-2xl border border-line bg-white p-8 text-center text-ink">{err}</div></Shell>
  if (!listingId) return <Shell><HomeView home={home} onOpen={open} /></Shell>
  if (!cat) return <Shell><div className="py-24 text-center text-muted inline-flex w-full justify-center items-center gap-2">{err || <><Loader2 className="w-4 h-4 animate-spin" /> Loading your catalog…</>}</div>{err && <button onClick={back} className="mx-auto block text-sm underline">Back to your properties</button>}</Shell>

  return (
    <Shell>
      <button type="button" onClick={back} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink mb-4"><ArrowLeft className="w-4 h-4" /> All your properties</button>
      <Hero l={cat.listing} />
      {cat.message && <p className="mt-5 rounded-2xl bg-white border border-line px-5 py-4 text-[14px] text-ink/80 leading-relaxed whitespace-pre-line">{cat.message}</p>}
      {cat.submittedAt && <div className="mt-5 rounded-2xl bg-emerald-50 border border-emerald-200 px-5 py-3 text-[14px] text-emerald-900 flex items-center gap-2"><Check className="w-4 h-4" /> Sent to Stay on {new Date(cat.submittedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. You can keep making changes — we see them as you go.</div>}
      <Catalog cat={cat} tier={tier} setTier={t => { setTier(t); if (cat.started) act({ action: 'tier', tier: t }) }} busy={busy}
        onChoose={choose} onInclude={include} onCompare={setCompare} onOwn={item => setOwn({ item })}
        onApprove={section => act({ action: 'approveSet', section, tier }, items => items.map(i => {
          if (i.group !== section) return i
          if (section === 'essential') return i.need === 'suggested' ? i : { ...i, include: true }
          if (i.pick || i.include === false) return i
          const p = tierPick(i, tier); return p ? { ...i, pick: p.src, ownerPicked: true, include: true } : i
        }), section === 'essential' ? 'The recommended set is approved.' : 'Stay’s picks are approved — change any of them anytime.')}
        onRemoveOwn={(it, src) => act({ action: 'removeOwn', itemKey: it.key, src }, setItem(it.key, i => ({ ...i, options: i.options.filter(o => o.src !== src), pick: i.pick === src ? null : i.pick })), 'Link removed.')}
        onSubmit={() => setSubmit(true)} />
      {compare && <Compare it={cat.items.find(i => i.key === compare.key) || compare} tier={tier} onClose={() => setCompare(null)}
        onChoose={(src) => { const it = cat.items.find(i => i.key === compare.key) || compare; choose(it, src); setCompare(null) }}
        onOwn={() => { const it = compare; setCompare(null); setOwn({ item: it }) }} />}
      {own && <OwnLink item={own.item} onClose={() => setOwn(null)} preview={url => act({ action: 'preview', url })}
        onSave={async (d) => { const j = await act({ action: 'own', ...d, itemKey: own.item?.key }, undefined, 'Added — we’ll buy that one.'); if (j.ok) setOwn(null); return j }} />}
      {submit && <Submit cat={cat} tier={tier} onClose={() => setSubmit(false)}
        onSend={async note => { const j = await act({ action: 'submit', note, tier }, undefined, 'Sent to Stay. Thank you!'); if (j.ok) setSubmit(false) }} />}
      {toast && <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-ink text-white text-[13px] font-medium px-4 py-2.5 shadow-lg">{toast}</div>}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-app text-ink">
      <header className="border-b border-line bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-[1180px] mx-auto px-4 h-14 flex items-center justify-between">
          <img src="/stay-logo.png" alt="Stay Hospitality" className="h-6 w-auto" />
          <span className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Furnishing catalog</span>
        </div>
      </header>
      <div className="max-w-[1180px] mx-auto px-4 py-8 pb-28">{children}</div>
    </main>
  )
}

function HomeView({ home, onOpen }: { home: Home | null; onOpen: (id: string) => void }) {
  if (!home) return <div className="py-24 flex justify-center text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>
  return (
    <div>
      <p className="text-[12px] uppercase tracking-[0.18em] text-muted font-semibold">Welcome{home.owner ? `, ${home.owner}` : ''}</p>
      <h1 className="text-[32px] md:text-[40px] font-bold tracking-tight leading-tight mt-1">Furnish your home, your way.</h1>
      <p className="text-[15px] text-muted mt-3 max-w-2xl leading-relaxed">Choose a property to see everything we stock it with — the essentials every guest needs and a complete furniture catalog. Compare options, approve what you like, or send us a link to anything you’d rather have. We order from what you approve, now and whenever something needs replacing.</p>
      {home.message && <p className="mt-5 rounded-2xl bg-white border border-line px-5 py-4 text-[14px] text-ink/80 leading-relaxed whitespace-pre-line max-w-3xl">{home.message}</p>}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 mt-8">
        {home.listings.map(l => (
          <button key={l.id} type="button" onClick={() => onOpen(l.id)} className="group text-left rounded-2xl overflow-hidden bg-white border border-line hover:border-ink/40 hover:shadow-lg transition">
            <div className="aspect-[3/2] bg-line/40 overflow-hidden">{l.photo ? <img src={l.photo} alt="" className="w-full h-full object-cover group-hover:scale-[1.02] transition" /> : <div className="w-full h-full grid place-items-center text-muted"><Package className="w-8 h-8" /></div>}</div>
            <div className="p-4">
              <div className="font-bold text-[16px] text-ink">{l.label}</div>
              <div className="text-[12.5px] text-muted mt-0.5">{[l.building, size(l)].filter(Boolean).join(' · ')}</div>
              <div className="mt-3 flex items-center justify-between">
                <Status l={l} />
                <span className="text-[13px] font-semibold text-ink inline-flex items-center gap-1">{l.slug ? 'Continue' : 'Start'} <ChevronRight className="w-4 h-4" /></span>
              </div>
            </div>
          </button>
        ))}
        {!home.listings.length && <p className="text-sm text-muted">No properties are on this link yet — your Stay contact will add them.</p>}
      </div>
    </div>
  )
}
const size = (l: Listing) => [l.bedrooms === 0 ? 'Studio' : l.bedrooms != null ? `${l.bedrooms} BR` : '', l.bathrooms != null ? `${l.bathrooms} BA` : '', l.guests ? `sleeps ${l.guests}` : ''].filter(Boolean).join(' · ')
function Status({ l }: { l: Listing }) {
  if (l.submittedAt) return <span className="text-[11.5px] font-semibold rounded-full px-2.5 py-1 bg-emerald-50 text-emerald-800">Sent to Stay</span>
  if (l.chosen) return <span className="text-[11.5px] font-semibold rounded-full px-2.5 py-1 bg-sky-50 text-sky-800">{l.chosen} choices saved</span>
  return <span className="text-[11.5px] font-semibold rounded-full px-2.5 py-1 bg-app text-muted border border-line">Not started</span>
}

function Hero({ l }: { l: Listing }) {
  const ph = l.photos.slice(0, 3)
  return (
    <section className="rounded-3xl overflow-hidden bg-white border border-line">
      {ph.length > 0 && (
        <div className={'grid gap-1 ' + (ph.length >= 3 ? 'grid-cols-[2fr_1fr] grid-rows-2 h-[240px] md:h-[320px]' : 'h-[220px] md:h-[300px]')}>
          {ph.map((u, i) => <img key={u} src={u} alt="" className={'w-full h-full object-cover ' + (ph.length >= 3 && i === 0 ? 'row-span-2' : '')} />)}
        </div>
      )}
      <div className="px-6 py-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] md:text-[34px] font-bold tracking-tight leading-tight">{l.label}</h1>
          <div className="text-[13.5px] text-muted mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {l.building && <span>{l.building}</span>}
            {l.bedrooms != null && <span className="inline-flex items-center gap-1"><BedDouble className="w-4 h-4" /> {l.bedrooms === 0 ? 'Studio' : `${l.bedrooms} bedroom${l.bedrooms === 1 ? '' : 's'}`}</span>}
            {l.bathrooms != null && <span className="inline-flex items-center gap-1"><Bath className="w-4 h-4" /> {l.bathrooms} bath</span>}
            {l.guests != null && <span className="inline-flex items-center gap-1"><Users className="w-4 h-4" /> sleeps {l.guests}</span>}
          </div>
        </div>
      </div>
    </section>
  )
}

function Catalog({ cat, tier, setTier, busy, onChoose, onInclude, onCompare, onOwn, onApprove, onRemoveOwn, onSubmit }: {
  cat: Cat; tier: Tier; setTier: (t: Tier) => void; busy: boolean
  onChoose: (it: Item, src: string | null) => void; onInclude: (it: Item, on: boolean) => void; onCompare: (it: Item) => void; onOwn: (it: Item | null) => void
  onApprove: (section: 'essential' | 'furniture') => void; onRemoveOwn: (it: Item, src: string) => void; onSubmit: () => void
}) {
  const ess = cat.items.filter(i => i.group === 'essential')
  const requests = cat.items.filter(i => i.group === 'furniture' && i.category === 'Your requests')
  const furn = cat.items.filter(i => i.group === 'furniture' && i.category !== 'Your requests')
  const cats = useMemo(() => { const m = new Map<string, Item[]>(); for (const i of furn) m.set(i.category, [...(m.get(i.category) || []), i]); return Array.from(m.entries()) }, [furn])
  const essTotal = ess.filter(included).reduce((t, i) => t + (current(i, tier).price ?? 0) * i.qty, 0)
  const furnChosen = [...furn, ...requests].filter(included)
  const furnTotal = furnChosen.reduce((t, i) => t + (current(i, tier).price ?? 0) * i.qty, 0)
  const [nav, setNav] = useState('essentials')
  const jump = (id: string) => { setNav(id); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return (
    <>
      <div className="sticky top-14 z-20 -mx-4 px-4 py-3 mt-6 bg-app/95 backdrop-blur border-b border-line">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="inline-flex rounded-full bg-white border border-line p-1" role="radiogroup" aria-label="Tier">
            {TIERS.map(t => (
              <button key={t.k} type="button" role="radio" aria-checked={tier === t.k} onClick={() => setTier(t.k)} title={t.blurb}
                className={'px-3.5 py-1.5 rounded-full text-[13px] font-semibold inline-flex items-center gap-1 transition ' + (tier === t.k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
                {t.k === 'luxury' && <Star className="w-3.5 h-3.5" />}{t.label}
              </button>
            ))}
          </div>
          <nav className="hidden md:flex items-center gap-1 text-[13px] font-semibold">
            {[['essentials', 'Essentials'], ['furniture', 'Furniture'], ['requests', 'Your requests']].map(([id, label]) => (
              <button key={id} type="button" onClick={() => jump(id)} className={'px-3 py-1.5 rounded-full ' + (nav === id ? 'bg-white border border-line text-ink' : 'text-muted hover:text-ink')}>{label}</button>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold">Estimated</div>
              <div className="text-[17px] font-bold tabular-nums">{usd(essTotal + furnTotal)}</div>
            </div>
            <button type="button" onClick={onSubmit} className="inline-flex items-center gap-1.5 rounded-full bg-ink text-white text-[13px] font-semibold px-4 py-2.5 hover:bg-ink/90">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {cat.submittedAt ? 'Send update' : 'Send to Stay'}
            </button>
          </div>
        </div>
        <p className="text-[12px] text-muted mt-1.5">{TIERS.find(t => t.k === tier)?.blurb}. Prices are estimates; we confirm before buying.</p>
      </div>

      {/* ESSENTIALS */}
      <section id="essentials" className="scroll-mt-36 mt-10">
        <SectionHead title="Essentials" sub="What every guest expects — quantities are set for your home’s size." total={essTotal}
          action={<button type="button" onClick={() => onApprove('essential')} className="inline-flex items-center gap-1.5 rounded-full border border-ink text-ink text-[13px] font-semibold px-4 py-2 hover:bg-ink hover:text-white transition"><Check className="w-4 h-4" /> Approve the recommended set</button>} />
        {(['must', 'recommended', 'suggested'] as const).map(need => {
          const list = ess.filter(i => i.need === need); if (!list.length) return null
          return (
            <div key={need} className="mt-6">
              <div className="flex flex-wrap items-baseline gap-x-2 mb-2"><h3 className="text-[15px] font-bold">{NEED[need].label}</h3><span className="text-[12.5px] text-muted">{NEED[need].hint}</span></div>
              <div className="rounded-2xl bg-white border border-line divide-y divide-line overflow-hidden">
                {list.map(it => <EssentialRow key={it.key} it={it} tier={tier} onInclude={onInclude} onCompare={onCompare} onOwn={onOwn} onChoose={onChoose} onRemoveOwn={onRemoveOwn} />)}
              </div>
            </div>
          )
        })}
        {!ess.length && <p className="text-sm text-muted mt-4">Your Stay contact is finishing the essentials list for this home.</p>}
      </section>

      {/* FURNITURE */}
      <section id="furniture" className="scroll-mt-36 mt-14">
        <SectionHead title="Furniture" sub="Optional — choose what you’d like for this home. Stay’s pick is shown for your tier; compare to see every option." total={furnTotal}
          action={<button type="button" onClick={() => onApprove('furniture')} className="inline-flex items-center gap-1.5 rounded-full border border-ink text-ink text-[13px] font-semibold px-4 py-2 hover:bg-ink hover:text-white transition"><Sparkles className="w-4 h-4" /> Approve all of Stay’s picks</button>} />
        {cats.map(([c, list]) => (
          <div key={c} className="mt-8">
            <h3 className="text-[15px] font-bold mb-3">{c}</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map(it => <FurnitureCard key={it.key} it={it} tier={tier} onChoose={onChoose} onInclude={onInclude} onCompare={onCompare} onOwn={onOwn} />)}
            </div>
          </div>
        ))}
      </section>

      {/* REQUESTS */}
      <section id="requests" className="scroll-mt-36 mt-14">
        <SectionHead title="Your requests" sub="Have something specific in mind? Send us the link and we’ll buy it for this home." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-4">
          {requests.map(it => <FurnitureCard key={it.key} it={it} tier={tier} onChoose={onChoose} onInclude={onInclude} onCompare={onCompare} onOwn={onOwn} onRemoveOwn={onRemoveOwn} />)}
          <button type="button" onClick={() => onOwn(null)} className="rounded-2xl border-2 border-dashed border-line hover:border-ink/40 bg-white/50 min-h-[220px] grid place-items-center text-center p-6 transition">
            <div><div className="mx-auto w-11 h-11 rounded-full bg-ink text-white grid place-items-center"><Plus className="w-5 h-5" /></div>
              <div className="font-bold mt-3">Request something else</div><div className="text-[13px] text-muted mt-1">Paste a link from any store</div></div>
          </button>
        </div>
      </section>
    </>
  )
}

function SectionHead({ title, sub, total, action }: { title: string; sub: string; total?: number; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
      <div><h2 className="text-[24px] font-bold tracking-tight">{title}{total != null && total > 0 && <span className="ml-3 text-[15px] font-semibold text-muted tabular-nums">{usd(total)}</span>}</h2><p className="text-[13.5px] text-muted mt-0.5">{sub}</p></div>
      {action}
    </div>
  )
}

function Thumb({ o, cls = 'hidden sm:grid w-14 h-14' }: { o: Opt | null; cls?: string }) {
  return <div className={cls + ' rounded-xl bg-app border border-line overflow-hidden shrink-0 place-items-center'}>{o?.image ? <img src={o.image} alt="" className={'w-full h-full ' + (o.fit === 'cover' ? 'object-cover' : 'object-contain p-1')} /> : <Package className="w-5 h-5 text-muted" />}</div>
}

function EssentialRow({ it, tier, onInclude, onCompare, onOwn, onChoose, onRemoveOwn }: { it: Item; tier: Tier; onInclude: (it: Item, on: boolean) => void; onCompare: (it: Item) => void; onOwn: (it: Item) => void; onChoose: (it: Item, s: string | null) => void; onRemoveOwn: (it: Item, src: string) => void }) {
  const c = current(it, tier)
  const on = included(it)
  const ownOpt = c.opt?.own ? c.opt : null
  return (
    <div className={'flex items-center gap-3 sm:gap-4 px-4 py-3 ' + (on ? '' : 'opacity-60')}>
      <Thumb o={c.opt} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-[14.5px] text-ink">{it.name}{it.qty > 1 && <span className="text-muted font-medium"> × {it.qty}</span>}</div>
        <div className="text-[12.5px] text-muted truncate">
          {c.mine && c.opt ? <span className="text-sky-800 font-medium">{ownOpt ? 'Your link' : 'Your choice'}: {c.opt.name}</span> : c.opt ? `${c.opt.vendor} · ${c.opt.name}` : 'Stay sources this for your tier'}
          {PER[it.qtyPer] && <span> · {PER[it.qtyPer]}</span>}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[12.5px] font-semibold">
          {it.options.length > 1 && <button type="button" onClick={() => onCompare(it)} className="text-ink underline underline-offset-2">Compare {it.options.length}</button>}
          {ownOpt ? <button type="button" onClick={() => onRemoveOwn(it, ownOpt.src)} className="text-muted hover:text-rose-700">Remove my link</button>
            : <button type="button" onClick={() => onOwn(it)} className="text-muted hover:text-ink inline-flex items-center gap-1"><Link2 className="w-3.5 h-3.5" /> Use my own link</button>}
          {c.mine && !ownOpt && <button type="button" onClick={() => onChoose(it, null)} className="text-muted hover:text-ink">Use Stay’s pick</button>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[14.5px] font-bold tabular-nums">{c.price != null ? usd(c.price * it.qty) : '—'}</div>
        {!c.opt && c.price != null && <div className="text-[11px] text-muted">estimate</div>}
      </div>
      <div className="shrink-0 sm:w-[92px] flex justify-end">
        {it.need === 'must'
          ? <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-800 bg-emerald-50 rounded-full px-2 sm:px-2.5 py-1" title="Always included"><Lock className="w-3 h-3" /><span className="hidden sm:inline">Included</span></span>
          : <Switch on={on} onChange={v => onInclude(it, v)} label={`Include ${it.name}`} />}
      </div>
    </div>
  )
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={'relative w-11 h-6 rounded-full transition ' + (on ? 'bg-emerald-600' : 'bg-line')}>
      <span className={'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ' + (on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  )
}

function FurnitureCard({ it, tier, onChoose, onInclude, onCompare, onOwn, onRemoveOwn }: { it: Item; tier: Tier; onChoose: (it: Item, s: string | null) => void; onInclude: (it: Item, on: boolean) => void; onCompare: (it: Item) => void; onOwn: (it: Item) => void; onRemoveOwn?: (it: Item, src: string) => void }) {
  const c = current(it, tier)
  const chosen = included(it)
  const skipped = it.include === false
  const o = c.opt
  return (
    <article className={'rounded-2xl bg-white border overflow-hidden flex flex-col transition ' + (chosen ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-line') + (skipped ? ' opacity-55' : '')}>
      <div className="relative aspect-[4/3] bg-app">
        {o?.image ? <img src={o.image} alt="" className={'w-full h-full ' + (o.fit === 'cover' ? 'object-cover' : 'object-contain p-4')} /> : <div className="w-full h-full grid place-items-center text-muted"><Package className="w-8 h-8" /></div>}
        <div className="absolute top-3 left-3 flex gap-1.5">
          {chosen ? <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-emerald-600 text-white inline-flex items-center gap-1"><Check className="w-3 h-3" /> {o?.own ? 'Your link' : it.approvedByStay ? 'Approved' : 'Your choice'}</span>
            : skipped ? <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-ink/70 text-white">Not needed</span>
              : <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-white/90 text-ink border border-line">Stay’s pick · {TIER_LABEL[tier]}</span>}
        </div>
      </div>
      <div className="p-4 flex-1 flex flex-col">
        {!it.options.some(x => x.name === it.name) && <div className="text-[12px] text-muted font-semibold uppercase tracking-wider">{it.name}</div>}
        <div className="font-semibold text-[14.5px] text-ink mt-0.5 line-clamp-2">{o?.name || 'Choose an option'}</div>
        <div className="flex items-baseline justify-between mt-1.5">
          <span className="text-[13px] text-muted">{o?.vendor}</span>
          <span className="text-[16px] font-bold tabular-nums">{usd(c.price, true)}</span>
        </div>
        {o && visibleChips(o).length > 0 && <div className="flex flex-wrap gap-1 mt-2">{visibleChips(o).map(ch => <span key={ch} className={'text-[11px] font-semibold rounded-full px-2 py-0.5 ' + chipTone(ch)}>{ch}</span>)}</div>}
        <div className="mt-auto pt-4 flex flex-wrap items-center gap-2">
          {!chosen && o && <button type="button" onClick={() => onChoose(it, o.src)} className="rounded-full bg-ink text-white text-[13px] font-semibold px-4 py-2">Choose this</button>}
          {chosen && <button type="button" onClick={() => onChoose(it, null)} className="rounded-full border border-line text-[13px] font-semibold px-3.5 py-2 hover:border-ink">Undo</button>}
          {it.options.length > 1 && <button type="button" onClick={() => onCompare(it)} className="rounded-full border border-line text-[13px] font-semibold px-3.5 py-2 hover:border-ink">Compare {it.options.length}</button>}
          {o?.url && <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1 ml-auto">View <ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
        <div className="flex items-center gap-3 mt-3 text-[12.5px] font-semibold">
          {o?.own && onRemoveOwn ? <button type="button" onClick={() => onRemoveOwn(it, o.src)} className="text-muted hover:text-rose-700 inline-flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Remove</button>
            : <button type="button" onClick={() => onOwn(it)} className="text-muted hover:text-ink inline-flex items-center gap-1"><Link2 className="w-3.5 h-3.5" /> Use my own link</button>}
          {!o?.own && <button type="button" onClick={() => onInclude(it, skipped)} className="text-muted hover:text-ink">{skipped ? 'Show again' : 'Not needed'}</button>}
        </div>
      </div>
    </article>
  )
}

function Modal({ title, sub, onClose, children, wide }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px] flex items-end md:items-center justify-center p-0 md:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} className={'bg-white w-full rounded-t-3xl md:rounded-3xl shadow-2xl max-h-[92vh] overflow-auto ' + (wide ? 'md:max-w-[1080px]' : 'md:max-w-[560px]')}>
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-line px-6 py-4 flex items-start justify-between gap-4 z-10">
          <div><h2 className="text-[19px] font-bold">{title}</h2>{sub && <p className="text-[13px] text-muted mt-0.5">{sub}</p>}</div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-app"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function Compare({ it, tier, onClose, onChoose, onOwn }: { it: Item; tier: Tier; onClose: () => void; onChoose: (src: string) => void; onOwn: () => void }) {
  const stay = tierPick(it, tier)
  const opts = [...it.options].sort((a, b) => (a.own ? 1 : 0) - (b.own ? 1 : 0) || TIER_ORDER.indexOf(a.tier || 'midlux') - TIER_ORDER.indexOf(b.tier || 'midlux') || (a.price ?? 1e9) - (b.price ?? 1e9))
  const low = Math.min(...opts.map(o => o.price ?? Infinity))
  return (
    <Modal title={`Compare — ${it.options.some(o => o.name === it.name) ? it.category : it.name}`} sub={`${opts.length} options. Choose one, or send us a link to something else.`} onClose={onClose} wide>
      <div className="flex gap-4 overflow-x-auto pb-2 snap-x">
        {opts.map(o => {
          const mine = it.pick === o.src
          return (
            <div key={o.src} className={'snap-start shrink-0 w-[250px] rounded-2xl border overflow-hidden flex flex-col ' + (mine ? 'border-emerald-500 ring-1 ring-emerald-500' : 'border-line')}>
              <div className="aspect-square bg-app">{o.image ? <img src={o.image} alt="" className={'w-full h-full ' + (o.fit === 'cover' ? 'object-cover' : 'object-contain p-4')} /> : <div className="w-full h-full grid place-items-center text-muted"><Package className="w-8 h-8" /></div>}</div>
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex flex-wrap gap-1 mb-2">
                  {o.tier && <span className="text-[10.5px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 bg-app border border-line">{TIER_LABEL[o.tier]}</span>}
                  {stay?.src === o.src && <span className="text-[10.5px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 bg-ink text-white">Stay’s pick</span>}
                  {o.own && <span className="text-[10.5px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 bg-sky-50 text-sky-800">Your link</span>}
                </div>
                <div className="text-[12.5px] text-muted font-semibold">{o.vendor}</div>
                <div className="font-semibold text-[14px] leading-snug mt-0.5 line-clamp-3">{o.name}</div>
                <div className="mt-2 flex items-baseline gap-2"><span className="text-[18px] font-bold tabular-nums">{usd(o.price, true)}</span>
                  {o.price != null && Number.isFinite(low) && o.price > low && <span className="text-[12px] text-muted">+{usd(o.price - low)}</span>}
                  {o.price != null && o.price === low && opts.length > 1 && <span className="text-[12px] text-emerald-700 font-semibold">Lowest</span>}</div>
                {o.each && <div className="text-[12px] text-muted">{o.each}</div>}
                {visibleChips(o).length > 0 && <div className="flex flex-wrap gap-1 mt-2">{visibleChips(o).map(ch => <span key={ch} className={'text-[11px] font-semibold rounded-full px-2 py-0.5 ' + chipTone(ch)}>{ch}</span>)}</div>}
                <div className="mt-auto pt-4 grid gap-2">
                  {mine ? <span className="rounded-full bg-emerald-600 text-white text-[13px] font-semibold px-4 py-2 text-center inline-flex items-center justify-center gap-1"><Check className="w-4 h-4" /> Your choice</span>
                    : <button type="button" onClick={() => onChoose(o.src)} className="rounded-full bg-ink text-white text-[13px] font-semibold px-4 py-2">Choose this</button>}
                  {o.url && <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-center text-muted hover:text-ink inline-flex items-center justify-center gap-1">View product <ExternalLink className="w-3.5 h-3.5" /></a>}
                </div>
              </div>
            </div>
          )
        })}
        <button type="button" onClick={onOwn} className="snap-start shrink-0 w-[250px] rounded-2xl border-2 border-dashed border-line hover:border-ink/40 grid place-items-center text-center p-6">
          <div><div className="mx-auto w-11 h-11 rounded-full bg-ink text-white grid place-items-center"><Link2 className="w-5 h-5" /></div><div className="font-bold mt-3">Prefer something else?</div><div className="text-[13px] text-muted mt-1">Paste a link from any store</div></div>
        </button>
      </div>
    </Modal>
  )
}

function OwnLink({ item, onClose, preview, onSave }: { item: Item | null; onClose: () => void; preview: (url: string) => Promise<any>; onSave: (d: { url: string; name: string; price: string; note: string; item: string }) => Promise<any> }) {
  const [url, setUrl] = useState('')
  const [what, setWhat] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [looking, setLooking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const look = async (u: string) => {
    if (!/^https?:\/\/\S+\.\S+/.test(u)) return
    setLooking(true); setErr('')
    const j = await preview(u); setLooking(false)
    if (j?.ok) { if (j.name && !name) setName(j.name); if (j.price != null && !price) setPrice(String(j.price)); setImage(j.image || null) }
  }
  const save = async () => {
    setErr('')
    if (!/^https?:\/\/\S+\.\S+/.test(url)) { setErr('Paste the full product link (starting with https://).'); return }
    if (!item && !what.trim()) { setErr('What is the item? (e.g. “Bar stools”)'); return }
    setSaving(true); const j = await onSave({ url, name, price, note, item: what }); setSaving(false)
    if (!j?.ok) setErr(j?.error || 'That did not save.')
  }
  const field = 'w-full rounded-xl border border-line px-3.5 py-2.5 text-[14px] focus:outline-none focus:border-ink'
  return (
    <Modal title={item ? `Your own link — ${item.name}` : 'Request something else'} sub="Paste a product link from any store. We’ll order it for this home." onClose={onClose}>
      <div className="grid gap-4">
        {!item && <label className="grid gap-1.5 text-[13px] font-semibold">What is it?<input className={field} value={what} onChange={e => setWhat(e.target.value)} placeholder="e.g. Bar stools, artwork for the living room" /></label>}
        <label className="grid gap-1.5 text-[13px] font-semibold">Product link
          <input className={field} value={url} onChange={e => setUrl(e.target.value)} onBlur={() => look(url)} onPaste={e => { const v = e.clipboardData.getData('text'); setTimeout(() => look(v.trim()), 0) }} placeholder="https://…" inputMode="url" /></label>
        {(looking || image || name) && (
          <div className="flex gap-3 items-center rounded-xl bg-app border border-line p-3">
            <div className="w-16 h-16 rounded-lg bg-white border border-line overflow-hidden grid place-items-center shrink-0">{looking ? <Loader2 className="w-4 h-4 animate-spin text-muted" /> : image ? <img src={image} alt="" className="w-full h-full object-contain" /> : <Package className="w-5 h-5 text-muted" />}</div>
            <div className="text-[13px] text-muted">{looking ? 'Reading the link…' : 'Check the name and price below.'}</div>
          </div>
        )}
        <div className="grid grid-cols-[1fr_130px] gap-3">
          <label className="grid gap-1.5 text-[13px] font-semibold">Product name<input className={field} value={name} onChange={e => setName(e.target.value)} placeholder="Optional" /></label>
          <label className="grid gap-1.5 text-[13px] font-semibold">Price<input className={field} value={price} onChange={e => setPrice(e.target.value)} placeholder="$" inputMode="decimal" /></label>
        </div>
        <label className="grid gap-1.5 text-[13px] font-semibold">Anything we should know?<textarea className={field} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="Color, size, quantity…" /></label>
        {err && <p className="text-[13px] text-rose-700">{err}</p>}
        <button type="button" disabled={saving} onClick={save} className="rounded-full bg-ink text-white text-[14px] font-semibold px-5 py-3 inline-flex items-center justify-center gap-2 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Add and choose this</button>
      </div>
    </Modal>
  )
}

function Submit({ cat, tier, onClose, onSend }: { cat: Cat; tier: Tier; onClose: () => void; onSend: (note: string) => Promise<void> }) {
  const [note, setNote] = useState(cat.ownerNote || '')
  const [sending, setSending] = useState(false)
  const ess = cat.items.filter(i => i.group === 'essential' && included(i))
  const furn = cat.items.filter(i => i.group === 'furniture' && included(i))
  const links = cat.items.filter(i => included(i) && current(i, tier).opt?.own)
  const total = [...ess, ...furn].reduce((t, i) => t + (current(i, tier).price ?? 0) * i.qty, 0)
  return (
    <Modal title={cat.submittedAt ? 'Send your update to Stay' : 'Send to Stay'} sub={`${cat.listing.label} · ${TIER_LABEL[tier]}`} onClose={onClose}>
      <div className="grid grid-cols-3 gap-3">
        {[[ess.length, 'essentials'], [furn.length, 'furniture pieces'], [links.length, 'your links']].map(([n, l]) => (
          <div key={String(l)} className="rounded-2xl bg-app border border-line p-3 text-center"><div className="text-[22px] font-bold tabular-nums">{n}</div><div className="text-[12px] text-muted">{l}</div></div>
        ))}
      </div>
      <div className="mt-4 flex items-baseline justify-between rounded-2xl border border-line px-4 py-3"><span className="text-[14px] font-semibold">Estimated total</span><span className="text-[22px] font-bold tabular-nums">{usd(total)}</span></div>
      <p className="text-[12.5px] text-muted mt-2">An estimate before tax and delivery. We confirm the order with you before anything is bought.</p>
      <label className="grid gap-1.5 text-[13px] font-semibold mt-5">A note for the Stay team<textarea rows={3} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-xl border border-line px-3.5 py-2.5 text-[14px] font-normal focus:outline-none focus:border-ink" placeholder="Timing, budget, anything else…" /></label>
      <button type="button" disabled={sending} onClick={async () => { setSending(true); await onSend(note); setSending(false) }} className="mt-5 w-full rounded-full bg-ink text-white text-[14px] font-semibold px-5 py-3 inline-flex items-center justify-center gap-2 disabled:opacity-60">{sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send to Stay</button>
    </Modal>
  )
}
