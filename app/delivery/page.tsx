'use client'
// DELIVERY PLAN - shareable, print-friendly placement list for the team: what is arriving
// and exactly where each item goes (building -> unit -> room). Password-gated share link,
// same shared password as the vendor / front-desk boards.
import { useCallback, useEffect, useState } from 'react'

type Item = { id: string; unit: string; building: string; room: string; kind: string; title: string; qty: number; note: string; photo: string | null; link: string | null; status: string }

const STATUS_LABEL: Record<string, string> = { approved: 'Approved - buying', ordered: 'Ordered', arriving: 'Arriving' }
const STATUS_CLS: Record<string, string> = { approved: 'bg-emerald-100 text-emerald-800', ordered: 'bg-sky-100 text-sky-800', arriving: 'bg-indigo-100 text-indigo-800' }

export default function DeliveryPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [needsPw, setNeedsPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [updated, setUpdated] = useState('')

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/public/delivery', { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 401 || j.needsPassword) { setNeedsPw(true); setLoading(false); return }
      if (!r.ok || !j.ok) { setErr(j.error || 'Failed to load'); setLoading(false); return }
      setNeedsPw(false)
      setItems(j.items || [])
      setUpdated(new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))
    } catch { setErr('Network error - reload to retry.') }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function unlock() {
    if (pwBusy || !pw.trim()) return
    setPwBusy(true); setPwErr('')
    try {
      const r = await fetch('/api/public/share-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setPwErr(j.error || 'Wrong password'); setPwBusy(false); return }
      setPw(''); setLoading(true)
      await load()
    } catch { setPwErr('Network error - retry') }
    setPwBusy(false)
  }

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-10 text-sm text-neutral-500">Loading delivery plan…</div>

  if (needsPw) {
    return (
      <div className="max-w-sm mx-auto px-4 py-16">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Stay Hospitality</div>
        <h1 className="text-xl font-bold text-neutral-900 mb-3">Delivery plan</h1>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-sm text-neutral-600 mb-2">Enter the team password to open the plan.</div>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') unlock() }} placeholder="Team password" className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2" />
          {pwErr ? <div className="text-xs text-rose-600 mt-1.5">{pwErr}</div> : null}
          <button onClick={unlock} disabled={pwBusy || !pw.trim()} className="mt-2 w-full text-sm font-semibold px-3 py-2 rounded-lg bg-neutral-900 text-white disabled:opacity-50">{pwBusy ? 'Checking…' : 'Open plan'}</button>
        </div>
      </div>
    )
  }

  const byBldg: Record<string, Record<string, Item[]>> = {}
  for (const it of items) {
    const b = it.building || 'Other'
    if (!byBldg[b]) byBldg[b] = {}
    if (!byBldg[b][it.unit]) byBldg[b][it.unit] = []
    byBldg[b][it.unit].push(it)
  }
  const bldgs = Object.keys(byBldg).sort()
  const total = items.reduce((n, it) => n + (it.qty || 1), 0)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 print:py-2">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-400 font-bold">Stay Hospitality</div>
          <h1 className="text-xl font-bold text-neutral-900 leading-tight">Delivery plan - where everything goes</h1>
          <div className="text-xs text-neutral-500 mt-0.5">{items.length} line{items.length === 1 ? '' : 's'} · {total} item{total === 1 ? '' : 's'} in flight{updated ? ' · updated ' + updated : ''}</div>
        </div>
        <span className="flex items-center gap-2 print:hidden">
          <button onClick={() => load()} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-neutral-200 text-neutral-500">Refresh</button>
          <button onClick={() => window.print()} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-neutral-900 text-white">Print</button>
        </span>
      </div>
      {bldgs.length === 0 ? <div className="text-sm text-neutral-500">Nothing in flight right now. Approved, ordered and arriving order lines show here with their placement.</div> : null}
      <div className="space-y-4">
        {bldgs.map(b => {
          const units = Object.keys(byBldg[b]).sort()
          let n = 0
          for (const u of units) for (const it of byBldg[b][u]) n += it.qty || 1
          return (
            <div key={b} className="rounded-xl border border-neutral-200 bg-white break-inside-avoid">
              <div className="px-4 py-2.5 border-b border-neutral-200 text-sm font-bold text-neutral-900">{b} <span className="text-neutral-400 font-semibold">· {n} item{n === 1 ? '' : 's'}</span></div>
              <div className="divide-y divide-neutral-100">
                {units.map(u => (
                  <div key={u} className="px-4 py-3">
                    <div className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold mb-1.5">{u}</div>
                    <div className="space-y-1">
                      {byBldg[b][u].map(it => (
                        <div key={it.id} className="flex items-start gap-2">
                          <span className="text-sm font-semibold text-neutral-900 whitespace-nowrap">{it.qty > 1 ? it.qty + '× ' : ''}{it.title}</span>
                          <span className="text-xs text-neutral-500 mt-0.5">{it.room ? '→ ' + it.room : ''}</span>
                          <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ' + (STATUS_CLS[it.status] || 'bg-neutral-100 text-neutral-600')}>{STATUS_LABEL[it.status] || it.status}</span>
                          <span className="ml-auto flex items-center gap-1.5">
                            {it.link ? <a href={it.link} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-sky-700 print:hidden">product</a> : null}
                            {it.photo ? <a href={it.photo} target="_blank" rel="noreferrer" className="print:hidden"><img src={it.photo} alt="" className="h-7 w-7 rounded object-cover" /></a> : null}
                          </span>
                        </div>
                      ))}
                      {byBldg[b][u].some(it => it.note) ? (
                        <div className="pt-0.5">
                          {byBldg[b][u].filter(it => it.note).map(it => <div key={'n' + it.id} className="text-[11px] text-neutral-400">{it.title}: {it.note}</div>)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
