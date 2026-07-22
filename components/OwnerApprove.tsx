'use client'
// Owner approval (share-code link). The owner sees the improvements a GM escalated for their sign-off
// and taps Approve or Decline on each. Clean, owner-facing - no ops jargon, no Breezeway.
import { useEffect, useState } from 'react'

type Item = { id: string; room: string; kind: string; title?: string | null; note?: string | null; photo_url?: string | null; qty: number; est?: number | null; approval?: string | null }

export default function OwnerApprove({ code }: { code: string }) {
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    try {
      const r = await fetch('/api/audit/approve?code=' + encodeURIComponent(code))
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not load this link.'); return }
      setData(j)
    } catch { setErr('Network error - reload to retry.') }
  }
  useEffect(() => { load() }, [])
  async function act(id: string, action: string) {
    setBusy(id)
    try {
      const r = await fetch('/api/audit/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, itemId: id, action }) })
      const j = await r.json()
      if (r.ok && j.ok) await load(); else alert(j.error || 'Failed')
    } catch { alert('Failed - retry') }
    setBusy('')
  }

  if (err) return <div className="max-w-md mx-auto p-6 text-center text-sm text-rose-600">{err}</div>
  if (!data) return <div className="max-w-md mx-auto p-6 text-center text-sm text-neutral-400">Loading…</div>
  const items: Item[] = data.items || []
  const pending = items.filter(i => i.approval === 'owner_pending')
  const decided = items.filter(i => i.approval === 'owner_approved' || i.approval === 'declined')
  const money = (n?: number | null) => (n && n > 0) ? '$' + Number(n).toLocaleString() : ''

  return (
    <div className="max-w-md mx-auto px-3 pb-24 pt-4">
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">For your approval</div>
        <h1 className="text-xl font-bold text-neutral-900 leading-tight">{data.listing.name}</h1>
        {data.listing.building ? <div className="text-xs text-neutral-500 mt-0.5">{data.listing.building}</div> : null}
        <div className="text-[11px] text-neutral-400 mt-2">A few recommended improvements need your sign-off before we proceed. Approve the ones you would like us to move forward with.</div>
      </div>
      {pending.length === 0 && decided.length === 0 ? <div className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">Nothing is awaiting your approval right now.</div> : null}
      <div className="space-y-2.5">
        {pending.map(it => (
          <div key={it.id} className="rounded-xl border border-neutral-200 bg-white p-3">
            {it.photo_url ? <img src={it.photo_url} alt="" className="w-full h-36 object-cover rounded-lg mb-2" /> : null}
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-neutral-900">{it.qty > 1 ? it.qty + '× ' : ''}{it.title}</span>
              {money(it.est) ? <span className="text-sm font-bold text-neutral-900">{money(it.est)}</span> : null}
            </div>
            <div className="text-[11px] text-neutral-500 mt-0.5">{it.room}{it.kind === 'replace' ? ' · replacement' : ' · new addition'}</div>
            {it.note ? <div className="text-[12px] text-neutral-600 mt-1">{it.note}</div> : null}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button onClick={() => act(it.id, 'decline')} disabled={busy === it.id} className="text-sm font-semibold py-2 rounded-lg border border-neutral-200 text-neutral-500 disabled:opacity-50">Decline</button>
              <button onClick={() => act(it.id, 'approve')} disabled={busy === it.id} className="text-sm font-semibold py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50">{busy === it.id ? '…' : 'Approve'}</button>
            </div>
          </div>
        ))}
      </div>
      {decided.length ? (
        <div className="mt-5">
          <div className="text-[10px] uppercase tracking-wide text-neutral-400 font-semibold mb-1.5">Your decisions</div>
          <div className="space-y-1.5">
            {decided.map(it => (
              <div key={it.id} className={'flex items-center gap-2 rounded-lg border p-2 ' + (it.approval === 'owner_approved' ? 'border-emerald-100 bg-emerald-50' : 'border-neutral-200 bg-neutral-50')}>
                <span className="flex-1 min-w-0 text-[12px] text-neutral-700 truncate">{it.title} <span className="text-neutral-400">· {it.room}</span></span>
                {money(it.est) ? <span className="text-[11px] text-neutral-500">{money(it.est)}</span> : null}
                <span className={'text-[11px] font-semibold ' + (it.approval === 'owner_approved' ? 'text-emerald-700' : 'text-neutral-400')}>{it.approval === 'owner_approved' ? 'Approved ✓' : 'Declined'}</span>
                <button onClick={() => act(it.id, it.approval === 'owner_approved' ? 'decline' : 'approve')} disabled={busy === it.id} className="text-[10px] font-semibold text-neutral-400 px-1">change</button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="text-center text-[10px] text-neutral-300 mt-6">Stay Hospitality</div>
    </div>
  )
}
