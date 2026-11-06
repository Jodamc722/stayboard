'use client'
import { call, verifyPush, type RegenResult } from '@/lib/regenerate-client'
// REGENERATE THE WHOLE LISTING, ONE PASS (Jon, 2026-11-05: "a full regenerate option — gives you the
// option to redo all title, description, all sections, captions … keep same content but redo it all
// at once … mirror, enhance, reorganize photos, reselect first 5, redo captions … add photos of
// amenities from similar listings if same property … that option should be at the listing level").
//
// Tick what to redo, press Run. Every step uses the tool that already does that job on its own tab —
// the copywriter (/api/optimize-listing), the photo analyst (/api/optimize-photos: order, first five,
// captions), the image pass (/api/photo-enhance: mirror and/or enhance EVERY photo, nothing skipped),
// and the property's own amenity shots from its sibling units (/api/listing-regenerate/amenity-photos).
// The results come back as one review — before/after title, the sections, the new first five, the
// captions, the images, the borrowed amenity photos — each part with its own tick. Nothing reaches
// Guesty until "Push everything", which writes the copy and the photos in two calls.
import { useState } from 'react'
import { Loader2, RefreshCw, Check, X, FlipHorizontal2, Sparkles, Images, Type, ListOrdered, MessageSquareText, Building2, UploadCloud, ChevronDown, ChevronRight } from 'lucide-react'

type Content = { title: string; summary: string; space: string; access: string; neighborhood: string; transit: string; notes: string }
const SECTIONS: { key: keyof Content; label: string }[] = [
  { key: 'summary', label: 'Summary' }, { key: 'space', label: 'The space' }, { key: 'access', label: 'Guest access' },
  { key: 'neighborhood', label: 'Neighborhood' }, { key: 'transit', label: 'Getting around' }, { key: 'notes', label: 'Other notes' },
]
type Pic = { id: string; url: string; thumb: string; caption: string }
type Borrow = { url: string; thumb: string; caption: string; amenity: string; label: string; fromUnit: string }
type Opts = { title: boolean; sections: boolean; order: boolean; captions: boolean; enhance: boolean; mirror: boolean; amenities: boolean }
type Step = { key: string; label: string; state: 'wait' | 'run' | 'done' | 'fail' | 'skip'; note?: string }

// Every step goes through the shared caller: a rate limit or overload waits and retries instead of
// failing the step (Jon, 2026-11-06: "says too many requests").
const j = (url: string, body?: any) => call(url, body)

