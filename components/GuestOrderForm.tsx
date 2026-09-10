'use client'
// THE GUEST ORDER FORM — one component, two homes: the public page (/order/<code>) renders it for
// real, and the Design Studio (/guest-orders/design) renders the very same thing inside a phone
// frame with edit affordances on every card. Whatever the studio shows is exactly what the guest
// gets — there is no second copy to drift (Jon, 2026-08-24: "from the form add and edit design,
// update feature, add photos, review the sheet").
//
// Not the app's indigo ops skin on purpose: the guest sees Stay Hospitality, not Lighthouse.
import { useEffect, useMemo, useState } from 'react'

export type PriceTier = { min_qty: number; unit_price_usd: number }
export type FormItem = { id?: string; sku: string; name: string; description: string | null; price: number; unit: string | null; category: string; maxQty: number; image: string | null; fewLeft?: number | null
  /** How much is in one — "500 mL". Sits with the pack label under the name. */
  size?: string | null
  /** Volume breaks on this item — "3+ $2.50 each". Best qualifying break wins, priced server-side. */
  tiers?: PriceTier[] | null }

/** The unit price at this quantity. Mirrors priceForQty on the server; the server still decides. */
export function unitPriceFor(c: FormItem, qty: number): { unit: number; tier: PriceTier | null } {
  let hit: PriceTier | null = null
  for (const t of (c.tiers || [])) if (qty >= t.min_qty) hit = t
  return { unit: hit ? hit.unit_price_usd : c.price, tier: hit }
}
/** The next break a guest has not reached yet — the nudge that turns 2 into 3. */
export function nextTier(c: FormItem, qty: number): PriceTier | null {
  const up = (c.tiers || []).filter(t => qty < t.min_qty).sort((a, b) => a.min_qty - b.min_qty)
  return up.length ? up[0] : null
}
export type PastOrder = { id: string; status: string; items: { name: string; qty: number; line_total_usd: number }[]; total: number; submittedAt: string; deliveryDate: string | null; deliveryNote: string | null; paid: boolean; requested?: string; requestedDate?: string | null }
export type FormData = {
  stay: { guestFirst: string; unit: string; building: string | null; checkIn: string; checkOut: string | null; checkInLabel: string; checkOutLabel: string; inHouse: boolean; departed: boolean }
  copy: { title: string; intro: string; taxPct: number; brand?: string; accent?: string; footer?: string
    /** The confirmation screen, word for word — see GuestOrdersCfg.confirmTitle. */
    confirmTitle?: string; confirmBody?: string; confirmNext?: string }
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
/** A stand-in order so the studio can show the confirmation screen before anyone has ordered. */
export const SAMPLE_PLACED: PastOrder = { id: 'sample', status: 'submitted', items: [{ name: 'Bottled water', qty: 3, line_total_usd: 36 }, { name: 'Coffee pods', qty: 1, line_total_usd: 12 }], total: 48, submittedAt: new Date().toISOString(), deliveryDate: null, deliveryNote: null, paid: false }

const ICON: Record<string, string> = { Drinks: '💧', Snacks: '🥐', Comfort: '🛁', Baby: '🍼', Services: '✨', Extras: '🧺' }
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
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0)
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }

