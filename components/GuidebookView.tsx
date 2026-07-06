'use client'
// Guidebook v3.4 — everything customizable: every fixed label/caption is editable via sections._labels.
// Editorial-grade rendering. Playfair Display typography, full-bleed cover with
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

  // v3.4: EVERY fixed label/caption in the book is editable. Overrides live in sections._labels
  // (underscore key — preserved by revise/ingest); falls back to the original wording.
  const lbl = (k: string, def: string) => { const o = (s._labels || {})[k]; return typeof o === 'string' ? o : def }
  const L = ({ k, def, rows = 1 }: { k: string; def: string; rows?: number }) =>
    edit
      ? <textarea rows={rows} value={lbl(k, def)} onChange={e => set(['_labels', k], e.target.value)} className="w-full bg-white/70 text-neutral-900 border border-dashed border-neutral-400 rounded p-1 text-[13px]" />
      : <>{lbl(k, def)}</>
  // Keeps tap-to-call on the digital view when an editable text contains the service number.
  const withTel = (txt: string) => { const num = String(s.contact?.customerService || ''); if (edit || !num || !txt.includes(num)) return <>{txt}</>; const i = txt.indexOf(num); return <>{txt.slice(0, i)}<Tel v={num}>{num}</Tel>{txt.slice(i + num.length)}</> }

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
            <span>{edit ? <L k="footer.site" def="STAY-HOSPITALITY.COM" /> : <a href={'https://' + lbl('footer.site', 'STAY-HOSPITALITY.COM').toLowerCase().replace(/[^a-z0-9.-]/g, '')} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: 'inherit' }}>{lbl('footer.site', 'STAY-HOSPITALITY.COM')}</a>}</span>
          </div>
        </div>
      </div>
    )
  }

  // Half-photo header with scrim — text below is always on paper, label over photo is scrimmed white.
  const PhotoBand = ({ src, label, k }: { src: string | null; label?: string; k?: string }) => src ? (
    <div className="relative -mx-[58px] -mt-[52px] mb-9 h-[34%] min-h-[220px] overflow-hidden" style={{ clipPath: 'polygon(0 0, 100% 0, 100% 88%, 0 100%)' }}>
      <img src={src} alt="" className="h-full w-full object-cover" />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,10,12,0.45), rgba(10,10,12,0.05) 55%)' }} />
      {showTags && <span className="absolute left-[58px] top-[44%] h-px w-16 bg-white/70" style={{ transform: 'rotate(-24deg)' }} />}
      {showTags && <span className="absolute left-[78px] top-[47%] h-px w-10 bg-white/40" style={{ transform: 'rotate(-24deg)' }} />}
      {showTags && label && <p className="absolute bottom-7 left-[58px] right-10 text-[9px] tracking-[0.45em] text-white/90" style={{ fontFamily: SANS }}>{'// '}{k ? <L k={k} def={label} /> : label}</p>}
    </div>
  ) : (label ? <p className="mb-3 text-[9px] tracking-[0.45em]" style={{ color: accentColor }}>{'// '}{k ? <L k={k} def={label} /> : label}</p> : null)

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
          html, body { background: white !important; overflow: visible !important; }
          .gb-chrome, .gb-nav { display: none !important; }
          .gb-pages { position: static !important; display: block !important; overflow: visible !important; height: auto !important; }
          .gb-slide { display: block !important; overflow: visible !important; height: auto !important; }
          .gb-page { transform: none !important; width: 210mm !important; height: 296.5mm !important; max-width: none !important; aspect-ratio: auto !important; margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; page-break-after: always; break-inside: avoid; }
        }
        @media screen and (max-width: 820px) {
          html, body { overflow: hidden !important; height: 100% !important; }
          .gb-chrome { position: fixed !important; top: 0; left: 0; right: 0; z-index: 40; }
          .gb-pages { position: fixed !important; top: var(--bkTop,64px) !important; bottom: var(--bkBottom,54px) !important; left: 0 !important; right: 0 !important; display: flex !important; flex-direction: row !important; flex-wrap: nowrap !important; overflow-x: auto !important; overflow-y: hidden !important; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; padding: 0 !important; margin: 0 !important; scrollbar-width: none; }
          .gb-pages::-webkit-scrollbar { display: none; }
          .gb-slide { flex: 0 0 100vw !important; scroll-snap-align: center; display: flex !important; align-items: center !important; justify-content: center !important; overflow: hidden; height: 100% !important; }
          .gb-page { flex: none !important; margin: 0 !important; width: 760px !important; max-width: 760px !important; transform: scale(var(--bkScale,0.5)) !important; transform-origin: center center !important; border-radius: 8px; box-shadow: 0 12px 44px rgba(0,0,0,0.2) !important; }
          .gb-nav { display: flex !important; }
        }
        .gb-nav { display: none; position: fixed; left: 0; right: 0; bottom: 0; height: 58px; flex-direction: row; align-items: center; justify-content: space-between; gap: 6px; padding: 0 12px; z-index: 50; font-family: Inter, system-ui, sans-serif; }
        .gb-nav-center { display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 1; }
        .gb-nav-btn { display: flex; align-items: center; gap: 5px; background: none; border: none; cursor: pointer; font: 600 9.5px Inter, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #6b6459; padding: 8px 6px; white-space: nowrap; }
        .gb-nav-btn .ic { font-size: 16px; line-height: 1; }
        .gb-nav.gb-dark .gb-nav-btn { color: rgba(255,255,255,0.75); }
        .gb-dots { display: flex; gap: 6px; align-items: center; }
        .gb-dot { width: 6px; height: 6px; border-radius: 50%; background: #cbc6bc; transition: all .25s; cursor: pointer; }
        .gb-dot.on { background: #1c1a17; width: 20px; border-radius: 3px; }
        .gb-nav.gb-dark .gb-dot { background: rgba(255,255,255,0.35); }
        .gb-nav.gb-dark .gb-dot.on { background: #ffffff; }
        .gb-count { font-size: 10px; letter-spacing: .18em; color: #6b6459; text-transform: uppercase; }
        .gb-nav.gb-dark .gb-count { color: rgba(255,255,255,0.7); }
        .gb-reader { position: fixed; inset: 0; z-index: 100; overflow: auto; -webkit-overflow-scrolling: touch; }
        .gb-reader .gb-page { transform: scale(var(--rdScale,1)) !important; transform-origin: top left !important; width: 760px !important; max-width: 760px !important; margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
        .gb-reader-wrap { margin: 0 auto; }
        .gb-reader-ctr { position: fixed; top: 12px; right: 12px; z-index: 101; display: flex; gap: 8px; }
        .gb-reader-ctr button { width: 42px; height: 42px; border-radius: 21px; border: none; background: rgba(20,18,15,0.72); color: #fff; font-size: 20px; line-height: 1; cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
        .gb-reader-hint { position: fixed; bottom: 16px; left: 0; right: 0; text-align: center; color: #6b6459; font: 600 10px Inter, sans-serif; letter-spacing: .16em; text-transform: uppercase; z-index: 101; pointer-events: none; }
        @media print { .gb-reader { display: none !important; } }
      `}</style>
      <script dangerouslySetInnerHTML={{ __html: "(function(){var NAV_H=58;function isDark(el){var s=getComputedStyle(el).backgroundColor;var i=s.indexOf('(');if(i<0)return false;var m=s.substring(i+1).split(',');var r=+m[0],g=+m[1],b=+m[2];return (0.299*r+0.587*g+0.114*b)<128;}var built=false,nav,dotsWrap,countEl,wrapper;function openReader(page){if(document.querySelector('.gb-reader'))return;var c=document.querySelector('.gb-chrome')?document.querySelector('.gb-chrome').parentElement:document.body;var ov=document.createElement('div');ov.className='gb-reader';ov.style.background=getComputedStyle(c).backgroundColor;var wrap=document.createElement('div');wrap.className='gb-reader-wrap';page.__slide=page.parentElement;wrap.appendChild(page);ov.appendChild(wrap);document.body.appendChild(ov);var fit=Math.min(window.innerWidth/760,1),z=fit;function apply(){document.documentElement.style.setProperty('--rdScale',z);wrap.style.width=(760*z)+'px';wrap.style.height=(1073*z)+'px';}apply();var ctr=document.createElement('div');ctr.className='gb-reader-ctr';function mk(t){var b=document.createElement('button');b.textContent=t;return b;}var zout=mk('−'),zin=mk('+'),cls=mk('✕');zin.onclick=function(){z=Math.min(fit*4,z*1.3);apply();};zout.onclick=function(){z=Math.max(fit,z/1.3);apply();};function close(){if(page.__slide)page.__slide.appendChild(page);ov.remove();document.documentElement.style.removeProperty('--rdScale');}cls.onclick=close;ctr.appendChild(zout);ctr.appendChild(zin);ctr.appendChild(cls);ov.appendChild(ctr);var hint=document.createElement('div');hint.className='gb-reader-hint';hint.textContent='Pinch or +/− to zoom · drag to move';ov.appendChild(hint);var lastTap=0;wrap.addEventListener('click',function(e){if(e.target.closest('a,button'))return;var n=Date.now();if(n-lastTap<300){z=(z>fit*1.2)?fit:Math.min(fit*2.2,fit*4);apply();}lastTap=n;});}function build(){wrapper=document.querySelector('.gb-pages')||((document.querySelector('.gb-page')||{}).parentElement);if(!wrapper)return;wrapper.classList.add('gb-pages');var pages=[].slice.call(document.querySelectorAll('.gb-page'));pages.forEach(function(p){if(!(p.parentElement&&p.parentElement.classList.contains('gb-slide'))){var s=document.createElement('div');s.className='gb-slide';p.parentElement.insertBefore(s,p);s.appendChild(p);}if(!p.__rd){p.__rd=1;p.addEventListener('click',function(e){if(window.innerWidth>820)return;if(e.target.closest('a,button,.gb-reader'))return;if(document.querySelector('.gb-reader'))return;openReader(p);});}});if(!nav){nav=document.createElement('div');nav.className='gb-nav';dotsWrap=document.createElement('div');dotsWrap.className='gb-dots';pages.forEach(function(p,i){var dt=document.createElement('div');dt.className='gb-dot'+(i===0?' on':'');dt.addEventListener('click',function(){wrapper.scrollTo({left:i*window.innerWidth,behavior:'smooth'});});dotsWrap.appendChild(dt);});countEl=document.createElement('div');countEl.className='gb-count';countEl.textContent='01 / '+pages.length;function navBtn(ic,lb,fn){var b=document.createElement('button');b.className='gb-nav-btn';var s=document.createElement('span');s.className='ic';s.textContent=ic;b.appendChild(s);b.appendChild(document.createTextNode(' '+lb));b.addEventListener('click',fn);return b;}var center=document.createElement('div');center.className='gb-nav-center';center.appendChild(dotsWrap);center.appendChild(countEl);nav.appendChild(navBtn('↓','Save',function(){window.print();}));nav.appendChild(center);nav.appendChild(navBtn('⤢','Zoom',function(){var idx=Math.round(wrapper.scrollLeft/window.innerWidth);var p=document.querySelectorAll('.gb-page')[idx];if(p)openReader(p);}));document.body.appendChild(nav);wrapper.addEventListener('scroll',function(){var idx=Math.round(wrapper.scrollLeft/window.innerWidth);var ds=dotsWrap.children;for(var i=0;i<ds.length;i++){ds[i].className='gb-dot'+(i===idx?' on':'');}countEl.textContent=(idx+1<10?'0':'')+(idx+1)+' / '+pages.length;});}built=true;}function fit(){var w=window.innerWidth,mobile=w>0&&w<=820;if(mobile){if(!built)build();if(!wrapper)return;var chrome=document.querySelector('.gb-chrome');var topH=chrome?Math.ceil(chrome.getBoundingClientRect().height):64;var de=document.documentElement;de.style.setProperty('--bkTop',topH+'px');de.style.setProperty('--bkBottom',NAV_H+'px');var availH=window.innerHeight-topH-NAV_H;var scale=Math.min((w-12)/760,(availH-12)/1073);de.style.setProperty('--bkScale',scale);[].slice.call(document.querySelectorAll('.gb-page')).forEach(function(p){p.style.transform='';p.style.width='';p.style.maxWidth='';p.style.marginBottom='';p.style.marginLeft='';p.style.marginRight='';p.style.transformOrigin='';});if(nav){var container=chrome?chrome.parentElement:document.body;nav.className='gb-nav'+(isDark(container)?' gb-dark':'');nav.style.background=getComputedStyle(container).backgroundColor;nav.style.display='flex';}}else{if(nav)nav.style.display='none';}}fit();window.addEventListener('resize',fit);window.addEventListener('load',function(){setTimeout(fit,60);});window.addEventListener('beforeprint',function(){if(nav)nav.style.display='none';});window.addEventListener('afterprint',fit);})();" }} />

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

      <div className="px-4 py-10 gb-pages">
        {/* COVER — full-bleed, scrimmed, white type */}
        <Page bleed={pa.cover || photos[0] || null} id="cover">
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-[9px] tracking-[0.55em] text-white/80"><L k="cover.kicker" def="WELCOME" /></p>
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
              <Kicker><L k="about.kicker" def="THE RESIDENCE" /></Kicker>
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
              <Kicker><L k="about.kicker" def="THE RESIDENCE" /></Kicker>
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
            <div><p className="text-[8.5px] tracking-[0.3em]" style={{ color: accentColor }}><L k="ess.wifi" def="WI-FI" /></p><p className="mt-1 text-[11.5px] font-medium leading-snug"><T path={['wifi', 'network']} value={s.wifi?.network} rows={1} /><br /><span className="font-light opacity-80"><T path={['wifi', 'password']} value={s.wifi?.password} rows={1} /></span></p></div>
            <div><p className="text-[8.5px] tracking-[0.3em]" style={{ color: accentColor }}><L k="ess.inout" def="CHECK-IN / OUT" /></p><p className="mt-1 text-[11.5px] font-medium leading-snug"><T path={['arrival', 'checkIn']} value={s.arrival?.checkIn} rows={1} /><br /><span className="font-light opacity-80"><T path={['arrival', 'checkOut']} value={s.arrival?.checkOut} rows={1} /></span></p></div>
            <div><p className="text-[8.5px] tracking-[0.3em]" style={{ color: accentColor }}><L k="ess.address" def="ADDRESS" /></p><p className="mt-1 text-[10.5px] font-light leading-snug"><MapLink v={s.guidelines?.address}><T path={['guidelines', 'address']} value={s.guidelines?.address} rows={2} /></MapLink></p></div>
            <div><p className="text-[8.5px] tracking-[0.3em]" style={{ color: accentColor }}><L k="ess.needus" def="NEED US?" /></p><p className="mt-1 text-[11.5px] font-medium leading-snug"><Tel v={s.contact?.customerService}><T path={['contact', 'customerService']} value={s.contact?.customerService} rows={1} /></Tel><br /><span className="font-light opacity-80"><L k="ess.hours" def="24/7" /></span></p></div>
          </div>
        </Page>

        {/* SPECIAL + QR */}
        {has('special', (s.special?.groups || []).length > 0) && (
          <Page id="special" hideKey="special">
            <PhotoBand src={pa.special || null} label="THE EXPERIENCE" k="band.special" />
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
              <div className="flex-1 text-[13px] leading-[1.7]" style={{ fontFamily: SERIF }}><L k="special.qr" def="Scan to explore our collection and book direct at stay-hospitality.com" rows={2} /></div>
            </div>
          </Page>
        )}

        {/* ARRIVAL — adaptive: sparse copy + photo becomes a full-height split page */}
        {((s.arrival?.entry || '').length + (s.arrival?.parking || '').length) < 340 && !has('gettingAround', !!str2(s.gettingAround?.body)) && pa.arrival ? (
          <Page id="arrival">
            <div className="absolute inset-y-0 left-0 w-[42%] overflow-hidden">
              <img src={pa.arrival} alt="" className="h-full w-full object-cover" />
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,10,12,0.5), rgba(10,10,12,0.06) 50%)' }} />
              <p className="absolute bottom-10 left-6 right-4 text-[9px] tracking-[0.45em] text-white/90"><L k="band.arrival" def="YOUR ARRIVAL" /></p>
            </div>
            <div className="relative ml-[46%] flex h-full flex-col">
              <H size="text-[34px]"><T path={['arrival', 'heading']} value={s.arrival?.heading} /></H>
              <div className="mt-7 space-y-5">
                <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}><L k="arrival.inLabel" def="CHECK-IN" /></p><p className="mt-1 text-[26px]" style={{ fontFamily: SERIF }}><T path={['arrival', 'checkIn']} value={s.arrival?.checkIn} rows={1} /></p></div>
                <div className="h-px w-10" style={{ background: accentColor + '55' }} />
                <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}><L k="arrival.outLabel" def="CHECK-OUT" /></p><p className="mt-1 text-[26px]" style={{ fontFamily: SERIF }}><T path={['arrival', 'checkOut']} value={s.arrival?.checkOut} rows={1} /></p></div>
              </div>
              <div className="mt-9 space-y-6 text-[12.5px] font-light leading-[1.85]">
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}><L k="arrival.entryLabel" def="Entry" /></p>
                  <p><T path={['arrival', 'entry']} value={s.arrival?.entry} rows={4} /></p>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}><L k="arrival.parkingLabel" def="Parking" /></p>
                  <p><T path={['arrival', 'parking']} value={s.arrival?.parking} rows={3} /></p>
                </div>
              </div>
            </div>
          </Page>
        ) : (
        <Page id="arrival">
          <PhotoBand src={pa.arrival || null} label="YOUR ARRIVAL" k="band.arrival" />
          <H><T path={['arrival', 'heading']} value={s.arrival?.heading} /></H>
          <div className="mt-6 flex gap-14">
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}><L k="arrival.inLabel" def="CHECK-IN" /></p><p className="mt-1 text-[22px]" style={{ fontFamily: SERIF }}><T path={['arrival', 'checkIn']} value={s.arrival?.checkIn} rows={1} /></p></div>
            <div className="w-px" style={{ background: accentColor + '44' }} />
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}><L k="arrival.outLabel" def="CHECK-OUT" /></p><p className="mt-1 text-[22px]" style={{ fontFamily: SERIF }}><T path={['arrival', 'checkOut']} value={s.arrival?.checkOut} rows={1} /></p></div>
          </div>
          <div className="mt-8 grid flex-1 grid-cols-2 content-center gap-x-12 gap-y-8 text-[12.5px] font-light leading-[1.85]">
            <div>
              <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}><L k="arrival.entryLabel" def="Entry" /></p>
              <p className="max-w-[58ch]"><T path={['arrival', 'entry']} value={s.arrival?.entry} rows={4} /></p>
            </div>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}><L k="arrival.parkingLabel" def="Parking" /></p>
              <p className="max-w-[58ch]"><T path={['arrival', 'parking']} value={s.arrival?.parking} rows={3} /></p>
            </div>
            {has('gettingThere', !!str2(s.gettingThere?.body)) && (
              <div className={has('gettingAround', !!str2(s.gettingAround?.body)) ? '' : 'col-span-2'}>
                <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}><L k="arrival.findLabel" def="Finding the residence" /></p>
                <p className="max-w-[58ch]"><T path={['gettingThere', 'body']} value={s.gettingThere?.body} rows={3} /></p>
              </div>
            )}
            {has('gettingAround', !!str2(s.gettingAround?.body)) && (
              <div className={has('gettingThere', !!str2(s.gettingThere?.body)) ? '' : 'col-span-2'}>
                <p className="mb-1.5 text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: accentColor }}><L k="arrival.aroundLabel" def="Getting around" /></p>
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
              <div className="absolute inset-x-0 top-0 h-[46%] overflow-hidden">
                <img src={wifiPhoto} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(19,18,16,0.10), rgba(19,18,16,0.45) 65%, #131210 100%)' }} />
              </div>
            ) : null
          })()}
          <div className="relative flex h-full flex-col text-[#efeae2]" style={{ margin: '-52px -58px -40px', padding: '52px 58px 40px' }}>
            <div className="h-[38%] shrink-0" />
            <div>
              <p className="text-[9px] tracking-[0.5em]" style={{ color: '#c9a96a' }}>{'// '}<L k="wifi.kicker" def="CONNECTED" /></p>
              <h2 className="mt-2 text-[40px] lowercase leading-[1.05] font-medium" style={{ fontFamily: SERIF, textShadow: '0 1px 18px rgba(0,0,0,0.5)' }}><L k="wifi.heading" def="wi-fi & the essentials" /></h2>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-8 border-y py-6" style={{ borderColor: '#c9a96a44' }}>
              <div><p className="text-[9px] tracking-[0.4em]" style={{ color: '#c9a96a' }}><L k="wifi.netLabel" def="NETWORK" /></p><p className="mt-2 text-[19px]" style={{ fontFamily: SERIF }}><T path={['wifi', 'network']} value={s.wifi?.network} rows={1} /></p></div>
              <div><p className="text-[9px] tracking-[0.4em]" style={{ color: '#c9a96a' }}><L k="wifi.passLabel" def="PASSWORD" /></p><p className="mt-2 text-[19px]" style={{ fontFamily: SERIF }}><T path={['wifi', 'password']} value={s.wifi?.password} rows={1} /></p></div>
            </div>
            <div className="mt-7 grid flex-1 content-evenly grid-cols-2 gap-x-8 text-[11.5px] font-light leading-[1.9] text-[#efeae2]/75">
              <div><L k="wifi.note1" def="The password is case-sensitive — enter it exactly as printed. Once a device connects, it will remember the network for the rest of your stay." rows={4} /></div>
              <div>{(() => { const d = 'Trouble connecting? Our team is one call away, day or night — ' + (s.contact?.customerService || '954-526-8998') + '. And if you sign into personal accounts on any TV, remember to log out before checkout.'; return edit ? <L k="wifi.note2" def={d} rows={4} /> : withTel(lbl('wifi.note2', d)) })()}</div>
            </div>
            <div className="mt-auto flex items-end justify-between pt-5 text-[8.5px] tracking-[0.28em] text-[#efeae2]/50">
              <span><Tel v={s.contact?.customerService}>{s.contact?.customerService}</Tel></span><span><Mail v={s.contact?.email}><T path={['contact', 'email']} value={s.contact?.email} rows={1} /></Mail></span>
            </div>
          </div>
        </Page>

        {/* HOW-TO GUIDE — one item per appliance/system, read from uploads + notes */}
        {has('houseGuide', (s.houseGuide?.items || []).length > 0) && (
          <Page id="howto" ghost="how" hideKey="houseGuide">
            <Kicker><L k="houseGuide.kicker" def="HOUSE GUIDE" /></Kicker>
            <H><L k="houseGuide.heading" def="how-to guide" /></H>
            <div className="mt-3 max-w-[56ch] text-[11px] font-light leading-[1.55] opacity-80"><L k="houseGuide.intro" def="Everything here is a feature — a minute of reading makes the whole stay effortless." rows={2} /></div>
            <div className={'mt-4 grid flex-1 gap-x-8 gap-y-3 ' + ((s.houseGuide.items || []).length > 3 ? 'grid-cols-2 content-evenly' : 'grid-cols-1 content-evenly')}>
              {(s.houseGuide.items).slice(0, 8).map((it: any, i: number) => (
                <div key={i} className="flex gap-3 border-b pb-3" style={{ borderColor: accentColor + '22' }}>
                  <span className="text-[24px] leading-none opacity-25" style={{ fontFamily: SERIF }}>{String(i + 1).padStart(2, '0')}</span>
                  <div className="flex-1">
                    <p className="text-[14px] lowercase font-medium leading-tight" style={{ fontFamily: SERIF }}><T path={['houseGuide', 'items', String(i), 'title'] as any} value={it.title} rows={1} /></p>
                    <div className="mt-1.5 h-px w-8" style={{ background: accentColor + '66' }} />
                    <p className="mt-1 text-[10px] font-light leading-[1.5]"><T path={['houseGuide', 'items', String(i), 'body'] as any} value={it.body} rows={3} /></p>
                  </div>
                  {it.photo && <img src={it.photo} alt="" className={((s.houseGuide.items || []).length > 3 ? 'h-24 w-28' : 'h-28 w-40') + ' shrink-0 rounded-sm object-cover ring-1 ring-black/10'} />}
                </div>
              ))}
            </div>
          </Page>
        )}

        {/* GUIDELINES + CONTACT — combined, lean */}
        <Page id="guidelines" ghost="notes">
          <Kicker><L k="guidelines.kicker" def="HOUSE NOTES" /></Kicker>
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
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}><L k="contact.csLabel" def="CUSTOMER SERVICE · 24/7" /></p><p className="mt-1.5 text-[14px]" style={{ fontFamily: SERIF }}><Tel v={s.contact?.customerService}><T path={['contact', 'customerService']} value={s.contact?.customerService} rows={1} /></Tel></p><div className="mt-1 text-[9.5px] font-light opacity-70"><L k="contact.emergency" def="Emergencies: dial 911 first, then call us." rows={2} /></div></div>
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}><T path={['contact', 'gmLabel']} value={s.contact?.gmLabel || 'GENERAL MANAGER'} rows={1} /></p><p className="mt-1.5 text-[14px]" style={{ fontFamily: SERIF }}><T path={['contact', 'gmName']} value={s.contact?.gmName} rows={1} /> · <Tel v={s.contact?.gmPhone}><T path={['contact', 'gmPhone']} value={s.contact?.gmPhone} rows={1} /></Tel></p></div>
            <div><p className="text-[9px] tracking-[0.35em]" style={{ color: accentColor }}><L k="contact.addressLabel" def="ADDRESS" /></p><p className="mt-1.5 text-[11px] font-light leading-snug"><MapLink v={s.guidelines?.address}><T path={['guidelines', 'address']} value={s.guidelines?.address} rows={2} /></MapLink></p></div>
          </div>
        </Page>

        {/* LOCAL — places / eats. Photo cards when imagery exists; big editorial cards when few items. */}
        {localSecs.map((sec: any) => {
          const items = (s[sec.key].items || []).slice(0, 6)
          const anyPhoto = items.some((p: any) => p.photo)
          const few = items.length <= 3
          return (
            <Page key={sec.key} id={sec.key} ghost={sec.key === 'restaurants' ? 'eat' : 'go'} hideKey={sec.key}>
              <Kicker><L k={sec.key + '.tag'} def={sec.tag} /></Kicker>
              <H><L k={sec.key + '.heading'} def={sec.title} /></H>
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
                <div className="text-[12px] leading-[1.7]" style={{ fontFamily: SERIF }}>{(() => { const d = "Want a table or a local tip? Call our front desk at " + (s.contact?.customerService || '954-526-8998') + " — we're happy to arrange reservations."; return edit ? <L k="local.reservations" def={d} rows={2} /> : withTel(lbl('local.reservations', d)) })()}</div>
              </div>
            </Page>
          )
        })}

        {/* ADD-ONS (only if provided) */}
        {has('addons', (s.addons?.items || []).length > 0) && (
          <Page id="addons" ghost="more" hideKey="addons">
            <Kicker><L k="addons.kicker" def="AT YOUR SERVICE" /></Kicker>
            <H><L k="addons.heading" def="exclusive add-ons" /></H>
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
          <PhotoBand src={pa.closing || null} label="UNTIL NEXT TIME" k="band.closing" />
          <div className="grid flex-1 grid-cols-[1fr_1px_1.1fr] gap-x-8">
            <div>
              <p className="text-[9px] tracking-[0.5em]" style={{ color: accentColor }}>{'// '}<L k="closing.beforeLabel" def="BEFORE YOU GO" /></p>
              <ul className="mt-5 space-y-2.5 text-[11.5px] font-light leading-[1.65]">
                {(s.beforeYouGo?.items || []).slice(0, 5).map((it: string, i: number) => (
                  <li key={i} className="flex gap-3"><span className="mt-[8px] h-1 w-1 shrink-0 rounded-full" style={{ background: accentColor }} /><T path={['beforeYouGo', 'items', String(i)] as any} value={it} rows={2} /></li>
                ))}
              </ul>
            </div>
            <div style={{ background: accentColor + '33' }} />
            <div className="flex flex-col items-center justify-center px-2 text-center">
              <p className="text-[13px] tracking-[0.5em]" style={{ color: accentColor }}><L k="closing.stars" def="★ ★ ★ ★ ★" /></p>
              <h3 className="mt-3 text-[26px] lowercase font-medium" style={{ fontFamily: SERIF }}><L k="closing.reviewHeading" def="loved your stay?" /></h3>
              <p className="mt-3 max-w-[40ch] text-[12px] font-light italic leading-[1.8]" style={{ fontFamily: SERIF }}><T path={['review', 'body']} value={s.review?.body} rows={4} /></p>
              <p className="mt-4 text-[11.5px]" style={{ fontFamily: SERIF }}>— <T path={['contact', 'signoff']} value={s.contact?.signoff || 'Jon McGill, General Manager'} rows={1} /></p>
            </div>
          </div>
          <div className="mt-5 flex flex-col items-center border-t pt-5 text-center" style={{ borderColor: accentColor + '33' }}>
            <h2 className="text-[34px] lowercase font-medium" style={{ fontFamily: SERIF }}><L k="closing.thanksHeading" def="thank you" /></h2>
            <p className="mt-1.5 text-[9px] tracking-[0.5em]" style={{ color: accentColor }}><T path={['thankyou', 'line']} value={s.thankyou?.line} rows={1} /></p>
            <div className="mt-4"><StayLogo small /></div>
          </div>
        </Page>
      </div>
    </div>
  )
}

function str2(v: any): string { return typeof v === 'string' ? v : '' }