export function ListingRegenerate({ listingId, name }: { listingId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<Opts>({ title: true, sections: true, order: true, captions: true, enhance: true, mirror: false, amenities: true })
  const [steer, setSteer] = useState('')
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  // results
  const [copy, setCopy] = useState<{ current: Content; proposed: Content; titleMax: number; factIssues: string[] } | null>(null)
  const [synced, setSynced] = useState<{ ok: boolean; missing: string[] } | null>(null)
  const [title, setTitle] = useState('')
  const [base, setBase] = useState<Pic[]>([])
  const [order, setOrder] = useState<string[] | null>(null)
  const [caps, setCaps] = useState<Record<string, string>>({})
  const [imgs, setImgs] = useState<Record<string, string>>({})
  const [imgLabel, setImgLabel] = useState('')
  const [borrow, setBorrow] = useState<Borrow[]>([])
  const [borrowOn, setBorrowOn] = useState<Set<number>>(new Set())
  const [use, setUse] = useState({ title: true, sections: true, order: true, captions: true, images: true })
  const [showSections, setShowSections] = useState(false)
  const [showCaps, setShowCaps] = useState(false)
  const [pushing, setPushing] = useState(false)

  const set = (k: keyof Opts) => setOpts(o => ({ ...o, [k]: !o[k] }))
  const mark = (key: string, state: Step['state'], note?: string) => setSteps(s => s.map(x => (x.key === key ? { ...x, state, note } : x)))

  async function run() {
    if (running) return
    setRunning(true); setErr(''); setMsg('')
    setCopy(null); setOrder(null); setCaps({}); setImgs({}); setBorrow([]); setBorrowOn(new Set())
    const plan: Step[] = [
      { key: 'copy', label: 'Title and description', state: opts.title || opts.sections ? 'wait' : 'skip' },
      { key: 'photos', label: 'Photo order, first five and captions', state: opts.order || opts.captions ? 'wait' : 'skip' },
      { key: 'images', label: opts.mirror && opts.enhance ? 'Mirror + enhance every photo' : opts.mirror ? 'Mirror every photo' : 'Enhance every photo', state: opts.mirror || opts.enhance ? 'wait' : 'skip' },
      { key: 'amenities', label: 'Amenity photos from the same property', state: opts.amenities ? 'wait' : 'skip' },
    ]
    setSteps(plan)
    // The live photos, always — the base every photo step works from.
    let pics: Pic[] = []
    let factHold = false
    try {
      const lib = await j('/api/photos/library?listing=' + encodeURIComponent(listingId))
      pics = (lib.photos || []).map((p: any) => ({ id: String(p.id), url: String(p.url), thumb: String(p.thumb || p.url), caption: String(p.caption || '') }))
      setBase(pics)
    } catch (e: any) { setErr('Could not read the listing’s photos: ' + String(e?.message || e)) }

    // 1 — copy: same facts, new words.
    if (opts.title || opts.sections) {
      mark('copy', 'run')
      try {
        const instruction = 'REGENERATE THIS LISTING: rewrite the title and all six sections with fresh wording and a fresh structure. KEEP THE SAME CONTENT — the same facts, features, rules and details already in the listing, nothing added that is not true of this unit, nothing important dropped. Keep the house voice exactly as specified.' + (steer.trim() ? ' Also make sure to: ' + steer.trim() : '')
        const d = await j('/api/optimize-listing', { listingId, instruction })
        const fi: string[] = Array.isArray(d.factIssues) ? d.factIssues : []
        factHold = fi.length > 0
        setCopy({ current: d.current, proposed: d.proposed, titleMax: d.titleMax || 50, factIssues: fi }); setTitle(String(d.proposed?.title || ''))
        mark('copy', fi.length ? 'fail' : 'done', fi.length ? 'held back — the new copy disagrees with the listing (see below)' : undefined)
      } catch (e: any) { mark('copy', 'fail', String(e?.message || e)) }
    }
    // 2 — photos: order, first five, captions.
    if (opts.order || opts.captions) {
      mark('photos', 'run')
      try {
        const d = await j('/api/optimize-photos', { listingId, ...(opts.captions ? { regenerateCaptions: true } : {}), ...(opts.order ? { autoHero: true } : {}), ...(steer.trim() ? { guidance: steer.trim() } : {}) })
        if (opts.order && Array.isArray(d.proposedOrder) && d.proposedOrder.length) setOrder(d.proposedOrder.map(String))
        if (opts.captions) {
          const c: Record<string, string> = {}
          for (const p of (d.photos || []) as any[]) if (p && p._id && typeof p.caption === 'string' && p.caption.trim() && !p.captionIsPlaceholder) c[String(p._id)] = p.caption.trim()
          setCaps(c)
        }
        mark('photos', 'done', d.partial ? String(d.partial) : undefined)
      } catch (e: any) { mark('photos', 'fail', String(e?.message || e)) }
    }
    // 3 — images: every photo, nothing skipped as "already good".
    if ((opts.mirror || opts.enhance) && pics.length) {
      mark('images', 'run')
      const ids = pics.map(p => p.id), out: Record<string, string> = {}
      const size = opts.mirror ? 6 : 8
      let failed = 0
      try {
        for (let i = 0; i < ids.length; i += size) {
          mark('images', 'run', Math.min(i + size, ids.length) + ' of ' + ids.length)
          const chunk = ids.slice(i, i + size)
          const body: any = { listingId, photoIds: chunk, force: true }
          if (opts.mirror) { body.flip = true; if (opts.enhance) body.flipEnhance = true }
          const d = await j('/api/photo-enhance', body).catch((e: any) => { failed += chunk.length; return { photos: [], err: String(e?.message || e) } })
          for (const p of (d.photos || []) as any[]) { const u = p.flippedUrl || p.enhancedUrl; if (u) out[String(p._id)] = u }
          failed += (d.errors || []).length
          setImgs({ ...out })
        }
        setImgLabel(opts.mirror && opts.enhance ? 'Mirrored + enhanced' : opts.mirror ? 'Mirrored' : 'Enhanced')
        mark('images', Object.keys(out).length ? 'done' : 'fail', Object.keys(out).length + ' of ' + ids.length + ' ready' + (failed ? ' · ' + failed + ' could not be done' : ''))
      } catch (e: any) { mark('images', 'fail', String(e?.message || e)) }
    } else if (opts.mirror || opts.enhance) mark('images', 'fail', 'no photos to work on')
    // 4 — amenity photos from sibling units.
    if (opts.amenities) {
      mark('amenities', 'run')
      try {
        const d = await j('/api/listing-regenerate/amenity-photos?listingId=' + encodeURIComponent(listingId))
        const b: Borrow[] = d.photos || []
        setBorrow(b); setBorrowOn(new Set(b.map((_, i) => i)))
        mark('amenities', 'done', b.length ? b.length + ' found at ' + d.building : (d.note || 'nothing missing — this listing already shows the property’s amenities'))
      } catch (e: any) { mark('amenities', 'fail', String(e?.message || e)) }
    }
    // Copy that disagrees with the listing's own numbers starts unticked; the person decides.
    setUse({ title: !factHold, sections: !factHold, order: true, captions: true, images: true })
    setSynced(null)
    setRunning(false)
  }

  const byId = new Map(base.map(p => [p.id, p]))
  const liveOrder = base.map(p => p.id)
  const newOrder = (use.order && order ? order.filter(id => byId.has(id)).concat(liveOrder.filter(id => !(order || []).includes(id))) : liveOrder)
  const capChanged = Object.entries(caps).filter(([id, c]) => byId.has(id) && (byId.get(id)!.caption || '') !== c)
  const sectionsChanged = copy ? SECTIONS.filter(s => (copy.proposed[s.key] || '').trim() && (copy.proposed[s.key] || '').trim() !== (copy.current[s.key] || '').trim()) : []
  const titleChanged = !!copy && opts.title && title.trim() && title.trim() !== (copy.current.title || '').trim()
  const borrowed = borrow.filter((_, i) => borrowOn.has(i))
  const anything = (titleChanged && use.title) || (sectionsChanged.length && opts.sections && use.sections) || (use.order && order) || (use.captions && capChanged.length) || (use.images && Object.keys(imgs).length) || borrowed.length

  async function pushAll() {
    if (!anything || pushing) return
    if (copy && use.title && titleChanged && title.trim().length > copy.titleMax) { setErr('The new title is over the ' + copy.titleMax + '-character limit — trim it first.'); return }
    if (copy && use.sections && opts.sections && copy.proposed.summary.trim().length > 500 && sectionsChanged.some(x => x.key === 'summary')) { setErr('The summary is ' + copy.proposed.summary.trim().length + ' characters — Airbnb allows 500. Trim it first.'); return }
    const parts = [
      titleChanged && use.title ? 'the title' : '', sectionsChanged.length && opts.sections && use.sections ? sectionsChanged.length + ' description section' + (sectionsChanged.length === 1 ? '' : 's') : '',
      use.order && order ? 'the photo order (new first five)' : '', use.captions && capChanged.length ? capChanged.length + ' captions' : '',
      use.images && Object.keys(imgs).length ? Object.keys(imgs).length + ' ' + imgLabel.toLowerCase() + ' photos' : '', borrowed.length ? borrowed.length + ' amenity photo' + (borrowed.length === 1 ? '' : 's') + ' from the same property' : '',
    ].filter(Boolean)
    if (!window.confirm('Push to Guesty for "' + name + '": ' + parts.join(', ') + '? This updates the live listing on every connected channel.')) return
    setPushing(true); setErr(''); setMsg(''); setSynced(null)
    const done: string[] = []
    const pushedSections: string[] = []
    try {
      if (copy && ((titleChanged && use.title) || (sectionsChanged.length && opts.sections && use.sections))) {
        const sections: Record<string, string> = {}
        if (opts.sections && use.sections) for (const s of sectionsChanged) { sections[s.key] = copy.proposed[s.key].trim(); pushedSections.push(s.key) }
        await j('/api/listing-content', { listingId, title: titleChanged && use.title ? title.trim() : undefined, publicDescription: sections, recreate: true })
        done.push('copy')
      }
      const photoWork = (use.order && order) || (use.captions && capChanged.length) || (use.images && Object.keys(imgs).length) || borrowed.length
      if (photoWork) {
        const adds: Record<string, { url: string; caption: string }> = {}
        borrowed.forEach((b, i) => { adds['borrow-' + i + '-' + Date.now().toString(36)] = { url: b.url, caption: b.caption } })
        const body: any = { listingId, order: newOrder.concat(Object.keys(adds)) }
        if (use.captions && capChanged.length) body.captions = Object.fromEntries(capChanged)
        if (use.images && Object.keys(imgs).length) body.urls = imgs
        if (Object.keys(adds).length) body.adds = adds
        await j('/api/photo-order', body)
        done.push('photos')
      }
      // DID IT SYNC? Read Guesty back and say so — and keep everything here so it can be pushed again.
      setMsg('Pushed to Guesty (' + done.join(' + ') + '). Checking that Guesty has it…')
      await new Promise(r => setTimeout(r, 6000))
      const r: RegenResult = { listingId, base, copy: copy ? { current: copy.current, proposed: { ...copy.proposed, title: title.trim() }, titleMax: copy.titleMax, factIssues: [], warnings: [] } : null, order, caps, imgs, imgLabel, borrow, errors: [] }
      const c = await verifyPush(r, { titleChanged: !!(titleChanged && use.title), title: title.trim(), sections: pushedSections } as any, done)
      setSynced({ ok: c.synced, missing: c.missing })
      if (c.synced) {
        setMsg('✓ Pushed and synced — Guesty has the new ' + done.join(' and ') + '. Airbnb and the site update within hours, Vrbo in 24–48h.')
        try { window.dispatchEvent(new CustomEvent('stay:score-refresh')) } catch { /* no-op */ }
      } else { setMsg(''); setErr('Pushed, but Guesty does not show: ' + c.missing.join(', ') + '. Use Push again.') }
    } catch (e: any) { setErr((done.length ? 'Pushed ' + done.join(' + ') + ', then: ' : '') + String(e?.message || e)) }
    setPushing(false)
  }

  const Opt = ({ k, icon, label, hint }: { k: keyof Opts; icon: any; label: string; hint: string }) => {
    const I = icon
    return (
      <button onClick={() => set(k)} disabled={running} title={hint}
        className={'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold ' + (opts[k] ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink/40')}>
        {opts[k] ? <Check size={13} /> : <I size={13} />} {label}
      </button>
    )
  }
  const Use = ({ k, label }: { k: keyof typeof use; label: string }) => (
    <label className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink cursor-pointer">
      <input type="checkbox" checked={use[k]} onChange={() => setUse(u => ({ ...u, [k]: !u[k] }))} /> {label}
    </label>
  )

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-brand-50 to-white flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><RefreshCw size={15} className="text-brand-600" /> Regenerate listing</h2>
          <p className="text-[12px] text-muted mt-0.5">Redo the whole listing in one pass — same content, fresh copy, captions and photos. You review everything before it goes live.</p>
        </div>
        <button onClick={() => setOpen(o => !o)} className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-bold">
          {open ? <X size={13} /> : <RefreshCw size={13} />} {open ? 'Close' : 'Regenerate…'}
        </button>
      </div>
      {open && (
        <div className="px-4 py-3 space-y-3">
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1.5">Copy</p>
            <div className="flex flex-wrap gap-2">
              <Opt k="title" icon={Type} label="Title" hint="A new title from the same facts" />
              <Opt k="sections" icon={MessageSquareText} label="All description sections" hint="Summary, the space, guest access, neighborhood, getting around, other notes" />
            </div>
          </div>
          <div>
            <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1.5">Photos</p>
            <div className="flex flex-wrap gap-2">
              <Opt k="order" icon={ListOrdered} label="Reorganize + pick first five" hint="The AI order: cover first, best five, then room by room" />
              <Opt k="captions" icon={MessageSquareText} label="Redo every caption" hint="A fresh caption for every photo" />
              <Opt k="enhance" icon={Sparkles} label="Enhance every photo" hint="Light, colour and sharpness corrected on every photo — none skipped" />
              <Opt k="mirror" icon={FlipHorizontal2} label="Mirror every photo" hint="Every photo flipped left-to-right. With Enhance, both in one pass." />
              <Opt k="amenities" icon={Building2} label="Add amenity photos from the same property" hint="Pool, gym, lobby, rooftop… that other units in this building show and this one doesn't" />
            </div>
          </div>
          <input value={steer} onChange={e => setSteer(e.target.value)} disabled={running} placeholder="Optional: anything to make sure of (e.g. “mention the rooftop pool and garage parking”)"
            className="w-full rounded-lg border border-line bg-app px-3 py-1.5 text-[12.5px]" />
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={run} disabled={running || !Object.values(opts).some(Boolean)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3.5 py-1.5 text-[13px] font-bold disabled:opacity-50">
              {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {running ? 'Working…' : 'Run'}
            </button>
            <span className="text-[11.5px] text-muted">Takes a minute or two. Nothing is pushed until you press Push everything.</span>
          </div>
          {steps.length > 0 && (
            <div className="rounded-lg border border-line divide-y divide-line">
              {steps.filter(s => s.state !== 'skip').map(s => (
                <div key={s.key} className="px-3 py-1.5 flex items-center gap-2 text-[12.5px]">
                  {s.state === 'run' ? <Loader2 size={13} className="animate-spin text-brand-600" /> : s.state === 'done' ? <Check size={13} className="text-emerald-600" /> : s.state === 'fail' ? <X size={13} className="text-rose-600" /> : <span className="w-[13px] h-[13px] rounded-full border border-line" />}
                  <span className="font-semibold text-ink">{s.label}</span>
                  {s.note && <span className={'text-[11.5px] ' + (s.state === 'fail' ? 'text-rose-700' : 'text-muted')}>{s.note}</span>}
                </div>
              ))}
            </div>
          )}
          {err && <div className="rounded-lg px-3 py-1.5 text-[12.5px] bg-rose-50 text-rose-700 border border-rose-200">{err}</div>}
          {msg && <div className="rounded-lg px-3 py-1.5 text-[12.5px] bg-emerald-50 text-emerald-800 border border-emerald-200">{msg}</div>}

          {!running && steps.length > 0 && (
            <div className="space-y-3">
              {copy?.factIssues?.length ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                  <p className="font-semibold">The new copy disagrees with this listing, so the title and sections start unticked:</p>
                  {copy.factIssues.map((f, i) => <p key={i}>• {f}</p>)}
                  <p className="mt-1">Fix the wording below (or run again), then tick them to push.</p>
                </div>
              ) : null}
              {copy && opts.title && (
                <div className="rounded-lg border border-line p-3">
                  <div className="flex items-center gap-2 mb-1.5"><Use k="title" label="New title" /><span className="text-[11px] text-muted ml-auto tabular-nums">{title.trim().length}/{copy.titleMax}</span></div>
                  <p className="text-[11.5px] text-muted line-through">{copy.current.title}</p>
                  <input value={title} onChange={e => setTitle(e.target.value)} className={'mt-1 w-full rounded-md border px-2 py-1 text-[13px] font-semibold ' + (title.trim().length > copy.titleMax ? 'border-rose-400' : 'border-line')} />
                </div>
              )}
              {copy && opts.sections && (
                <div className="rounded-lg border border-line p-3">
                  <div className="flex items-center gap-2"><Use k="sections" label={sectionsChanged.length + ' description section' + (sectionsChanged.length === 1 ? '' : 's') + ' rewritten'} />
                    <button onClick={() => setShowSections(v => !v)} className="ml-auto text-[11.5px] font-semibold text-brand-700 inline-flex items-center gap-0.5">{showSections ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {showSections ? 'Hide' : 'Read them'}</button></div>
                  {showSections && (
                    <div className="mt-2 space-y-2">
                      {sectionsChanged.map(s => (
                        <div key={s.key}>
                          <p className="text-[11px] font-bold uppercase tracking-wide text-muted flex">{s.label}{s.key === 'summary' ? <span className={'ml-auto normal-case tracking-normal font-semibold tabular-nums ' + (copy.proposed.summary.trim().length > 500 ? 'text-rose-700' : 'text-muted')}>{copy.proposed.summary.trim().length}/500</span> : null}</p>
                          <textarea value={copy.proposed[s.key]} onChange={e => setCopy(c => c ? { ...c, proposed: { ...c.proposed, [s.key]: e.target.value } } : c)} rows={4} className="w-full rounded-md border border-line px-2 py-1 text-[12.5px]" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {base.length > 0 && (order || Object.keys(imgs).length || capChanged.length) ? (
                <div className="rounded-lg border border-line p-3">
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    {order && <Use k="order" label="New order + first five" />}
                    {capChanged.length > 0 && <Use k="captions" label={capChanged.length + ' new captions'} />}
                    {Object.keys(imgs).length > 0 && <Use k="images" label={Object.keys(imgs).length + ' ' + imgLabel.toLowerCase() + ' photos'} />}
                    {capChanged.length > 0 && <button onClick={() => setShowCaps(v => !v)} className="ml-auto text-[11.5px] font-semibold text-brand-700">{showCaps ? 'Hide captions' : 'Read captions'}</button>}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-1.5">
                    {newOrder.slice(0, showCaps ? newOrder.length : 16).map((id, i) => { const p = byId.get(id); if (!p) return null; const u = use.images && imgs[id] ? imgs[id] : p.thumb; const c = use.captions && caps[id] ? caps[id] : p.caption; return (
                      <div key={id} className={'rounded-md overflow-hidden border ' + (i < 5 ? 'border-amber-400' : 'border-line')}>
                        <div className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="" className="w-full aspect-[4/3] object-cover" loading="lazy" />
                          <span className={'absolute top-1 left-1 text-[9.5px] font-bold px-1 rounded ' + (i < 5 ? 'bg-amber-500 text-white' : 'bg-black/60 text-white')}>{i + 1}</span>
                        </div>
                        {showCaps && <p className={'px-1 py-0.5 text-[10px] leading-snug ' + (caps[id] && caps[id] !== p.caption ? 'text-emerald-700' : 'text-muted')}>{c}</p>}
                      </div>
                    ) })}
                  </div>
                  {!showCaps && newOrder.length > 16 && <p className="text-[11px] text-muted mt-1">+ {newOrder.length - 16} more</p>}
                </div>
              ) : null}
              {borrow.length > 0 && (
                <div className="rounded-lg border border-line p-3">
                  <p className="text-[12px] font-semibold text-ink mb-2 inline-flex items-center gap-1.5"><Images size={13} /> Amenity photos from the same property — added at the end. Untick any you don&rsquo;t want.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {borrow.map((b, i) => { const on = borrowOn.has(i); return (
                      <button key={i} onClick={() => setBorrowOn(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })}
                        className={'text-left rounded-md overflow-hidden border-2 ' + (on ? 'border-emerald-500' : 'border-line opacity-50')}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={b.thumb} alt="" className="w-full aspect-[4/3] object-cover" loading="lazy" />
                        <span className="block px-1 pt-0.5 text-[10.5px] font-bold">{on ? '✓ ' : ''}{b.label}</span>
                        <span className="block px-1 pb-0.5 text-[10px] text-muted truncate">from {b.fromUnit}</span>
                      </button>
                    ) })}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button onClick={pushAll} disabled={!anything || pushing} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3.5 py-1.5 text-[13px] font-bold disabled:opacity-40">
                  {pushing ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />} {synced && !synced.ok ? 'Push again' : 'Push everything'}
                </button>
                {!anything && <span className="text-[11.5px] text-muted">Nothing to push yet.</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
