'use client'
// The guest-orders panel on a reservation (Jon, 2026-08-24: "its own tab on the page"). Shows the
// stay's order link (create / copy / write to Guesty) and every basket with its status and day.
import { useState } from 'react'
import Link from 'next/link'
import { Copy, Link2, Send, Loader2 } from 'lucide-react'

type LinkRow = { code: string; sent_at: string | null; send_error: string | null; opened_at: string | null } | null
type Order = { id: string; status: string; items: { name: string; qty: number }[]; total_usd: number; submitted_at: string; delivery_date: string | null; delivery_note: string | null; requested_delivery: string | null; requested_date: string | null; payment_note: string | null; charge_error: string | null }

const CHIP: Record<string, string> = {
  submitted: 'bg-amber-100 text-amber-900', approved: 'bg-amber-100 text-amber-900', awaiting_payment: 'bg-orange-100 text-orange-900', payment_failed: 'bg-rose-100 text-rose-800',
  paid: 'bg-sky-100 text-sky-900', pushed: 'bg-indigo-100 text-indigo-900', delivered: 'bg-emerald-100 text-emerald-900', declined: 'bg-slate-200 text-slate-700', cancelled: 'bg-slate-200 text-slate-700',
}
const LABEL: Record<string, string> = { submitted: 'Needs approval', approved: 'Charging', awaiting_payment: 'Awaiting payment', payment_failed: 'Charge failed', paid: 'Paid · scheduled', pushed: 'With the team', delivered: 'Delivered', declined: 'Declined', cancelled: 'Cancelled' }
const money = (n: number) => '$' + (Math.round(Number(n) * 100) / 100).toFixed(2)
const day = (s: string | null) => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''

export function ReservationOrders({ reservationId, link, orders }: { reservationId: string; link: LinkRow; orders: Order[] }) {
  const [cur, setCur] = useState<LinkRow>(link)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const url = cur ? (typeof window !== 'undefined' ? window.location.origin : '') + '/order/' + cur.code : ''

  async function act(action: 'create_link' | 'write_link') {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/guest-orders/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'create_link' ? { action, reservationId } : { action, code: cur?.code }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setMsg(j.error || j.message || 'Failed'); setBusy(false); return }
      if (action === 'create_link') { setCur({ code: j.code, sent_at: j.guesty && j.guesty.ok ? new Date().toISOString() : null, send_error: j.guesty && !j.guesty.ok ? j.guesty.note : null, opened_at: null }); setMsg(j.guesty && j.guesty.ok ? 'Link created and written to Guesty.' : 'Link created · Guesty: ' + (j.guesty ? j.guesty.note : '')) }
      else { setMsg(j.note || (j.ok ? 'Written to Guesty' : 'Failed')); if (j.ok) setCur(c => c ? { ...c, sent_at: new Date().toISOString(), send_error: null } : c) }
    } catch { setMsg('Network error') }
    setBusy(false)
  }
  async function copy() { try { await navigator.clipboard.writeText(url); setMsg('Link copied.') } catch { setMsg(url) } }

  return (
    <div className="space-y-2">
      {!cur ? (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-500 flex items-center justify-between gap-2">
          <span>No order link yet — it is created automatically 7 days before arrival.</span>
          <button onClick={() => act('create_link')} disabled={busy} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg bg-slate-900 text-white disabled:opacity-50">{busy ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} Create now</button>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <a href={'/order/' + cur.code} target="_blank" className="font-mono text-[11px] text-slate-700 truncate underline">/order/{cur.code}</a>
            <span className="flex items-center gap-1 flex-shrink-0">
              <button onClick={copy} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 font-semibold"><Copy size={11} /> Copy</button>
              {!cur.sent_at ? <button onClick={() => act('write_link')} disabled={busy} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 font-semibold disabled:opacity-50"><Send size={11} /> Write to Guesty</button> : null}
            </span>
          </div>
          <div className="text-slate-500 mt-1">{cur.sent_at ? '✓ in the “Order form” field' : cur.send_error ? '✗ ' + cur.send_error : 'not in Guesty yet'}{cur.opened_at ? ' · guest opened it' : ''}</div>
        </div>
      )}
      {msg ? <div className="text-[11px] text-slate-600">{msg}</div> : null}
      {orders.length === 0 ? <p className="text-xs text-slate-400">No orders on this stay.</p> : orders.map(o => (
        <Link key={o.id} href="/guest-orders" className="block rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm hover:shadow-sm transition">
          <div className="flex items-center justify-between gap-2">
            <span className={'text-[11px] font-semibold px-2 py-0.5 rounded-full ' + (CHIP[o.status] || 'bg-slate-200 text-slate-700')}>{LABEL[o.status] || o.status}</span>
            <span className="font-bold text-slate-900 tabular-nums">{money(o.total_usd)}</span>
          </div>
          <div className="text-xs text-slate-600 mt-1">{(o.items || []).map(l => l.qty + '× ' + l.name).join(' · ')}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {o.delivery_date ? 'Deliver ' + day(o.delivery_date) + (o.delivery_note ? ' · ' + o.delivery_note : '') : o.requested_delivery && o.requested_delivery !== 'auto' ? 'Guest asked: ' + (o.requested_delivery === 'date' ? day(o.requested_date) : o.requested_delivery === 'asap' ? 'ASAP' : 'arrival day') : ''}
            {o.charge_error ? ' · ' + o.charge_error : ''}
          </div>
        </Link>
      ))}
    </div>
  )
}
