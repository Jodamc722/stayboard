'use client'
// THE GUEST ORDER FORM — the vending machine (Jon, 2026-08-24: "super user friendly… super
// visually amazing"). Public, one link per reservation, phone-first. Everything money-related is
// priced on the server; this page only collects skus + quantities and a note.
//
// Not the app's indigo ops skin on purpose: the guest sees Stay Hospitality, not Lighthouse.
import { useCallback, useEffect, useMemo, useState } from 'react'

type Item = { sku: string; name: string; description: string | null; price: number; unit: string | null; category: string; maxQty: number; image: string | null }
type PastOrder = { id: string; status: string; items: { name: string; qty: number; line_total_usd: number }[]; total: number; submittedAt: string; deliveryDate: string | null; deliveryNote: string | null; paid: boolean }
type Data = {
  stay: { guestFirst: string; unit: string; building: string | null; checkIn: string; checkOut: string | null; checkInLabel: string; checkOutLabel: string; inHouse: boolean; departed: boolean }
  copy: { title: string; intro: string; taxPct: number; brand?: string; accent?: string; footer?: string }
  deadline: { orderBy: string; orderByLabel: string; arrivalDayStillPossible: boolean; nextDelivery: string; hoursBefore: number; leadHours: number; offered?: boolean }
  catalog: Item[]
  orders: PastOrder[]
}

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

