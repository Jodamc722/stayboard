'use client'
// THE GUEST ORDER FORM — one component, two homes: the public page (/order/<code>) renders it for
// real, and the Design Studio (/guest-orders/design) renders the very same thing inside a phone
// frame with edit affordances on every card. Whatever the studio shows is exactly what the guest
// gets — there is no second copy to drift (Jon, 2026-08-24: "from the form add and edit design,
// update feature, add photos, review the sheet").
//
// 2026-09-10 (Jon: "make it great, visually… allow user to add 3 or 6 bulk buy for the discounted
// price, 1 for etc… coupon code enter area"): the card leads with the picture and the price, then
// offers the ways to buy as one row of choices — "1 · $4", "3 · $10.50 save 12%", "6 · $18 save
// 25%" — built from the item's volume breaks and its sold-in multiple. One tap sets the quantity;
// the stepper is there for fine tuning. A sticky category bar, a basket bar that stays put, and a
// review sheet with a "Have a code?" field whose verdict comes from the server, never the browser.
//
// Not the app's indigo ops skin on purpose: the guest sees Stay Hospitality, not Lighthouse.
import { useEffect, useMemo, useRef, useState } from 'react'

export type PriceTier = { min_qty: number; unit_price_usd: number }
export type FormItem = { id?: string; sku: string; name: string; description: string | null; price: number; unit: string | null; category: string; maxQty: number; image: string | null; fewLeft?: number | null
  /** How much is in one — "500 mL". Sits with the pack label under the name. */
  size?: string | null
  /** On offer: what they pay now, with `price` shown struck through. */
  salePrice?: number | null
  /** A short promo word on the card — New, Limited, Last few. */
  badge?: string | null
  /** Sold in multiples of N — the basket steps by N and starts at N. Coffee pods in 5s. */
  soldIn?: number | null
  /** Volume breaks on this item — "3+ $2.50 each". Best qualifying break wins, priced server-side. */
  tiers?: PriceTier[] | null }

/** The unit price at this quantity. Mirrors priceForQty on the server; the server still decides. */
export function unitPriceFor(c: FormItem, qty: number): { unit: number; tier: PriceTier | null } {
  let hit: PriceTier | null = null
  for (const t of (c.tiers || [])) if (qty >= t.min_qty) hit = t
  // Mirrors priceForQty on the server: an offer price and a volume break both apply, the guest pays
  // the lower of the two, and they never stack. The server still decides.
  const candidates = [hit ? hit.unit_price_usd : c.price]
  if (c.salePrice !== null && c.salePrice !== undefined && c.salePrice >= 0) candidates.push(c.salePrice)
  const unit = Math.min(...candidates)
  return { unit, tier: hit && hit.unit_price_usd <= unit ? hit : null }
}
/**
 * The next break a guest has not reached yet — the nudge that turns 2 into 3.
 *
 * It must BEAT what they are already paying. With an offer price of $11 running against a 3+ break
 * of $12, the old version cheerfully advertised "3+ $12 each · save 20%" — inviting the guest to buy
 * more in order to pay more, and quoting the saving against a list price nobody was being charged.
 */
export function nextTier(c: FormItem, qty: number): PriceTier | null {
  const nowPaying = unitPriceFor(c, Math.max(1, qty)).unit
  const up = (c.tiers || []).filter(t => qty < t.min_qty && t.unit_price_usd < nowPaying).sort((a, b) => a.min_qty - b.min_qty)
  return up.length ? up[0] : null
}
/** The multiple an item is sold in — 1 unless the catalog says otherwise. */
export function stepOf(c: FormItem): number { return c.soldIn && c.soldIn > 1 ? Math.floor(c.soldIn) : 1 }
/**
 * THE WAYS TO BUY. One pill per quantity worth offering: the single (or the sold-in multiple), then
 * every volume break, each snapped up to the multiple and capped by the max per order. "1 · $4",
 * "3 · $10.50 · save 12%", "6 · $18 · save 25%". At most four; a bundle that would cost more per
 * unit than a smaller one is dropped, because nobody should be offered a worse deal as an upgrade.
 */
