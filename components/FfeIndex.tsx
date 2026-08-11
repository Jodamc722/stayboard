'use client'
// FF&E AUDIT LINKS — one link per unit, and the order that comes back (Jon, 2026-08-10).
//
// This is the internal side of the FF&E walk: mint a unit's link, hand it to whoever is walking,
// then watch the answers land. It is a PURCHASING list — what furniture to order — and deliberately
// has no connection to maintenance tasks or Breezeway.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sofa, Copy, Check, RefreshCw, Download, ExternalLink, Loader2 } from 'lucide-react'
import { FFE_ROOMS } from '@/lib/ffe-checklist'

type Unit = { id: string; name: string; bedrooms: number | null; code: string | null; total: number; answered: number; replace: number }
type Idx = { ok: boolean; building: string; units: Unit[]; error?: string }

const BUILDINGS = ['17WEST', 'Arya', 'Elser', 'Nomad', 'District 225', 'Botanica', 'Eden', 'Rustic', 'Oasis', 'Pelican', 'Hendricks']

export function FfeIndex() {
  const [building, setBuilding] = useState('17WEST')
  const [data, setData] = useState<Idx | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [minting, setMinting] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/audit/ffe?building=' + encodeURIComponent(building), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not load units.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [building])
  useEffect(() => { load() }, [load])

  const urlFor = (code: string) => (typeof window !== 'undefined' ? window.location.origin : '') + '/audit/ffe/' + code

  // A unit only gets a link once someone asks for it, so nothing is minted for units nobody walks.
  const mint = async (u: Unit) => {
    setMinting(u.id)
    try {
      const r = await fetch('/api/audit/ffe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link', listingId: u.id }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not create the link.')
      setData(d => d ? { ...d, units: d.units.map(x => x.id === u.id ? { ...x, code: j.code } : x) } : d)
      copy(j.code)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setMinting('')
  }

  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(urlFor(code)); setCopied(code); setTimeout(() => setCopied(''), 1600) } catch { /* clipboard blocked */ }
  }

  const totals = useMemo(() => {
    const u = data?.units || []
    return {
      units: u.length,
      started: u.filter(x => x.answered > 0).length,
      done: u.filter(x => x.total > 0 && x.answered >= x.total).length,
      toOrder: u.reduce((a, x) => a + x.replace, 0),
    }
  }, [data])

  // The whole point of the walk: a list you can hand to whoever is buying.
  const exportOrder = async () => {
    if (!data) return
    const rows: string[] = ['Unit,Room,Item,Answer,Qty,Note']
    const label: Record<string, string> = {}
    for (const r of FFE_ROOMS) for (const i of r.items) label[r.key + '::' + i.key] = r.en + ',' + i.en
    for (const u of data.units) {
      if (!u.code || !u.replace) continue
      try {
        const r = await fetch('/api/audit/ffe?code=' + encodeURIComponent(u.code), { cache: 'no-store' })
        const j = await r.json()
        if (!j.ok) continue
        for (const k of Object.keys(j.answers || {})) {
          const a = j.answers[k]
          if (!['replace', 'add'].includes(a.answer)) continue
          rows.push('"' + u.name + '",' + (label[k] ? label[k].split(',').map((x: string) => '"' + x + '"').join(',') : '"' + k + '",""')
            + ',"' + a.answer + '",' + (a.qty || 1) + ',"' + String(a.note || '').replace(/"/g, '""') + '"')
        }
      } catch { /* skip that unit */ }
    }
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }))
    const el = document.createElement('a'); el.href = url; el.download = 'ffe-order-' + building.toLowerCase() + '.csv'; el.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={building} onChange={e => setBuilding(e.target.value)}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft">
          {BUILDINGS.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="flex-1" />
        <button onClick={exportOrder} disabled={!totals.toOrder}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5 disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> Export order
        </button>
        <button onClick={load} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
          <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
        </button>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: 'Units', v: String(totals.units), s: building },
          { l: 'Walked', v: totals.started + ' started', s: totals.done + ' complete' },
          { l: 'Pieces to order', v: String(totals.toOrder), s: 'replace or add' },
          { l: 'Not started', v: String(totals.units - totals.started), s: 'no answers yet' },
        ].map(x => (
          <div key={x.l} className="rounded-2xl border border-line bg-white p-4 shadow-soft">
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-brand-600 font-bold">{x.l}</div>
            <div className="text-2xl font-bold text-ink tabular-nums mt-1 tracking-tight">{x.v}</div>
            <div className="text-[11px] text-muted mt-0.5">{x.s}</div>
          </div>
        ))}
      </div>

      {loading && !data ? (
        <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading units…
        </div>
      ) : null}

      {data && !data.units.length && !loading ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-center text-sm text-muted">
          No active units found for {building}.
        </div>
      ) : null}

      {data && data.units.length ? (
        <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
          <div className="px-4 py-3 border-b border-line flex items-center gap-2">
            <Sofa size={15} className="text-brand-600" />
            <span className="text-sm font-bold text-ink">One link per unit</span>
            <span className="text-[11px] text-muted">send it to whoever is walking — it opens on a phone, no login</span>
          </div>
          <div className="divide-y divide-line">
            {data.units.map(u => {
              const pct = u.total ? Math.round((u.answered / u.total) * 100) : 0
              return (
                <div key={u.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-bold text-ink">{u.name}</span>
                      {u.bedrooms != null ? <span className="text-[11px] text-muted">{u.bedrooms} BR</span> : null}
                      {u.replace > 0 ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          {u.replace} to order
                        </span>
                      ) : null}
                      {u.total > 0 && u.answered >= u.total ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">complete</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="h-1.5 w-32 rounded-full bg-neutral-100 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: pct + '%' }} />
                      </div>
                      <span className="text-[11px] text-muted tabular-nums">{u.answered}/{u.total}</span>
                    </div>
                  </div>
                  {u.code ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => copy(u.code as string)} title={urlFor(u.code)}
                        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1.5 hover:border-brand-300">
                        {copied === u.code ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy link</>}
                      </button>
                      <a href={'/audit/ffe/' + u.code} target="_blank" rel="noreferrer"
                        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1.5 hover:border-brand-300">
                        <ExternalLink className="w-3.5 h-3.5" /> Open
                      </a>
                    </div>
                  ) : (
                    <button onClick={() => mint(u)} disabled={minting === u.id}
                      className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold shrink-0 disabled:opacity-50">
                      {minting === u.id ? 'Creating…' : 'Create link'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      <p className="text-[11px] text-muted">
        FF&amp;E answers are a purchasing list only — nothing here creates a Breezeway task, a work order or a
        maintenance cost. Export order gives you every Replace and Add across the building, with quantity and notes.
      </p>
    </div>
  )
}
