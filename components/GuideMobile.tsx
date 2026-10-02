'use client'
// THE GUEST GUIDEBOOK ON A PHONE (Jon, 2026-10-02: "make sure the guidebook sharable links for
// guests are optimized for phones, make it great").
//
// The book (GuidebookView) is a printed object: letter-size pages, 40px display headings, two
// columns. Shrunk onto a phone it was a 13,000px scroll with no way to find the Wi-Fi. This is the
// same book read as a phone app: the cover, then the five things a guest actually opens the link
// for (Wi-Fi with a copy button, check-in and out, the address that opens Maps, the number that
// dials), a sticky section strip to jump anywhere, every section as a card in the book's order, a
// thumb bar at the bottom (Call · Wi-Fi · Map · SOS). Same data, same label overrides (sections
// ._labels), same photos. Nothing here writes; the book is edited at /guidebooks/[id].
//
// Rendered under md: (CSS), the book above it — see app/g/[id]/page.tsx.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Wifi, Copy, Check, Phone, MapPin, Clock, Car, KeyRound, ChevronDown, Sparkles, BookOpen, ListChecks,
  Utensils, Compass, Gift, Siren, Star, ExternalLink, Mail, Navigation, Hospital, ShieldAlert,
} from 'lucide-react'
import { DEFAULT_EMERGENCY_CONTACTS } from '@/lib/emergency'

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const SANS = "'Inter', -apple-system, sans-serif"
const LOGO_URL = 'https://ugbtsppfsgkkrdyyuxxg.supabase.co/storage/v1/object/public/guidebook-assets/1783090958148-l1zr8u.png'

const purl = (p: any): string | null => {
  if (!p) return null
  if (typeof p === 'object') return p.original || p.thumbnail || p.url || null
  if (typeof p === 'string') { const s = p.trim(); if (s.charAt(0) === '{') { try { const o = JSON.parse(s); return o.original || o.thumbnail || o.url || null } catch { return null } } return s }
  return null
}
const str = (v: any): string => (typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v.body === 'string') ? v.body : '')
const tel = (v: any) => String(v || '').replace(/[^\d+]/g, '')
const mapsUrl = (q: string) => 'https://maps.google.com/?q=' + encodeURIComponent(q)