export function bundlesFor(c: FormItem): { qty: number; total: number; unit: number; savePct: number }[] {
  const step = stepOf(c)
  const snap = (n: number) => Math.ceil(n / step) * step
  const cand = new Set<number>([step])
  for (const t of (c.tiers || [])) if (t.min_qty > 0) cand.add(snap(t.min_qty))
  const base = unitPriceFor(c, step).unit
  const out: { qty: number; total: number; unit: number; savePct: number }[] = []
  for (const q of Array.from(cand).sort((a, b) => a - b)) {
    if (q > c.maxQty) continue
    const unit = unitPriceFor(c, q).unit
    if (out.length && unit > out[out.length - 1].unit) continue
    out.push({ qty: q, total: Math.round(unit * q * 100) / 100, unit, savePct: base > 0 && unit < base ? Math.round((1 - unit / base) * 100) : 0 })
    if (out.length >= 4) break
  }
  return out
}
export type PastOrder = { id: string; status: string; items: { name: string; qty: number; line_total_usd: number }[]; total: number; submittedAt: string; deliveryDate: string | null; deliveryNote: string | null; paid: boolean; requested?: string; requestedDate?: string | null; discount?: number; discountNote?: string | null; coupon?: string | null }
export type FormData = {
  stay: { guestFirst: string; unit: string; building: string | null; checkIn: string; checkOut: string | null; checkInLabel: string; checkOutLabel: string; inHouse: boolean; departed: boolean }
  copy: { title: string; intro: string; taxPct: number; brand?: string; accent?: string; footer?: string
    /** The confirmation screen, word for word — see GuestOrdersCfg.confirmTitle. */
    confirmTitle?: string; confirmBody?: string; confirmNext?: string
    /** "Spend $75, save 5%" — highest rung reached wins, off the subtotal before tax. */
    spendRules?: { min_subtotal_usd: number; percent_off: number }[] }
  deadline: { orderBy: string; orderByLabel: string; arrivalDayStillPossible: boolean; nextDelivery: string; hoursBefore: number; leadHours: number; offered?: boolean; taxPct?: number; taxSource?: string; source?: string }
  catalog: FormItem[]
  orders: PastOrder[]
}
export type Delivery = { mode: 'asap' | 'arrival' | 'date'; date: string | null }
export type CopyField = 'title' | 'intro' | 'brand' | 'footer' | 'confirmTitle' | 'confirmBody' | 'confirmNext'
export type EditHooks = {
  onItem: (item: FormItem) => void
  onAdd: (category: string) => void
  onCopy: (field: CopyField) => void
  selectedSku?: string | null
}
/** What the server says a basket costs — the form's totals once a code is in play. */
export type Quote = { subtotal: number; discount: number; spendDiscount: number; spendNote: string | null; coupon: { code: string; label: string | null; amount: number } | null; couponProblem: string | null; tax: number; total: number; problems: string[] }
/** A stand-in order so the studio can show the confirmation screen before anyone has ordered. */
export const SAMPLE_PLACED: PastOrder = { id: 'sample', status: 'submitted', items: [{ name: 'Bottled water', qty: 3, line_total_usd: 36 }, { name: 'Coffee pods', qty: 1, line_total_usd: 12 }], total: 48, submittedAt: new Date().toISOString(), deliveryDate: null, deliveryNote: null, paid: false }

const ICON: Record<string, string> = { Drinks: '💧', Snacks: '🥐', Comfort: '🛁', Baby: '🍼', Services: '✨', Extras: '🧺', Breakfast: '🥐', Wine: '🍷', Beer: '🍺', Coffee: '☕' }
const STATUS: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Being reviewed', cls: 'bg-amber-100 text-amber-900' },
  approved: { label: 'Processing payment', cls: 'bg-amber-100 text-amber-900' },
  paid: { label: 'Confirmed', cls: 'bg-emerald-100 text-emerald-900' },
  awaiting_payment: { label: 'Awaiting payment', cls: 'bg-amber-100 text-amber-900' },
  payment_failed: { label: 'Payment issue — we will reach out', cls: 'bg-rose-100 text-rose-900' },
  pushed: { label: 'On its way', cls: 'bg-emerald-100 text-emerald-900' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-600 text-white' },
  declined: { label: 'Not available', cls: 'bg-neutral-200 text-neutral-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-neutral-200 text-neutral-700' },
}
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(Math.abs(n) % 1 ? 2 : 0)
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }
const PAPER = 'linear-gradient(180deg,#FBF7F0 0%,#F6F1E8 100%)'
const INK = '#1B1A17'
const slug = (s: string) => 'cat-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

