'use client'
// BOOK DIRECT (Jon, 2026-10-13: "optimized for speed, ease, and verification of ID and selfie, and have
// it book"). One page, four short steps, phone-first:
//
//   1  WHERE & WHEN   dates + guests → the homes free for those dates, with the price for the stay
//   2  THE HOME       photos, the facts, an availability calendar, the exact price (Guesty quote)
//   3  WHO            name / email / mobile, then an ID photo (rear camera) and a selfie (front camera)
//                     — checked on the spot; a retake is asked for in plain words
//   4  PAY            Guesty's own card form (pay.guesty.com iframe — the card never touches us),
//                     3-D Secure if the bank asks, then the confirmation code
//
// Speed: no libraries beyond what the app already ships, photos lazy-loaded and shrunk in the browser
// (a 12 MB phone photo uploads as ~300 KB), the search cached for a minute, nothing fetched twice.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const API = '/api/public/book'
const LOGO = 'https://ugbtsppfsgkkrdyyuxxg.supabase.co/storage/v1/object/public/guidebook-assets/1783090958148-l1zr8u.png'
const SERIF = "'Playfair Display', Georgia, serif"

type Card = { id: string; title: string; type: string; city: string; area: string; guests: number | null; bedrooms: number | null; bathrooms: number | null; beds: number | null; photo: string | null; perNight: number | null; stayFrom: number | null; currency: string; rating: number | null; reviews: number }
type Listing = { id: string; title: string; type: string; city: string; area: string; guests: number | null; bedrooms: number | null; bathrooms: number | null; beds: number | null; photos: { src: string; thumb: string; caption: string }[]; summary: string; space: string; access: string; neighborhood: string; houseRules: string; amenities: string[]; rating: number | null; reviews: number; basePrice: number | null; currency: string; checkInTime: string | null; checkOutTime: string | null }
type Day = { date: string; open: boolean; minNights: number; cta: boolean; ctd: boolean }
type RatePlan = { id: string; name: string; currency: string; total: number; accommodation: number; cleaning: number; fees: number; taxes: number; items: { title: string; amount: number }[]; cancellation: string[] }
type Quote = { quoteId: string; expiresAt: string | null; ratePlans: RatePlan[] }

const money = (n: number | null | undefined, cur = 'USD') => n == null ? '' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n)
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d) }
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const nightsOf = (a: string, b: string) => a && b ? Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400_000) : 0
const nice = (s: string) => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''

async function call(body: any): Promise<any> {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.ok) throw new Error(j?.error || 'Something went wrong — please try again.')
  return j
}

function shrink(file: File, maxPx = 1600, q = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.naturalWidth, h = img.naturalHeight
      if (!w || !h) return reject(new Error('That photo could not be read — try again.'))
      const s = Math.min(1, maxPx / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d'); if (!ctx) return reject(new Error('Your browser could not process the photo.'))
      ctx.drawImage(img, 0, 0, w, h); resolve(c.toDataURL('image/jpeg', q))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo could not be read — use a JPG or PNG.')) }
    img.src = url
  })
}

