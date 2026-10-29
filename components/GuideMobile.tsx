'use client'
// THE GUEST GUIDE — phone first, prints as a short house manual.
//
// 2026-10-29 (Jon: "improve our guidebooks, clean them up, make them better and more optimized for
// the phone and have a printable setting too" → "revamp all guidebooks, clean it up and make it
// great"). Rebuilt from the 2026-10-02 phone version:
//
//   · ESSENTIALS FIRST. Wi-Fi (copy), check-in and check-out, the door, parking, the address that
//     opens Maps, call / text — the things a guest opens the link for, before any reading.
//   · SHORT AND SCANNABLE. Sentence-case headings, one type scale, long paragraphs clamp with
//     "More". The all-caps "retreat" boxes are gone; highlights are chips; house rules are rows.
//   · NO BROKEN PICTURES. Local places are clean rows (name, why, directions, call) — the stock
//     photos auto-sourced for them were often wrong or missing and left grey boxes.
//   · THE SAME PAGE ON A LAPTOP, centred; one column reads better than the old magazine spread.
//   · PRINT = THE HOUSE MANUAL (GuidePrint below): a few clean Letter pages with everything a guest
//     needs on paper and a QR code back to this live guide. "Print this guide" in the footer, Cmd-P,
//     or /g/<id>?print=1. The old 12-page book still opens at ?book=1.
//
// Same data and the same label overrides (sections._labels) as the book editor at /guidebooks/[id].
// Nothing here writes.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Wifi, Copy, Check, Phone, MapPin, Car, KeyRound, ChevronDown, ListChecks,
  Compass, Siren, ExternalLink, MessageSquare, Navigation, Hospital, ShieldAlert, LogOut,
} from 'lucide-react'
import { DEFAULT_EMERGENCY_CONTACTS } from '@/lib/emergency'

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const LOGO_URL = 'https://ugbtsppfsgkkrdyyuxxg.supabase.co/storage/v1/object/public/guidebook-assets/1783090958148-l1zr8u.png'