export function GuestOrderForm({ data, onSubmit, frame, edit, reviewOpen, onReviewChange, showConfirm }: {
  data: FormData
  onSubmit?: (basket: { sku: string; qty: number }[], note: string, delivery: Delivery) => Promise<{ ok: boolean; order?: PastOrder; error?: string }>
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
  useEffect(() => { setWhen(data.stay.inHouse ? 'asap' : 'arrival') }, [data.stay.inHouse])

  const lines = useMemo(() => data.catalog.filter(c => (qty[c.sku] || 0) > 0).map(c => {
    const n = qty[c.sku]
    const { unit, tier } = unitPriceFor(c, n)
    return { ...c, qty: n, unitPrice: unit, tier, total: Math.round(unit * n * 100) / 100, saved: tier ? Math.round((c.price - unit) * n * 100) / 100 : 0 }
  }), [data, qty])
  const count = lines.reduce((n, l) => n + l.qty, 0)
  const subtotal = lines.reduce((n, l) => n + l.total, 0)
  const tax = Math.round(subtotal * data.copy.taxPct) / 100
  const total = subtotal + tax
  const bump = (sku: string, d: number, max: number) => setQty(q => { const n = Math.min(Math.max((q[sku] || 0) + d, 0), max); const next = { ...q }; if (n) next[sku] = n; else delete next[sku]; return next })

  async function place() {
    if (busy || !lines.length || !onSubmit) return
    setBusy(true); setSubmitErr('')
    try {
      const r = await onSubmit(lines.map(l => ({ sku: l.sku, qty: l.qty })), note, { mode: when, date: when === 'date' ? whenDate : null })
      if (!r.ok) { setSubmitErr(r.error || 'Could not place the order.'); setBusy(false); return }
      setPlaced(r.order || null); setQty({}); setNote(''); setReview(false)
    } catch { setSubmitErr('Network hiccup — please try again.') }
    setBusy(false)
  }

  const { stay, deadline } = data
  const cats = Array.from(new Set(data.catalog.map(c => c.category)))
  const accent = data.copy.accent || '#1F5C46'
  const brand = data.copy.brand || 'Stay Hospitality'
  const fixed = frame ? 'absolute' : 'fixed'
  const editable = !!edit
  const EditTag = ({ field, children }: { field: CopyField; children: React.ReactNode }) => editable
    ? <span onClick={() => edit!.onCopy(field)} className="cursor-text rounded-md outline-dashed outline-1 outline-transparent hover:outline-neutral-400 hover:bg-white/60 transition" title="Edit">{children}</span>
    : <>{children}</>

  const shell = (children: React.ReactNode) => (
    <div className={(frame ? 'min-h-full relative' : 'min-h-screen') + ''} style={{ background: 'linear-gradient(180deg,#FBF7F0 0%,#F6F1E8 100%)', color: '#1B1A17', fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <div className="max-w-lg mx-auto px-5 pb-40 pt-8">{children}</div>
    </div>
  )

  // THE CONFIRMATION SCREEN. Jon, 2026-09-09: "as they add to their cart and they submit, it'll
  // tell them their total and to expect confirmation of purchase and/or gathering additional
  // information." So the TOTAL leads — it is the number the guest wants to see repeated back — and
  // every word around it comes from settings, including the "what happens next" line, because what
  // happens next differs by whether we charge on approval or ring the guest first.
  const shown = placed || (showConfirm ? SAMPLE_PLACED : null)
  if (shown) return shell(
    <div className="pt-10 animate-slide-up">
      <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500">{brand} · {stay.unit}</div>
      <div className="mt-6 rounded-3xl bg-white shadow-[0_20px_50px_-24px_rgba(27,26,23,.35)] p-7 text-center">
        <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center text-3xl" style={{ background: '#E9F4EE' }}>🎉</div>
        <h1 className="text-[28px] leading-tight mt-4" style={serif}><EditTag field="confirmTitle">{data.copy.confirmTitle || 'Order received'}</EditTag>, {stay.guestFirst}.</h1>
        <p className="text-[15px] text-neutral-600 mt-3 leading-relaxed"><EditTag field="confirmBody">{data.copy.confirmBody || 'Thank you — your order is with our team now.'}</EditTag></p>

        <div className="mt-6 rounded-2xl px-5 py-4" style={{ background: accent + '12' }}>
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold" style={{ color: accent }}>Your total</div>
          <div className="text-[34px] font-semibold tabular-nums leading-none mt-1.5" style={{ color: accent }}>{money(shown.total)}</div>
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
      <div className={'mt-6 rounded-2xl px-4 py-3.5 text-[13.5px] leading-snug flex gap-3 items-start ' + (deadline.arrivalDayStillPossible ? 'bg-[#E9F4EE] text-[#154734]' : 'bg-[#FFF3DF] text-[#7A4A00]')}>
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

    {!stay.departed && deadline.offered !== false ? cats.map(cat => (
      <section key={cat} className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">{ICON[cat] || '🧺'}</span>
          <h2 className="text-[20px]" style={serif}>{cat}</h2>
          {editable ? <button onClick={() => edit!.onAdd(cat)} className="ml-auto text-[12px] font-semibold px-2.5 py-1 rounded-full bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-900">+ Add item</button> : null}
        </div>
        <div className="space-y-3">
          {data.catalog.filter(c => c.category === cat).map(c => {
            const n = qty[c.sku] || 0
            const sel = editable && edit!.selectedSku === c.sku
            return (
              <div key={c.sku} onClick={editable ? () => edit!.onItem(c) : undefined} className={'relative rounded-2xl bg-white p-4 transition-shadow ' + (sel ? 'ring-2 ring-neutral-900' : n ? 'shadow-[0_12px_30px_-16px_rgba(15,76,58,.45)] ring-1 ring-black/10' : 'shadow-[0_8px_24px_-18px_rgba(27,26,23,.35)] border border-neutral-200/60') + (editable ? ' cursor-pointer hover:ring-2 hover:ring-neutral-400' : '')}>
                {editable ? <span className="absolute -top-2 right-3 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-neutral-900 text-white">Edit</span> : null}
                <div className="flex gap-3">
                  {c.image ? <img src={c.image} alt="" className="w-[84px] h-[84px] rounded-2xl object-cover flex-shrink-0 bg-neutral-100" /> : editable ? <div className="w-[84px] h-[84px] rounded-2xl bg-neutral-100 border border-dashed border-neutral-300 flex items-center justify-center text-[11px] text-neutral-400 flex-shrink-0">photo</div> : null}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-[16px] font-semibold leading-tight">{c.name}</div>
                      {(() => { const { unit, tier } = unitPriceFor(c, Math.max(1, n)); return (
                        <div className="text-right whitespace-nowrap">
                          <div className="text-[15px] font-semibold tabular-nums">{money(unit)}{tier ? <span className="text-[12px] font-normal text-neutral-400 line-through ml-1.5">{money(c.price)}</span> : null}</div>
                        </div>
                      )})()}
                    </div>
                    {c.description ? <div className="text-[13px] text-neutral-600 mt-1 leading-snug">{c.description}</div> : null}
                    <div className="flex items-center gap-2 mt-1">
                      {c.size || c.unit ? <div className="text-[12px] text-neutral-400">{[c.size, c.unit].filter(Boolean).join(' · ')}</div> : null}
                      {c.fewLeft !== null && c.fewLeft !== undefined ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900">Only {c.fewLeft} left</span> : null}
                      {/* The multi-buy nudge: what the next break costs, and what it saves. */}
                      {(() => { const nx = nextTier(c, n); if (!nx || c.price <= 0) return null
                        const off = Math.round(((c.price - nx.unit_price_usd) / c.price) * 100)
                        return <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: accent + '1a', color: accent }}>{nx.min_qty}+ {money(nx.unit_price_usd)} each{off > 0 ? ' · save ' + off + '%' : ''}</span>
                      })()}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-end" onClick={e => { if (editable) e.stopPropagation() }}>
                  {n === 0 ? (
                    <button onClick={() => bump(c.sku, 1, c.maxQty)} className="h-10 px-5 rounded-full text-[14px] font-semibold text-white active:scale-[.98] transition" style={{ background: accent }}>Add</button>
                  ) : (
                    <div className="inline-flex items-center rounded-full overflow-hidden" style={{ background: accent }}>
                      <button onClick={() => bump(c.sku, -1, c.maxQty)} aria-label="Less" className="h-10 w-11 text-white text-xl leading-none active:bg-black/10">−</button>
                      <span className="text-white text-[15px] font-semibold tabular-nums w-8 text-center">{n}</span>
                      <button onClick={() => bump(c.sku, 1, c.maxQty)} aria-label="More" disabled={n >= c.maxQty} className="h-10 w-11 text-white text-xl leading-none active:bg-black/10 disabled:opacity-40">+</button>
                    </div>
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

    {count > 0 && !stay.departed && deadline.offered !== false ? (
      <div className={fixed + ' inset-x-0 bottom-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 pointer-events-none'}>
        <div className="max-w-lg mx-auto pointer-events-auto">
          <button onClick={() => setReview(true)} className="w-full h-14 rounded-2xl text-white text-[16px] font-semibold flex items-center justify-between px-5 shadow-[0_18px_40px_-14px_rgba(15,76,58,.6)] active:scale-[.99] transition" style={{ background: '#1B1A17' }}>
            <span className="inline-flex items-center gap-2"><span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/15 text-[13px] tabular-nums">{count}</span> Review order</span>
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
              <div key={l.sku} className="flex items-center justify-between px-4 py-2.5 text-[14px]">
                <div className="min-w-0"><b>{l.qty}×</b> {l.name}
                  {/* Show the break they earned — a discount nobody notices is a discount wasted. */}
                  {l.tier ? <span className="block text-[11.5px] font-semibold text-emerald-700">{l.tier.min_qty}+ price · {money(l.unitPrice)} each, saving {money(l.saved)}</span> : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{money(l.total)}</span>
                  <button onClick={() => bump(l.sku, -l.qty, l.maxQty)} className="text-neutral-400 hover:text-rose-600 text-lg leading-none" aria-label="Remove">×</button>
                </div>
              </div>
            ))}
            {(() => { const saved = lines.reduce((n, l) => n + (l.saved || 0), 0); return saved > 0
              ? <div className="flex justify-between px-4 py-2 text-[13px] font-semibold text-emerald-700"><span>Multi-buy saving</span><span className="tabular-nums">−{money(saved)}</span></div> : null })()}
            {tax ? <div className="flex justify-between px-4 py-2 text-[13px] text-neutral-600"><span>Sales tax ({data.copy.taxPct}%)</span><span className="tabular-nums">{money(tax)}</span></div> : null}
            <div className="flex justify-between px-4 py-3 text-[16px] font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
          </div>
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
          <button onClick={place} disabled={busy || !lines.length || (when === 'date' && !whenDate) || !onSubmit} className="mt-4 w-full h-14 rounded-2xl text-white text-[16px] font-semibold disabled:opacity-60 active:scale-[.99] transition" style={{ background: accent }}>{busy ? 'Placing your order…' : !onSubmit ? 'Place order (preview)' : 'Place order · ' + money(total)}</button>
          <button onClick={() => setReview(false)} disabled={busy} className="mt-2 w-full h-11 rounded-2xl text-[14px] font-semibold text-neutral-600">Keep browsing</button>
        </div>
      </div>
    ) : null}
  </>)
}