export function GuestOrderForm({ data, onSubmit, onQuote, frame, edit, reviewOpen, onReviewChange, showConfirm }: {
  data: FormData
  onSubmit?: (basket: { sku: string; qty: number }[], note: string, delivery: Delivery, coupon: string | null) => Promise<{ ok: boolean; order?: PastOrder; error?: string }>
  /** Prices the basket on the server (with the code, if any). Without it the form does its own arithmetic and codes are off. */
  onQuote?: (basket: { sku: string; qty: number }[], coupon: string | null) => Promise<Quote | null>
  /** Rendered inside the studio's phone frame: bars pin to the frame, not the window. */
  frame?: boolean
  edit?: EditHooks
  reviewOpen?: boolean
  onReviewChange?: (open: boolean) => void
  /** Studio only: force the confirmation screen with a sample order, so its words can be edited. */
  showConfirm?: boolean
}) {
  const [qty, setQty] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [reviewLocal, setReviewLocal] = useState(false)
  const review = reviewOpen !== undefined ? reviewOpen : reviewLocal
  const setReview = (v: boolean) => { setReviewLocal(v); if (onReviewChange) onReviewChange(v) }
  const [busy, setBusy] = useState(false)
  const [placed, setPlaced] = useState<PastOrder | null>(null)
  const [when, setWhen] = useState<'asap' | 'arrival' | 'date'>(data.stay.inHouse ? 'asap' : 'arrival')
  const [whenDate, setWhenDate] = useState('')
  const [submitErr, setSubmitErr] = useState('')
  const [couponInput, setCouponInput] = useState('')
  const [coupon, setCoupon] = useState<string | null>(null)        // the code being applied
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [activeCat, setActiveCat] = useState<string>('')
  const quoteSeq = useRef(0)
  useEffect(() => { setWhen(data.stay.inHouse ? 'asap' : 'arrival') }, [data.stay.inHouse])

  // The page behind the form is ours too: without this the gradient stops where the content stops
  // and the phone shows a white strip under a cream page.
  useEffect(() => {
    if (frame) return
    const html = document.documentElement, body = document.body
    const prev = { h: html.style.background, b: body.style.background }
    html.style.background = '#F6F1E8'; body.style.background = PAPER
    return () => { html.style.background = prev.h; body.style.background = prev.b }
  }, [frame])

  const lines = useMemo(() => data.catalog.filter(c => (qty[c.sku] || 0) > 0).map(c => {
    const n = qty[c.sku]
    const { unit, tier } = unitPriceFor(c, n)
    return { ...c, qty: n, unitPrice: unit, tier, total: Math.round(unit * n * 100) / 100, saved: tier ? Math.round((c.price - unit) * n * 100) / 100 : 0 }
  }), [data, qty])
  const count = lines.reduce((n, l) => n + l.qty, 0)
  const subtotalLocal = lines.reduce((n, l) => n + l.total, 0)
  // SPEND AND SAVE, locally — mirrors spendDiscountFor on the server. When a server quote exists
  // (a code is in play) its numbers win; the local ones keep the basket bar honest in between.
  const rungs = (data.copy.spendRules || []).slice().sort((a, b) => a.min_subtotal_usd - b.min_subtotal_usd)
  const hitRung = rungs.filter(r => subtotalLocal >= r.min_subtotal_usd).pop() || null
  const spendLocal = hitRung ? Math.round(subtotalLocal * hitRung.percent_off) / 100 : 0
  const nextRung = rungs.filter(r => subtotalLocal < r.min_subtotal_usd)[0] || null
  // The server's numbers are used only when they describe THIS basket; the coupon verdict (applied
  // or why not) is shown from the latest answer either way, so the guest is never left guessing.
  const q = quote && quote.subtotal === Math.round(subtotalLocal * 100) / 100 ? quote : null
  const subtotal = subtotalLocal
  const discount = q ? q.discount : spendLocal
  const couponLine = q && q.coupon ? q.coupon : null
  const couponVerdict = quote ? (quote.coupon ? 'ok' : quote.couponProblem || 'We don\u2019t recognise that code.') : null
  const afterDiscount = Math.round((subtotal - discount) * 100) / 100
  const tax = q ? q.tax : Math.round(afterDiscount * data.copy.taxPct) / 100
  const total = q ? q.total : Math.round((afterDiscount + tax) * 100) / 100

  // Re-quote whenever the basket or the code changes and a code is in play (or was). Sequenced so a
  // slow answer never lands on top of a newer basket.
  useEffect(() => {
    if (!onQuote || !coupon) { setQuote(null); return }
    const basket = lines.map(l => ({ sku: l.sku, qty: l.qty }))
    if (!basket.length) { setQuote(null); return }
    const my = ++quoteSeq.current
    setQuoting(true)
    onQuote(basket, coupon).then(r => { if (my === quoteSeq.current) { setQuote(r); setQuoting(false) } }).catch(() => { if (my === quoteSeq.current) setQuoting(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupon, subtotalLocal, count])

  // `d` is in STEPS: +1 adds one multiple (5 pods), −1 removes one; `set` lands on an exact bundle.
  // An item sold in 5s can never hold 3, and nothing ever goes above the max.
  const setExact = (c: FormItem, n: number) => setQty(qs => {
    const step = stepOf(c)
    let v = Math.ceil(Math.max(0, n) / step) * step
    if (v > c.maxQty) v = Math.floor(c.maxQty / step) * step
    const next = { ...qs }; if (v > 0) next[c.sku] = v; else delete next[c.sku]; return next
  })
  const bump = (c: FormItem, d: number) => setExact(c, d === -Infinity ? 0 : (qty[c.sku] || 0) + d * stepOf(c))

  async function place() {
    if (busy || !lines.length || !onSubmit) return
    setBusy(true); setSubmitErr('')
    try {
      const r = await onSubmit(lines.map(l => ({ sku: l.sku, qty: l.qty })), note, { mode: when, date: when === 'date' ? whenDate : null }, couponLine ? couponLine.code : null)
      if (!r.ok) { setSubmitErr(r.error || 'Could not place the order.'); setBusy(false); return }
      setPlaced(r.order || null); setQty({}); setNote(''); setReview(false); setCoupon(null); setCouponInput(''); setQuote(null)
    } catch { setSubmitErr('Network hiccup — please try again.') }
    setBusy(false)
  }

  const { stay, deadline } = data
  const cats = Array.from(new Set(data.catalog.map(c => c.category)))
  const accent = data.copy.accent || '#1F5C46'
  const brand = data.copy.brand || 'Stay Hospitality'
  const fixed = frame ? 'absolute' : 'fixed'
  const editable = !!edit
  const canOrder = !stay.departed && deadline.offered !== false
  const EditTag = ({ field, children }: { field: CopyField; children: React.ReactNode }) => editable
    ? <span onClick={() => edit!.onCopy(field)} className="cursor-text rounded-md outline-dashed outline-1 outline-transparent hover:outline-neutral-400 hover:bg-white/60 transition" title="Edit">{children}</span>
    : <>{children}</>

  // Which category is on screen — for the sticky bar. Cheap: one observer over the section heads.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || cats.length < 2) return
    const heads = Array.from((rootRef.current || document).querySelectorAll<HTMLElement>('[data-cat]'))
    if (!heads.length) return
    const io = new IntersectionObserver(entries => {
      const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (vis[0]) setActiveCat(vis[0].target.getAttribute('data-cat') || '')
    }, { rootMargin: '-96px 0px -70% 0px', threshold: 0 })
    heads.forEach(h => io.observe(h))
    return () => io.disconnect()
  }, [cats.join('|'), placed])
  const jump = (cat: string) => {
    const el = (rootRef.current || document).querySelector<HTMLElement>('#' + slug(cat))
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const shell = (children: React.ReactNode) => (
    <div ref={rootRef} className={(frame ? 'min-h-full relative' : 'min-h-screen')} style={{ background: PAPER, color: INK, fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <div className="max-w-lg mx-auto px-5 pb-40 pt-7">{children}</div>
    </div>
  )

  // THE CONFIRMATION SCREEN. Jon, 2026-09-09: "as they add to their cart and they submit, it'll
  // tell them their total and to expect confirmation of purchase and/or gathering additional
  // information." So the TOTAL leads — it is the number the guest wants to see repeated back — and
  // every word around it comes from settings, including the "what happens next" line, because what
  // happens next differs by whether we charge on approval or ring the guest first.
  const shown = placed || (showConfirm ? SAMPLE_PLACED : null)
  if (shown) return shell(
    <div className="pt-8 animate-slide-up">
      <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500">{brand} · {stay.unit}</div>
      <div className="mt-6 rounded-3xl bg-white shadow-[0_24px_60px_-28px_rgba(27,26,23,.4)] p-7 text-center">
        <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center text-3xl" style={{ background: accent + '18' }}>🎉</div>
        <h1 className="text-[28px] leading-tight mt-4" style={serif}><EditTag field="confirmTitle">{data.copy.confirmTitle || 'Order received'}</EditTag>, {stay.guestFirst}.</h1>
        <p className="text-[15px] text-neutral-600 mt-3 leading-relaxed"><EditTag field="confirmBody">{data.copy.confirmBody || 'Thank you — your order is with our team now.'}</EditTag></p>

        <div className="mt-6 rounded-2xl px-5 py-4" style={{ background: accent + '12' }}>
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold" style={{ color: accent }}>Your total</div>
          <div className="text-[36px] font-semibold tabular-nums leading-none mt-1.5" style={{ color: accent }}>{money(shown.total)}</div>
          {shown.discount ? <div className="text-[12.5px] mt-1.5 font-semibold" style={{ color: accent }}>You saved {money(shown.discount)}{shown.coupon ? ' with code ' + shown.coupon : ''}</div> : null}
        </div>

        <div className="mt-4 text-left rounded-2xl border border-neutral-200/80 divide-y divide-neutral-100">
          {shown.items.map((l, i) => <div key={i} className="flex justify-between px-4 py-2.5 text-[14px]"><span><b>{l.qty}×</b> {l.name}</span><span className="tabular-nums">{money(l.line_total_usd)}</span></div>)}
        </div>

        <div className="mt-4 text-left rounded-2xl bg-neutral-50 border border-neutral-200/70 px-4 py-3.5">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-500">What happens next</div>
          <p className="text-[13.5px] text-neutral-700 mt-1.5 leading-relaxed"><EditTag field="confirmNext">{data.copy.confirmNext || 'You will get a confirmation of purchase shortly.'}</EditTag></p>
          <p className="text-[13px] text-neutral-500 mt-2 leading-relaxed">{when === 'date' && whenDate ? <>You asked for <b className="text-neutral-700">{whenDate}</b> — we confirm the day once the order is approved.</> : <>Delivery: <b className="text-neutral-700">{deadline.nextDelivery}</b>.</>}</p>
        </div>

        <button onClick={() => setPlaced(null)} className="mt-6 text-[14px] font-semibold underline underline-offset-4 text-neutral-700">Order something else</button>
      </div>
    </div>)

  return shell(<>
    <header>
      <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500"><EditTag field="brand">{brand}</EditTag>{stay.building ? ' · ' + stay.building : ''}</div>
      <h1 className="text-[34px] leading-[1.05] mt-3" style={serif}><EditTag field="title">{data.copy.title}</EditTag>, {stay.guestFirst}.</h1>
      <p className="text-[15px] text-neutral-600 mt-3 leading-relaxed"><EditTag field="intro">{data.copy.intro}</EditTag></p>
      <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/80 border border-neutral-200/80 px-3.5 py-1.5 text-[13px] text-neutral-700 shadow-sm">
        <span className="font-semibold text-neutral-900">{stay.unit}</span><span className="text-neutral-300">·</span><span>{stay.checkInLabel}{stay.checkOutLabel ? ' → ' + stay.checkOutLabel : ''}</span>
      </div>
    </header>

    {stay.departed ? (
      <div className="mt-6 rounded-2xl bg-white p-5 text-[14px] text-neutral-700">This stay has ended — thank you for staying with us. We hope to welcome you back soon.</div>
    ) : deadline.offered === false ? (
      <div className="mt-6 rounded-2xl bg-white p-5 text-[14px] text-neutral-700">Pre-arrival extras are not available at this property yet. If you need anything, reply to your booking message and we will do our best.</div>
    ) : (
      <div className={'mt-5 rounded-2xl px-4 py-3.5 text-[13.5px] leading-snug flex gap-3 items-start ' + (deadline.arrivalDayStillPossible ? 'bg-[#E9F4EE] text-[#154734]' : 'bg-[#FFF3DF] text-[#7A4A00]')}>
        <span className="text-lg leading-none mt-0.5">{deadline.arrivalDayStillPossible ? '🕓' : '⏱️'}</span>
        <div>
          {deadline.arrivalDayStillPossible
            ? <><b>Order by {deadline.orderByLabel}</b> and it will be waiting in your suite when you arrive.</>
            : stay.inHouse
              ? <><b>You are in-house.</b> Orders arrive {deadline.nextDelivery}.</>
              : <><b>The arrival-day window has closed.</b> You can still order — items arrive {deadline.nextDelivery}.</>}
        </div>
      </div>
    )}

    {rungs.length && canOrder ? (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {rungs.map(r => <span key={r.min_subtotal_usd} className={'text-[11.5px] font-semibold px-2.5 py-1 rounded-full border ' + (hitRung && hitRung.min_subtotal_usd === r.min_subtotal_usd ? 'text-white' : 'bg-white/70 text-neutral-600 border-neutral-200/80')} style={hitRung && hitRung.min_subtotal_usd === r.min_subtotal_usd ? { background: accent, borderColor: accent } : undefined}>Spend {money(r.min_subtotal_usd)}, save {r.percent_off}%</span>)}
      </div>
    ) : null}

    {data.orders.length ? (
      <section className="mt-7">
        <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-500 mb-2">Your orders</div>
        <div className="space-y-2">
          {data.orders.map(o => {
            const st = STATUS[o.status] || { label: o.status, cls: 'bg-neutral-200 text-neutral-700' }
            return (
              <div key={o.id} className="rounded-2xl bg-white border border-neutral-200/70 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={'text-[11px] font-semibold px-2 py-0.5 rounded-full ' + st.cls}>{st.label}</span>
                  <span className="text-[13px] tabular-nums font-semibold">{money(o.total)}</span>
                </div>
                <div className="text-[13px] text-neutral-700 mt-1.5">{o.items.map(l => l.qty + '× ' + l.name).join(' · ')}</div>
                {o.deliveryDate ? <div className="text-[12px] text-neutral-500 mt-1">Delivery {o.deliveryDate}{o.deliveryNote ? ' · ' + o.deliveryNote : ''}</div> : o.requested === 'date' && o.requestedDate ? <div className="text-[12px] text-neutral-500 mt-1">Requested for {o.requestedDate}</div> : null}
              </div>
            )
          })}
        </div>
      </section>
    ) : null}

    {/* STICKY CATEGORY BAR — only when there is something to jump between. */}
    {canOrder && cats.length > 1 ? (
      <nav className="sticky top-0 z-20 -mx-5 px-5 pt-3 pb-2 mt-6" style={{ background: 'linear-gradient(180deg,#FBF7F0 70%,rgba(251,247,240,0))' }}>
        <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' } as React.CSSProperties}>
          {cats.map(cat => { const on = activeCat === cat; return (
            <button key={cat} onClick={() => jump(cat)} className={'flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-semibold border transition ' + (on ? 'text-white' : 'bg-white text-neutral-700 border-neutral-200/80')} style={on ? { background: INK, borderColor: INK } : undefined}>
              <span className="text-[14px] leading-none">{ICON[cat] || '🧺'}</span>{cat}
            </button>) })}
        </div>
      </nav>
    ) : null}

    {canOrder ? cats.map(cat => (
      <section key={cat} id={slug(cat)} className="mt-6 scroll-mt-16">
        <div className="flex items-center gap-2 mb-3" data-cat={cat}>
          <span className="text-xl">{ICON[cat] || '🧺'}</span>
          <h2 className="text-[22px]" style={serif}>{cat}</h2>
          {editable ? <button onClick={() => edit!.onAdd(cat)} className="ml-auto text-[12px] font-semibold px-2.5 py-1 rounded-full bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-900">+ Add item</button> : null}
        </div>
        <div className="space-y-3">
          {data.catalog.filter(c => c.category === cat).map(c => {
            const n = qty[c.sku] || 0
            const sel = editable && edit!.selectedSku === c.sku
            const bundles = bundlesFor(c)
            const step = stepOf(c)
            const { unit, tier } = unitPriceFor(c, Math.max(step, n))
            const off = unit < c.price
            const onSale = off && !tier            // an offer price, not a bulk break
            const soldOut = step > c.maxQty
            const single = bundles.length === 1 && step === 1
            return (
              <div key={c.sku} onClick={editable ? () => edit!.onItem(c) : undefined}
                className={'relative rounded-3xl bg-white transition-shadow ' + (sel ? 'ring-2 ring-neutral-900' : n ? 'ring-2 shadow-[0_18px_40px_-22px_rgba(15,76,58,.5)]' : 'shadow-[0_10px_30px_-22px_rgba(27,26,23,.45)] ring-1 ring-black/[.06]') + (editable ? ' cursor-pointer hover:ring-2 hover:ring-neutral-400' : '')}
                style={n && !sel ? { ['--tw-ring-color' as any]: accent } : undefined}>
                {editable ? <span className="absolute -top-2 right-3 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-neutral-900 text-white">Edit</span> : null}
                {n ? <span className="absolute -top-2 left-4 text-[11px] font-bold px-2 py-0.5 rounded-full text-white shadow-sm" style={{ background: accent }}>{n} in your order</span> : null}
                <div className="p-4 flex gap-3.5">
                  {c.image
                    ? <img src={c.image} alt="" className="w-[92px] h-[92px] rounded-2xl object-contain flex-shrink-0 bg-[#F2EEE7]" loading="lazy" />
                    : editable ? <div className="w-[92px] h-[92px] rounded-2xl bg-neutral-100 border border-dashed border-neutral-300 flex items-center justify-center text-[11px] text-neutral-400 flex-shrink-0">photo</div>
                    : <div className="w-[92px] h-[92px] rounded-2xl bg-[#F2EEE7] flex items-center justify-center text-3xl flex-shrink-0">{ICON[cat] || '🧺'}</div>}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[16.5px] font-semibold leading-tight">{c.name}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          {c.badge ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full text-white" style={{ background: accent }}>{c.badge}</span> : null}
                          {c.salePrice !== null && c.salePrice !== undefined && c.salePrice < c.price ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#B0342C] text-white">{Math.round((1 - c.salePrice / c.price) * 100)}% off</span> : null}
                          {c.fewLeft !== null && c.fewLeft !== undefined ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900">Only {c.fewLeft} left</span> : null}
                        </div>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <div className={'text-[17px] font-semibold tabular-nums leading-none ' + (onSale ? 'text-[#B0342C]' : '')} style={off && !onSale ? { color: accent } : undefined}>{money(unit)}</div>
                        <div className="text-[11px] text-neutral-400 mt-1">{off ? <span className="line-through mr-1">{money(c.price)}</span> : null}{step > 1 ? 'each · in ' + step + 's' : c.unit ? c.unit : 'each'}</div>
                      </div>
                    </div>
                    {c.description ? <div className="text-[13px] text-neutral-600 mt-1.5 leading-snug">{c.description}</div> : null}
                    {c.size || (c.unit && step > 1) ? <div className="text-[12px] text-neutral-400 mt-1">{[c.size, step > 1 ? c.unit : null].filter(Boolean).join(' · ')}</div> : null}
                  </div>
                </div>

                {/* WAYS TO BUY + the stepper. One row; a tap on a bundle sets that exact quantity. */}
                <div className="px-4 pb-4" onClick={e => { if (editable) e.stopPropagation() }}>
                  {soldOut ? <span className="text-[13px] text-neutral-500">Not available right now</span> : single ? (
                    <div className="flex items-center justify-end gap-2">
                      {n > 0 ? (
                        <div className="inline-flex items-center rounded-full overflow-hidden" style={{ background: INK }}>
                          <button onClick={() => bump(c, -1)} aria-label="Less" className="h-11 w-11 text-white text-xl leading-none active:bg-white/10">−</button>
                          <span className="text-white text-[15px] font-semibold tabular-nums w-8 text-center">{n}</span>
                          <button onClick={() => bump(c, 1)} aria-label="More" disabled={n + step > c.maxQty} className="h-11 w-11 text-white text-xl leading-none active:bg-white/10 disabled:opacity-40">+</button>
                        </div>
                      ) : (
                        <button onClick={() => setExact(c, 1)} className="h-11 px-5 rounded-full text-[14px] font-semibold text-white active:scale-[.98] transition" style={{ background: accent }}>Add · {money(unit)}</button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-1.5 flex-wrap">
                        {bundles.map(b => { const on = n === b.qty; return (
                          <button key={b.qty} onClick={() => setExact(c, on ? 0 : b.qty)}
                            className={'inline-flex flex-col items-start justify-center h-11 px-3 rounded-2xl border text-left transition active:scale-[.98] ' + (on ? 'text-white' : 'bg-[#FBF8F3] text-neutral-800 border-neutral-200/80')}
                            style={on ? { background: accent, borderColor: accent } : undefined}>
                            <span className="text-[13px] font-semibold leading-none tabular-nums">{b.qty} for {money(b.total)}</span>
                            {b.savePct > 0 ? <span className={'text-[10.5px] font-semibold leading-none mt-1 ' + (on ? 'text-white/85' : 'text-[#1F5C46]')}>save {b.savePct}%</span> : bundles.length > 1 ? <span className={'text-[10.5px] leading-none mt-1 ' + (on ? 'text-white/75' : 'text-neutral-400')}>{money(b.unit)} each</span> : null}
                          </button>) })}
                      </div>
                      {n > 0 ? (
                        <div className="mt-2.5 flex items-center justify-between gap-3">
                          <span className="text-[12.5px] text-neutral-500">{n} × {money(unit)} = <b className="text-neutral-800 tabular-nums">{money(Math.round(unit * n * 100) / 100)}</b></span>
                          <div className="inline-flex items-center rounded-full overflow-hidden flex-shrink-0" style={{ background: INK }}>
                            <button onClick={() => bump(c, -1)} aria-label="Less" className="h-10 w-11 text-white text-xl leading-none active:bg-white/10">−</button>
                            <span className="text-white text-[15px] font-semibold tabular-nums w-8 text-center">{n}</span>
                            <button onClick={() => bump(c, 1)} aria-label="More" disabled={n + step > c.maxQty} className="h-10 w-11 text-white text-xl leading-none active:bg-white/10 disabled:opacity-40">+</button>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>
    )) : null}
    {editable && !cats.length ? <button onClick={() => edit!.onAdd('Drinks')} className="mt-8 w-full rounded-2xl border-2 border-dashed border-neutral-300 bg-white/60 py-8 text-[14px] font-semibold text-neutral-600">+ Add your first item</button> : null}
    {editable && cats.length ? <button onClick={() => edit!.onAdd('')} className="mt-6 w-full rounded-2xl border-2 border-dashed border-neutral-300 bg-white/60 py-4 text-[13px] font-semibold text-neutral-600">+ Add an item in a new category</button> : null}

    <p className="mt-10 text-[12px] text-neutral-500 leading-relaxed">Prices in USD{data.copy.taxPct ? ', plus ' + data.copy.taxPct + '% sales tax' : ', tax included'}. <EditTag field="footer">{data.copy.footer || 'Once confirmed, the total is charged to the card on your reservation. Questions? Just reply to your booking message.'}</EditTag></p>

    {count > 0 && canOrder ? (
      <div className={fixed + ' inset-x-0 bottom-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 pointer-events-none'}>
        <div className="max-w-lg mx-auto pointer-events-auto">
          {nextRung && subtotal > 0 && nextRung.min_subtotal_usd - subtotal <= Math.max(25, subtotal) ? (
            <div className="mb-2 mx-auto w-fit max-w-full text-[12px] font-semibold px-3 py-1.5 rounded-full bg-white/95 border border-neutral-200/80 shadow-sm text-neutral-700">Add <b>{money(nextRung.min_subtotal_usd - subtotal)}</b> more for <b>{nextRung.percent_off}% off</b> everything</div>
          ) : null}
          <button onClick={() => setReview(true)} className="w-full h-14 rounded-2xl text-white text-[16px] font-semibold flex items-center justify-between px-5 shadow-[0_18px_40px_-14px_rgba(27,26,23,.6)] active:scale-[.99] transition" style={{ background: INK }}>
            <span className="inline-flex items-center gap-2.5"><span className="inline-flex items-center justify-center min-w-7 h-7 px-2 rounded-full bg-white/15 text-[13px] tabular-nums">{count}</span> Review order</span>
            <span className="tabular-nums">{money(total)}</span>
          </button>
        </div>
      </div>
    ) : null}

    {review ? (
      <div className={fixed + ' inset-0 z-40 flex items-end sm:items-center justify-center'} onClick={() => !busy && setReview(false)}>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
        <div onClick={e => e.stopPropagation()} className={'relative w-full bg-white rounded-t-3xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-slide-up max-h-[92%] overflow-y-auto ' + (frame ? '' : 'sm:max-w-md sm:rounded-3xl')}>
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-500">Your order · {stay.unit}</div>
          <h3 className="text-[24px] mt-1" style={serif}>Ready when you are</h3>
          <div className="mt-4 divide-y divide-neutral-100 rounded-2xl border border-neutral-200/80">
            {lines.length === 0 ? <div className="px-4 py-3 text-[13px] text-neutral-500">Nothing in the basket yet.</div> : null}
            {lines.map(l => (
              <div key={l.sku} className="flex items-center justify-between px-4 py-2.5 text-[14px] gap-3">
                <div className="min-w-0"><b>{l.qty}×</b> {l.name}
                  {/* Show the break they earned — a discount nobody notices is a discount wasted. */}
                  {l.tier ? <span className="block text-[11.5px] font-semibold text-emerald-700">{l.tier.min_qty}+ price · {money(l.unitPrice)} each, saving {money(l.saved)}</span> : null}
                </div>
                <div className="flex items-center gap-2.5 flex-shrink-0">
                  <div className="inline-flex items-center rounded-full border border-neutral-200 overflow-hidden">
                    <button onClick={() => bump(l, -1)} aria-label="Less" className="h-8 w-8 text-neutral-700 text-lg leading-none">−</button>
                    <span className="text-[13px] font-semibold tabular-nums w-6 text-center">{l.qty}</span>
                    <button onClick={() => bump(l, 1)} aria-label="More" disabled={l.qty + stepOf(l) > l.maxQty} className="h-8 w-8 text-neutral-700 text-lg leading-none disabled:opacity-40">+</button>
                  </div>
                  <span className="tabular-nums w-14 text-right">{money(l.total)}</span>
                </div>
              </div>
            ))}
            {(() => { const saved = lines.reduce((n, l) => n + (l.saved || 0), 0); return saved > 0
              ? <div className="flex justify-between px-4 py-2 text-[13px] font-semibold text-emerald-700"><span>Multi-buy saving</span><span className="tabular-nums">−{money(saved)}</span></div> : null })()}
            {(q ? q.spendDiscount > 0 : !!hitRung) ? <div className="flex justify-between gap-3 px-4 py-2 text-[13px] font-semibold text-emerald-700"><span>{q && q.spendNote ? q.spendNote : hitRung ? hitRung.percent_off + '% off orders over ' + money(hitRung.min_subtotal_usd) : 'Spend & save'}</span><span className="tabular-nums">−{money(q ? q.spendDiscount : spendLocal)}</span></div> : null}
            {couponLine ? <div className="flex justify-between gap-3 px-4 py-2 text-[13px] font-semibold text-emerald-700"><span className="min-w-0">Code {couponLine.code}{couponLine.label ? <span className="block text-[11.5px] font-normal text-emerald-700/80">{couponLine.label}</span> : null}</span><span className="tabular-nums whitespace-nowrap">−{money(couponLine.amount)}</span></div> : null}
            {tax ? <div className="flex justify-between px-4 py-2 text-[13px] text-neutral-600"><span>Sales tax ({data.copy.taxPct}%)</span><span className="tabular-nums">{money(tax)}</span></div> : null}
            <div className="flex justify-between px-4 py-3 text-[16px] font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
          </div>

          {/* HAVE A CODE? The verdict comes from the server; the browser only shows it. */}
          {onQuote || editable ? (
            <div className="mt-3">
              {couponLine || (coupon && quote && quote.coupon) ? (
                <div className="flex items-center justify-between rounded-2xl px-4 py-2.5 text-[13px]" style={{ background: accent + '14', color: accent }}>
                  <span className="min-w-0"><b>{(couponLine || quote!.coupon)!.code}</b> applied{quoting ? ' · updating…' : ''}{(couponLine || quote!.coupon)!.label ? <span className="block text-[12px] opacity-80">{(couponLine || quote!.coupon)!.label}</span> : null}</span>
                  <button onClick={() => { setCoupon(null); setCouponInput(''); setQuote(null) }} className="text-[12px] font-semibold underline underline-offset-2">Remove</button>
                </div>
              ) : (
                <div>
                  <div className="flex gap-2">
                    <input value={couponInput} onChange={e => setCouponInput(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32))} onKeyDown={e => { if (e.key === 'Enter' && couponInput.length >= 3) setCoupon(couponInput) }}
                      placeholder="Have a code?" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                      className="flex-1 h-11 rounded-2xl border border-neutral-200 px-4 text-[14px] font-mono tracking-wide uppercase focus:outline-none focus:ring-2 focus:ring-black/10" />
                    <button onClick={() => setCoupon(couponInput)} disabled={couponInput.length < 3 || quoting || !onQuote} className="h-11 px-4 rounded-2xl text-[14px] font-semibold border border-neutral-900 text-neutral-900 disabled:opacity-40">{quoting ? '…' : 'Apply'}</button>
                  </div>
                  {coupon && quoting ? <div className="mt-1.5 text-[12.5px] text-neutral-500">Checking your code…</div> : coupon && couponVerdict && couponVerdict !== 'ok' ? <div className="mt-1.5 text-[12.5px] text-rose-700">{couponVerdict}</div> : null}
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-500 mb-2">When would you like it?</div>
            <div className="grid gap-2">
              {stay.inHouse ? (
                <button type="button" onClick={() => setWhen('asap')} className={'text-left rounded-2xl border px-4 py-3 ' + (when === 'asap' ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200')}>
                  <div className="text-[14px] font-semibold">As soon as possible</div>
                  <div className="text-[12px] text-neutral-500">{deadline.nextDelivery}</div>
                </button>
              ) : (
                <button type="button" onClick={() => setWhen('arrival')} className={'text-left rounded-2xl border px-4 py-3 ' + (when === 'arrival' ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200')}>
                  <div className="text-[14px] font-semibold">On arrival day · {stay.checkInLabel}</div>
                  <div className="text-[12px] text-neutral-500">{deadline.arrivalDayStillPossible ? 'Waiting in the suite when you walk in' : 'Arrival-day window has closed — we deliver ' + deadline.nextDelivery}</div>
                </button>
              )}
              <button type="button" onClick={() => setWhen('date')} className={'text-left rounded-2xl border px-4 py-3 ' + (when === 'date' ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200')}>
                <div className="text-[14px] font-semibold">Pick a day during my stay</div>
                {when === 'date' ? (
                  <input type="date" value={whenDate} min={stay.inHouse ? new Date().toISOString().slice(0, 10) : stay.checkIn} max={stay.checkOut ? new Date(new Date(stay.checkOut + 'T12:00:00Z').getTime() - 86_400_000).toISOString().slice(0, 10) : undefined} onChange={e => setWhenDate(e.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-[15px]" />
                ) : <div className="text-[12px] text-neutral-500">Any day before checkout</div>}
              </button>
            </div>
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 600))} placeholder="Anything we should know? Allergies, brand preferences, where to leave it…" rows={3} className="mt-3 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-black/10" />
          <div className="mt-3 text-[12.5px] text-neutral-500 leading-snug">We confirm the exact day once the order is approved (at least {deadline.leadHours}h after payment). The card on your reservation is charged only when we confirm — nothing is charged now.</div>
          {submitErr ? <div className="mt-3 text-[13px] text-rose-700 bg-rose-50 rounded-xl px-3 py-2">{submitErr}</div> : null}
          <button onClick={place} disabled={busy || quoting || !lines.length || (when === 'date' && !whenDate) || !onSubmit} className="mt-4 w-full h-14 rounded-2xl text-white text-[16px] font-semibold disabled:opacity-60 active:scale-[.99] transition" style={{ background: accent }}>{busy ? 'Placing your order…' : !onSubmit ? 'Place order (preview)' : 'Place order · ' + money(total)}</button>
          <button onClick={() => setReview(false)} disabled={busy} className="mt-2 w-full h-11 rounded-2xl text-[14px] font-semibold text-neutral-600">Keep browsing</button>
        </div>
      </div>
    ) : null}
  </>)
}