export const purl = (p: any): string | null => {
  if (!p) return null
  if (typeof p === 'object') return p.original || p.thumbnail || p.url || null
  if (typeof p === 'string') { const s = p.trim(); if (s.charAt(0) === '{') { try { const o = JSON.parse(s); return o.original || o.thumbnail || o.url || null } catch { return null } } return s }
  return null
}
const str = (v: any): string => (typeof v === 'string' ? v.trim() : (v && typeof v === 'object' && typeof v.body === 'string') ? v.body.trim() : '')
const tel = (v: any) => String(v || '').replace(/[^\d+]/g, '')
const mapsUrl = (q: string) => 'https://maps.google.com/?q=' + encodeURIComponent(q)
/** "Stainless Steel Side-by-Side Refrigerator" → "Stainless steel side-by-side refrigerator"; leaves acronyms (TV, AC) alone. */
export function sentence(t: string): string {
  const s = String(t || '').trim()
  if (!s) return ''
  const words = s.split(/\s+/)
  return words.map((w, i) => (/^[A-Z0-9]{2,}$/.test(w) || /\d/.test(w) ? w : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ')
}
/** The guest-facing name of the stay: the listing title without the "— Guest Guidebook" suffix or the "| Pool & Beach" marketing tail. */
export function stayName(gb: any): string {
  const t = String(gb?.title || gb?.listing_name || 'Your stay').replace(/\s*[—–-]\s*Guest Guidebook\s*$/i, '').trim()
  const head = t.split(/\s+\|\s+/)[0].trim()
  return head || t || 'Your stay'
}

/** Everything both views read from the book, in one place. */
export function guideData(gb: any) {
  const s = gb?.sections || {}
  const omit: string[] = Array.isArray(s.omit) ? s.omit : []
  const has = (key: string, ok: boolean) => omit.indexOf(key) < 0 && ok
  const lbl = (k: string, def: string) => { const o = (s._labels || {})[k]; return typeof o === 'string' && o.trim() ? o : def }
  const pa: Record<string, string | null> = {}
  for (const k of Object.keys(s._photoAssign || {})) pa[k] = purl(s._photoAssign[k])
  const photos: string[] = (Array.isArray(s._photos) ? s._photos : []).map(purl).filter(Boolean) as string[]
  const em = s.emergency || {}
  const address = str(s.guidelines?.address).replace(/,\s*United States( of America)?$/i, '')
  const list = (v: any) => (Array.isArray(v) ? v : [])
  return {
    s, has, lbl, pa, photos, em,
    name: stayName(gb),
    subtitle: str(s.cover?.subtitle).replace(/\s{2,}/g, ' '),
    line1: str(s.cover?.line1), line2: str(s.cover?.line2),
    cover: pa.cover || photos[0] || null,
    wifiNet: str(s.wifi?.network), wifiPw: str(s.wifi?.password),
    checkIn: str(s.arrival?.checkIn), checkOut: str(s.arrival?.checkOut),
    entry: str(s.arrival?.entry), parking: str(s.arrival?.parking),
    gettingThere: has('gettingThere', true) ? str(s.gettingThere?.body) : '',
    gettingAround: has('gettingAround', true) ? str(s.gettingAround?.body) : '',
    address,
    phone: str(s.contact?.customerService), email: str(s.contact?.email),
    signoff: str(s.contact?.signoff) || 'Jon McGill, General Manager',
    about: has('about', true) ? str(s.about?.body) : '',
    highlights: has('special', true) ? list(s.special?.groups).filter((g: any) => g && list(g.items).length) : [],
    howto: has('houseGuide', true) ? list(s.houseGuide?.items).filter((x: any) => x && (x.title || x.body)) : [],
    rules: has('guidelines', true) ? list(s.guidelines?.items).filter((x: any) => x && (x.title || x.body)) : [],
    rulesIntro: str(s.guidelines?.intro),
    places: has('localPlaces', true) ? list(s.localPlaces?.items).filter((x: any) => x && x.name) : [],
    eats: has('restaurants', true) ? list(s.restaurants?.items).filter((x: any) => x && x.name) : [],
    addons: has('addons', true) ? list(s.addons?.items).filter((x: any) => x && (x.name || typeof x === 'string')) : [],
    addonsIntro: str(s.addons?.intro),
    checkoutList: list(s.beforeYouGo?.items).filter((x: any) => typeof x === 'string' && x.trim()),
    review: str(s.review?.body),
    hospitals: list(em.hospitals).filter((h: any) => h && h.name),
    contacts: (Array.isArray(em.contacts) ? em.contacts : DEFAULT_EMERGENCY_CONTACTS).filter((x: any) => x && tel(x.value).length >= 7),
    police: str(em.police), policeLabel: str(em.policeLabel) || 'Police',
    emNotes: str(em.notes),
    bookUrl: lbl('booknext.url', 'https://stay-hospitality.com'),
    code: lbl('booknext.code', 'STAYAGAIN10'),
    placeCity: address.split(',')[1]?.trim() || '',
  }
}

export function GuideMobile({ gb, autoPrint = false }: { gb: any; autoPrint?: boolean }) {
  const d = useMemo(() => guideData(gb), [gb])
  const { lbl } = d
  const dark = gb?.theme === 'dark'
  const c = {
    paper: dark ? '#141311' : '#f7f4ee', card: dark ? '#1d1b18' : '#ffffff', ink: dark ? '#efeae2' : '#1f1d1a',
    mute: dark ? 'rgba(239,234,226,0.64)' : 'rgba(31,29,26,0.62)', accent: dark ? '#c9a96a' : '#8a7350',
    line: dark ? 'rgba(239,234,226,0.1)' : 'rgba(31,29,26,0.08)', tint: dark ? 'rgba(201,169,106,0.12)' : 'rgba(138,115,80,0.09)',
  }

  const nav = useMemo(() => ([
    (d.entry || d.parking || d.gettingThere) && { id: 'arrival', label: 'Arrival' },
    d.howto.length && { id: 'howto', label: 'House guide' },
    d.rules.length && { id: 'rules', label: 'House rules' },
    (d.about || d.highlights.length) && { id: 'space', label: 'The space' },
    d.places.length && { id: 'explore', label: 'Explore' },
    d.eats.length && { id: 'eat', label: 'Eat' },
    d.addons.length && { id: 'addons', label: 'Extras' },
    { id: 'checkout', label: 'Check-out' },
    { id: 'help', label: 'Help' },
  ].filter(Boolean) as { id: string; label: string }[]), [d])

  // Scroll-spy: the last section whose top has passed under the strip is lit.
  const [active, setActive] = useState('')
  useEffect(() => {
    let raf = 0
    const pick = () => {
      raf = 0
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8
      let cur = ''
      if (atEnd) cur = nav[nav.length - 1]?.id || ''
      else for (const x of nav) { const el = document.getElementById('g-' + x.id); if (el && el.getBoundingClientRect().top <= 120) cur = x.id }
      setActive(a => (a === cur ? a : cur))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(pick) }
    pick(); window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [nav])
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const strip = stripRef.current, el = strip?.querySelector('[data-id="' + active + '"]') as HTMLElement | null
    // Scroll only the strip itself — scrollIntoView would also nudge the page.
    if (strip && el) strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2, behavior: 'smooth' })
  }, [active])
  const go = (id: string) => { const el = document.getElementById('g-' + id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: 'smooth' }) }

  const [copied, setCopied] = useState('')
  const copy = async (what: string, v: string) => { try { await navigator.clipboard.writeText(v); setCopied(what); setTimeout(() => setCopied(''), 1600) } catch { /* selectable */ } }

  const [ticked, setTicked] = useState<Record<number, boolean>>({})
  useEffect(() => { try { const r = localStorage.getItem('gb-ticks-' + gb?.id); if (r) setTicked(JSON.parse(r)) } catch { /* private mode */ } }, [gb?.id])
  const tick = (i: number) => setTicked(t => { const n = { ...t, [i]: !t[i] }; try { localStorage.setItem('gb-ticks-' + gb?.id, JSON.stringify(n)) } catch { /* fine */ } return n })
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }))

  useEffect(() => { if (autoPrint) { const t = setTimeout(() => window.print(), 900); return () => clearTimeout(t) } }, [autoPrint])

  const shadow = dark ? 'none' : '0 1px 2px rgba(31,29,26,0.05), 0 10px 30px -18px rgba(31,29,26,0.28)'
  const iconDot = (Icon: any) => <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><Icon size={16} /></span>

  return (
    <>
      <div className="gm-root print:hidden" style={{ background: c.paper, color: c.ink, fontFamily: SANS, minHeight: '100vh', paddingBottom: 'calc(78px + env(safe-area-inset-bottom, 0px))' }}>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600&family=Inter:wght@400;500;600;700&display=swap" />
        <style>{`.gm-root ::-webkit-scrollbar{display:none} .gm-x{scrollbar-width:none;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain} .gm-root a,.gm-root button{touch-action:manipulation;-webkit-tap-highlight-color:transparent} .gm-clamp{display:-webkit-box;-webkit-box-orient:vertical;overflow:hidden}`}</style>
        <div className="mx-auto max-w-[680px]">

          {/* COVER */}
          <header className="relative overflow-hidden md:mt-6 md:rounded-3xl" style={{ height: 'min(46vh, 440px)', minHeight: 300, background: '#1c1a17' }}>
            {d.cover ? <img src={d.cover} alt="" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" /> : null}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(10,10,12,0.35), rgba(10,10,12,0) 30%, rgba(10,10,12,0.78) 100%)' }} />
            <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
              <img src={LOGO_URL} alt="Stay Hospitality" className="h-6 w-auto" style={{ filter: 'brightness(0) invert(1)' }} />
            </div>
            <div className="absolute inset-x-0 bottom-0 px-5 pb-10">
              {!/^welcome/i.test(d.line1) ? <p className="text-[10px] tracking-[0.45em] text-white/80">{lbl('cover.kicker', 'WELCOME')}</p> : null}
              <h1 className="mt-2 text-[38px] leading-[1.02] font-medium lowercase text-white" style={{ fontFamily: SERIF, textWrap: 'balance' as any }}>{d.line1 ? <>{d.line1}{d.line2 ? <><br />{d.line2}</> : null}</> : d.name}</h1>
              {d.subtitle ? <p className="mt-2.5 text-[11px] uppercase tracking-[0.3em] text-white/75">{d.subtitle}</p> : null}
            </div>
          </header>

          {/* ESSENTIALS */}
          <div className="relative z-10 -mt-6 px-4" id="g-essentials">
            <div className="rounded-2xl p-4" style={{ background: c.card, boxShadow: shadow }}>
              {d.wifiNet ? (
                <div className="flex items-center gap-3">
                  {iconDot(Wifi)}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: c.mute }}>Wi-Fi</p>
                    <p className="text-[15px] font-semibold break-all select-all">{d.wifiNet}</p>
                    {d.wifiPw ? <p className="text-[14px] break-all select-all" style={{ color: c.mute }}>Password <span className="font-semibold" style={{ color: c.ink }}>{d.wifiPw}</span></p> : null}
                  </div>
                  {d.wifiPw ? (
                    <button type="button" onClick={() => copy('wifi', d.wifiPw)} aria-label="Copy the Wi-Fi password" className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold text-white" style={{ background: copied === 'wifi' ? '#1f7a4d' : c.accent }}>
                      {copied === 'wifi' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {(d.checkIn || d.checkOut) ? (
                <div className={'grid grid-cols-2 gap-2 ' + (d.wifiNet ? 'mt-4' : '')}>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: c.tint }}>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: c.mute }}>Check-in</p>
                    <p className="mt-0.5 text-[18px] font-semibold">{d.checkIn || '—'}</p>
                  </div>
                  <div className="rounded-xl px-3 py-2.5" style={{ background: c.tint }}>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: c.mute }}>Check-out</p>
                    <p className="mt-0.5 text-[18px] font-semibold">{d.checkOut || '—'}</p>
                  </div>
                </div>
              ) : null}

              {d.address ? (
                <a href={mapsUrl(d.address)} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-3 active:opacity-80">
                  {iconDot(MapPin)}
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium leading-snug">{d.address}</p>
                    <p className="text-[12px] font-semibold" style={{ color: c.accent }}>Open in Maps</p>
                  </div>
                </a>
              ) : null}

              {/* CONTACT (Jon, 2026-10-29): guests message us through the app they booked with — no
                  call or text buttons. Our number is shown for anything urgent. */}
              <div className="mt-4 flex items-start gap-3 rounded-xl p-3" style={{ background: c.tint }}>
                <MessageSquare size={18} className="mt-0.5 shrink-0" style={{ color: c.accent }} />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold leading-snug">{lbl('ess.message', 'Questions? Message us in your booking app')}</p>
                  <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: c.mute }}>{lbl('ess.messageSub', 'Airbnb, Vrbo, Booking.com or wherever you booked — we reply fast.')}{d.phone ? <> Urgent: <span className="font-semibold tabular-nums" style={{ color: c.ink }}>{d.phone}</span></> : null}</p>
                </div>
              </div>
            </div>
          </div>

          {/* STRIP */}
          <nav className="sticky z-20 mt-4" style={{ top: 0, background: c.paper, borderBottom: '1px solid ' + c.line, paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div ref={stripRef} className="gm-x flex gap-1.5 overflow-x-auto px-4 py-2.5">
              {nav.map(x => (
                <button key={x.id} data-id={x.id} type="button" onClick={() => go(x.id)} className="shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold whitespace-nowrap transition-colors"
                  style={active === x.id ? { background: c.ink, color: c.paper } : { background: c.tint, color: c.ink }}>{x.label}</button>
              ))}
            </div>
          </nav>

          <main className="space-y-4 px-4 pt-4">
            {/* ARRIVAL */}
            {(d.entry || d.parking || d.gettingThere) ? (
              <Section id="arrival" kicker={lbl('arrival.kicker', 'Your arrival')} title={lbl('m.arrival', 'getting in')} c={c} shadow={shadow} photo={d.pa.arrival || null}>
                <div className="space-y-4">
                  {d.entry ? <Fact Icon={KeyRound} label={lbl('arrival.entryLabel', 'The door')} body={d.entry} k="entry" open={open} toggle={toggle} c={c} /> : null}
                  {d.parking ? <Fact Icon={Car} label={lbl('arrival.parkingLabel', 'Parking')} body={d.parking} k="parking" open={open} toggle={toggle} c={c} /> : null}
                  {d.gettingThere ? <Fact Icon={MapPin} label={lbl('arrival.thereLabel', 'Finding us')} body={d.gettingThere} k="there" open={open} toggle={toggle} c={c} /> : null}
                  {d.gettingAround ? <Fact Icon={Compass} label={lbl('arrival.aroundLabel', 'Getting around')} body={d.gettingAround} k="around" open={open} toggle={toggle} c={c} /> : null}
                </div>
              </Section>
            ) : null}

            {/* HOUSE GUIDE */}
            {d.howto.length ? (
              <Section id="howto" kicker={lbl('howto.kicker', 'How things work')} title={lbl('m.howto', 'how-to guide')} c={c} shadow={shadow}>
                <div className="-mx-1">
                  {d.howto.slice(0, 16).map((it: any, i: number) => {
                    const k = 'h' + i, isOpen = !!open[k], photo = purl(it.photo)
                    return (
                      <div key={i} style={{ borderTop: i ? '1px solid ' + c.line : 'none' }}>
                        <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-1 py-3 text-left">
                          <span className="flex-1 text-[15px] font-semibold leading-snug">{sentence(it.title || 'Item ' + (i + 1))}</span>
                          <ChevronDown size={18} className="shrink-0 transition-transform" style={{ color: c.accent, transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                        </button>
                        {isOpen ? (
                          <div className="px-1 pb-4">
                            {photo ? <img src={photo} alt="" loading="lazy" className="mb-3 max-h-[220px] w-full rounded-xl object-cover" onError={(e: any) => { e.currentTarget.style.display = 'none' }} /> : null}
                            <p className="text-[14.5px] leading-[1.65] whitespace-pre-line">{str(it.body)}</p>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </Section>
            ) : null}

            {/* HOUSE RULES */}
            {d.rules.length ? (
              <Section id="rules" kicker={lbl('guidelines.kicker', 'Please note')} title={lbl('m.rules', 'house rules')} c={c} shadow={shadow}>
                {d.rulesIntro ? <p className="-mt-1 mb-3 text-[13.5px] leading-[1.6]" style={{ color: c.mute }}>{d.rulesIntro}</p> : null}
                <ul>
                  {d.rules.slice(0, 12).map((it: any, i: number) => (
                    <li key={i} className="py-2.5" style={{ borderTop: i ? '1px solid ' + c.line : 'none' }}>
                      <p className="text-[14.5px] font-semibold leading-snug">{sentence(it.title)}</p>
                      {str(it.body) ? <p className="mt-0.5 text-[13.5px] leading-[1.55]" style={{ color: c.mute }}>{str(it.body)}</p> : null}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {/* THE SPACE */}
            {(d.about || d.highlights.length) ? (
              <Section id="space" kicker={lbl('about.kicker', 'Your home for the stay')} title={lbl('m.space', 'about the space')} c={c} shadow={shadow} photo={d.pa.about || d.pa.special || null}>
                {d.about ? <Clamp text={d.about} k="about" lines={5} open={open} toggle={toggle} c={c} /> : null}
                {d.highlights.map((g: any, i: number) => (
                  <div key={i} className="mt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: c.mute }}>{sentence(g.title || 'Highlights')}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(g.items || []).slice(0, 12).map((it: string, j: number) => <span key={j} className="rounded-full px-3 py-1.5 text-[13px]" style={{ background: c.tint }}>{it}</span>)}
                    </div>
                  </div>
                ))}
              </Section>
            ) : null}

            {/* EXPLORE / EAT */}
            {d.places.length ? (
              <Section id="explore" kicker={lbl('localPlaces.tag', 'Nearby')} title={lbl('m.explore', 'local places')} c={c} shadow={shadow}>
                <PlaceList items={d.places} city={d.placeCity} c={c} />
              </Section>
            ) : null}
            {d.eats.length ? (
              <Section id="eat" kicker={lbl('restaurants.tag', 'Our picks')} title={lbl('m.eat', 'where to eat')} c={c} shadow={shadow}>
                <PlaceList items={d.eats} city={d.placeCity} c={c} />
              </Section>
            ) : null}

            {/* EXTRAS */}
            {d.addons.length ? (
              <Section id="addons" kicker={lbl('addons.kicker', 'At your service')} title={lbl('m.addons', 'exclusive add-ons')} c={c} shadow={shadow}>
                {d.addonsIntro ? <p className="-mt-1 mb-2 text-[13.5px] leading-[1.6]" style={{ color: c.mute }}>{d.addonsIntro}</p> : null}
                <ul>
                  {d.addons.slice(0, 12).map((p: any, i: number) => (
                    <li key={i} className="flex items-baseline gap-3 py-2.5" style={{ borderTop: i ? '1px solid ' + c.line : 'none' }}>
                      <span className="flex-1 text-[14.5px] font-medium">{p.name || str(p)}</span>
                      {p.price ? <span className="text-[13.5px] font-semibold" style={{ color: c.accent }}>{p.price}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13px]" style={{ color: c.mute }}>To arrange any of these, message us in your booking app.</p>
              </Section>
            ) : null}

            {/* CHECK-OUT */}
            <Section id="checkout" kicker={lbl('closing.beforeLabel', 'Before you go')} title={lbl('m.checkout', 'checking out')} c={c} shadow={shadow}>
              <p className="-mt-1 text-[13.5px]" style={{ color: c.mute }}>Check-out is {d.checkOut || 'as agreed'}.{d.checkoutList.length ? ' Tick these off as you go.' : ''}</p>
              {d.checkoutList.length ? (
                <ul className="mt-2 -mx-1">
                  {d.checkoutList.slice(0, 10).map((it: string, i: number) => (
                    <li key={i}>
                      <button type="button" onClick={() => tick(i)} aria-pressed={!!ticked[i]} className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left">
                        <span className="mt-0.5 inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2" style={{ borderColor: c.accent, background: ticked[i] ? c.accent : 'transparent', color: '#fff' }}>{ticked[i] ? <Check size={13} /> : null}</span>
                        <span className="text-[14.5px] leading-[1.5]" style={{ textDecoration: ticked[i] ? 'line-through' : 'none', opacity: ticked[i] ? 0.55 : 1 }}>{it}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4 rounded-2xl p-4" style={{ background: c.tint }}>
                <p className="text-[12px] tracking-[0.3em]" style={{ color: c.accent }}>★★★★★</p>
                <p className="mt-1 text-[22px] font-medium lowercase" style={{ fontFamily: SERIF }}>{lbl('closing.reviewHeading', 'loved your stay?')}</p>
                <p className="mt-1 text-[13.5px] leading-[1.6]" style={{ color: c.mute }}>{d.review || 'A five-star review means the world to our small team.'}</p>
                <p className="mt-2 text-[12.5px]" style={{ color: c.mute }}>— {d.signoff}</p>
              </div>
              <div className="mt-3 rounded-2xl p-4" style={{ border: '1px solid ' + c.line }}>
                <p className="text-[20px] font-medium lowercase" style={{ fontFamily: SERIF }}>{lbl('booknext.heading', 'book your next stay')}</p>
                <p className="mt-1 text-[13.5px] leading-[1.6]" style={{ color: c.mute }}>{lbl('booknext.body', 'Book directly with us next time and save.')}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a href={d.bookUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-[13.5px] font-semibold text-white" style={{ background: c.accent }}><ExternalLink size={15} /> Book direct</a>
                  <button type="button" onClick={() => copy('code', d.code)} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-semibold" style={{ background: c.tint }}>
                    Code <span className="tracking-[0.12em]" style={{ color: c.accent }}>{d.code}</span> {copied === 'code' ? <Check size={14} /> : <Copy size={14} style={{ color: c.mute }} />}
                  </button>
                </div>
              </div>
            </Section>

            {/* HELP */}
            <Section id="help" kicker={lbl('emergency.kicker', 'Any time')} title={lbl('m.help', 'if you need help')} c={c} shadow={shadow}>
              <div className="grid gap-2">
                <a href="tel:911" className="flex items-center gap-3 rounded-2xl p-3.5 text-white active:opacity-85" style={{ background: '#b42318' }}>
                  <Siren size={22} /><div><p className="text-[16px] font-bold leading-tight">Emergency: call 911</p><p className="text-[12.5px] opacity-90">Police · fire · ambulance — then let us know</p></div>
                </a>
                {d.phone ? <CallRow Icon={Phone} value={d.phone} sub={'Stay Hospitality · urgent issues, 24/7 · everything else, message us in your booking app'} c={c} /> : null}
                {d.police ? <CallRow Icon={ShieldAlert} value={d.police} sub={d.policeLabel + ' · non-emergency'} c={c} /> : null}
                {d.contacts.map((x: any, i: number) => <CallRow key={i} Icon={Phone} value={x.value} sub={x.label + (x.note ? ' · ' + x.note : '')} c={c} />)}
              </div>
              {d.hospitals.length ? (
                <div className="mt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: c.mute }}>Nearest hospitals</p>
                  <ul className="mt-1">
                    {d.hospitals.slice(0, 4).map((h: any, i: number) => (
                      <li key={i} className="flex items-center gap-3 py-3" style={{ borderTop: i ? '1px solid ' + c.line : 'none' }}>
                        <Hospital size={18} className="shrink-0" style={{ color: c.accent }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[14.5px] font-semibold leading-tight">{h.name}{h.miles != null ? <span className="ml-1.5 text-[12px] font-normal" style={{ color: c.mute }}>{h.miles} mi</span> : null}</p>
                          {h.address ? <p className="text-[12.5px] leading-snug truncate" style={{ color: c.mute }}>{h.address}</p> : null}
                        </div>
                        {h.phone ? <a href={'tel:' + tel(h.phone)} aria-label={'Call ' + h.name} className="inline-flex h-10 w-10 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><Phone size={15} /></a> : null}
                        <a href={mapsUrl([h.name, h.address].filter(Boolean).join(', '))} target="_blank" rel="noreferrer" aria-label={'Directions to ' + h.name} className="inline-flex h-10 w-10 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><Navigation size={15} /></a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {d.emNotes ? <p className="mt-3 text-[13px] leading-[1.6]" style={{ color: c.mute }}>{d.emNotes}</p> : null}
            </Section>

            <footer className="pb-6 pt-2 text-center">
              <img src={LOGO_URL} alt="Stay Hospitality" className="mx-auto mt-2 h-6 w-auto" style={{ filter: dark ? 'brightness(0) invert(1)' : 'none', opacity: 0.85 }} />
              <p className="mt-2 text-[12px]" style={{ color: c.mute }}>{lbl('footer.line', 'stay-hospitality.com')}</p>
              {d.email ? <a href={'mailto:' + d.email} className="mt-0.5 inline-block text-[12px]" style={{ color: c.mute }}>{d.email}</a> : null}
            </footer>
          </main>
        </div>

        {/* THUMB BAR */}
        <nav className="fixed inset-x-0 bottom-0 z-30" style={{ background: dark ? 'rgba(20,19,17,0.94)' : 'rgba(247,244,238,0.94)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderTop: '1px solid ' + c.line, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="mx-auto flex max-w-[680px] items-stretch">
            {d.wifiNet ? <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold"><Wifi size={19} style={{ color: c.accent }} />Wi-Fi</button> : null}
            {d.howto.length ? <button type="button" onClick={() => go('howto')} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold"><ListChecks size={19} style={{ color: c.accent }} />Guide</button> : null}
            <button type="button" onClick={() => go('checkout')} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold"><LogOut size={19} style={{ color: c.accent }} />Check-out</button>
            <button type="button" onClick={() => go('help')} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold" style={{ color: '#b42318' }}><Siren size={19} />Help</button>
          </div>
        </nav>
      </div>

      <GuidePrint gb={gb} />
    </>
  )
}

type C = { paper: string; card: string; ink: string; mute: string; accent: string; line: string; tint: string }

function Section({ id, kicker, title, children, c, shadow, photo }: { id: string; kicker: string; title: string; children: any; c: C; shadow: string; photo?: string | null }) {
  return (
    <section id={'g-' + id} className="scroll-mt-16 overflow-hidden rounded-2xl" style={{ background: c.card, boxShadow: shadow }}>
      {photo ? <img src={photo} alt="" loading="lazy" className="h-[170px] w-full object-cover" onError={(e: any) => { e.currentTarget.style.display = 'none' }} /> : null}
      <div className="p-4">
        <p className="text-[10px] uppercase tracking-[0.4em]" style={{ color: c.accent }}>{kicker}</p>
        <h2 className="mb-3 mt-1 text-[27px] font-medium lowercase leading-[1.05]" style={{ fontFamily: SERIF }}>{title}</h2>
        {children}
      </div>
    </section>
  )
}

function Clamp({ text, k, lines, open, toggle, c }: { text: string; k: string; lines: number; open: Record<string, boolean>; toggle: (k: string) => void; c: C }) {
  const long = text.length > lines * 55
  const isOpen = !!open[k]
  return (
    <div>
      <p className={'text-[14.5px] leading-[1.65] whitespace-pre-line ' + (long && !isOpen ? 'gm-clamp' : '')} style={long && !isOpen ? { WebkitLineClamp: lines } as any : undefined}>{text}</p>
      {long ? <button type="button" onClick={() => toggle(k)} className="mt-1 text-[13px] font-semibold" style={{ color: c.accent }}>{isOpen ? 'Less' : 'More'}</button> : null}
    </div>
  )
}

function Fact({ Icon, label, body, k, open, toggle, c }: { Icon: any; label: string; body: string; k: string; open: Record<string, boolean>; toggle: (k: string) => void; c: C }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: c.tint, color: c.accent }}><Icon size={16} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold">{label}</p>
        <div className="mt-0.5"><Clamp text={body} k={k} lines={4} open={open} toggle={toggle} c={c} /></div>
      </div>
    </div>
  )
}

function CallRow({ Icon, value, sub, c }: { Icon: any; value: string; sub: string; c: C }) {
  return (
    <a href={'tel:' + tel(value)} className="flex items-center gap-3 rounded-2xl p-3.5 active:opacity-85" style={{ background: c.tint }}>
      <Icon size={20} style={{ color: c.accent }} />
      <div className="min-w-0"><p className="text-[15px] font-semibold leading-tight tabular-nums">{value}</p><p className="text-[12.5px]" style={{ color: c.mute }}>{sub}</p></div>
    </a>
  )
}

/** A place's photo, shown only once it has really loaded — never an empty grey box (also when the
 *  browser had it cached and finished before React hydrated, so onLoad never fired). */
function PlacePhoto({ src }: { src: string }) {
  const [ok, setOk] = useState(false)
  const ref = useRef<HTMLImageElement>(null)
  useEffect(() => { const im = ref.current; if (im && im.complete && im.naturalWidth > 40) setOk(true) }, [src])
  return (
    <div className="relative h-[130px]" style={{ display: ok ? 'block' : 'none' }}>
      <img ref={ref} src={src} alt="" decoding="async" className="h-full w-full object-cover" onLoad={(e: any) => { if (e.currentTarget.naturalWidth > 40) setOk(true) }} onError={() => setOk(false)} />
    </div>
  )
}

function PlaceList({ items, city, c }: { items: any[]; city: string; c: C }) {
  // Swipeable cards, as before; a photo that fails to load drops away and the card reads as text.
  return (
    <div className="gm-x -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
      {items.slice(0, 10).map((p: any, i: number) => {
        const q = [p.name, p.address || city].filter(Boolean).join(', ')
        const photo = purl(p.photo)
        return (
          <div key={i} className="snap-start shrink-0 w-[236px] overflow-hidden rounded-2xl" style={{ background: c.tint }}>
            {photo ? (
              <PlacePhoto src={photo} />
            ) : null}
            <div className="p-3">
              <p className="text-[15.5px] font-medium leading-tight" style={{ fontFamily: SERIF }}>{p.name}</p>
              {p.note ? <p className="mt-1 text-[12.5px] leading-[1.5] line-clamp-3" style={{ color: c.mute }}>{p.note}</p> : null}
              <div className="mt-2.5 flex items-center gap-2">
                <a href={mapsUrl(q)} target="_blank" rel="noreferrer" className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-white" style={{ background: c.accent }}><Navigation size={12} /> Directions</a>
                {p.phone && tel(p.phone).length >= 7 ? <a href={'tel:' + tel(p.phone)} aria-label={'Call ' + p.name} className="inline-flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: c.card, color: c.accent }}><Phone size={14} /></a> : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── THE PRINTED HOUSE MANUAL ──────────────────────────────────────────────────────────────────────
// Letter, half-inch margins, black on white (prints on any office printer, no background graphics
// needed). Flowing columns, never a fixed page box, so a long how-to simply runs onto the next sheet
// instead of being clipped; nothing is split mid-item. Hidden on screen.
export function GuidePrint({ gb }: { gb: any }) {
  const d = guideData(gb)
  const link = 'https://lighthouse-stay.vercel.app/g/' + String(gb?.id || '')
  const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=' + encodeURIComponent(link)
  const H = ({ children }: { children: any }) => <h2 className="gp-h">{children}</h2>
  return (
    <div className="gp hidden print:block">
      <style>{`
        @media print {
          @page { size: letter; margin: 0.5in; }
          html, body { background: #fff !important; }
          .gp { font-family: ${SANS}; color: #111; font-size: 10.5pt; line-height: 1.45; }
          .gp-h { font-family: ${SERIF}; font-size: 15pt; font-weight: 600; margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.2pt solid #111; break-after: avoid; }
          .gp-cols { column-count: 2; column-gap: 22pt; }
          .gp-item { break-inside: avoid; margin: 0 0 7pt; }
          .gp-item b { display: block; font-size: 10.5pt; }
          .gp-muted { color: #555; }
          .gp-box { border: 1.2pt solid #111; border-radius: 8pt; padding: 10pt 12pt; break-inside: avoid; }
          .gp-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8pt 16pt; }
          .gp-k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .12em; color: #555; }
          .gp-v { font-size: 12pt; font-weight: 600; }
          .gp-big { font-size: 15pt; font-weight: 700; letter-spacing: .02em; }
          .gp-check { display: inline-block; width: 9pt; height: 9pt; border: 1pt solid #111; border-radius: 2pt; margin-right: 6pt; vertical-align: -1pt; }
          .gp-sos { border: 2pt solid #b42318; color: #b42318; }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16pt' }}>
        <div style={{ flex: 1 }}>
          <img src={LOGO_URL} alt="Stay Hospitality" style={{ height: '18pt', width: 'auto' }} />
          <p className="gp-k" style={{ marginTop: '12pt' }}>House manual</p>
          <h1 style={{ fontFamily: SERIF, fontSize: '22pt', fontWeight: 600, lineHeight: 1.15, margin: '2pt 0 0' }}>{d.name}</h1>
          {d.subtitle ? <p className="gp-muted" style={{ marginTop: '2pt' }}>{d.subtitle}</p> : null}
          {d.address ? <p className="gp-muted">{d.address}</p> : null}
        </div>
        <div style={{ textAlign: 'center', width: '84pt' }}>
          <img src={qr} alt="" style={{ width: '78pt', height: '78pt' }} />
          <p className="gp-muted" style={{ fontSize: '7.5pt', marginTop: '3pt' }}>Scan for the live guide on your phone</p>
        </div>
      </div>

      <div className="gp-box" style={{ marginTop: '14pt' }}>
        <div className="gp-grid">
          {d.wifiNet ? <div style={{ gridColumn: 'span 2' }}><p className="gp-k">Wi-Fi network</p><p className="gp-big">{d.wifiNet}</p></div> : null}
          {d.wifiPw ? <div><p className="gp-k">Wi-Fi password</p><p className="gp-big">{d.wifiPw}</p></div> : null}
          <div style={{ gridColumn: '1 / -1', fontSize: '9.5pt' }}><b>Questions?</b> Message us in the app you booked with (Airbnb, Vrbo, Booking.com…) — we reply fast.</div>
          {d.checkIn ? <div><p className="gp-k">Check-in</p><p className="gp-v">{d.checkIn}</p></div> : null}
          {d.checkOut ? <div><p className="gp-k">Check-out</p><p className="gp-v">{d.checkOut}</p></div> : null}
          {d.phone ? <div><p className="gp-k">Urgent issues · 24/7</p><p className="gp-v">{d.phone}</p></div> : null}
        </div>
      </div>

      {(d.entry || d.parking) ? (
        <>
          <H>Arrival</H>
          {d.entry ? <div className="gp-item"><b>The door</b>{d.entry}</div> : null}
          {d.parking ? <div className="gp-item"><b>Parking</b>{d.parking}</div> : null}
          {d.gettingThere ? <div className="gp-item"><b>Finding us</b>{d.gettingThere}</div> : null}
        </>
      ) : null}

      {d.rules.length ? (
        <>
          <H>House rules</H>
          <div className="gp-cols">
            {d.rules.slice(0, 12).map((it: any, i: number) => <div key={i} className="gp-item"><b>{sentence(it.title)}</b>{str(it.body)}</div>)}
          </div>
        </>
      ) : null}

      {d.howto.length ? (
        <>
          <H>House guide</H>
          <div className="gp-cols">
            {d.howto.slice(0, 16).map((it: any, i: number) => <div key={i} className="gp-item"><b>{sentence(it.title)}</b><span style={{ whiteSpace: 'pre-line' }}>{str(it.body)}</span></div>)}
          </div>
        </>
      ) : null}

      <H>Check-out{d.checkOut ? ' · ' + d.checkOut : ''}</H>
      {d.checkoutList.length ? d.checkoutList.slice(0, 10).map((it: string, i: number) => <div key={i} className="gp-item"><span className="gp-check" />{it}</div>) : <p>Please leave by {d.checkOut || 'the agreed time'}.</p>}

      {(d.places.length || d.eats.length) ? (
        <>
          <H>Around you</H>
          <div className="gp-cols">
            {d.places.slice(0, 8).map((p: any, i: number) => <div key={'p' + i} className="gp-item"><b>{p.name}</b>{p.note ? <span>{p.note} </span> : null}<span className="gp-muted">{[String(p.address || '').replace(/,\s*(United States|USA)$/i, ''), p.phone].filter(Boolean).join(' · ')}</span></div>)}
            {d.eats.slice(0, 8).map((p: any, i: number) => <div key={'e' + i} className="gp-item"><b>{p.name} <span className="gp-muted" style={{ fontWeight: 400, display: 'inline' }}>· eat</span></b>{p.note ? <span>{p.note} </span> : null}<span className="gp-muted">{[String(p.address || '').replace(/,\s*(United States|USA)$/i, ''), p.phone].filter(Boolean).join(' · ')}</span></div>)}
          </div>
        </>
      ) : null}

      <H>Help &amp; emergencies</H>
      <div className="gp-box gp-sos" style={{ marginBottom: '8pt' }}><span className="gp-big">Emergency: call 911</span> &nbsp;— police, fire, ambulance. Then let us know{d.phone ? ' at ' + d.phone : ''}.</div>
      <div className="gp-cols">
        {d.police ? <div className="gp-item"><b>{d.policeLabel} · non-emergency</b>{d.police}</div> : null}
        {d.contacts.map((x: any, i: number) => <div key={i} className="gp-item"><b>{x.label}</b>{x.value}{x.note ? <span className="gp-muted"> · {x.note}</span> : null}</div>)}
        {d.hospitals.slice(0, 3).map((h: any, i: number) => <div key={'h' + i} className="gp-item"><b>{h.name}{h.miles != null ? ' · ' + h.miles + ' mi' : ''}</b>{[h.address, h.phone].filter(Boolean).join(' · ')}</div>)}
      </div>

      <p className="gp-muted" style={{ marginTop: '16pt', textAlign: 'center', fontSize: '8.5pt' }}>
        Book your next stay direct at {d.bookUrl.replace(/^https?:\/\//, '')} · code {d.code}
      </p>
    </div>
  )
}
