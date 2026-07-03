'use client'
// Guidebook v2 — editorial-grade rendering. Playfair Display typography, full-bleed cover with
// gradient scrim (text always readable over photos), vision-assigned imagery per page, lean page
// set (respects sections.omit + empty content), Salato-style hairline accents, page numbers, and
// print-exact A4 output (@page, exact colors, no app chrome).
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Paperclip, Pencil, Printer, Save, Share2, Sparkles, Trash2, Loader2, X } from 'lucide-react'

const QR = 'https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=' + encodeURIComponent('https://stay-hospitality.com')
const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const SANS = "'Inter', -apple-system, sans-serif"

// The real Stay Hospitality logo (from brand assets, white-keyed to transparent, hosted in our
// public storage bucket). `light` inverts black -> white for dark pages and photo covers.
const LOGO_URL = 'https://ugbtsppfsgkkrdyyuxxg.supabase.co/storage/v1/object/public/guidebook-assets/1783090958148-l1zr8u.png'

function StayLogo({ light = false, small = false }: { light?: boolean; small?: boolean }) {
  return (
    <img src={LOGO_URL} alt="Stay Hospitality"
      className={(small ? 'h-9' : 'h-14') + ' w-auto mx-auto'}
      style={light ? { filter: 'invert(1)' } : undefined} />
  )
}

