'use client'
// The two buttons on /approve/order/<token>. Approve charges the guest, so it is explicit.
import { useState } from 'react'

export function OrderDecide({ token, total }: { token: string; total: string }) {
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [done, setDone] = useState<{ ok: boolean; status: string | null; text: string } | null>(null)

  async function go(kind: 'approve' | 'decline') {
    if (busy) return
    setBusy(kind)
    try {
      const r = await fetch('/api/public/guest-order-decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, go: kind }) })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        const st = String(j.status || '')
        setDone({ ok: false, status: st || null, text: j.error || j.chargeError || 'Something went wrong.' })
      } else {
        const st = String(j.status || '')
        const text = kind === 'decline' ? 'Declined. The guest sees “not available” on their order page.'
          : st === 'paid' ? 'Charged ' + total + '. ' + (j.paymentNote || '') + (j.deliveryDate ? ' Delivery ' + j.deliveryDate + '.' : '')
          : st === 'awaiting_payment' ? 'Approved, but no card could be charged: ' + (j.chargeError || 'collect another way') + ' — mark it paid on the board once collected.'
          : 'Approved (' + st.replace('_', ' ') + ').'
        setDone({ ok: true, status: st, text })
      }
    } catch { setDone({ ok: false, status: null, text: 'Network error — open the board instead.' }) }
    setBusy(null)
  }

  if (done) {
    const tone = done.ok && done.status === 'paid' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : done.ok ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-900'
    return (
      <div className={'mt-4 rounded-2xl border px-4 py-4 text-sm ' + tone}>
        <div className="text-xl">{done.ok && done.status === 'paid' ? '✅' : done.ok ? '🟡' : '⚠️'}</div>
        <div className="mt-1.5 leading-relaxed">{done.text}</div>
        <a href="/guest-orders" className="inline-block mt-3 text-[13px] font-semibold underline underline-offset-2">Open Guest Orders</a>
      </div>
    )
  }
  return (
    <div className="mt-4 space-y-2">
      <button onClick={() => go('approve')} disabled={!!busy} className="w-full h-12 rounded-xl bg-emerald-600 text-white text-[15px] font-semibold disabled:opacity-60">{busy === 'approve' ? 'Charging…' : 'Approve & charge ' + total}</button>
      <button onClick={() => go('decline')} disabled={!!busy} className="w-full h-11 rounded-xl bg-white border border-neutral-200 text-neutral-700 text-[14px] font-semibold disabled:opacity-60">{busy === 'decline' ? 'Declining…' : 'Decline'}</button>
      <p className="text-[12px] text-neutral-500 text-center pt-1">Approve charges the card Guesty holds for this reservation and adds the items to the folio.</p>
    </div>
  )
}