export function GuideMobile({ gb }: { gb: any }) {
  const s = gb?.sections || {}
  const omit: string[] = Array.isArray(s.omit) ? s.omit : []
  const has = (key: string, ok: boolean) => !omit.includes(key) && ok
  const lbl = (k: string, def: string) => { const o = (s._labels || {})[k]; return typeof o === 'string' && o.trim() ? o : def }
  const dark = gb?.theme === 'dark'
  const pa: Record<string, string | null> = {}
  for (const k of Object.keys(s._photoAssign || {})) pa[k] = purl(s._photoAssign[k])
  const photos: string[] = (Array.isArray(s._photos) ? s._photos : []).map(purl).filter(Boolean) as string[]
  const cover = pa.cover || photos[0] || null

  const c = {
    paper: dark ? '#141311' : '#fbf9f5', card: dark ? '#1d1b18' : '#ffffff', ink: dark ? '#efeae2' : '#1f1d1a',
    mute: dark ? 'rgba(239,234,226,0.62)' : 'rgba(31,29,26,0.6)', accent: dark ? '#c9a96a' : '#8a7350',
    line: dark ? 'rgba(201,169,106,0.22)' : 'rgba(138,115,80,0.2)', tint: dark ? 'rgba(201,169,106,0.1)' : 'rgba(138,115,80,0.08)',
  }

  const title = String(gb?.title || 'Your Stay')
  const cityLine = str(s.cover?.subtitle) || ''
  const wifiNet = str(s.wifi?.network), wifiPw = str(s.wifi?.password)
  const checkIn = str(s.arrival?.checkIn), checkOut = str(s.arrival?.checkOut)
  const address = str(s.guidelines?.address)
  const phone = str(s.contact?.customerService)
  const email = str(s.contact?.email)
  const em = s.emergency || {}
  const hosps: any[] = Array.isArray(em.hospitals) ? em.hospitals : []
  const emContacts: any[] = Array.isArray(em.contacts) ? em.contacts : DEFAULT_EMERGENCY_CONTACTS
  const placeCity = address.split(',')[1]?.trim() || ''

  // The section strip: only sections the book actually has, in the book's order.
  const sections = useMemo(() => ([
    has('arrival', !!(str(s.arrival?.entry) || str(s.arrival?.parking) || checkIn)) && { id: 'arrival', label: 'Arrival', Icon: KeyRound },
    has('about', !!str(s.about?.body)) && { id: 'about', label: 'The space', Icon: BookOpen },
    has('special', (s.special?.groups || []).length > 0) && { id: 'special', label: 'Highlights', Icon: Sparkles },
    has('houseGuide', (s.houseGuide?.items || []).length > 0) && { id: 'howto', label: 'How-to', Icon: ListChecks },
    has('guidelines', (s.guidelines?.items || []).length > 0) && { id: 'guidelines', label: 'House rules', Icon: ShieldAlert },
    has('localPlaces', (s.localPlaces?.items || []).length > 0) && { id: 'local', label: 'Explore', Icon: Compass },
    has('restaurants', (s.restaurants?.items || []).length > 0) && { id: 'eat', label: 'Eat', Icon: Utensils },
    has('addons', (s.addons?.items || []).length > 0) && { id: 'addons', label: 'Add-ons', Icon: Gift },
    { id: 'checkout', label: 'Check-out', Icon: Star },
    { id: 'emergency', label: 'Emergency', Icon: Siren },
  ].filter(Boolean) as { id: string; label: string; Icon: any }[]), [gb])

  // Scroll-spy for the strip: the section whose top is nearest the strip is the lit one.
  const [active, setActive] = useState<string>('')
  useEffect(() => {
    const els = sections.map(x => document.getElementById('m-' + x.id)).filter(Boolean) as HTMLElement[]
    if (!els.length) return
    const io = new IntersectionObserver(entries => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (vis[0]) setActive(vis[0].target.id.slice(2))
    }, { rootMargin: '-120px 0px -60% 0px', threshold: 0 })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [sections])
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = stripRef.current?.querySelector('[data-id="' + active + '"]') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [active])
  const go = (id: string) => { const el = document.getElementById('m-' + id); if (!el) return; const y = el.getBoundingClientRect().top + window.scrollY - 104; window.scrollTo({ top: y, behavior: 'smooth' }) }

  // Copy with a visible "copied" tick; falls back to selecting the text where the clipboard is refused.
  const [copied, setCopied] = useState<string>('')
  const copy = async (what: string, v: string) => {
    try { await navigator.clipboard.writeText(v); setCopied(what); setTimeout(() => setCopied(''), 1600) } catch { /* the text is selectable */ }
  }

  // Before-you-go checklist state lives only on this phone, for this stay.
  const [ticked, setTicked] = useState<Record<number, boolean>>({})
  useEffect(() => { try { const r = localStorage.getItem('gb-ticks-' + gb?.id); if (r) setTicked(JSON.parse(r)) } catch {} }, [gb?.id])
  const tick = (i: number) => setTicked(t => { const n = { ...t, [i]: !t[i] }; try { localStorage.setItem('gb-ticks-' + gb?.id, JSON.stringify(n)) } catch {} return n })

  const [open, setOpen] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }))

  const Kicker = ({ children }: { children: any }) => <p className="text-[10px] tracking-[0.4em] uppercase" style={{ color: c.accent, fontFamily: SANS }}>{children}</p>
  const H2 = ({ children }: { children: any }) => <h2 className="mt-1 text-[28px] lowercase leading-[1.05] font-medium" style={{ fontFamily: SERIF, color: c.ink }}>{children}</h2>
  const Card = ({ id, children, pad = true }: { id?: string; children: any; pad?: boolean }) => (
    <section id={id ? 'm-' + id : undefined} className={'rounded-2xl ' + (pad ? 'p-4' : '')} style={{ background: c.card, boxShadow: dark ? '0 1px 0 rgba(255,255,255,0.04)' : '0 1px 2px rgba(31,29,26,0.06), 0 8px 24px -16px rgba(31,29,26,0.25)' }}>{children}</section>
  )
  const Btn = ({ href, onClick, children, solid = false, title }: { href?: string; onClick?: () => void; children: any; solid?: boolean; title?: string }) => {
    const cls = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 min-h-[44px] text-[13px] font-semibold active:opacity-80 transition'
    const style = solid ? { background: c.accent, color: '#fff' } : { background: c.tint, color: c.ink }
    return href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={cls} style={style} title={title}>{children}</a>
      : <button type="button" onClick={onClick} className={cls} style={style} title={title}>{children}</button>
  }
  const Place = ({ p }: { p: any }) => {
    const photo = purl(p.photo)
    const q = [p.name, p.address || placeCity].filter(Boolean).join(', ')
    return (
      <a href={mapsUrl(q)} target="_blank" rel="noreferrer" className="snap-start shrink-0 w-[232px] rounded-2xl overflow-hidden active:opacity-85" style={{ background: c.card, boxShadow: dark ? 'none' : '0 1px 2px rgba(31,29,26,0.06), 0 8px 24px -16px rgba(31,29,26,0.25)' }}>
        {photo ? (
          <div className="relative h-[140px]">
            <img src={photo} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" onError={(e: any) => { e.currentTarget.parentElement.style.display = 'none' }} />
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(10,10,12,0.6), rgba(10,10,12,0) 60%)' }} />
            <p className="absolute bottom-2.5 left-3 right-3 text-[16px] font-medium text-white leading-tight" style={{ fontFamily: SERIF }}>{p.name}</p>
          </div>
        ) : null}
        <div className="p-3">
          {!photo && <p className="text-[16px] font-medium leading-tight" style={{ fontFamily: SERIF, color: c.ink }}>{p.name}</p>}
          {p.note ? <p className="text-[12px] leading-[1.5] line-clamp-3" style={{ color: c.mute }}>{p.note}</p> : null}
          <p className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: c.accent }}><Navigation size={11} /> Directions{p.address ? <span className="font-normal truncate max-w-[140px]" style={{ color: c.mute }}>· {p.address}</span> : null}</p>
        </div>
      </a>
    )
  }

  return (
    <div className="gm-root" style={{ background: c.paper, color: c.ink, fontFamily: SANS, minHeight: '100vh', paddingBottom: 'calc(84px + env(safe-area-inset-bottom, 0px))' }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600&display=swap" />
      <style>{`.gm-root ::-webkit-scrollbar{display:none} .gm-root .gm-x{scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain} .gm-root a,.gm-root button{touch-action:manipulation;-webkit-tap-highlight-color:transparent}`}</style>

      {/* COVER — the photo, the name, the welcome. Sized to the phone, not to the page. */}
      <header className="relative" style={{ height: 'min(62vh, 520px)', background: '#1c1a17' }}>
        {cover ? <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" /> : null}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(10,10,12,0.25), rgba(10,10,12,0.05) 35%, rgba(10,10,12,0.75) 100%)' }} />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
          <img src={LOGO_URL} alt="Stay Hospitality" className="h-7 w-auto" style={{ filter: 'brightness(0) invert(1)' }} />
          {phone ? <a href={'tel:' + tel(phone)} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-md"><Phone size={12} /> Call us</a> : null}
        </div>
        <div className="absolute inset-x-0 bottom-0 px-5 pb-7">
          <p className="text-[10px] tracking-[0.45em] text-white/80">{lbl('cover.kicker', 'WELCOME')}</p>
          <h1 className="mt-2 text-[40px] leading-[1.02] font-medium text-white" style={{ fontFamily: SERIF, textWrap: 'balance' as any }}>{str(s.cover?.line) || ('welcome to ' + title)}</h1>
          {cityLine ? <p className="mt-2.5 text-[11px] tracking-[0.3em] uppercase text-white/75">{cityLine}</p> : null}
        </div>
      </header>

      {/* THE ESSENTIALS — overlapping the cover: what a guest opens this link for. */}
      <div className="px-4 -mt-5 relative z-10">
        <Card>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {wifiNet ? (
              <div className="col-span-2 flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><Wifi size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: c.accent }}>{lbl('ess.wifi', 'WI-FI')}</p>
                  <p className="mt-0.5 text-[15px] font-medium break-all select-all">{wifiNet}</p>
                  {wifiPw ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <code className="rounded-lg px-2.5 py-1.5 text-[15px] font-semibold tracking-wide select-all break-all" style={{ background: c.tint }}>{wifiPw}</code>
                      <button type="button" onClick={() => copy('wifi', wifiPw)} aria-label="Copy the Wi-Fi password" className="inline-flex h-9 min-w-[44px] items-center justify-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold" style={{ background: copied === 'wifi' ? '#1f7a4d' : c.accent, color: '#fff' }}>{copied === 'wifi' ? <><Check size={13} /> copied</> : <><Copy size={13} /> copy</>}</button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {(checkIn || checkOut) ? (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><Clock size={16} /></span>
                <div className="min-w-0">
                  <p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: c.accent }}>{lbl('ess.inout', 'CHECK-IN / OUT')}</p>
                  <p className="mt-0.5 text-[14px] font-medium leading-snug">{checkIn || '—'}</p>
                  <p className="text-[12.5px]" style={{ color: c.mute }}>out {checkOut || '—'}</p>
                </div>
              </div>
            ) : null}
            {phone ? (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><Phone size={16} /></span>
                <div className="min-w-0">
                  <p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: c.accent }}>{lbl('ess.needus', 'NEED US?')}</p>
                  <a href={'tel:' + tel(phone)} className="mt-0.5 block text-[14px] font-medium leading-snug underline-offset-2">{phone}</a>
                  <p className="text-[12.5px]" style={{ color: c.mute }}>{lbl('ess.hours', '24/7')}</p>
                </div>
              </div>
            ) : null}
            {address ? (
              <a href={mapsUrl(address)} target="_blank" rel="noreferrer" className="col-span-2 flex items-start gap-3 rounded-xl p-2.5 -m-2.5 active:opacity-80" style={{ background: 'transparent' }}>
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><MapPin size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: c.accent }}>{lbl('ess.address', 'ADDRESS')}</p>
                  <p className="mt-0.5 text-[14px] font-medium leading-snug">{address.replace(/,\s*United States$/i, '')}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: c.accent }}><Navigation size={11} /> Open in Maps</p>
                </div>
              </a>
            ) : null}
          </div>
        </Card>
      </div>

      {/* THE STRIP — sticky, one line, lights up as you scroll. */}
      <nav className="sticky z-20 mt-4" style={{ top: 'env(safe-area-inset-top, 0px)', background: c.paper, borderBottom: '1px solid ' + c.line }}>
        <div ref={stripRef} className="gm-x flex gap-1.5 overflow-x-auto px-4 py-2.5">
          {sections.map(x => (
            <button key={x.id} data-id={x.id} type="button" onClick={() => go(x.id)} className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap transition"
              style={active === x.id ? { background: c.ink, color: c.paper } : { background: c.tint, color: c.ink }}>
              <x.Icon size={13} /> {x.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="px-4 pt-4 space-y-4">
        {/* ARRIVAL */}
        {has('arrival', !!(str(s.arrival?.entry) || str(s.arrival?.parking) || checkIn)) && (
          <Card id="arrival">
            <Kicker>{lbl('arrival.kicker', 'YOUR ARRIVAL')}</Kicker>
            <H2>{str(s.arrival?.heading) || 'getting in'}</H2>
            {str(s.arrival?.entry) ? <div className="mt-4 flex gap-3"><KeyRound size={16} className="mt-0.5 shrink-0" style={{ color: c.accent }} /><div><p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: c.accent }}>{lbl('arrival.entryLabel', 'Entry')}</p><p className="mt-1 text-[14.5px] leading-[1.6]">{str(s.arrival?.entry)}</p></div></div> : null}
            {str(s.arrival?.parking) ? <div className="mt-4 flex gap-3"><Car size={16} className="mt-0.5 shrink-0" style={{ color: c.accent }} /><div><p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: c.accent }}>{lbl('arrival.parkingLabel', 'Parking')}</p><p className="mt-1 text-[14.5px] leading-[1.6]">{str(s.arrival?.parking)}</p></div></div> : null}
            {has('gettingThere', !!str(s.gettingThere?.body)) ? <div className="mt-4 flex gap-3"><MapPin size={16} className="mt-0.5 shrink-0" style={{ color: c.accent }} /><div><p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: c.accent }}>{lbl('arrival.thereLabel', 'Finding the residence')}</p><p className="mt-1 text-[14.5px] leading-[1.6]">{str(s.gettingThere?.body)}</p></div></div> : null}
            {has('gettingAround', !!str(s.gettingAround?.body)) ? <div className="mt-4 flex gap-3"><Compass size={16} className="mt-0.5 shrink-0" style={{ color: c.accent }} /><div><p className="text-[10px] tracking-[0.3em] uppercase" style={{ color: c.accent }}>{lbl('arrival.aroundLabel', 'Getting around')}</p><p className="mt-1 text-[14.5px] leading-[1.6]">{str(s.gettingAround?.body)}</p></div></div> : null}
          </Card>
        )}

        {/* ABOUT */}
        {has('about', !!str(s.about?.body)) && (
          <Card id="about" pad={false}>
            {pa.about ? <img src={pa.about} alt="" loading="lazy" className="h-[180px] w-full object-cover rounded-t-2xl" /> : null}
            <div className="p-4">
              <Kicker>{lbl('about.kicker', 'THE RESIDENCE')}</Kicker>
              <H2>{str(s.about?.heading) || 'about the space'}</H2>
              <p className="mt-3 text-[14.5px] leading-[1.7]">{str(s.about?.body)}</p>
              {has('retreat', (s.retreat?.lines || []).length > 0) ? (
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {(s.retreat.lines as string[]).slice(0, 3).map((ln, i) => <p key={i} className="rounded-xl px-2 py-2 text-center text-[11px] leading-snug" style={{ background: c.tint, color: c.ink }}>{ln}</p>)}
                </div>
              ) : null}
            </div>
          </Card>
        )}

        {/* SPECIAL */}
        {has('special', (s.special?.groups || []).length > 0) && (
          <Card id="special" pad={false}>
            {pa.special ? <img src={pa.special} alt="" loading="lazy" className="h-[160px] w-full object-cover rounded-t-2xl" /> : null}
            <div className="p-4">
              <Kicker>{lbl('band.special', 'THE EXPERIENCE')}</Kicker>
              <H2>{str(s.special?.heading) || 'what makes it special'}</H2>
              <div className="mt-3 space-y-4">
                {(s.special.groups as any[]).map((g, i) => (
                  <div key={i}>
                    <p className="text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: c.accent }}>{g.title}</p>
                    <ul className="mt-1.5 space-y-1.5">
                      {(g.items || []).map((it: string, j: number) => <li key={j} className="flex gap-2 text-[14px] leading-[1.55]"><span style={{ color: c.accent }}>—</span><span>{it}</span></li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* HOW-TO — one row per item, tap to open; the appliance photo sits with its steps. */}
        {has('houseGuide', (s.houseGuide?.items || []).length > 0) && (
          <Card id="howto">
            <Kicker>{lbl('howto.kicker', 'THE HOUSE')}</Kicker>
            <H2>{lbl('howto.heading', 'how-to guide')}</H2>
            <div className="mt-3 divide-y" style={{ borderColor: c.line }}>
              {(s.houseGuide.items as any[]).slice(0, 12).map((it, i) => {
                const k = 'h' + i, isOpen = !!open[k], photo = purl(it.photo)
                return (
                  <div key={i} style={{ borderColor: c.line }}>
                    <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen} className="flex w-full items-center gap-3 py-3 text-left">
                      <span className="text-[18px] leading-none w-7 shrink-0 opacity-30" style={{ fontFamily: SERIF }}>{String(i + 1).padStart(2, '0')}</span>
                      <span className="flex-1 text-[15.5px] lowercase font-medium leading-tight" style={{ fontFamily: SERIF }}>{it.title}</span>
                      <ChevronDown size={16} className="shrink-0 transition-transform" style={{ color: c.accent, transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                    </button>
                    {isOpen ? (
                      <div className="pb-4 pl-10">
                        {photo ? <img src={photo} alt="" loading="lazy" className="mb-2.5 h-[150px] w-full rounded-xl object-cover" /> : null}
                        <p className="text-[14px] leading-[1.65] whitespace-pre-line" style={{ color: c.ink }}>{str(it.body)}</p>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {/* HOUSE RULES */}
        {has('guidelines', (s.guidelines?.items || []).length > 0) && (
          <Card id="guidelines">
            <Kicker>{lbl('guidelines.kicker', 'HOUSE GUIDELINES')}</Kicker>
            <H2>{str(s.guidelines?.heading) || 'a few house notes'}</H2>
            {str(s.guidelines?.intro) ? <p className="mt-2 text-[13.5px] leading-[1.6]" style={{ color: c.mute }}>{str(s.guidelines?.intro)}</p> : null}
            <div className="mt-3 space-y-3">
              {(s.guidelines.items as any[]).slice(0, 8).map((it, i) => (
                <div key={i} className="rounded-xl p-3" style={{ background: c.tint }}>
                  <p className="text-[10px] font-semibold tracking-[0.24em] uppercase" style={{ color: c.accent }}>{it.title}</p>
                  <p className="mt-1 text-[14px] leading-[1.6]">{str(it.body)}</p>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* EXPLORE / EAT — swipeable cards, each one opens Maps. */}
        {has('localPlaces', (s.localPlaces?.items || []).length > 0) && (
          <section id="m-local" className="-mx-4">
            <div className="px-8"><Kicker>{lbl('localPlaces.tag', 'TO VISIT')}</Kicker><H2>{lbl('localPlaces.heading', 'local places')}</H2></div>
            <div className="gm-x mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-8 pb-2">
              {(s.localPlaces.items as any[]).slice(0, 8).map((p, i) => <Place key={i} p={p} />)}
            </div>
          </section>
        )}
        {has('restaurants', (s.restaurants?.items || []).length > 0) && (
          <section id="m-eat" className="-mx-4">
            <div className="px-8"><Kicker>{lbl('restaurants.tag', 'OUR PICKS')}</Kicker><H2>{lbl('restaurants.heading', 'where to eat')}</H2></div>
            <div className="gm-x mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-8 pb-2">
              {(s.restaurants.items as any[]).slice(0, 8).map((p, i) => <Place key={i} p={p} />)}
            </div>
          </section>
        )}

        {/* ADD-ONS */}
        {has('addons', (s.addons?.items || []).length > 0) && (
          <Card id="addons">
            <Kicker>{lbl('addons.kicker', 'AT YOUR SERVICE')}</Kicker>
            <H2>{lbl('addons.heading', 'exclusive add-ons')}</H2>
            {str(s.addons?.intro) ? <p className="mt-2 text-[13.5px] leading-[1.6]" style={{ color: c.mute }}>{str(s.addons?.intro)}</p> : null}
            <ul className="mt-3 divide-y" style={{ borderColor: c.line }}>
              {(s.addons.items as any[]).slice(0, 12).map((p, i) => (
                <li key={i} className="flex items-baseline gap-3 py-2.5" style={{ borderColor: c.line }}>
                  <span className="text-[13px] leading-none opacity-30" style={{ fontFamily: SERIF }}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="flex-1 text-[15px] lowercase font-medium" style={{ fontFamily: SERIF }}>{p.name || str(p)}</span>
                  {p.price ? <span className="text-[13px] font-semibold" style={{ color: c.accent }}>{p.price}</span> : null}
                </li>
              ))}
            </ul>
            {phone ? <div className="mt-4"><Btn href={'sms:' + tel(phone)} solid><Mail size={14} /> Text us to arrange</Btn></div> : null}
          </Card>
        )}

        {/* CHECK-OUT + REVIEW + BOOK AGAIN */}
        <Card id="checkout">
          <Kicker>{lbl('closing.beforeLabel', 'BEFORE YOU GO')}</Kicker>
          <H2>{lbl('closing.heading', 'checking out')}</H2>
          <p className="mt-1.5 text-[13px]" style={{ color: c.mute }}>Check-out is {checkOut || 'as agreed'}. Tick these off as you go.</p>
          <ul className="mt-3 space-y-1.5">
            {((s.beforeYouGo?.items || []) as string[]).slice(0, 8).map((it, i) => (
              <li key={i}>
                <button type="button" onClick={() => tick(i)} aria-pressed={!!ticked[i]} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left" style={{ background: ticked[i] ? c.tint : 'transparent' }}>
                  <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: c.accent, background: ticked[i] ? c.accent : 'transparent', color: '#fff' }}>{ticked[i] ? <Check size={12} /> : null}</span>
                  <span className="text-[14px] leading-[1.55]" style={{ textDecoration: ticked[i] ? 'line-through' : 'none', opacity: ticked[i] ? 0.6 : 1 }}>{it}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-5 rounded-2xl p-4 text-center" style={{ background: c.tint }}>
            <p className="text-[13px] tracking-[0.4em]" style={{ color: c.accent }}>{lbl('closing.stars', '★ ★ ★ ★ ★')}</p>
            <h3 className="mt-2 text-[24px] lowercase font-medium" style={{ fontFamily: SERIF }}>{lbl('closing.reviewHeading', 'loved your stay?')}</h3>
            {str(s.review?.body) ? <p className="mt-2 text-[13.5px] italic leading-[1.7]" style={{ fontFamily: SERIF, color: c.mute }}>{str(s.review?.body)}</p> : null}
            <p className="mt-2 text-[12.5px]" style={{ fontFamily: SERIF }}>— {str(s.contact?.signoff) || 'Jon McGill, General Manager'}</p>
          </div>
          <div className="mt-4 rounded-2xl p-4" style={{ border: '1px solid ' + c.line }}>
            <p className="text-[10px] tracking-[0.4em] uppercase" style={{ color: c.accent }}>{lbl('booknext.kicker', 'COME BACK SOON')}</p>
            <p className="mt-1 text-[20px] lowercase font-medium leading-tight" style={{ fontFamily: SERIF }}>{lbl('booknext.heading', 'book your next stay')}</p>
            <p className="mt-1.5 text-[13px] leading-[1.6]" style={{ color: c.mute }}>{lbl('booknext.body', 'We would love to host you again. Book directly with us and enjoy a little something off your next stay.')}</p>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <Btn href={lbl('booknext.url', 'https://stay-hospitality.com')} solid><ExternalLink size={14} /> Book direct</Btn>
              <button type="button" onClick={() => copy('code', lbl('booknext.code', 'STAYAGAIN10'))} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 text-[13px] font-semibold" style={{ background: c.tint, color: c.ink }}>
                {lbl('booknext.codeLabel', 'Use code')} <span className="tracking-[0.18em]" style={{ color: c.accent }}>{lbl('booknext.code', 'STAYAGAIN10')}</span> {copied === 'code' ? <Check size={13} /> : <Copy size={13} style={{ color: c.mute }} />}
              </button>
            </div>
          </div>
        </Card>

        {/* EMERGENCY — big, obvious, every number dials, every hospital gets directions. */}
        <Card id="emergency">
          <Kicker>{lbl('emergency.kicker', 'IN AN EMERGENCY')}</Kicker>
          <H2>{str(em.heading) || 'if you need help'}</H2>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <a href="tel:911" className="flex items-center gap-3 rounded-2xl p-3.5 active:opacity-85" style={{ background: '#b42318', color: '#fff' }}>
              <Siren size={22} /><div><p className="text-[16px] font-bold leading-tight">Call 911</p><p className="text-[12px] opacity-85">Police · fire · ambulance — then call us</p></div>
            </a>
            {phone ? <a href={'tel:' + tel(phone)} className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: c.tint }}><Phone size={20} style={{ color: c.accent }} /><div><p className="text-[15px] font-semibold leading-tight">{phone}</p><p className="text-[12px]" style={{ color: c.mute }}>Stay Hospitality · {lbl('ess.hours', '24/7')}</p></div></a> : null}
            {em.police ? <a href={'tel:' + tel(em.police)} className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: c.tint }}><ShieldAlert size={20} style={{ color: c.accent }} /><div><p className="text-[15px] font-semibold leading-tight">{em.police}</p><p className="text-[12px]" style={{ color: c.mute }}>{em.policeLabel || 'Police'} · non-emergency</p></div></a> : null}
            {emContacts.map((x: any, i: number) => tel(x.value).length >= 7 ? (
              <a key={i} href={'tel:' + tel(x.value)} className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: c.tint }}><Phone size={20} style={{ color: c.accent }} /><div><p className="text-[15px] font-semibold leading-tight">{x.value}</p><p className="text-[12px]" style={{ color: c.mute }}>{x.label}{x.note ? ' · ' + x.note : ''}</p></div></a>
            ) : null)}
          </div>
          {hosps.length ? (
            <div className="mt-4">
              <p className="text-[10px] font-semibold tracking-[0.3em] uppercase" style={{ color: c.accent }}>Nearest hospitals</p>
              <ul className="mt-2 divide-y" style={{ borderColor: c.line }}>
                {hosps.slice(0, 5).map((h: any, i: number) => (
                  <li key={i} className="flex items-center gap-3 py-3" style={{ borderColor: c.line }}>
                    <Hospital size={18} className="shrink-0" style={{ color: c.accent }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-semibold leading-tight">{h.name}{h.miles != null ? <span className="ml-1.5 text-[12px] font-normal" style={{ color: c.mute }}>{h.miles} mi</span> : null}</p>
                      <p className="text-[12px] leading-snug" style={{ color: c.mute }}>{[h.note, h.address].filter(Boolean).join(' · ')}</p>
                    </div>
                    {h.phone ? <a href={'tel:' + tel(h.phone)} aria-label={'Call ' + h.name} className="inline-flex h-10 w-10 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><Phone size={15} /></a> : null}
                    <a href={mapsUrl([h.name, h.address].filter(Boolean).join(', '))} target="_blank" rel="noreferrer" aria-label={'Directions to ' + h.name} className="inline-flex h-10 w-10 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><Navigation size={15} /></a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {str(em.notes) ? <p className="mt-3 text-[13px] leading-[1.6]" style={{ color: c.mute }}>{str(em.notes)}</p> : null}
        </Card>

        <footer className="pt-2 pb-4 text-center">
          <img src={LOGO_URL} alt="Stay Hospitality" className="mx-auto h-6 w-auto" style={{ filter: dark ? 'brightness(0) invert(1)' : 'none', opacity: 0.8 }} />
          <p className="mt-2 text-[11px] tracking-[0.25em] uppercase" style={{ color: c.mute }}>{lbl('footer.line', 'stay-hospitality.com')}</p>
          {email ? <a href={'mailto:' + email} className="mt-1 inline-block text-[12px]" style={{ color: c.mute }}>{email}</a> : null}
          <p className="mt-3 text-[11px]" style={{ color: c.mute }}><a href={'/g/' + gb?.id + '?book=1'} className="underline underline-offset-2">Printable book</a></p>
        </footer>
      </main>

      {/* THE THUMB BAR */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch" style={{ background: dark ? 'rgba(20,19,17,0.92)' : 'rgba(251,249,245,0.92)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderTop: '1px solid ' + c.line, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {phone ? <a href={'tel:' + tel(phone)} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10.5px] font-semibold" style={{ color: c.ink }}><Phone size={19} style={{ color: c.accent }} />Call</a> : null}
        {wifiNet ? <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10.5px] font-semibold" style={{ color: c.ink }}><Wifi size={19} style={{ color: c.accent }} />Wi-Fi</button> : null}
        {address ? <a href={mapsUrl(address)} target="_blank" rel="noreferrer" className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10.5px] font-semibold" style={{ color: c.ink }}><MapPin size={19} style={{ color: c.accent }} />Map</a> : null}
        <button type="button" onClick={() => go('howto')} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10.5px] font-semibold" style={{ color: c.ink }}><ListChecks size={19} style={{ color: c.accent }} />How-to</button>
        <button type="button" onClick={() => go('emergency')} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10.5px] font-semibold" style={{ color: '#b42318' }}><Siren size={19} />SOS</button>
      </nav>
    </div>
  )
}