export function GuidebookView({ initial, guest = false }: { initial: any; guest?: boolean }) {
  const router = useRouter()
  const [gb, setGb] = useState<any>(initial)
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [askText, setAskText] = useState('')
  const [askBusy, setAskBusy] = useState(false)
  const [askErr, setAskErr] = useState('')
  const [matBusy, setMatBusy] = useState(false)
  const matRef = useRef<HTMLInputElement>(null)

  // Upload building info, appliance photos, manuals etc. AFTER generation — the AI reads them
  // and folds them into the book (How-To Guide items get the photo pinned).
  async function addMaterials(files: FileList | null) {
    if (!files || !files.length) return
    setMatBusy(true); setAskErr('')
    try {
      const photos: string[] = []; const docs: string[] = []
      for (const f of Array.from(files).slice(0, 10)) {
        const fd = new FormData(); fd.append('file', f)
        const r = await fetch('/api/guidebook/upload', { method: 'POST', body: fd })
        const d = await r.json().catch(() => ({}))
        if (!r.ok || !d?.url) throw new Error(d?.error || 'Upload failed')
        if (d.kind === 'doc') docs.push(d.url); else photos.push(d.url)
      }
      const r2 = await fetch('/api/guidebook/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: gb.id, photoUrls: photos, docUrls: docs }) })
      const d2 = await r2.json().catch(() => ({}))
      if (!r2.ok || !d2?.sections) throw new Error(d2?.error || 'Could not read the materials')
      setGb((g: any) => ({ ...g, sections: d2.sections }))
    } catch (e: any) { setAskErr(e?.message || String(e)); setAskOpen(true) } finally { setMatBusy(false); if (matRef.current) matRef.current.value = '' }
  }

  async function askAI() {
    const prompt = askText.trim()
    if (!prompt) return
    setAskBusy(true); setAskErr('')
    try {
      const r = await fetch('/api/guidebook/revise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: gb.id, prompt }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d?.sections) throw new Error(d?.error || 'Revision failed')
      setGb((g: any) => ({ ...g, sections: d.sections }))
      setAskText(''); setAskOpen(false)
    } catch (e: any) { setAskErr(e?.message || String(e)) } finally { setAskBusy(false) }
  }
  const s = gb.sections || {}
  const omit: string[] = Array.isArray(s.omit) ? s.omit : []
  const pa = s._photoAssign || {}
  const photos: string[] = Array.isArray(s._photos) ? s._photos : []
  const dark = gb.theme === 'dark'
  const showTags = s._showTags !== false

  function set(path: string[], value: any) {
    setGb((g: any) => {
      const next = JSON.parse(JSON.stringify(g))
      let o = next.sections
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]] = o[path[i]] ?? {}
      o[path[path.length - 1]] = value
      return next
    })
  }

  async function save() {
    setBusy(true)
    try {
      await fetch('/api/guidebook', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: gb.id, sections: gb.sections, title: gb.title, theme: gb.theme }) })
      setEdit(false)
    } finally { setBusy(false) }
  }

  async function del() {
    if (!confirm('Delete this guidebook?')) return
    await fetch('/api/guidebook?id=' + gb.id, { method: 'DELETE' })
    router.push('/guidebooks')
  }

  const T = ({ path, value, className, rows = 2 }: { path: string[]; value: string; className?: string; rows?: number }) =>
    edit
      ? <textarea rows={rows} value={value || ''} onChange={e => set(path, e.target.value)} className={'w-full bg-white/70 text-neutral-900 border border-dashed border-neutral-400 rounded p-1 text-[13px] ' + (className || '')} />
      : <span className={className}>{value}</span>

  const paper = dark ? '#141311' : '#fbf9f5'
  const ink = dark ? '#efeae2' : '#1f1d1a'
  const accentColor = dark ? '#c9a96a' : '#8a7350'
  const has = (key: string, contentOk: boolean) => !omit.includes(key) && contentOk

  // Clickable contact details for the digital/shared view: phones dial, addresses open Maps,
  // email opens mail. Inert while editing; prints as plain text.
  const Tel = ({ v, children }: { v?: string; children: any }) => {
    const num = String(v || '').replace(/[^\d+]/g, '')
    return !edit && num.length >= 7 ? <a href={'tel:' + num} className="hover:underline" style={{ color: 'inherit' }}>{children}</a> : <>{children}</>
  }
  const MapLink = ({ v, children }: { v?: string; children: any }) => {
    const q = String(v || '').trim()
    return !edit && q ? <a href={'https://maps.google.com/?q=' + encodeURIComponent(q)} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: 'inherit' }}>{children}</a> : <>{children}</>
  }
  const Mail = ({ v, children }: { v?: string; children: any }) => {
    const m = String(v || '').trim()
    return !edit && m.includes('@') ? <a href={'mailto:' + m} className="hover:underline" style={{ color: 'inherit' }}>{children}</a> : <>{children}</>
  }
  // Local places & restaurants click through to Google Maps (venue + city) on the digital view.
  const placeCity = String(s.guidelines?.address || '').split(',')[1]?.trim() || ''
  const PlaceLink = ({ name, children }: { name?: string; children: any }) => {
    const nm = String(name || '').trim()
    return !edit && nm
      ? <a href={'https://maps.google.com/?q=' + encodeURIComponent(nm + (placeCity ? ', ' + placeCity : ''))} target="_blank" rel="noreferrer" className="block transition-opacity hover:opacity-85" style={{ color: 'inherit' }}>{children}</a>
      : <>{children}</>
  }

  // Pages the operator can remove from the book (Edit mode → "Hide page"; restore from the bar).
  const PAGE_LABELS: Record<string, string> = { special: 'What makes it special', houseGuide: 'How-to guide', addons: 'Add-ons', localPlaces: 'Local places', restaurants: 'Where to eat', gettingThere: 'Finding the residence', gettingAround: 'Getting around', retreat: 'Retreat lines', host: 'Meet your host' }
  function hidePage(key: string) {
    setGb((g: any) => {
      const next = JSON.parse(JSON.stringify(g))
      const o: string[] = Array.isArray(next.sections.omit) ? next.sections.omit : []
      if (!o.includes(key)) o.push(key)
      next.sections.omit = o
      return next
    })
  }
  function restorePage(key: string) {
    setGb((g: any) => {
      const next = JSON.parse(JSON.stringify(g))
      next.sections.omit = (Array.isArray(next.sections.omit) ? next.sections.omit : []).filter((k: string) => k !== key)
      return next
    })
  }

  let pageNo = 0
  const Page = ({ children, bleed, id, ghost, hideKey }: { children: any; bleed?: string | null; id?: string; ghost?: string; hideKey?: string }) => {
    pageNo += 1
    const n = pageNo
    return (
      <div key={id || n} className="gb-page relative mx-auto mb-8 w-full max-w-[760px] overflow-hidden shadow-[0_2px_24px_rgba(0,0,0,0.10)] print:mb-0 print:shadow-none"
        style={{ aspectRatio: '210/297', background: paper, color: ink, fontFamily: SANS }}>
        {edit && hideKey && (
          <button onClick={() => hidePage(hideKey)} title="Remove this page from the book (restore from the bar above)"
            className="absolute right-3 top-3 z-10 rounded-lg border border-red-300 bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-red-600 shadow-sm hover:bg-red-50">
            <X size={10} className="mr-1 inline" />Hide page
          </button>
        )}
        {bleed && (
          <>
            <img src={bleed} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(10,10,12,0.62) 0%, rgba(10,10,12,0.28) 38%, rgba(10,10,12,0.05) 60%, rgba(10,10,12,0.55) 100%)' }} />
            <div className="pointer-events-none absolute inset-4 border border-white/25" />
          </>
        )}
        {!bleed && ghost && (
          <span className="pointer-events-none absolute -top-6 right-6 select-none text-[170px] font-medium leading-none" style={{ fontFamily: SERIF, color: ink, opacity: 0.05 }}>{ghost}</span>
        )}
        <div className={'relative flex h-full flex-col ' + (bleed ? 'text-white' : '')} style={{ padding: '52px 58px 40px' }}>
          {children}
          <div className={'mt-auto pt-5 flex items-end justify-between text-[8.5px] tracking-[0.28em] ' + (bleed ? 'text-white/70' : '')} style={bleed ? {} : { color: accentColor }}>
            <span><Tel v={s.contact?.customerService || '954-526-8998'}>{s.contact?.customerService || '954-526-8998'}</Tel></span>
            <span className="tabular-nums">{String(n).padStart(2, '0')}</span>
            <span><a href="https://stay-hospitality.com" target="_blank" rel="noreferrer" className="hover:underline" style={{ color: 'inherit' }}>STAY-HOSPITALITY.COM</a></span>
          </div>
        </div>
      </div>
    )
  }

  // Half-photo header with scrim — text below is always on paper, label over photo is scrimmed white.
  const PhotoBand = ({ src, label }: { src: string | null; label?: string }) => src ? (
    <div className="relative -mx-[58px] -mt-[52px] mb-9 h-[34%] min-h-[220px] overflow-hidden" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 88%, 0 100%)' }}>
      <img src={src} alt="" className="h-full w-full object-cover" />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,10,12,0.45), rgba(10,10,12,0.05) 55%)' }} />
      {showTags && <span className="absolute left-[58px] top-[44%] h-px w-16 bg-white/70" style={{ transform: 'rotate(-24deg)' }} />}
      {showTags && <span className="absolute left-[78px] top-[47%] h-px w-10 bg-white/40" style={{ transform: 'rotate(-24deg)' }} />}
      {showTags && label && <p className="absolute bottom-7 left-[58px] text-[9px] tracking-[0.45em] text-white/90" style={{ fontFamily: SANS }}>{'// ' + label}</p>}
    </div>
  ) : (label ? <p className="mb-3 text-[9px] tracking-[0.45em]" style={{ color: accentColor }}>{'// ' + label}</p> : null)

  const H = ({ children, size = 'text-[40px]' }: { children: any; size?: string }) => (
    <h2 className={size + ' lowercase leading-[1.05] font-medium'} style={{ fontFamily: SERIF }}>{children}</h2>
  )
  const Kicker = ({ children }: { children: any }) => (
    <p className="mb-2 text-[9px] tracking-[0.45em]" style={{ color: accentColor }}>{'// '}{children}</p>
  )

  const localSecs = [
    has('localPlaces', (s.localPlaces?.items || []).length > 0) && { title: 'local places', tag: 'TO VISIT', key: 'localPlaces' },
    has('restaurants', (s.restaurants?.items || []).length > 0) && { title: 'where to eat', tag: 'OUR PICKS', key: 'restaurants' },
  ].filter(Boolean) as any[]

  return (
    <div style={{ background: dark ? '#1c1a17' : '#eceae6', minHeight: '100vh' }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap" />
      <style>{`
        .gb-page { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          @page { size: A4; margin: 0; }
          body { background: white !important; }
          .gb-chrome { display: none !important; }
          .gb-page { width: 210mm !important; height: 296.5mm !important; max-width: none !important; aspect-ratio: auto !important; page-break-after: always; break-inside: avoid; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="gb-chrome sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/10 bg-white/95 px-4 py-3 backdrop-blur">
        {guest
          ? <span className="text-xs font-semibold tracking-[0.3em] text-neutral-700">STAY HOSPITALITY</span>
          : <Link href="/guidebooks" className="inline-flex shrink-0 items-center gap-1.5 text-sm text-neutral-600 hover:text-black"><ArrowLeft size={15} /> Guidebooks</Link>}
        {edit
          ? <input value={gb.title || ''} onChange={e => setGb({ ...gb, title: e.target.value })} className="max-w-[40%] flex-1 rounded-lg border border-dashed border-neutral-400 px-2 py-1 text-sm font-semibold text-neutral-800" />
          : <div className="truncate max-w-[40%] text-sm font-semibold text-neutral-800">{gb.title}</div>}
        <div className="flex items-center gap-2">
          {!guest && <select value={gb.theme} onChange={e => setGb({ ...gb, theme: e.target.value })} className="rounded-lg border border-neutral-300 px-2 py-1.5 text-xs">
            <option value="editorial">Coastal editorial</option>
            <option value="dark">Dark luxe</option>
          </select>}
          {!guest && <button onClick={() => matRef.current?.click()} disabled={matBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-60" title="Upload building info, appliance photos, or manuals — the AI folds them into the book">{matBusy ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} {matBusy ? 'Reading…' : 'Add materials'}</button>}
          {!guest && <input ref={matRef} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={e => addMaterials(e.target.files)} />}
          {!guest && <button onClick={() => setAskOpen(o => !o)} className={'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ' + (askOpen ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-300')} title="Tell the AI what to change — it rewrites the book for you"><Sparkles size={13} /> Ask AI</button>}
          {!guest && (edit
            ? <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-xs font-semibold text-white">{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
            : <button onClick={() => setEdit(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold"><Pencil size={13} /> Edit</button>)}
          {!guest && <button onClick={() => { const next = JSON.parse(JSON.stringify(gb)); next.sections._showTags = showTags ? false : true; setGb(next); fetch('/api/guidebook', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: next.id, sections: next.sections }) }) }} className={'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ' + (showTags ? 'border-neutral-300' : 'border-neutral-800 bg-neutral-800 text-white')} title="Show/hide the // labels and accent lines on photos">Photo tags {showTags ? 'on' : 'off'}</button>}
          {!guest && <button onClick={() => { navigator.clipboard.writeText(window.location.origin + '/g/' + gb.id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {}) }} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold" title="Copy the public guest link — no login needed to view">{copied ? <Save size={13} /> : <Share2 size={13} />} {copied ? 'Copied!' : 'Share'}</button>}
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold"><Printer size={13} /> Print / PDF</button>
          {!guest && <button onClick={del} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600"><Trash2 size={13} /></button>}
        </div>
      </div>

      {/* ASK AI — tell it what to change; the book rewrites itself */}
      {!guest && askOpen && (
        <div className="gb-chrome sticky top-[57px] z-10 border-b border-black/10 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-[760px] items-start gap-2">
            <textarea rows={2} autoFocus value={askText} onChange={e => setAskText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI() } }}
              placeholder='Tell the AI what to change — e.g. "make the about section shorter", "add the rooftop pool to what makes this special", "change quiet hours to 10 PM", "hide the add-ons page"'
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/20" />
            <button onClick={askAI} disabled={askBusy || !askText.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-black px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {askBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {askBusy ? 'Revising…' : 'Apply'}
            </button>
            <button onClick={() => { setAskOpen(false); setAskErr('') }} className="rounded-lg border border-neutral-300 p-2 text-neutral-500"><X size={14} /></button>
          </div>
          {askErr && <p className="mx-auto mt-1.5 max-w-[760px] text-xs text-red-600">{askErr}</p>}
        </div>
      )}

      {/* HIDDEN PAGES — restore while editing */}
      {!guest && edit && omit.length > 0 && (
        <div className="gb-chrome sticky top-[57px] z-10 border-b border-black/10 bg-amber-50/95 px-4 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-amber-900">Hidden pages:</span>
            {omit.map(k => (
              <button key={k} onClick={() => restorePage(k)} className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-0.5 font-medium text-amber-900 hover:bg-amber-100" title="Click to restore">
                {PAGE_LABELS[k] || k} <X size={11} />
              </button>
            ))}
            <span className="text-amber-700/70">— click to restore, then Save</span>
          </div>
        </div>
      )}

      <div className="px-4 py-10">
        {/* COVER — full-bleed, scrimmed, white type */}
        <Page bleed={pa.cover || photos[0] || null} id="cover">
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-[9px] tracking-[0.55em] text-white/80">WELCOME</p>
            <div className="mt-5 text-[54px] leading-[1.08] font-medium" style={{ fontFamily: SERIF, textShadow: '0 1px 24px rgba(0,0,0,0.35)' }}>
              <T path={['cover', 'line1']} value={s.cover?.line1} /><br />
              <T path={['cover', 'line2']} value={s.cover?.line2} />
            </div>
            <div className="mx-auto mt-7 h-px w-14 bg-white/60" />
            <p className="mt-5 text-[10px] tracking-[0.4em] text-white/85"><T path={['cover', 'subtitle']} value={s.cover?.subtitle} /></p>
          </div>
          <div className="pb-2"><StayLogo light /></div>
        </Page>

        {/* ABOUT — adaptive: short copy becomes a centered manifesto page; long copy reads editorial-left */}
        <Page id="about">
          <PhotoBand src={pa.about || null} />
          {(s.about?.body || '').length < 240 ? (
            <div className="flex flex-1 flex-col items-center justify-center pb-10 text-center">
              <Kicker>THE RESIDENCE</Kicker>
              <H><T path={['about', 'heading']} value={s.about?.heading} /></H>
              <div className="mx-auto mt-7 h-px w-12" style={{ background: accentColor + '77' }} />
              <p className="mt-8 max-w-[38ch] text-[17px] font-light italic leading-[2.05]" style={{ fontFamily: SERIF }}><T path={['about', 'body']} value={s.about?.body} rows={5} /></p>
              {has('retreat', (s.retreat?.lines || []).length > 0) && (
                <div className="mt-10 space-y-3 text-[9.5px] tracking-[0.28em] leading-[1.9]" style={{ color: accentColor }}>
                  {(s.retreat.lines).slice(0, 3).map((ln: string, i: number) => (
                    <p key={i}><T path={['retreat', 'lines', String(i)] as any} value={ln} rows={2} /></p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-center pb-4">
              <Kicker>THE RESIDENCE</Kicker>
              <H><T path={['about', 'heading']} value={s.about?.heading} /></H>
              <p className="mt-6 max-w-[62ch] text-[13.5px] font-light leading-[1.95]"><T path={['about', 'body']} value={s.about?.body} rows={5} /></p>
              {has('retreat', (s.retreat?.lines || []).length > 0) && (
                <div className="mt-9 space-y-3.5 border-l pl-6 text-[10px] tracking-[0.22em] leading-[1.8]" style={{ borderColor: accentColor + '55' }}>
                  {(s.retreat.lines).slice(0, 3).map((ln: string, i: number) => (
                    <p key={i} style={{ color: accentColor }}><T path={['retreat', 'lines', String(i)] as any} value={ln} rows={2} /></p>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* ESSENTIALS AT A GLANCE — the four things every guest hunts for, on page two. */}
          <div className="mt-auto grid grid-cols-4 gap-5 border-t pt-5" style={{ borderColor: accentColor + '33' }}>
            <div><p className="text-[8.5px] tracking-[0.3em]" style={{ color: accentColor }}>WI-FI</p><p className="mt-1 text-[11.5px] font-medium leading-snug">{s.wifi?.network}<br /><span className="font-light opacity-80">{s.wifi?.password}</span></p></div>
            <div><p className="text-[8.5px] tracking-[0.3em]" style={{ color: accentColor }}>CHECK-IN / OUT</p><p className="mt-1 text-[11.5px] font-medium leading-snug">{s.arrival?.checkIn}<br /><span className="font-light opacity-80">{s.arrival?.checkOut}</span></p></div>
            <div><p className="text-[8.5px] tracking-[0.3em]" style={{ color: accentColor }}>ADDRESS</p><p className="mt-1 text-[10.5px] font-light leading-snug"><MapLink v={s.guidelines?.address}>{s.guidelines?.address}</MapLink></p></div>
            <div><p className="text-[8.5px] tracking-[0.3em]" style={{ color: accentColor }}>NEED US?</p><p className="mt-1 text-[11.5px] font-medium leading-snug"><Tel v={s.contact?.customerService}>{s.contact?.customerService}</Tel><br /><span className="font-light opacity-80">24/7</span></p></div>
          </div>
        </Page>

        {/* SPECIAL + QR */}
        {has('special', (s.special?.groups || []).length > 0) && (
          <Page id="special" hideKey="special">
            <PhotoBand src={pa.special || null} label="THE EXPERIENCE" />
            <H><T path={['special', 'heading']} value={s.special?.heading} /></H>
            <div className={'mt-7 grid flex-1 grid-cols-2 gap-x-10 gap-y-7 ' + ((s.special.groups || []).length <= 2 ? 'content-center' : 'content-start')}>
              {(s.special.groups).map((g: any, i: number) => (
                <div key={i}>
                  <p className="text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}><T path={['special', 'groups', String(i), 'title'] as any} value={g.title} /></p>
                  <ul className="mt-2.5 space-y-1.5 text-[12.5px] font-light leading-[1.6]">
                    {(g.items || []).map((it: string, j: number) => (
                      <li key={j} className="flex gap-2"><span style={{ color: accentColor }}>—</span><T path={['special', 'groups', String(i), 'items', String(j)] as any} value={it} rows={1} /></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center gap-5 border-t pt-5" style={{ borderColor: accentColor + '33' }}>
              <img src={QR} alt="stay-hospitality.com" className="h-20 w-20 bg-white p-1" />
              <p className="text-[13px] leading-[1.7]" style={{ fontFamily: SERIF }}>Scan to explore our collection<br />and <em>book direct</em> at stay-hospitality.com</p>
            </div>
          </Page>
        )}

        {/* ARRIVAL — adaptive: sparse copy + photo becomes a full-height split page */}
        {((s.arrival?.entry || '').length + (s.arrival?.parking || '').length) < 340 && !has('gettingAround', !!str2(s.gettingAround?.body)) && pa.arrival ? (
          <Page id="arrival">
            <div className="absolute inset-y-0 left-0 w-[42%] overflow-hidden">
              <img src={pa.arrival} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,10,12,0.5), rgba(10,10,12,0.06) 50%)' }} />
              <p className="absolute bottom-10 left-6 text-[9px] tracking-[0.45em] text-white/90">YOUR ARRIVAL</p>
            </div>
            <div className="relative ml-[46%] flex h-full flex-col">
              <H size="text-[34px]"><T path={['arrival', 'heading']} value={s.arrival?.heading} /></H>
              <div className="mt-7 space-y-5">
                <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}>CHECK-IN</p><p className="mt-1 text-[26px]" style={{ fontFamily: SERIF }}><T path={['arrival', 'checkIn']} value={s.arrival?.checkIn} rows={1} /></p></div>
                <div className="h-px w-10" style={{ background: accentColor + '55' }} />
                <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}>CHECK-OUT</p><p className="mt-1 text-[26px]" style={{ fontFamily: SERIF }}><T path={['arrival', 'checkOut']} value={s.arrival?.checkOut} rows={1} /></p></div>
              </div>
              <div className="mt-9 space-y-6 text-[12.5px] font-light leading-[1.85]">
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}>Entry</p>
                  <p><T path={['arrival', 'entry']} value={s.arrival?.entry} rows={4} /></p>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}>Parking</p>
                  <p><T path={['arrival', 'parking']} value={s.arrival?.parking} rows={3} /></p>
                </div>
              </div>
            </div>
          </Page>
        ) : (
        <Page id="arrival">
          <PhotoBand src={pa.arrival || null} label="YOUR ARRIVAL" />
          <H><T path={['arrival', 'heading']} value={s.arrival?.heading} /></H>
          <div className="mt-6 flex gap-14">
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}>CHECK-IN</p><p className="mt-1 text-[22px]" style={{ fontFamily: SERIF }}><T path={['arrival', 'checkIn']} value={s.arrival?.checkIn} rows={1} /></p></div>
            <div className="w-px" style={{ background: accentColor + '44' }} />
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}>CHECK-OUT</p><p className="mt-1 text-[22px]" style={{ fontFamily: SERIF }}><T path={['arrival', 'checkOut']} value={s.arrival?.checkOut} rows={1} /></p></div>
          </div>
          <div className="mt-8 grid flex-1 grid-cols-2 content-center gap-x-12 gap-y-8 text-[12.5px] font-light leading-[1.85]">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}>Entry</p>
              <p className="max-w-[58ch]"><T path={['arrival', 'entry']} value={s.arrival?.entry} rows={4} /></p>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}>Parking</p>
              <p className="max-w-[58ch]"><T path={['arrival', 'parking']} value={s.arrival?.parking} rows={3} /></p>
            </div>
            {has('gettingThere', !!str2(s.gettingThere?.body)) && (
              <div className={has('gettingAround', !!str2(s.gettingAround?.body)) ? '' : 'col-span-2'}>
                <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}>Finding the residence</p>
                <p className="max-w-[58ch]"><T path={['gettingThere', 'body']} value={s.gettingThere?.body} rows={3} /></p>
              </div>
            )}
            {has('gettingAround', !!str2(s.gettingAround?.body)) && (
              <div className={has('gettingThere', !!str2(s.gettingThere?.body)) ? '' : 'col-span-2'}>
                <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}>Getting around</p>
                <p className="max-w-[58ch]"><T path={['gettingAround', 'body']} value={s.gettingAround?.body} rows={3} /></p>
              </div>
            )}
          </div>
        </Page>
        )}

        {/* WI-FI — dark spread with a half-page photo and useful connection notes */}
        <Page id="wifi">
          <div className="absolute inset-0" style={{ background: '#131210' }} />
          {(() => {
            const used = new Set(Object.values(pa).filter(Boolean))
            const scene = (s._photoMeta || []).find((x: any) => ['living', 'bedroom', 'view', 'beach', 'pool', 'kitchen', 'dining', 'exterior', 'amenity'].includes(x.category) && !x.hasText && !used.has(x.url))
            const wifiPhoto = scene?.url || pa.about || null
            return wifiPhoto ? (
              <div className="absolute inset-x-0 top-0 h-[44%] overflow-hidden">
                <img src={wifiPhoto} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(19,18,16,0.10), rgba(19,18,16,0.45) 65%, #131210 100%)' }} />
              </div>
            ) : null
          })()}
          <div className="relative flex h-full flex-col text-[#efeae2]" style={{ margin: '-52px -58px -40px', padding: '52px 58px 40px' }}>
            <div className="mt-[36%]">
              <p className="text-[9px] tracking-[0.5em]" style={{ color: '#c9a96a' }}>{'// CONNECTED'}</p>
              <h2 className="mt-2 text-[40px] lowercase leading-[1.05] font-medium" style={{ fontFamily: SERIF }}>wi-fi &amp; the essentials</h2>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-8 border-y py-6" style={{ borderColor: '#c9a96a44' }}>
              <div><p className="text-[9px] tracking-[0.4em]" style={{ color: '#c9a96a' }}>NETWORK</p><p className="mt-2 text-[19px]" style={{ fontFamily: SERIF }}><T path={['wifi', 'network']} value={s.wifi?.network} rows={1} /></p></div>
              <div><p className="text-[9px] tracking-[0.4em]" style={{ color: '#c9a96a' }}>PASSWORD</p><p className="mt-2 text-[19px]" style={{ fontFamily: SERIF }}><T path={['wifi', 'password']} value={s.wifi?.password} rows={1} /></p></div>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-x-8 text-[11px] font-light leading-[1.8] text-[#efeae2]/75">
              <p>The password is case-sensitive — enter it exactly as printed. Once a device connects, it will remember the network for the rest of your stay.</p>
              <p>Trouble connecting? Our team is one call away, day or night — <Tel v={s.contact?.customerService}>{s.contact?.customerService}</Tel>. And if you sign into personal accounts on any TV, remember to log out before checkout.</p>
            </div>
            <div className="mt-auto flex items-end justify-between pt-5 text-[8.5px] tracking-[0.28em] text-[#efeae2]/50">
              <span><Tel v={s.contact?.customerService}>{s.contact?.customerService}</Tel></span><span><Mail v={s.contact?.email}>{s.contact?.email}</Mail></span>
            </div>
          </div>
        </Page>

        {/* HOW-TO GUIDE — one item per appliance/system, read from uploads + notes */}
        {has('houseGuide', (s.houseGuide?.items || []).length > 0) && (
          <Page id="howto" ghost="how" hideKey="houseGuide">
            <Kicker>HOUSE GUIDE</Kicker>
            <H>how-to guide</H>
            <p className="mt-4 max-w-[56ch] text-[12px] font-light leading-[1.8] opacity-80">Everything here is a feature — a minute of reading makes the whole stay effortless.</p>
            <div className={'mt-7 grid flex-1 gap-x-10 gap-y-6 ' + ((s.houseGuide.items || []).length > 3 ? 'grid-cols-2 content-evenly' : 'grid-cols-1 content-evenly')}>
              {(s.houseGuide.items).slice(0, 8).map((it: any, i: number) => (
                <div key={i} className="flex gap-5 border-b pb-6" style={{ borderColor: accentColor + '22' }}>
                  <span className="text-[30px] leading-none opacity-25" style={{ fontFamily: SERIF }}>{String(i + 1).padStart(2, '0')}</span>
                  <div className="flex-1">
                    <p className="text-[16px] lowercase font-medium leading-tight" style={{ fontFamily: SERIF }}><T path={['houseGuide', 'items', String(i), 'title'] as any} value={it.title} rows={1} /></p>
                    <div className="mt-1.5 h-px w-8" style={{ background: accentColor + '66' }} />
                    <p className="mt-2 text-[11.5px] font-light leading-[1.75]"><T path={['houseGuide', 'items', String(i), 'body'] as any} value={it.body} rows={3} /></p>
                  </div>
                  {it.photo && <img src={it.photo} alt="" className={((s.houseGuide.items || []).length > 3 ? 'h-24 w-28' : 'h-28 w-40') + ' shrink-0 rounded-sm object-cover ring-1 ring-black/10'} />}
                </div>
              ))}
            </div>
          </Page>
        )}

        {/* GUIDELINES + CONTACT — combined, lean */}
        <Page id="guidelines" ghost="notes">
          <Kicker>HOUSE NOTES</Kicker>
          <H><T path={['guidelines', 'heading']} value={s.guidelines?.heading} /></H>
          <p className="mt-4 max-w-[56ch] text-[12px] font-light leading-[1.8] opacity-80"><T path={['guidelines', 'intro']} value={s.guidelines?.intro} rows={2} /></p>
          <div className={'mt-7 flex-1 flex flex-col ' + ((s.guidelines?.items || []).length <= 3 ? 'justify-center gap-6' : 'justify-evenly gap-4')}>
            {(s.guidelines?.items || []).slice(0, 5).map((it: any, i: number) => (
              <div key={i} className="flex gap-4 border-b pb-3.5" style={{ borderColor: accentColor + '22' }}>
                <p className="w-44 shrink-0 text-[10px] font-semibold tracking-[0.24em] uppercase pt-0.5" style={{ color: accentColor }}><T path={['guidelines', 'items', String(i), 'title'] as any} value={it.title} rows={1} /></p>
                <p className="text-[12px] font-light leading-[1.7]"><T path={['guidelines', 'items', String(i), 'body'] as any} value={it.body} rows={2} /></p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-6">
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}>CUSTOMER SERVICE · 24/7</p><p className="mt-1.5 text-[14px]" style={{ fontFamily: SERIF }}><Tel v={s.contact?.customerService}><T path={['contact', 'customerService']} value={s.contact?.customerService} rows={1} /></Tel></p><p className="mt-1 text-[9.5px] font-light opacity-70">Emergencies: dial 911 first, then call us.</p></div>
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}>GENERAL MANAGER</p><p className="mt-1.5 text-[14px]" style={{ fontFamily: SERIF }}><T path={['contact', 'gmName']} value={s.contact?.gmName} rows={1} /> · <Tel v={s.contact?.gmPhone}><T path={['contact', 'gmPhone']} value={s.contact?.gmPhone} rows={1} /></Tel></p></div>
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}>ADDRESS</p><p className="mt-1.5 text-[11px] font-light leading-snug"><MapLink v={s.guidelines?.address}><T path={['guidelines', 'address']} value={s.guidelines?.address} rows={2} /></MapLink></p></div>
          </div>
        </Page>

        {/* LOCAL — places / eats. Photo cards when imagery exists; big editorial cards when few items. */}
        {localSecs.map((sec: any) => {
          const items = (s[sec.key].items || []).slice(0, 6)
          const anyPhoto = items.some((p: any) => p.photo)
          const few = items.length <= 3
          return (
            <Page key={sec.key} id={sec.key} ghost={sec.key === 'restaurants' ? 'eat' : 'go'} hideKey={sec.key}>
              <Kicker>{sec.tag}</Kicker>
              <H>{sec.title}</H>
              {anyPhoto ? (
                <div className={'mt-8 grid flex-1 gap-6 ' + (few ? 'grid-cols-1 content-center' : 'grid-cols-2 content-start')}>
                  {items.map((p: any, i: number) => (
                    <div key={i} className={!few && items.length % 2 === 1 && i === items.length - 1 ? 'col-span-2' : ''}>
                      <PlaceLink name={p.name}>
                      {p.photo ? (
                        <div className={'relative overflow-hidden ' + (few ? 'h-[190px]' : 'h-[145px]')}>
                          <img src={p.photo} alt="" className="h-full w-full object-cover" />
                          <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,10,12,0.62), rgba(10,10,12,0.02) 55%)' }} />
                          <span className="absolute right-3 top-3 h-px w-10 bg-white/70" style={{ transform: 'rotate(-24deg)' }} />
                          <p className="absolute bottom-3 left-4 text-[15px] font-medium tracking-wide text-white" style={{ fontFamily: SERIF }}><T path={[sec.key, 'items', String(i), 'name'] as any} value={p.name} rows={1} /></p>
                        </div>
                      ) : (
                        <div className={'flex items-end border-l-2 pl-4 ' + (few ? 'h-[190px]' : 'h-[145px]')} style={{ borderColor: accentColor + '66' }}>
                          <p className="pb-3 text-[15px] font-medium tracking-wide" style={{ fontFamily: SERIF }}><T path={[sec.key, 'items', String(i), 'name'] as any} value={p.name} rows={1} /></p>
                        </div>
                      )}
                      {p.note ? <p className="mt-2 text-[11px] font-light leading-[1.65] opacity-80"><T path={[sec.key, 'items', String(i), 'note'] as any} value={p.note} rows={2} /></p> : null}
                      {(edit || p.address || p.phone) ? <p className="mt-1 text-[10px] font-light tracking-wide opacity-60"><T path={[sec.key, 'items', String(i), 'address'] as any} value={p.address} rows={1} />{p.address && p.phone ? ' · ' : ''}<Tel v={p.phone}><T path={[sec.key, 'items', String(i), 'phone'] as any} value={p.phone} rows={1} /></Tel></p> : null}
                      </PlaceLink>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-9 grid flex-1 grid-cols-2 content-start gap-x-10 gap-y-7">
                  {items.map((p: any, i: number) => (
                    <div key={i} className="border-l-2 pl-5" style={{ borderColor: accentColor + '66' }}>
                      <PlaceLink name={p.name}>
                      <p className="text-[13px] font-medium tracking-wide" style={{ fontFamily: SERIF }}><T path={[sec.key, 'items', String(i), 'name'] as any} value={p.name} rows={1} /></p>
                      {p.note && <p className="mt-1 text-[11px] font-light leading-[1.6] opacity-75"><T path={[sec.key, 'items', String(i), 'note'] as any} value={p.note} rows={2} /></p>}
                      {(edit || p.address || p.phone) ? <p className="mt-1 text-[10px] font-light tracking-wide opacity-60"><T path={[sec.key, 'items', String(i), 'address'] as any} value={p.address} rows={1} />{p.address && p.phone ? ' · ' : ''}<Tel v={p.phone}><T path={[sec.key, 'items', String(i), 'phone'] as any} value={p.phone} rows={1} /></Tel></p> : null}
                      </PlaceLink>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-5 border-t pt-4 text-center" style={{ borderColor: accentColor + '33' }}>
                <p className="text-[12px] leading-[1.7]" style={{ fontFamily: SERIF }}>Want a table or a local tip? Call our front desk at <Tel v={s.contact?.customerService}>{s.contact?.customerService}</Tel> — we're happy to arrange reservations.</p>
              </div>
            </Page>
          )
        })}

        {/* ADD-ONS (only if provided) */}
        {has('addons', (s.addons?.items || []).length > 0) && (
          <Page id="addons" ghost="more" hideKey="addons">
            <Kicker>AT YOUR SERVICE</Kicker>
            <H>exclusive add-ons</H>
            <p className="mt-4 max-w-[56ch] text-[12px] font-light leading-[1.8] opacity-80"><T path={['addons', 'intro']} value={s.addons?.intro} rows={2} /></p>
            <div className={'mt-8 grid flex-1 content-evenly ' + ((s.addons.items || []).length <= 4 ? 'grid-cols-1 gap-y-6' : 'grid-cols-2 gap-x-10 gap-y-5')}>
              {(s.addons.items).slice(0, 10).map((p: any, i: number) => (
                <div key={i} className="flex items-baseline gap-5 border-b pb-4" style={{ borderColor: accentColor + '22' }}>
                  <span className={((s.addons.items || []).length <= 4 ? 'text-[24px]' : 'text-[13px]') + ' leading-none opacity-30'} style={{ fontFamily: SERIF }}>{String(i + 1).padStart(2, '0')}</span>
                  <p className={((s.addons.items || []).length <= 4 ? 'text-[16px] lowercase font-medium' : 'text-[12px] font-medium tracking-[0.14em] uppercase')} style={(s.addons.items || []).length <= 4 ? { fontFamily: SERIF } : undefined}><T path={['addons', 'items', String(i), 'name'] as any} value={p.name} rows={1} /></p>
                </div>
              ))}
            </div>
          </Page>
        )}

        {/* CLOSING — checklist + starred review ask + thank you, on paper for readability */}
        <Page id="closing" ghost="bye">
          <PhotoBand src={pa.closing || null} label="UNTIL NEXT TIME" />
          <div className="grid flex-1 grid-cols-[1fr_1px_1.1fr] gap-x-8">
            <div>
              <p className="text-[9px] tracking-[0.5em]" style={{ color: accentColor }}>{'// BEFORE YOU GO'}</p>
              <ul className="mt-5 space-y-2.5 text-[11.5px] font-light leading-[1.65]">
                {(s.beforeYouGo?.items || []).slice(0, 5).map((it: string, i: number) => (
                  <li key={i} className="flex gap-3"><span className="mt-[8px] h-1 w-1 shrink-0 rounded-full" style={{ background: accentColor }} /><T path={['beforeYouGo', 'items', String(i)] as any} value={it} rows={2} /></li>
                ))}
              </ul>
            </div>
            <div style={{ background: accentColor + '33' }} />
            <div className="flex flex-col items-center justify-center px-2 text-center">
              <p className="text-[13px] tracking-[0.5em]" style={{ color: accentColor }}>★ ★ ★ ★ ★</p>
              <h3 className="mt-3 text-[26px] lowercase font-medium" style={{ fontFamily: SERIF }}>loved your stay?</h3>
              <p className="mt-3 max-w-[40ch] text-[12px] font-light italic leading-[1.8]" style={{ fontFamily: SERIF }}><T path={['review', 'body']} value={s.review?.body} rows={4} /></p>
              <p className="mt-4 text-[11.5px]" style={{ fontFamily: SERIF }}>— {s.contact?.gmName || 'Jon McGill'}, General Manager</p>
            </div>
          </div>
          <div className="mt-5 flex flex-col items-center border-t pt-5 text-center" style={{ borderColor: accentColor + '33' }}>
            <h2 className="text-[34px] lowercase font-medium" style={{ fontFamily: SERIF }}>thank you</h2>
            <p className="mt-1.5 text-[9px] tracking-[0.5em]" style={{ color: accentColor }}><T path={['thankyou', 'line']} value={s.thankyou?.line} rows={1} /></p>
            <div className="mt-4"><StayLogo small /></div>
          </div>
        </Page>
      </div>
    </div>
  )
}

function str2(v: any): string { return typeof v === 'string' ? v : '' }