export default function GuestOrderPage({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [note, setNote] = useState('')
  const [review, setReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [placed, setPlaced] = useState<PastOrder | null>(null)
  const [submitErr, setSubmitErr] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/public/guest-order?code=' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'This link is not valid.'); return }
      setData(j)
    } catch { setErr('We could not load your order page — please try again in a moment.') }
  }, [code])
  useEffect(() => { load() }, [load])

  const lines = useMemo(() => {
    if (!data) return []
    return data.catalog.filter(c => (qty[c.sku] || 0) > 0).map(c => ({ ...c, qty: qty[c.sku], total: c.price * qty[c.sku] }))
  }, [data, qty])
  const count = lines.reduce((n, l) => n + l.qty, 0)
  const subtotal = lines.reduce((n, l) => n + l.total, 0)
  const tax = data ? Math.round(subtotal * data.copy.taxPct) / 100 : 0
  const total = subtotal + tax

  const bump = (sku: string, d: number, max: number) => setQty(q => { const n = Math.min(Math.max((q[sku] || 0) + d, 0), max); const next = { ...q }; if (n) next[sku] = n; else delete next[sku]; return next })

  async function place() {
    if (busy || !lines.length) return
    setBusy(true); setSubmitErr('')
    try {
      const r = await fetch('/api/public/guest-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, basket: lines.map(l => ({ sku: l.sku, qty: l.qty })), note }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setSubmitErr(j.error || 'Could not place the order.'); setBusy(false); return }
      setPlaced(j.order); setQty({}); setNote(''); setReview(false)
      load()
    } catch { setSubmitErr('Network hiccup — please try again.') }
    setBusy(false)
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg,#FBF7F0 0%,#F6F1E8 100%)', color: '#1B1A17', fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <div className="max-w-lg mx-auto px-5 pb-40 pt-8">{children}</div>
    </div>
  )
  const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }

  if (err) return shell(
    <div className="pt-16 text-center">
      <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500">Stay Hospitality</div>
      <h1 className="text-2xl mt-3" style={serif}>{err}</h1>
      <p className="text-sm text-neutral-600 mt-2">If you received this link from us, reply to your booking message and we will sort it out.</p>
    </div>)
  if (!data) return shell(<div className="pt-24 text-center text-sm text-neutral-500">Setting the table…</div>)

  const { stay, deadline } = data
  const cats = Array.from(new Set(data.catalog.map(c => c.category)))
  const accent = data.copy.accent || '#1F5C46'
  const brand = data.copy.brand || 'Stay Hospitality'

  if (placed) return shell(
    <div className="pt-10 animate-slide-up">
      <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500">{brand} · {stay.unit}</div>
      <div className="mt-6 rounded-3xl bg-white shadow-[0_20px_50px_-24px_rgba(27,26,23,.35)] p-7 text-center">
        <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center text-3xl" style={{ background: '#E9F4EE' }}>🎉</div>
        <h1 className="text-[28px] leading-tight mt-4" style={serif}>Order received, {stay.guestFirst}.</h1>
        <p className="text-[15px] text-neutral-600 mt-3 leading-relaxed">We will confirm it shortly and charge the card on your reservation. Your items arrive <b className="text-neutral-900">{deadline.nextDelivery}</b>.</p>
        <div className="mt-5 text-left rounded-2xl border border-neutral-200/80 divide-y divide-neutral-100">
          {placed.items.map((l, i) => <div key={i} className="flex justify-between px-4 py-2.5 text-[14px]"><span><b>{l.qty}×</b> {l.name}</span><span className="tabular-nums">{money(l.line_total_usd)}</span></div>)}
          <div className="flex justify-between px-4 py-3 text-[15px] font-semibold"><span>Total</span><span className="tabular-nums">{money(placed.total)}</span></div>
        </div>
        <button onClick={() => setPlaced(null)} className="mt-6 text-[14px] font-semibold underline underline-offset-4 text-neutral-700">Order something else</button>
      </div>
    </div>)

  return shell(<>
    <header>
      <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500">{brand}{stay.building ? ' · ' + stay.building : ''}</div>
      <h1 className="text-[34px] leading-[1.05] mt-3" style={serif}>{data.copy.title}, {stay.guestFirst}.</h1>
      <p className="text-[15px] text-neutral-600 mt-3 leading-relaxed">{data.copy.intro}</p>
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
                {o.deliveryDate ? <div className="text-[12px] text-neutral-500 mt-1">Delivery {o.deliveryDate}{o.deliveryNote ? ' · ' + o.deliveryNote : ''}</div> : null}
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
        </div>
        <div className="space-y-3">
          {data.catalog.filter(c => c.category === cat).map(c => {
            const n = qty[c.sku] || 0
            return (
              <div key={c.sku} className={'rounded-2xl bg-white p-4 transition-shadow ' + (n ? 'shadow-[0_12px_30px_-16px_rgba(15,76,58,.45)] ring-1 ring-black/10' : 'shadow-[0_8px_24px_-18px_rgba(27,26,23,.35)] border border-neutral-200/60')}>
                <div className="flex gap-3">
                  {c.image ? <img src={c.image} alt="" className="w-[84px] h-[84px] rounded-2xl object-cover flex-shrink-0 bg-neutral-100" /> : null}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="text-[16px] font-semibold leading-tight">{c.name}</div>
                      <div className="text-[15px] font-semibold tabular-nums whitespace-nowrap">{money(c.price)}</div>
                    </div>
                    {c.description ? <div className="text-[13px] text-neutral-600 mt-1 leading-snug">{c.description}</div> : null}
                    {c.unit ? <div className="text-[12px] text-neutral-400 mt-1">{c.unit}</div> : null}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-end">
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

    <p className="mt-10 text-[12px] text-neutral-500 leading-relaxed">Prices in USD{data.copy.taxPct ? ', plus ' + data.copy.taxPct + '% sales tax' : ', tax included'}. {data.copy.footer || 'Once confirmed, the total is charged to the card on your reservation. Questions? Just reply to your booking message.'}</p>

    {count > 0 && !stay.departed && deadline.offered !== false ? (
      <div className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 pointer-events-none">
        <div className="max-w-lg mx-auto pointer-events-auto">
          <button onClick={() => setReview(true)} className="w-full h-14 rounded-2xl text-white text-[16px] font-semibold flex items-center justify-between px-5 shadow-[0_18px_40px_-14px_rgba(15,76,58,.6)] active:scale-[.99] transition" style={{ background: '#1B1A17' }}>
            <span className="inline-flex items-center gap-2"><span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/15 text-[13px] tabular-nums">{count}</span> Review order</span>
            <span className="tabular-nums">{money(total)}</span>
          </button>
        </div>
      </div>
    ) : null}

    {review ? (
      <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" onClick={() => !busy && setReview(false)}>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
        <div onClick={e => e.stopPropagation()} className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] animate-slide-up max-h-[92vh] overflow-y-auto">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-500">Your order · {stay.unit}</div>
          <h3 className="text-[24px] mt-1" style={serif}>Ready when you are</h3>
          <div className="mt-4 divide-y divide-neutral-100 rounded-2xl border border-neutral-200/80">
            {lines.map(l => (
              <div key={l.sku} className="flex items-center justify-between px-4 py-2.5 text-[14px]">
                <div className="min-w-0"><b>{l.qty}×</b> {l.name}</div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{money(l.total)}</span>
                  <button onClick={() => bump(l.sku, -l.qty, l.maxQty)} className="text-neutral-400 hover:text-rose-600 text-lg leading-none" aria-label="Remove">×</button>
                </div>
              </div>
            ))}
            {tax ? <div className="flex justify-between px-4 py-2 text-[13px] text-neutral-600"><span>Sales tax ({data.copy.taxPct}%)</span><span className="tabular-nums">{money(tax)}</span></div> : null}
            <div className="flex justify-between px-4 py-3 text-[16px] font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
          </div>
          <textarea value={note} onChange={e => setNote(e.target.value.slice(0, 600))} placeholder="Anything we should know? Allergies, brand preferences, where to leave it…" rows={3} className="mt-4 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-black/10" />
          <div className="mt-3 text-[12.5px] text-neutral-500 leading-snug">Delivery {deadline.nextDelivery}. We charge the card on your reservation once the order is confirmed — nothing is charged now.</div>
          {submitErr ? <div className="mt-3 text-[13px] text-rose-700 bg-rose-50 rounded-xl px-3 py-2">{submitErr}</div> : null}
          <button onClick={place} disabled={busy || !lines.length} className="mt-4 w-full h-14 rounded-2xl text-white text-[16px] font-semibold disabled:opacity-60 active:scale-[.99] transition" style={{ background: accent }}>{busy ? 'Placing your order…' : 'Place order · ' + money(total)}</button>
          <button onClick={() => setReview(false)} disabled={busy} className="mt-2 w-full h-11 rounded-2xl text-[14px] font-semibold text-neutral-600">Keep browsing</button>
        </div>
      </div>
    ) : null}
  </>)
}
