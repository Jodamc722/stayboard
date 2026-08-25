'use client'
// THE GUEST ORDER FORM — public, one link per reservation, phone-first. The form itself lives in
// components/GuestOrderForm.tsx so the Design Studio renders the identical thing.
import { useCallback, useEffect, useState } from 'react'
import { GuestOrderForm, type FormData, type Delivery } from '@/components/GuestOrderForm'

export default function GuestOrderPage({ params }: { params: { code: string } }) {
  const code = String(params.code || '')
  const [data, setData] = useState<FormData | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/public/guest-order?code=' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'This link is not valid.'); return }
      setData(j)
    } catch { setErr('We could not load your order page — please try again in a moment.') }
  }, [code])
  useEffect(() => { load() }, [load])

  async function submit(basket: { sku: string; qty: number }[], note: string, delivery: Delivery) {
    const r = await fetch('/api/public/guest-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, basket, note, delivery }) })
    const j = await r.json()
    if (!r.ok || !j.ok) return { ok: false, error: j.error || 'Could not place the order.' }
    load()
    return { ok: true, order: j.order }
  }

  const bg = { background: 'linear-gradient(180deg,#FBF7F0 0%,#F6F1E8 100%)', color: '#1B1A17', fontFamily: 'var(--font-inter), system-ui, sans-serif' }
  const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif" }
  if (err) return (
    <div className="min-h-screen" style={bg}><div className="max-w-lg mx-auto px-5 pt-24 text-center">
      <div className="text-[11px] uppercase tracking-[0.22em] font-semibold text-neutral-500">Stay Hospitality</div>
      <h1 className="text-2xl mt-3" style={serif}>{err}</h1>
      <p className="text-sm text-neutral-600 mt-2">If you received this link from us, reply to your booking message and we will sort it out.</p>
    </div></div>
  )
  if (!data) return <div className="min-h-screen" style={bg}><div className="pt-24 text-center text-sm text-neutral-500">Setting the table…</div></div>
  return <GuestOrderForm data={data} onSubmit={submit} />
}
