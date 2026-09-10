'use client'
// THE GUEST ORDER FORM — public, one link per reservation, phone-first. The form itself lives in
// components/GuestOrderForm.tsx so the Design Studio renders the identical thing.
//
// 2026-09-10: a cold function occasionally hung for the full 30 s and the guest saw "Setting the
// table…" until it gave up. Now the fetch has an 9 s budget and is tried three times, the page
// shows the shape of the form while it waits, and the basket is priced on the server (with the
// guest's code, if any) through the same route.
import { useCallback, useEffect, useState } from 'react'
import { GuestOrderForm, type FormData, type Delivery, type Quote } from '@/components/GuestOrderForm'

const PAPER = 'linear-gradient(180deg,#FBF7F0 0%,#F6F1E8 100%)'
const bg: React.CSSProperties = { background: PAPER, color: '#1B1A17', fontFamily: 'var(--font-inter), system-ui, sans-serif' }
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif" }

async function fetchWithBudget(input: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try { return await fetch(input, { ...init, signal: ctl.signal }) } finally { clearTimeout(t) }
}

function Skeleton() {
  const bar = (w: string, h = 'h-4') => <div className={'rounded-full bg-black/[.06] ' + h} style={{ width: w }} />
  return (
    <div className="max-w-lg mx-auto px-5 pt-7 animate-pulse">
      <div className="flex justify-between">{bar('40%', 'h-3')}{bar('30%', 'h-6')}</div>
      <div className="mt-5">{bar('85%', 'h-8')}</div>
      <div className="mt-3 space-y-2">{bar('100%')}{bar('70%')}</div>
      <div className="mt-5 rounded-2xl bg-black/[.05] h-16" />
      <div className="mt-8 flex gap-2">{bar('90px', 'h-9')}{bar('90px', 'h-9')}{bar('90px', 'h-9')}</div>
      {[0, 1, 2].map(i => (
        <div key={i} className="mt-3 rounded-3xl bg-white/80 p-4 flex gap-3.5">
          <div className="w-[92px] h-[92px] rounded-2xl bg-black/[.05]" />
          <div className="flex-1 space-y-2 pt-1">{bar('55%', 'h-5')}{bar('80%', 'h-3')}<div className="flex gap-2 pt-2">{bar('72px', 'h-10')}{bar('72px', 'h-10')}</div></div>
        </div>
      ))}
    </div>
  )
}

export default function GuestOrderPage({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const [data, setData] = useState<FormData | null>(null)
  const [err, setErr] = useState('')
  const [slow, setSlow] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    let last = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt) setSlow(true)
        const r = await fetchWithBudget('/api/public/guest-order?code=' + encodeURIComponent(code), { cache: 'no-store' }, 9000)
        const j = await r.json()
        if (r.status === 404 || (j && j.error && r.status < 500)) { setErr(j.error || 'This link is not valid.'); return }
        if (!r.ok || !j.ok) { last = j?.error || 'Could not load'; continue }
        setData(j); setSlow(false); return
      } catch { last = 'timeout' }
    }
    setErr(last === 'timeout' ? 'Taking longer than usual — please pull to refresh in a moment.' : 'We could not load your order page — please try again in a moment.')
  }, [code])
  useEffect(() => { load() }, [load])

  async function submit(basket: { sku: string; qty: number }[], note: string, delivery: Delivery, coupon: string | null) {
    const r = await fetch('/api/public/guest-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, basket, note, delivery, coupon }) })
    const j = await r.json()
    if (!r.ok || !j.ok) return { ok: false, error: j.error || 'Could not place the order.' }
    load()
    return { ok: true, order: j.order }
  }
  async function quote(basket: { sku: string; qty: number }[], coupon: string | null): Promise<Quote | null> {
    try {
      const r = await fetchWithBudget('/api/public/guest-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, basket, coupon, quote: true }) }, 9000)
      const j = await r.json()
      return r.ok && j.ok && j.quote ? j.quote : null
    } catch { return null }
  }

  if (err) return (
    <div className="min-h-screen" style={bg}><div className="max-w-lg mx-auto px-5 pt-24 text-center">
      <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500">Stay Hospitality</div>
      <h1 className="text-2xl mt-3" style={serif}>{err}</h1>
      <p className="text-sm text-neutral-600 mt-2">If you received this link from us, reply to your booking message and we will sort it out.</p>
      <button onClick={() => { setData(null); load() }} className="mt-6 h-11 px-5 rounded-full bg-neutral-900 text-white text-[14px] font-semibold">Try again</button>
    </div></div>
  )
  if (!data) return (
    <div className="min-h-screen" style={bg}>
      <Skeleton />
      <div className="text-center text-[12.5px] text-neutral-500 mt-6">{slow ? 'Still setting the table — one moment…' : 'Setting the table…'}</div>
    </div>
  )
  return <GuestOrderForm data={data} onSubmit={submit} onQuote={quote} />
}