// Guesty's card form. Loaded from pay.guesty.com only when the guest reaches the payment step.
function loadGuestyPay(): Promise<any> {
  const w = window as any
  if (w.guestyTokenization && 'handle3DSChallenge' in w.guestyTokenization) return Promise.resolve(w.guestyTokenization)
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://pay.guesty.com/tokenization/v3/init.js'; s.async = true
    s.onload = () => w.guestyTokenization ? resolve(w.guestyTokenization) : reject(new Error('The card form did not load.'))
    s.onerror = () => reject(new Error('The card form could not load — check your connection.'))
    document.head.appendChild(s)
  })
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────
export function DirectBooking() {
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [guests, setGuests] = useState(2)
  const [open, setOpen] = useState<string | null>(null)   // listing id
  // Read the URL once, so a shared link (?checkIn=…&checkOut=…&guests=…&home=…) lands on the right place.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const ci = sp.get('checkIn') || '', co = sp.get('checkOut') || ''
    if (ci) setCheckIn(ci); if (co) setCheckOut(co)
    const g = Number(sp.get('guests')); if (g > 0) setGuests(Math.min(16, g))
    if (sp.get('home')) setOpen(sp.get('home'))
  }, [])
  useEffect(() => {
    const sp = new URLSearchParams()
    if (checkIn) sp.set('checkIn', checkIn); if (checkOut) sp.set('checkOut', checkOut); if (guests !== 2) sp.set('guests', String(guests)); if (open) sp.set('home', open)
    const q = sp.toString()
    window.history.replaceState(null, '', '/book' + (q ? '?' + q : ''))
  }, [checkIn, checkOut, guests, open])

  return (
    <div className="min-h-screen bg-[#faf8f4] text-[#1c1b19]" style={{ fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
      <header className="sticky top-0 z-30 bg-[#faf8f4]/95 backdrop-blur border-b border-black/5">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <button onClick={() => setOpen(null)} className="flex items-center gap-2" aria-label="All homes">
            <img src={LOGO} alt="Stay Hospitality" className="h-7 w-auto" />
          </button>
          <span className="ml-auto text-[12px] text-black/60 hidden sm:inline">Book direct · best rate · instant confirmation</span>
        </div>
      </header>
      {open
        ? <Home id={open} checkIn={checkIn} checkOut={checkOut} guests={guests} setDates={(a, b) => { setCheckIn(a); setCheckOut(b) }} setGuests={setGuests} onBack={() => setOpen(null)} />
        : <Search checkIn={checkIn} checkOut={checkOut} guests={guests} setCheckIn={setCheckIn} setCheckOut={setCheckOut} setGuests={setGuests} onOpen={setOpen} />}
      <footer className="max-w-6xl mx-auto px-4 py-10 text-[12px] text-black/50">Stay Hospitality · South Florida · Payments are processed securely by Guesty. Your ID and selfie are seen only by our front desk and kept private.</footer>
    </div>
  )
}

// ── 1. search ────────────────────────────────────────────────────────────────────────────────────
function Search({ checkIn, checkOut, guests, setCheckIn, setCheckOut, setGuests, onOpen }: { checkIn: string; checkOut: string; guests: number; setCheckIn: (s: string) => void; setCheckOut: (s: string) => void; setGuests: (n: number) => void; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Card[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const today = todayET()
  const run = useCallback(async (cursor?: string) => {
    setBusy(true); setErr('')
    try {
      const sp = new URLSearchParams({ a: 'search', guests: String(guests) })
      if (checkIn && checkOut) { sp.set('checkIn', checkIn); sp.set('checkOut', checkOut) }
      if (cursor) sp.set('cursor', cursor)
      const r = await fetch(API + '?' + sp.toString()); const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Search failed.')
      setRows(prev => cursor && prev ? prev.concat(j.listings) : j.listings); setNext(j.next || null)
    } catch (e: any) { setErr(e.message || String(e)) }
    setBusy(false)
  }, [checkIn, checkOut, guests])
  useEffect(() => { run() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const n = nightsOf(checkIn, checkOut)
  return (
    <main className="max-w-6xl mx-auto px-4 pb-10">
      <section className="pt-8 pb-5">
        <h1 className="text-[30px] sm:text-[40px] leading-tight" style={{ fontFamily: SERIF }}>Stay in South Florida, booked direct.</h1>
        <p className="text-black/60 mt-1 text-[14px]">Best rate, no booking-site fees, instant confirmation.</p>
      </section>
      <form onSubmit={e => { e.preventDefault(); run() }} className="bg-white rounded-2xl shadow-sm border border-black/5 p-3 grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-black/50">Check in
          <input type="date" min={today} value={checkIn} onChange={e => { setCheckIn(e.target.value); if (checkOut && e.target.value >= checkOut) setCheckOut(addDays(e.target.value, 2)) }} className="mt-1 w-full h-11 rounded-xl border border-black/10 px-3 text-[15px] font-normal normal-case tracking-normal text-black" />
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-black/50">Check out
          <input type="date" min={checkIn ? addDays(checkIn, 1) : today} value={checkOut} onChange={e => setCheckOut(e.target.value)} className="mt-1 w-full h-11 rounded-xl border border-black/10 px-3 text-[15px] font-normal normal-case tracking-normal text-black" />
        </label>
        <Guests value={guests} onChange={setGuests} />
        <button type="submit" disabled={busy} className="h-11 rounded-xl bg-[#1c1b19] text-white px-6 font-semibold text-[15px] disabled:opacity-60">{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {err && <p className="mt-3 text-[13px] text-rose-700">{err}</p>}
      <p className="mt-4 text-[13px] text-black/60">{rows == null ? 'Loading homes…' : checkIn && checkOut ? `${rows.length}${next ? '+' : ''} homes free ${nice(checkIn)} – ${nice(checkOut)} · ${n} night${n === 1 ? '' : 's'}` : `${rows.length}${next ? '+' : ''} homes — add dates to see prices for your stay`}</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(rows || []).map(c => (
          <button key={c.id} onClick={() => { onOpen(c.id); window.scrollTo(0, 0) }} className="text-left bg-white rounded-2xl overflow-hidden border border-black/5 shadow-sm hover:shadow-md transition-shadow">
            <div className="aspect-[4/3] bg-black/5">{c.photo ? <img src={c.photo} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : null}</div>
            <div className="p-3">
              <div className="flex items-start gap-2">
                <h3 className="font-semibold text-[15px] leading-snug flex-1">{c.title}</h3>
                {c.rating ? <span className="text-[12.5px] shrink-0">★ {c.rating}{c.reviews ? <span className="text-black/50"> ({c.reviews})</span> : null}</span> : null}
              </div>
              <p className="text-[12.5px] text-black/60 mt-0.5">{[c.area || c.city, c.bedrooms != null ? (c.bedrooms ? c.bedrooms + ' bd' : 'Studio') : '', c.bathrooms ? c.bathrooms + ' ba' : '', c.guests ? 'up to ' + c.guests : ''].filter(Boolean).join(' · ')}</p>
              <p className="mt-2 text-[14px]">{c.stayFrom && n ? <><b>{money(c.stayFrom, c.currency)}</b> <span className="text-black/60">for {n} night{n === 1 ? '' : 's'} · before taxes & fees</span></> : c.perNight ? <><b>{money(c.perNight, c.currency)}</b> <span className="text-black/60">/ night</span></> : <span className="text-black/60">See prices</span>}</p>
            </div>
          </button>
        ))}
      </div>
      {next && <div className="mt-6 text-center"><button onClick={() => run(next)} disabled={busy} className="h-11 px-6 rounded-xl border border-black/15 bg-white font-semibold text-[14px]">{busy ? 'Loading…' : 'Show more homes'}</button></div>}
      {rows && !rows.length && !busy && <p className="mt-6 text-[14px] text-black/60">Nothing free for those dates and guests. Try nearby dates or fewer guests.</p>}
    </main>
  )
}

function Guests({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-black/50">Guests
      <div className="mt-1 h-11 rounded-xl border border-black/10 bg-white flex items-center">
        <button type="button" aria-label="Fewer guests" onClick={() => onChange(Math.max(1, value - 1))} className="w-10 h-full text-[18px] text-black/70">−</button>
        <span className="w-8 text-center text-[15px] font-normal text-black">{value}</span>
        <button type="button" aria-label="More guests" onClick={() => onChange(Math.min(16, value + 1))} className="w-10 h-full text-[18px] text-black/70">+</button>
      </div>
    </div>
  )
}

// ── 2–4. one home, the price, who, pay ───────────────────────────────────────────────────────────
type Step = 'price' | 'who' | 'verify' | 'pay' | 'done'

function Home({ id, checkIn, checkOut, guests, setDates, setGuests, onBack }: { id: string; checkIn: string; checkOut: string; guests: number; setDates: (a: string, b: string) => void; setGuests: (n: number) => void; onBack: () => void }) {
  const [l, setL] = useState<Listing | null>(null)
  const [cal, setCal] = useState<Day[]>([])
  const [err, setErr] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [plan, setPlan] = useState<string>('')
  const [draftId, setDraftId] = useState<string>('')
  const [providerId, setProviderId] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('price')
  const [busy, setBusy] = useState('')
  const [more, setMore] = useState(false)
  const [booked, setBooked] = useState<{ confirmationCode: string } | null>(null)

  useEffect(() => {
    let live = true
    fetch(`${API}?a=listing&id=${encodeURIComponent(id)}`).then(r => r.json()).then(j => { if (!live) return; if (!j.ok) { setErr(j.error || 'This home could not be loaded.'); return } setL(j.listing); setCal(j.calendar || []) }).catch(e => live && setErr(String(e?.message || e)))
    return () => { live = false }
  }, [id])

  const getPrice = useCallback(async () => {
    if (!checkIn || !checkOut) { setErr('Pick your dates on the calendar.'); return }
    setBusy('quote'); setErr(''); setQuote(null)
    try {
      const j = await call({ a: 'quote', listingId: id, checkIn, checkOut, guests, draftId: draftId || undefined })
      setQuote(j.quote); setPlan(j.quote.ratePlans[0]?.id || ''); setDraftId(j.draftId); setProviderId(j.providerId)
    } catch (e: any) { setErr(e.message) }
    setBusy('')
  }, [id, checkIn, checkOut, guests, draftId])
  // A price as soon as there are dates — one tap fewer.
  useEffect(() => { if (checkIn && checkOut && l) getPrice() }, [checkIn, checkOut, guests, l]) // eslint-disable-line react-hooks/exhaustive-deps

  const rp = quote?.ratePlans.find(p => p.id === plan) || quote?.ratePlans[0] || null
  const n = nightsOf(checkIn, checkOut)
  if (err && !l) return <main className="max-w-3xl mx-auto px-4 py-10"><button onClick={onBack} className="text-[14px] underline">← All homes</button><p className="mt-4 text-rose-700">{err}</p></main>
  if (!l) return <main className="max-w-3xl mx-auto px-4 py-10 text-black/60">Loading…</main>

  if (step === 'done' && booked) return (
    <main className="max-w-xl mx-auto px-4 py-12 text-center">
      <div className="text-[44px]">✓</div>
      <h1 className="text-[30px] leading-tight mt-2" style={{ fontFamily: SERIF }}>You&apos;re booked.</h1>
      <p className="mt-2 text-[15px]">{l.title} · {nice(checkIn)} – {nice(checkOut)}</p>
      <p className="mt-4 inline-block rounded-xl bg-white border border-black/10 px-4 py-2 text-[15px]">Confirmation <b className="tracking-wide">{booked.confirmationCode}</b></p>
      <p className="mt-4 text-[14px] text-black/60">A confirmation is on its way to your email. Your ID is verified — check-in details arrive before your stay.</p>
    </main>
  )

  return (
    <main className="max-w-6xl mx-auto px-4 pb-10">
      <button onClick={onBack} className="mt-4 text-[13px] text-black/60 hover:text-black">← All homes</button>
      <Gallery photos={l.photos} />
      <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_400px] items-start">
        <section>
          <h1 className="text-[26px] sm:text-[32px] leading-tight" style={{ fontFamily: SERIF }}>{l.title}</h1>
          <p className="text-[14px] text-black/60 mt-1">{[l.area || l.city, l.bedrooms != null ? (l.bedrooms ? l.bedrooms + ' bedroom' + (l.bedrooms === 1 ? '' : 's') : 'Studio') : '', l.beds ? l.beds + ' bed' + (l.beds === 1 ? '' : 's') : '', l.bathrooms ? l.bathrooms + ' bath' : '', l.guests ? 'sleeps ' + l.guests : ''].filter(Boolean).join(' · ')}{l.rating ? ` · ★ ${Math.round(l.rating * 10) / 10} (${l.reviews})` : ''}</p>
          {l.summary && <p className="mt-4 text-[15px] leading-relaxed whitespace-pre-line">{more ? l.summary : l.summary.slice(0, 420) + (l.summary.length > 420 ? '…' : '')}</p>}
          {more && l.space && <><h3 className="mt-5 font-semibold">The space</h3><p className="mt-1 text-[14.5px] leading-relaxed whitespace-pre-line">{l.space}</p></>}
          {more && l.neighborhood && <><h3 className="mt-5 font-semibold">The neighborhood</h3><p className="mt-1 text-[14.5px] leading-relaxed whitespace-pre-line">{l.neighborhood}</p></>}
          {(l.summary.length > 420 || l.space || l.neighborhood) && <button onClick={() => setMore(m => !m)} className="mt-2 text-[14px] font-semibold underline">{more ? 'Show less' : 'Read more'}</button>}
          {l.amenities.length > 0 && <><h3 className="mt-6 font-semibold">What&apos;s here</h3><ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[14px] text-black/80">{l.amenities.slice(0, 16).map(a => <li key={a}>· {a.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}</li>)}</ul></>}
          {l.houseRules && <details className="mt-6"><summary className="font-semibold cursor-pointer">House rules</summary><p className="mt-2 text-[14px] leading-relaxed whitespace-pre-line text-black/80">{l.houseRules}</p></details>}
        </section>

        <aside className="lg:sticky lg:top-20 bg-white rounded-2xl border border-black/10 shadow-sm p-4">
          {step === 'price' && <>
            <Calendar days={cal} checkIn={checkIn} checkOut={checkOut} onPick={(a, b) => setDates(a, b)} />
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1 text-[13px]">{checkIn ? <><b>{nice(checkIn)}</b> → <b>{checkOut ? nice(checkOut) : '…'}</b>{n ? <span className="text-black/60"> · {n} night{n === 1 ? '' : 's'}</span> : null}</> : <span className="text-black/60">Tap your check-in, then check-out.</span>}</div>
              <Guests value={guests} onChange={setGuests} />
            </div>
            {busy === 'quote' && <p className="mt-3 text-[13px] text-black/60">Getting your price…</p>}
            {quote && rp && <Price quote={quote} plan={rp.id} setPlan={setPlan} />}
            {err && <p className="mt-3 text-[13px] text-rose-700">{err}</p>}
            <button disabled={!rp || !!busy} onClick={() => { setErr(''); setStep('who') }} className="mt-4 w-full h-12 rounded-xl bg-[#1c1b19] text-white font-semibold text-[15px] disabled:opacity-40">{rp ? `Reserve · ${money(rp.total, rp.currency)}` : 'Pick dates to see the price'}</button>
            <p className="mt-2 text-[12px] text-center text-black/50">Next: your details and a quick ID check. You won&apos;t be charged until the last step.</p>
          </>}
          {step !== 'price' && rp && (
            <Checkout listing={l} rp={rp} quoteId={quote!.quoteId} draftId={draftId} providerId={providerId} checkIn={checkIn} checkOut={checkOut}
              step={step} setStep={setStep} onBooked={b => { setBooked(b); setStep('done'); window.scrollTo(0, 0) }} onBack={() => setStep('price')} />
          )}
        </aside>
      </div>
    </main>
  )
}

function Gallery({ photos }: { photos: { src: string; caption: string }[] }) {
  if (!photos.length) return null
  return (
    <div className="mt-3 flex gap-2 overflow-x-auto snap-x snap-mandatory rounded-2xl" style={{ scrollbarWidth: 'none' }}>
      {photos.map((p, i) => (
        <img key={p.src} src={p.src} alt={p.caption || ''} loading={i < 2 ? 'eager' : 'lazy'} decoding="async"
          className="snap-start shrink-0 h-[240px] sm:h-[380px] w-[86%] sm:w-auto sm:max-w-[640px] object-cover rounded-2xl bg-black/5" />
      ))}
    </div>
  )
}

function Calendar({ days, checkIn, checkOut, onPick }: { days: Day[]; checkIn: string; checkOut: string; onPick: (a: string, b: string) => void }) {
  const today = todayET()
  const [month, setMonth] = useState(() => (checkIn || today).slice(0, 7))
  const byDate = useMemo(() => { const m: Record<string, Day> = {}; for (const d of days) m[d.date] = d; return m }, [days])
  const known = days.length > 0
  const isOpen = (s: string) => s >= today && (!known || !!byDate[s]?.open)
  const first = new Date(month + '-01T12:00:00Z')
  const lead = first.getUTCDay()
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  const cells: (string | null)[] = Array(lead).fill(null).concat(Array.from({ length: dim }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`))
  const shift = (k: number) => { const d = new Date(first); d.setUTCMonth(d.getUTCMonth() + k); setMonth(d.toISOString().slice(0, 7)) }
  // Every night between check-in and this day must be open for it to be a valid check-out.
  const canOut = (s: string) => { if (!checkIn || s <= checkIn) return false; for (let d = checkIn; d < s; d = addDays(d, 1)) if (!isOpen(d)) return false; const min = byDate[checkIn]?.minNights || 1; return nightsOf(checkIn, s) >= min && !byDate[s]?.ctd }
  const pick = (s: string) => {
    if (checkIn && !checkOut && canOut(s)) { onPick(checkIn, s); return }
    if (isOpen(s) && !byDate[s]?.cta) onPick(s, '')
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => shift(-1)} disabled={month <= today.slice(0, 7)} className="w-8 h-8 rounded-lg hover:bg-black/5 disabled:opacity-30" aria-label="Previous month">‹</button>
        <span className="text-[14px] font-semibold">{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</span>
        <button onClick={() => shift(1)} className="w-8 h-8 rounded-lg hover:bg-black/5" aria-label="Next month">›</button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] text-black/40 mb-1">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((s, i) => {
          if (!s) return <span key={i} />
          const inRange = checkIn && checkOut && s > checkIn && s < checkOut
          const edge = s === checkIn || s === checkOut
          const selectable = (checkIn && !checkOut) ? (canOut(s) || (isOpen(s) && s < checkIn)) : isOpen(s)
          return (
            <button key={s} disabled={!selectable && !edge} onClick={() => pick(s)}
              className={'h-9 text-[13px] rounded-lg ' + (edge ? 'bg-[#1c1b19] text-white font-semibold' : inRange ? 'bg-black/10' : selectable ? 'hover:bg-black/5' : 'text-black/25 line-through')}>
              {Number(s.slice(8))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Price({ quote, plan, setPlan }: { quote: Quote; plan: string; setPlan: (s: string) => void }) {
  const rp = quote.ratePlans.find(p => p.id === plan) || quote.ratePlans[0]
  return (
    <div className="mt-4">
      {quote.ratePlans.length > 1 && (
        <div className="space-y-1.5 mb-3">
          {quote.ratePlans.map(p => (
            <label key={p.id} className={'flex items-center gap-2 rounded-xl border px-3 py-2 cursor-pointer ' + (p.id === rp.id ? 'border-[#1c1b19]' : 'border-black/10')}>
              <input type="radio" checked={p.id === rp.id} onChange={() => setPlan(p.id)} />
              <span className="flex-1 text-[13.5px]">{p.name}<span className="block text-[12px] text-black/50">{p.cancellation[0] || ''}</span></span>
              <b className="text-[14px]">{money(p.total, p.currency)}</b>
            </label>
          ))}
        </div>
      )}
      <div className="text-[13.5px] space-y-1">
        {(rp.items.length ? rp.items : [{ title: 'Stay', amount: rp.accommodation }, { title: 'Cleaning', amount: rp.cleaning }, { title: 'Fees', amount: rp.fees }, { title: 'Taxes', amount: rp.taxes }].filter(x => x.amount)).map((x, i) => (
          <div key={i} className="flex justify-between"><span className="text-black/70">{x.title}</span><span>{money(x.amount, rp.currency)}</span></div>
        ))}
        <div className="flex justify-between border-t border-black/10 pt-2 mt-2 text-[15px] font-semibold"><span>Total</span><span>{money(rp.total, rp.currency)}</span></div>
      </div>
      {rp.cancellation.length > 0 && <p className="mt-2 text-[12px] text-black/60">{rp.cancellation.join(' ')}</p>}
    </div>
  )
}

// ── who, verify, pay ─────────────────────────────────────────────────────────────────────────────
function Checkout({ listing, rp, quoteId, draftId, providerId, checkIn, checkOut, step, setStep, onBooked, onBack }: {
  listing: Listing; rp: RatePlan; quoteId: string; draftId: string; providerId: string | null; checkIn: string; checkOut: string
  step: Step; setStep: (s: Step) => void; onBooked: (b: { confirmationCode: string }) => void; onBack: () => void
}) {
  const [g, setG] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [idImg, setIdImg] = useState('')
  const [selfie, setSelfie] = useState('')
  const [retake, setRetake] = useState<string[]>([])
  const [agree, setAgree] = useState(false)
  const [cardOk, setCardOk] = useState(false)
  const pay = useRef<any>(null)

  const saveWho = async () => {
    setBusy('who'); setErr('')
    try { const j = await call({ a: 'guest', draftId, ...g }); setStep(j.needsVerify ? 'verify' : 'pay') } catch (e: any) { setErr(e.message) }
    setBusy('')
  }
  const verify = async () => {
    setBusy('verify'); setErr(''); setRetake([])
    try {
      const j = await call({ a: 'verify', draftId, idPhoto: idImg, selfie })
      if (j.check.verdict === 'retake') setRetake(j.check.reasons)
      else setStep('pay')
    } catch (e: any) { setErr(e.message) }
    setBusy('')
  }
  // The card form, when the guest reaches it.
  useEffect(() => {
    if (step !== 'pay') return
    if (!providerId) { setErr('Card payments are not set up for this home yet — please message us to book.'); return }
    let gone = false
    loadGuestyPay().then(async t => {
      if (gone) return
      pay.current = t
      await t.render({ containerId: 'guesty-pay', providerId, onStatusChange: (ok: boolean) => setCardOk(ok), styles: { fontFamily: 'Inter, -apple-system, sans-serif', borderRadius: 12, inputHeight: 44, colorBorderFocus: '#1c1b19' } })
    }).catch(e => !gone && setErr(String(e?.message || e)))
    return () => { gone = true; try { pay.current?.destroy?.() } catch { /* gone */ } }
  }, [step, providerId])

  const book = async () => {
    setBusy('book'); setErr('')
    try {
      const pm = await pay.current.submit({ amount: rp.total, currency: rp.currency, listingId: listing.id, quoteId, guest: { firstName: g.firstName, lastName: g.lastName, email: g.email, phone: g.phone }, method: 'verify_no_3ds' })
      if (!pm?._id) throw new Error('Check your card details.')
      let j = await call({ a: 'book', draftId, ratePlanId: rp.id, paymentMethodId: pm._id, agree })
      if (j.threeDSChallenge) {
        const r = await pay.current.handle3DSChallenge({ threeDSChallenge: j.threeDSChallenge })
        j = await call({ a: 'confirm3ds', draftId, threeDSResult: r })
      }
      if (j.booked) onBooked(j.booked)
    } catch (e: any) { setErr(String(e?.message || e).replace(/^Error:\s*/, '')) }
    setBusy('')
  }

  const steps: [Step, string][] = [['who', 'Your details'], ['verify', 'ID check'], ['pay', 'Pay']]
  return (
    <div>
      <div className="flex items-center gap-1 text-[11.5px] mb-3">
        <button onClick={onBack} className="text-black/60 hover:text-black mr-1">←</button>
        {steps.map(([k, t], i) => <span key={k} className={'px-2 py-1 rounded-full ' + (k === step ? 'bg-[#1c1b19] text-white' : 'bg-black/5 text-black/60')}>{i + 1}. {t}</span>)}
      </div>
      <p className="text-[13px] text-black/70 mb-3">{listing.title}<br />{nice(checkIn)} – {nice(checkOut)} · <b>{money(rp.total, rp.currency)}</b></p>

      {step === 'who' && <form onSubmit={e => { e.preventDefault(); saveWho() }} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="First name" v={g.firstName} on={v => setG({ ...g, firstName: v })} auto="given-name" />
          <Field label="Last name" v={g.lastName} on={v => setG({ ...g, lastName: v })} auto="family-name" />
        </div>
        <Field label="Email" type="email" v={g.email} on={v => setG({ ...g, email: v })} auto="email" />
        <Field label="Mobile" type="tel" v={g.phone} on={v => setG({ ...g, phone: v })} auto="tel" />
        <p className="text-[12px] text-black/50">Use your name exactly as it is on your ID.</p>
        <button disabled={!!busy} className="w-full h-12 rounded-xl bg-[#1c1b19] text-white font-semibold disabled:opacity-50">{busy ? 'Saving…' : 'Continue'}</button>
      </form>}

      {step === 'verify' && <div className="space-y-3">
        <p className="text-[13.5px]">To book direct we verify every guest. Two quick photos — they&apos;re private and only our front desk sees them.</p>
        <Snap label="1 · Photo of your ID" hint="Driver's licence, passport or national ID — flat, in good light, whole card in frame." capture="environment" value={idImg} onPick={setIdImg} onErr={setErr} />
        <Snap label="2 · A selfie" hint="Face the camera, no hat or sunglasses." capture="user" value={selfie} onPick={setSelfie} onErr={setErr} />
        {retake.length > 0 && <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-[13px] text-amber-900">{retake.map((r, i) => <p key={i}>{r}</p>)}</div>}
        <button disabled={!idImg || !selfie || !!busy} onClick={verify} className="w-full h-12 rounded-xl bg-[#1c1b19] text-white font-semibold disabled:opacity-40">{busy ? 'Checking…' : 'Verify me'}</button>
        <button onClick={() => setStep('who')} className="w-full text-[12.5px] text-black/60 underline">Edit my name</button>
      </div>}

      {step === 'pay' && <div className="space-y-3">
        <p className="text-[13px] text-emerald-700">✓ ID verified</p>
        <div id="guesty-pay" className="min-h-[220px]" />
        <label className="flex items-start gap-2 text-[12.5px] text-black/70">
          <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5" />
          <span>I accept the house rules{rp.cancellation.length ? ', the cancellation policy' : ''} and that the card is charged {money(rp.total, rp.currency)} now.</span>
        </label>
        <button disabled={!agree || !cardOk || !!busy} onClick={book} className="w-full h-12 rounded-xl bg-[#1c1b19] text-white font-semibold disabled:opacity-40">{busy ? 'Booking…' : `Book · ${money(rp.total, rp.currency)}`}</button>
        <p className="text-[11.5px] text-black/50 text-center">Card details go straight to Guesty&apos;s secure payment form — we never see your card.</p>
      </div>}
      {err && <p className="mt-3 text-[13px] text-rose-700">{err}</p>}
    </div>
  )
}

function Field({ label, v, on, type = 'text', auto }: { label: string; v: string; on: (s: string) => void; type?: string; auto?: string }) {
  return <label className="block text-[11px] font-semibold uppercase tracking-wide text-black/50">{label}
    <input type={type} value={v} onChange={e => on(e.target.value)} autoComplete={auto} required className="mt-1 w-full h-11 rounded-xl border border-black/15 px-3 text-[15px] font-normal normal-case tracking-normal text-black" />
  </label>
}

function Snap({ label, hint, capture, value, onPick, onErr }: { label: string; hint: string; capture: 'user' | 'environment'; value: string; onPick: (s: string) => void; onErr: (s: string) => void }) {
  const ref = useRef<HTMLInputElement | null>(null)
  return (
    <div className="rounded-xl border border-black/10 p-3">
      <div className="flex items-center gap-3">
        {value ? <img src={value} alt="" className="w-16 h-16 rounded-lg object-cover" /> : <div className="w-16 h-16 rounded-lg bg-black/5 flex items-center justify-center text-[22px]">{capture === 'user' ? '🙂' : '🪪'}</div>}
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold">{label}</p>
          <p className="text-[12px] text-black/55">{hint}</p>
        </div>
      </div>
      <input ref={ref} type="file" accept="image/*" capture={capture} className="hidden"
        onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { onPick(await shrink(f)) } catch (x: any) { onErr(x.message) } }} />
      <button type="button" onClick={() => ref.current?.click()} className="mt-2 w-full h-10 rounded-lg border border-black/15 text-[13.5px] font-semibold">{value ? 'Retake' : capture === 'user' ? 'Take selfie' : 'Take photo of ID'}</button>
    </div>
  )
}
