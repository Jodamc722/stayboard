'use client'
// OWNER ORDER APPROVAL PAGE - what an owner opens from their share link. Shows just their
// property's or unit's order items with the estimated cost per line and an order total.
// Owner taps Approve (or Decline) per item, or approves everything at once - approvals
// flow straight into the team's order lifecycle. The signed link is the key; no login.
import { useEffect, useState } from 'react'

type Item = { id: string; unit: string; room: string; kind: string; title: string; qty: number; note: string; photo: string | null; link: string | null; est: number | null; status: string }

const STATUS_LABEL: Record<string, string> = { open: 'Awaiting your approval', approved: 'Approved', ordered: 'Ordered', arriving: 'Arriving' }
const STATUS_CLS: Record<string, string> = { open: 'bg-amber-100 text-amber-800', approved: 'bg-emerald-100 text-emerald-800', ordered: 'bg-sky-100 text-sky-800', arriving: 'bg-indigo-100 text-indigo-800' }

function money(n: number): string { return '$' + Math.round(n).toLocaleString('en-US') }

export default function OwnerOrdersPage() {
  const [s, setS] = useState('')
  const [k, setK] = useState('')
  const [label, setLabel] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  async function load(ss: string, kk: string) {
    try {
      setErr('')
      const r = await fetch('/api/public/owner-orders?s=' + encodeURIComponent(ss) + '&k=' + encodeURIComponent(kk), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'This link is not valid.'); setLoading(false); return }
      setLabel(j.label || '')
      setItems(j.items || [])
    } catch { setErr('Network error - reload to retry.') }
    setLoading(false)
  }
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const ss = p.get('s') || ''
    const kk = p.get('k') || ''
    setS(ss); setK(kk)
    if (!ss || !kk) { setErr('This link is not valid.'); setLoading(false); return }
    load(ss, kk)
  }, [])

  async function act(it: Item, action: string) {
    if (busy) return
    setBusy(it.id)
    try { await fetch('/api/public/owner-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s, k, itemId: it.id, action }) }) } catch {}
    setBusy('')
    await load(s, k)
  }
  async function approveAll() {
    if (busy) return
    setBusy('all')
    for (const it of items) {
      if (it.status !== 'open') continue
      try { await fetch('/api/public/owner-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s, k, itemId: it.id, action: 'approve' }) }) } catch {}
    }
    setBusy('')
    await load(s, k)
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm text-neutral-500">Loading your order…</div>
  if (err) return <div className="max-w-2xl mx-auto px-4 py-10 text-sm text-rose-600">{err}</div>

  const byUnit: Record<string, Item[]> = {}
  for (const it of items) { if (!byUnit[it.unit]) byUnit[it.unit] = []; byUnit[it.unit].push(it) }
  const units = Object.keys(byUnit).sort()
  const openItems = items.filter(it => it.status === 'open')
  const estTotal = items.reduce((n, it) => n + (it.est ? it.est * (it.qty || 1) : 0), 0)
  const estMissing = items.some(it => !it.est)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Stay Hospitality</div>
      <h1 className="text-xl font-bold text-neutral-900 leading-tight">Order approval{label ? ' - ' + label : ''}</h1>
      <div className="text-xs text-neutral-500 mt-0.5 mb-4">Review the items below and approve what you would like us to move forward with. Prices are estimates - final costs may vary slightly.</div>
      {items.length === 0 ? <div className="text-sm text-neutral-500">Nothing needs your review right now.</div> : null}
      <div className="space-y-4">
        {units.map(u => (
          <div key={u} className="rounded-xl border border-neutral-200 bg-white">
            <div className="px-4 py-2.5 border-b border-neutral-200 text-sm font-bold text-neutral-900">{u}</div>
            <div className="divide-y divide-neutral-100">
              {byUnit[u].map(it => (
                <div key={it.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded border ' + (it.kind === 'add' ? 'bg-sky-100 text-sky-800 border-sky-300' : 'bg-rose-100 text-rose-700 border-rose-300')}>{it.kind === 'add' ? 'Add' : 'Replace'}</span>
                    <span className="text-sm font-semibold text-neutral-900">{it.qty > 1 ? it.qty + '× ' : ''}{it.title}</span>
                    {it.room ? <span className="text-[11px] text-neutral-500">{it.room}</span> : null}
                    <span className="ml-auto text-sm font-bold text-neutral-900">{it.est ? money(it.est * (it.qty || 1)) : ''}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + (STATUS_CLS[it.status] || 'bg-neutral-100 text-neutral-600')}>{STATUS_LABEL[it.status] || it.status}</span>
                    {it.est && it.qty > 1 ? <span className="text-[11px] text-neutral-400">{money(it.est)} each</span> : null}
                    {it.photo ? <a href={it.photo} target="_blank" rel="noreferrer"><img src={it.photo} alt="" className="h-8 w-8 rounded object-cover" /></a> : null}
                    {it.link ? <a href={it.link} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-sky-700">view product</a> : null}
                    {it.status === 'open' ? (
                      <span className="ml-auto flex items-center gap-1.5">
                        <button onClick={() => act(it, 'decline')} disabled={!!busy} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-neutral-200 text-neutral-400 disabled:opacity-50">Decline</button>
                        <button onClick={() => act(it, 'approve')} disabled={!!busy} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">{busy === it.id ? '…' : 'Approve'}</button>
                      </span>
                    ) : null}
                  </div>
                  {it.note ? <div className="text-[11px] text-neutral-400 mt-1">{it.note}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {items.length ? (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white px-4 py-3 flex flex-wrap items-center gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold">Estimated order total</div>
            <div className="text-lg font-bold text-neutral-900">{money(estTotal)}{estMissing ? <span className="text-[11px] font-semibold text-neutral-400"> + items pending estimate</span> : null}</div>
          </div>
          {openItems.length ? <button onClick={approveAll} disabled={!!busy} className="ml-auto text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50">{busy === 'all' ? 'Approving…' : 'Approve all ' + openItems.length + ' open item' + (openItems.length === 1 ? '' : 's')}</button> : <span className="ml-auto text-xs font-semibold text-emerald-700">All reviewed ✓</span>}
        </div>
      ) : null}
      <div className="mt-6 text-[11px] text-neutral-400">Questions? Reply to your Stay Hospitality contact - approvals here go straight to our purchasing queue.</div>
    </div>
  )
}
