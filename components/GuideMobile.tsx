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
//   · PRINT = THE 1-PAGER (components/GuideFlyer, 2026-11-06). The magazine opens at ?book=1 and the
//     1-pager at ?flyer=1 — the two paper versions; this page is the digital one.
//
// Same data and the same label overrides (sections._labels) as the book editor at /guidebooks/[id].
// Nothing here writes.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Wifi, Copy, Check, Phone, MapPin, Car, KeyRound, ChevronDown, ListChecks,
  Compass, Siren, ExternalLink, MessageSquare, Navigation, Hospital, ShieldAlert, LogOut,
  Share2, Waves, QrCode, Sun, Sunset,
} from 'lucide-react'
import { DEFAULT_EMERGENCY_CONTACTS, keepContact } from '@/lib/emergency'
import { themeForBook } from '@/lib/guide-themes'
import { GuideFlyer } from '@/components/GuideFlyer'
import { printPrefs, howtoShown, isMapItem, splitSteps, dedupeHowtos } from '@/lib/guide-print'

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
export const LOGO_URL = 'https://ugbtsppfsgkkrdyyuxxg.supabase.co/storage/v1/object/public/guidebook-assets/1783090958148-l1zr8u.png'

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
  // Place names stay capitalised ("Delray Beach & Atlantic Avenue"): a word in PLACES, and any capitalised word right after one.
  let prevPlace = false
  return words.map((w, i) => {
    const bare = w.replace(/[^A-Za-z]/g, '')
    const place = PLACES.has(bare.toLowerCase()) || (prevPlace && /^[A-Z]/.test(w))
    prevPlace = place
    if (/^[A-Z0-9]{2,}$/.test(w) || /\d/.test(w)) return w
    if (place) return w.charAt(0).toUpperCase() + w.slice(1)
    return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()
  }).join(' ')
}
const PLACES = new Set(['delray', 'boynton', 'atlantic', 'miami', 'fort', 'lauderdale', 'pompano', 'palm', 'florida', 'brickell', 'wynwood', 'las', 'olas', 'hollywood', 'elser', 'salato', 'botanica', 'arya', 'aria', 'hendricks', 'eden', 'gulf', 'briny', 'seaview', 'central', 'east', 'ocean', 'intracoastal', 'pineapple', 'morikami', 'wakodahatchee'])
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
  // Tidy the address (2026-11-06 polish): "4621 North Ocean Boulevard, 33435 Boynton Beach" reads backwards —
  // it becomes "4621 North Ocean Boulevard, Boynton Beach, FL 33435".
  const address = str(s.guidelines?.address).replace(/,\s*United States( of America)?$/i, '')
    .replace(/,\s*(\d{5})\s+([A-Za-z .'-]+)$/, (_m: string, zip: string, city: string) => ', ' + city.trim() + ', FL ' + zip)
  const list = (v: any) => (Array.isArray(v) ? v : [])
  return {
    s, has, lbl, pa, photos, em,
    name: stayName(gb),
    // Set by /g/[id] from the listing ("Unit 3"); empty when the listing has no unit number.
    unit: str(gb?._unit),            // "Surfside · Unit 4" — the unit's name and number
    geo: (gb?._geo && typeof gb._geo.lat === 'number') ? gb._geo as { lat: number; lng: number } : null,
    beach: str(gb?._beach),
    // Map how-tos (lib/guide-print isMapItem): the parking one also shows under Parking on the phone,
    // and every one gets a full-size sheet in the printed manual.
    maps: (Array.isArray(s.houseGuide?.items) ? s.houseGuide.items : []).filter((x: any) => isMapItem(x) && howtoShown(x.title, printPrefs(s))).map((x: any) => ({ title: String(x.title || 'Map'), src: purl(x.photo) || '' })).filter((m: any) => m.src),
    // Parking map lives in its own how-to ("Where to park") — the arrival section and the quick action
    // OPEN that item instead of repeating the map (Jon, 2026-11-06: "I liked the way it was").
    parkingMap: ((Array.isArray(s.houseGuide?.items) ? s.houseGuide.items : []).find((x: any) => isMapItem(x) && /park/i.test(String(x.title || ''))) ? purl((s.houseGuide.items as any[]).find((x: any) => isMapItem(x) && /park/i.test(String(x.title || ''))).photo) : null) as string | null,
    subtitle: (() => {
      // "BOYNTON · BOYNTON BEACH" → "BOYNTON BEACH": drop a part another part already contains.
      const parts = str(s.cover?.subtitle).replace(/\s{2,}/g, ' ').split(/\s*[·|•]\s*/).map(x => x.trim()).filter(Boolean)
      return parts.filter((p, i) => !parts.some((q, j) => j !== i && q.length > p.length && q.toLowerCase().includes(p.toLowerCase()))).join(' · ')
    })(),
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
    // Common-sense how-tos (microwave, kettle, fridge…) are left out unless brought back in the editor's
    // Print options; ones taken off there are gone from the phone too (lib/guide-print).
    howto: has('houseGuide', true) ? dedupeHowtos(list(s.houseGuide?.items).filter((x: any) => x && (x.title || x.body) && howtoShown(x.title, printPrefs(s)))) : [],
    rules: has('guidelines', true) ? list(s.guidelines?.items).filter((x: any) => x && (x.title || x.body)) : [],
    rulesIntro: str(s.guidelines?.intro),
    // _i = the item's index in the saved list (the photo-repair route addresses items by it).
    places: has('localPlaces', true) ? list(s.localPlaces?.items).map((x: any, i: number) => x && typeof x === 'object' ? { ...x, _i: i } : x).filter((x: any) => x && x.name) : [],
    eats: has('restaurants', true) ? list(s.restaurants?.items).map((x: any, i: number) => x && typeof x === 'object' ? { ...x, _i: i } : x).filter((x: any) => x && x.name) : [],
    addons: has('addons', true) ? list(s.addons?.items).filter((x: any) => x && (x.name || typeof x === 'string')) : [],
    addonsIntro: str(s.addons?.intro),
    checkoutList: list(s.beforeYouGo?.items).filter((x: any) => typeof x === 'string' && x.trim()),
    review: str(s.review?.body),
    hospitals: list(em.hospitals).filter((h: any) => h && h.name),
    contacts: (Array.isArray(em.contacts) ? em.contacts : DEFAULT_EMERGENCY_CONTACTS).filter((x: any) => x && tel(x.value).length >= 7 && keepContact(x)),
    police: str(em.police), policeLabel: str(em.policeLabel) || 'Police',
    emNotes: str(em.notes),
    bookUrl: lbl('booknext.url', 'https://stay-hospitality.com'),
    code: lbl('booknext.code', 'STAYAGAIN10'),
    placeCity: address.split(',')[1]?.trim() || '',
  }
}

export function GuideMobile({ gb, autoPrint = false, photoToken = '' }: { gb: any; autoPrint?: boolean; photoToken?: string }) {
  const d = useMemo(() => guideData(gb), [gb])
  const { lbl } = d
  // Colour theme (lib/guide-themes): the saved one, or the smart pick for this property.
  const t = useMemo(() => themeForBook(gb), [gb])
  const dark = t.dark
  const c = { paper: t.paper, card: t.card, ink: t.ink, mute: t.mute, accent: t.accent, line: t.line, tint: t.tint }

  const nav = useMemo(() => ([
    (d.entry || d.parking || d.gettingThere) && { id: 'arrival', label: 'Arrival' },
    d.howto.length && { id: 'howto', label: 'House guide' },
    d.rules.length && { id: 'rules', label: 'House rules' },
    (d.about || d.highlights.length) && { id: 'space', label: 'The space' },
    d.places.length && { id: 'explore', label: 'Things to do' },
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
  // The "Where to park" how-to (with its map): opened in place and scrolled to.
  const parkIdx = useMemo(() => d.howto.slice(0, 16).findIndex((x: any) => isMapItem(x) && /park/i.test(String(x.title || ''))), [d])
  const openParking = () => { setOpen(o => ({ ...o, ['h' + parkIdx]: true })); setTimeout(() => go('h' + parkIdx), 60) }
  // One way to the beach (Jon, 2026-11-06: "two walk to the beach tabs"): the chip opens the book's own
  // "Walking to the beach" how-to; Google Maps only when the book has no beach how-to.
  const beachIdx = useMemo(() => d.howto.slice(0, 16).findIndex((x: any) => /beach/i.test(String(x.title || '')) && /walk|access|path|getting|way to/i.test(String(x.title || ''))), [d])
  const openBeach = () => { setOpen(o => ({ ...o, ['h' + beachIdx]: true })); setTimeout(() => go('h' + beachIdx), 60) }
  const go = (id: string) => { const el = document.getElementById('g-' + id); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: 'smooth' }) }

  const [copied, setCopied] = useState('')
  const copy = async (what: string, v: string) => { try { await navigator.clipboard.writeText(v); setCopied(what); setTimeout(() => setCopied(''), 1600) } catch { /* selectable */ } }
  const [wifiQr, setWifiQr] = useState(false)
  // Share the guide with the rest of the party — the phone's own share sheet, else copy the link.
  const share = async () => {
    const url = typeof window !== 'undefined' ? window.location.origin + '/g/' + String(gb?.id || '') : ''
    try { if ((navigator as any).share) { await (navigator as any).share({ title: (d.unit ? d.unit + ' — ' : '') + d.name, text: 'Our guide for the stay — Wi-Fi, parking, check-out and more.', url }); return } } catch { return }
    copy('link', url)
  }

  const [ticked, setTicked] = useState<Record<number, boolean>>({})
  useEffect(() => { try { const r = localStorage.getItem('gb-ticks-' + gb?.id); if (r) setTicked(JSON.parse(r)) } catch { /* private mode */ } }, [gb?.id])
  const tick = (i: number) => setTicked(t => { const n = { ...t, [i]: !t[i] }; try { localStorage.setItem('gb-ticks-' + gb?.id, JSON.stringify(n)) } catch { /* fine */ } return n })
  // Every how-to is a drop-down, maps included (Jon, 2026-11-06: "everything should be a drop down in the
  // how-to section"). The parking chip and "See the parking map" open theirs on tap.
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
          <header className="relative overflow-hidden md:mt-6 md:rounded-3xl" style={{ height: 'min(46vh, 440px)', minHeight: 300, background: t.cover }}>
            {d.cover ? <img src={d.cover} alt="" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" /> : null}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(10,10,12,0.35), rgba(10,10,12,0) 30%, rgba(10,10,12,0.78) 100%)' }} />
            <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
              <img src={LOGO_URL} alt="Stay Hospitality" className="h-6 w-auto" style={{ filter: 'brightness(0) invert(1)' }} />
            </div>
            <div className="absolute inset-x-0 bottom-0 px-5 pb-10">
              {!/^welcome/i.test(d.line1) ? <p className="text-[10.5px] font-semibold tracking-[0.3em] text-white/85">{lbl('cover.kicker', 'WELCOME')}</p> : null}
              <h1 className="mt-2 text-[38px] leading-[1.02] font-medium lowercase text-white" style={{ fontFamily: SERIF, textWrap: 'balance' as any }}>{d.line1 ? <>{d.line1}{d.line2 ? <><br />{d.line2}</> : null}</> : d.name}</h1>
              {d.subtitle ? <p className="mt-2.5 text-[11px] uppercase tracking-[0.3em] text-white/75">{d.subtitle}</p> : null}
              {d.unit ? <p className="mt-3 inline-flex rounded-full bg-white px-3.5 py-1.5 text-[14px] font-bold tracking-[0.04em]" style={{ color: '#1f1d1a' }}>{d.unit}</p> : null}
            </div>
          </header>

          {/* ESSENTIALS */}
          <div className="relative z-10 -mt-6 px-4" id="g-essentials">
            <div className="rounded-2xl p-4" style={{ background: c.card, boxShadow: shadow }}>
              {d.unit ? (
                <div className={'flex items-center gap-3 ' + (d.wifiNet ? 'mb-4 pb-4' : '')} style={d.wifiNet ? { borderBottom: '1px solid ' + c.line } : undefined}>
                  {iconDot(KeyRound)}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: c.mute }}>Your unit</p>
                    <p className="text-[22px] font-bold leading-tight">{d.unit}</p>
                  </div>
                </div>
              ) : null}
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

              {/* QUICK ACTIONS (2026-11-06 audit) — the three things guests hunt for, one tap each. */}
              {(d.parkingMap || d.beach || d.address) ? (
                <div className="gm-x -mx-1 mt-3 flex gap-2 overflow-x-auto px-1">
                  {d.parkingMap && parkIdx >= 0 ? <button type="button" onClick={openParking} className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold" style={{ background: c.tint }}><Car size={15} style={{ color: c.accent }} /> Parking map</button> : null}
                  {beachIdx >= 0 ? <button type="button" onClick={openBeach} className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold" style={{ background: c.tint }}><Waves size={15} style={{ color: c.accent }} /> To the beach</button>
                  : d.beach && d.address ? <a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('beach access near ' + d.address)} target="_blank" rel="noreferrer" className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold" style={{ background: c.tint }}><Waves size={15} style={{ color: c.accent }} /> To the beach</a> : null}
                  {d.wifiNet ? <button type="button" onClick={() => setWifiQr(v => !v)} className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold" style={{ background: c.tint }}><QrCode size={15} style={{ color: c.accent }} /> Wi-Fi QR</button> : null}
                  <button type="button" onClick={share} className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold" style={{ background: c.tint }}><Share2 size={15} style={{ color: c.accent }} /> {copied === 'link' ? 'Link copied' : 'Share with your group'}</button>
                </div>
              ) : null}
              {wifiQr && d.wifiNet ? (
                <div className="mt-3 flex items-center gap-3 rounded-xl p-3" style={{ background: c.tint }}>
                  <img src={wifiQrSrc(d.wifiNet, d.wifiPw)} alt="Wi-Fi QR code" className="h-28 w-28 rounded-lg bg-white p-1.5" />
                  <p className="text-[13px] leading-snug" style={{ color: c.mute }}>Point another phone's camera here to join <b style={{ color: c.ink }}>{d.wifiNet}</b> — no typing.</p>
                </div>
              ) : null}
              {d.geo ? <Weather geo={d.geo} city={d.placeCity} c={c} /> : null}

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
                  {d.parkingMap && parkIdx >= 0 ? <button type="button" onClick={openParking} className="ml-12 -mt-2 inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: c.accent }}><Car size={14} /> See the parking map</button> : null}
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
                      <div key={i} id={'g-h' + i} className="scroll-mt-16" style={{ borderTop: i ? '1px solid ' + c.line : 'none' }}>
                        <button type="button" onClick={() => toggle(k)} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-1 py-3 text-left">
                          <span className="flex-1 text-[15px] font-semibold leading-snug">{sentence(it.title || 'Item ' + (i + 1))}</span>
                          <ChevronDown size={18} className="shrink-0 transition-transform" style={{ color: c.accent, transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                        </button>
                        {isOpen ? (
                          <div className="px-1 pb-4">
                            {photo && isMapItem(it) ? <MapImage src={photo} title={String(it.title || 'Map')} c={c} /> : photo ? <img src={photo} alt="" loading="lazy" className="mb-3 max-h-[300px] w-full rounded-xl object-contain" style={{ background: '#f3efe6' }} onError={(e: any) => { e.currentTarget.style.display = 'none' }} /> : null}
                            <Steps body={str(it.body)} />
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
              <Section id="explore" kicker={lbl('localPlaces.tag', 'Nearby')} title={lbl('m.explore', 'things to do')} c={c} shadow={shadow}>
                <PlaceList items={d.places} city={d.placeCity} c={c} gbId={String(gb?.id || '')} section="localPlaces" token={photoToken} />
              </Section>
            ) : null}
            {d.eats.length ? (
              <Section id="eat" kicker={lbl('restaurants.tag', 'Our picks')} title={lbl('m.eat', 'where to eat')} c={c} shadow={shadow}>
                <PlaceList items={d.eats} city={d.placeCity} c={c} gbId={String(gb?.id || '')} section="restaurants" token={photoToken} />
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
                {/* Information, not buttons (Jon, 2026-10-29): nothing in this section dials on a tap. */}
                <div className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: c.tint }}>
                  <Siren size={20} style={{ color: '#b42318' }} /><div><p className="text-[15px] font-semibold leading-tight">In an emergency, dial 911</p><p className="text-[12.5px]" style={{ color: c.mute }}>Police · fire · ambulance — then let us know</p></div>
                </div>
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
                          {h.phone ? <p className="text-[12.5px] tabular-nums" style={{ color: c.mute }}>{h.phone}</p> : null}
                        </div>
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
        <nav className="fixed inset-x-0 bottom-0 z-30" style={{ background: t.paper + 'f0', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderTop: '1px solid ' + c.line, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="mx-auto flex max-w-[680px] items-stretch">
            {d.wifiNet ? <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold"><Wifi size={19} style={{ color: c.accent }} />Wi-Fi</button> : null}
            {d.howto.length ? <button type="button" onClick={() => go('howto')} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold"><ListChecks size={19} style={{ color: c.accent }} />Guide</button> : null}
            <button type="button" onClick={() => go('checkout')} className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold"><LogOut size={19} style={{ color: c.accent }} />Check-out</button>
          </div>
        </nav>
      </div>

      {/* PRINT = THE ONE-PAGER (Jon, 2026-11-06: three versions — this digital guide, the magazine, the 1-pager). */}
      <div className="hidden print:block"><GuideFlyer gb={gb} /></div>
    </>
  )
}

type C = { paper: string; card: string; ink: string; mute: string; accent: string; line: string; tint: string }

function Section({ id, kicker, title, children, c, shadow, photo }: { id: string; kicker: string; title: string; children: any; c: C; shadow: string; photo?: string | null }) {
  return (
    <section id={'g-' + id} className="scroll-mt-16 overflow-hidden rounded-2xl" style={{ background: c.card, boxShadow: shadow, border: '1px solid ' + c.line }}>
      {photo ? <img src={photo} alt="" loading="lazy" className="h-[180px] w-full object-cover" onError={(e: any) => { e.currentTarget.style.display = 'none' }} /> : null}
      <div className="px-5 pb-5 pt-[18px]">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em]" style={{ color: c.accent }}>{kicker}</p>
        <h2 className="mb-4 mt-1.5 text-[28px] font-medium lowercase leading-[1.05] tracking-[-0.01em]" style={{ fontFamily: SERIF }}>{title}</h2>
        {children}
      </div>
    </section>
  )
}

/** WIFI:… payload — any phone camera joins the network from it. */
export const wifiQrSrc = (net: string, pw: string) => {
  const esc = (v: string) => String(v || '').replace(/([\\;,:"])/g, '\\$1')
  const payload = 'WIFI:T:' + (pw ? 'WPA' : 'nopass') + ';S:' + esc(net) + ';' + (pw ? 'P:' + esc(pw) + ';' : '') + ';'
  return 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=' + encodeURIComponent(payload)
}

/**
 * TODAY HERE (2026-11-06 audit) — the beach question every guest asks: how warm, when is sunset, how
 * strong is the sun. Open-Meteo (free, no key), read in the guest's browser; shows nothing on failure.
 */
function Weather({ geo, city, c }: { geo: { lat: number; lng: number }; city: string; c: C }) {
  const [w, setW] = useState<any>(null)
  useEffect(() => {
    let off = false
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + geo.lat.toFixed(4) + '&longitude=' + geo.lng.toFixed(4) +
      '&current=temperature_2m&daily=temperature_2m_max,temperature_2m_min,sunset,uv_index_max,precipitation_probability_max&temperature_unit=fahrenheit&timezone=America%2FNew_York&forecast_days=1'
    fetch(u).then(r => r.ok ? r.json() : null).then(j => { if (!off && j && j.daily) setW(j) }).catch(() => {})
    return () => { off = true }
  }, [geo.lat, geo.lng])
  if (!w) return null
  const dly = w.daily, n = (v: any) => Math.round(Number(v))
  const sunset = String(dly.sunset?.[0] || '').slice(11, 16)
  const sunsetTxt = sunset ? new Date('2000-01-01T' + sunset + ':00').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
  const uv = n(dly.uv_index_max?.[0]), rain = n(dly.precipitation_probability_max?.[0])
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
      <div className="rounded-xl px-2 py-2.5" style={{ background: c.tint }}><Sun size={15} className="mx-auto" style={{ color: c.accent }} /><p className="mt-1 text-[16px] font-semibold tabular-nums">{n(w.current?.temperature_2m)}°</p><p className="text-[11px]" style={{ color: c.mute }}>{n(dly.temperature_2m_max?.[0])}° / {n(dly.temperature_2m_min?.[0])}°{city ? ' · ' + city : ''}</p></div>
      <div className="rounded-xl px-2 py-2.5" style={{ background: c.tint }}><Sunset size={15} className="mx-auto" style={{ color: c.accent }} /><p className="mt-1 text-[16px] font-semibold">{sunsetTxt || '—'}</p><p className="text-[11px]" style={{ color: c.mute }}>Sunset today</p></div>
      <div className="rounded-xl px-2 py-2.5" style={{ background: c.tint }}><Waves size={15} className="mx-auto" style={{ color: c.accent }} /><p className="mt-1 text-[16px] font-semibold tabular-nums">UV {isFinite(uv) ? uv : '—'}</p><p className="text-[11px]" style={{ color: c.mute }}>{uv >= 8 ? 'Very strong — sunscreen' : uv >= 6 ? 'High — sunscreen' : 'Moderate'}{isFinite(rain) && rain >= 40 ? ' · ' + rain + '% rain' : ''}</p></div>
    </div>
  )
}

/** A map or diagram at full width — never cropped; tap opens it full size to pinch-zoom. */
function MapImage({ src, title, c }: { src: string; title: string; c: C }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" className="mb-3 block overflow-hidden rounded-xl" style={{ background: '#fff', border: '1px solid ' + c.line }} aria-label={'Open ' + title + ' full size'}>
      <img src={src} alt={title} loading="lazy" className="block h-auto w-full" onError={(e: any) => { e.currentTarget.closest('a').style.display = 'none' }} />
      <span className="flex items-center gap-3 px-3 py-2 text-[12px] font-semibold" style={{ color: c.accent }}><span className="min-w-0 flex-1 truncate">{title}</span><span className="inline-flex shrink-0 items-center gap-1"><ExternalLink size={12} /> Full size</span></span>
    </a>
  )
}

/** Steps on their own lines ("1. … 2. …" written as one paragraph reads as a wall of text). */
function Steps({ body }: { body: string }) {
  const st = splitSteps(body)
  if (!st.steps.length) return <p className="text-[14.5px] leading-[1.65] whitespace-pre-line">{body}</p>
  return (
    <div className="text-[14.5px] leading-[1.6]">
      {st.intro ? <p className="mb-1.5">{st.intro}</p> : null}
      <ol className="list-decimal space-y-1.5 pl-5">{st.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
    </div>
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
    <div className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: c.tint }}>
      <Icon size={20} style={{ color: c.accent }} />
      <div className="min-w-0"><p className="text-[15px] font-semibold leading-tight tabular-nums select-all">{value}</p><p className="text-[12.5px]" style={{ color: c.mute }}>{sub}</p></div>
    </div>
  )
}

/**
 * A place's photo — every card gets one (Jon, 2026-10-29: "make sure each local place has a photo").
 * The saved picture shows once it has really loaded. If there is none, or it is dead, the card asks
 * the same repair route the magazine uses (/api/public/place-photo: a fresh search, saved to the book
 * so the next guest gets it at once) and shows a soft placeholder meanwhile — never a broken icon.
 */
function PlacePhoto({ src, gbId, section, index, token, c }: { src: string | null; gbId: string; section: string; index: number; token: string; c: C }) {
  const [url, setUrl] = useState<string | null>(src)
  const [ok, setOk] = useState(false)
  const [asked, setAsked] = useState(false)
  const ref = useRef<HTMLImageElement>(null)
  const repair = async () => {
    if (asked || !gbId || !(index >= 0)) return
    setAsked(true)
    try {
      const r = await fetch('/api/public/place-photo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: gbId, section, index, token }) })
      const j = await r.json().catch(() => ({}))
      if (j && j.photo && j.photo !== url) { setOk(false); setUrl(j.photo) }
    } catch { /* placeholder stays */ }
  }
  useEffect(() => { if (!url) repair() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const im = ref.current; if (im && im.complete) { if (im.naturalWidth > 40) setOk(true); else if (url) repair() } }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative h-[132px] overflow-hidden" style={{ background: c.tint }}>
      {url ? <img ref={ref} src={url} alt="" decoding="async" className="h-full w-full object-cover transition-opacity duration-300" style={{ opacity: ok ? 1 : 0 }}
        onLoad={(e: any) => { if (e.currentTarget.naturalWidth > 40) setOk(true); else repair() }} onError={() => { setOk(false); repair() }} /> : null}
    </div>
  )
}

function PlaceList({ items, city, c, gbId, section, token }: { items: any[]; city: string; c: C; gbId: string; section: string; token: string }) {
  // Phone: swipe. Laptop: a mouse can't swipe, so the cards sit in a two-column grid.
  return (
    <div className="gm-x -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0">
      {items.slice(0, 10).map((p: any, i: number) => {
        const q = [p.name, p.address || city].filter(Boolean).join(', ')
        return (
          <div key={i} className="snap-start shrink-0 w-[236px] md:w-auto overflow-hidden rounded-2xl" style={{ background: c.card, border: '1px solid ' + c.line }}>
            <PlacePhoto src={purl(p.photo)} gbId={gbId} section={section} index={typeof p._i === 'number' ? p._i : i} token={token} c={c} />
            <div className="p-3.5">
              <p className="text-[16px] font-medium leading-tight" style={{ fontFamily: SERIF }}>{p.name}</p>
              {p.note ? <p className="mt-1 text-[12.5px] leading-[1.5] line-clamp-2" style={{ color: c.mute }}>{p.note}</p> : null}
              <div className="mt-2.5 flex items-center justify-between">
                <a href={mapsUrl(q)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: c.accent }}><Navigation size={12} /> Directions</a>
                {p.phone && tel(p.phone).length >= 7 ? <a href={'tel:' + tel(p.phone)} aria-label={'Call ' + p.name} className="inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: c.mute }}><Phone size={12} /> Call</a> : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const qrSrc = (url: string) => 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&data=' + encodeURIComponent(url)

/**
 * "Parking, your unit & the beach" — the questions guests ask, with answers from the book (Jon, 2026-11-06).
 * Shared by the magazine's FAQ page. The beach answer is the unit's own walking steps when the book has them.
 */
export function guideFaq(gb: any) {
  const d = guideData(gb)
  const allHow = (Array.isArray(d.s.houseGuide?.items) ? d.s.houseGuide.items : []).filter((x: any) => x && (x.title || x.body))
  const pick = (re: RegExp) => allHow.find((x: any) => re.test(String(x.title || ''))) || null
  const beachHow = pick(/(walk\w*|access|path|getting|way)\b.*\bbeach|beach\b.*\b(walk\w*|access|path)/i) || pick(/^\s*(the )?beach\s*$/i), parkHow = pick(/park/i), doorHow = pick(/door|entry|keypad|check[- ]?in/i)
  const dot = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : t.trim() + '.')
  const beachText = beachHow ? str(beachHow.body) : d.beach ? dot(d.beach.replace(/\s+-\s+/g, ' — ')) : ''
  const qa: { q: string; a: string; map?: string; steps: { intro: string; steps: string[] } }[] = ([
    d.unit ? { q: 'Which unit is mine?', a: d.unit + (d.address ? ' at ' + d.address : '') + '.' } : null,
    (d.parking || parkHow) ? { q: 'Where do I park?', a: d.parking || str(parkHow.body), map: parkHow && isMapItem(parkHow) ? String(parkHow.title) : '' } : null,
    (d.entry || doorHow) ? { q: 'How do I get in?', a: d.entry || str(doorHow.body) } : null,
    beachText ? { q: 'How do I get to the beach?', a: beachText, map: beachHow && isMapItem(beachHow) ? String(beachHow.title) : '' } : null,
    d.gettingThere ? { q: 'How do I find the building?', a: d.gettingThere } : null,
    (d.checkIn || d.checkOut) ? { q: 'When are check-in and check-out?', a: [d.checkIn && 'Check-in from ' + d.checkIn, d.checkOut && 'check-out by ' + d.checkOut].filter(Boolean).join(', ') + '.' } : null,
    { q: 'Something is not working?', a: 'Message us in the app you booked with — we reply fast.' + (d.phone ? ' Urgent: ' + d.phone + '.' : '') },
  ].filter(Boolean) as { q: string; a: string; map?: string }[]).map(x => ({ ...x, steps: splitSteps(x.a) }))
  return {
    qa,
    buildingQr: d.address ? qrSrc(mapsUrl(d.address)) : '',
    beachQr: beachText && d.address ? qrSrc('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('beach access near ' + d.address)) : '',
    used: [beachHow, parkHow, doorHow].filter(Boolean),
  }
}

