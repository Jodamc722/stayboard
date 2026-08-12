'use client'
// FF&E AUDIT — the internal view, organised by owner (Jon, 2026-08-11).
//
//   "It should have one owner link, that link then opens to a page with each unit, with its own
//    link... should be organized by owner."
//
// Every link already exists — there is no Create button, because a share code is derived from the
// listing id rather than minted (lib/ffe-links). Share the owner link once and the team works from
// there; the per-unit links are here for handing a single unit to a single person.
//
// This is a PURCHASING list. Nothing on this page creates a Breezeway task or a maintenance cost.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sofa, Copy, Check, RefreshCw, Download, ExternalLink, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { FFE_ROOMS } from '@/lib/ffe-checklist'

type Unit = {
  id: string; name: string; bedrooms: number | null; building: string
  ownerId: string; ownerName: string; code: string
  total: number; answered: number; toOrder: number
  completedAt: string | null; today: string
}
type Owner = {
  ownerId: string; ownerName: string; code: string
  buildings: { building: string; code: string }[]
  units: Unit[]
  total: number; answered: number; toOrder: number; complete: number
}
type Data = { ok: boolean; owners: Owner[]; error?: string }

const STATUS: Record<string, { label: string; cls: string }> = {
  vacant:   { label: 'Vacant',          cls: 'bg-emerald-100 text-emerald-700' },
  checkout: { label: 'Checkout today',  cls: 'bg-blue-100 text-blue-700' },
  checkin:  { label: 'Check-in today',  cls: 'bg-amber-100 text-amber-800' },
  turn:     { label: 'Same-day turn',   cls: 'bg-rose-100 text-rose-700' },
  occupied: { label: 'Occupied',        cls: 'bg-neutral-200 text-neutral-700' },
}

export function FfeIndex() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const r = await fetch('/api/audit/ffe?index=1', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not load.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const unitUrl = (c: string) => origin + '/audit/ffe/' + c
  const hubUrl = (c: string) => origin + '/audit/ffe/hub/' + c
  const copy = async (key: string, url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(key); setTimeout(() => setCopied(''), 1600) } catch { /* blocked */ }
  }

  const owners = useMemo(() => {
    const list = data?.owners || []
    const needle = q.trim().toLowerCase()
    if (!needle) return list
    return list
      .map(o => ({ ...o, units: o.units.filter(u => u.name.toLowerCase().includes(needle) || u.building.toLowerCase().includes(needle)) }))
      .filter(o => o.ownerName.toLowerCase().includes(needle) || o.units.length)
  }, [data, q])

  const totals = useMemo(() => {
    const u = (data?.owners || []).flatMap(o => o.units)
    return {
      owners: (data?.owners || []).length,
      units: u.length,
      complete: u.filter(x => x.completedAt).length,
      toOrder: u.reduce((a, x) => a + x.toOrder, 0),
    }
  }, [data])

  // The deliverable: everything marked Replace or Add, ready to hand to whoever is buying.
  const exportOrder = async (scope?: Owner) => {
    const src = scope ? [scope] : (data?.owners || [])
    const label: Record<string, string[]> = {}
    for (const r of FFE_ROOMS) for (const i of r.items) label[r.key + '::' + i.key] = [r.en, i.en]
    const rows = ['Owner,Unit,Room,Item,Answer,Qty,Note']
    for (const o of src) {
      for (const u of o.units) {
        if (!u.toOrder) continue
        try {
          const j = await (await fetch('/api/audit/ffe?code=' + encodeURIComponent(u.code), { cache: 'no-store' })).json()
          if (!j.ok) continue
          for (const k of Object.keys(j.answers || {})) {
            const a = j.answers[k]
            if (!['replace', 'add'].includes(a.answer)) continue
            const [room, item] = label[k] || [k, '']
            rows.push([o.ownerName, u.name, room, item, a.answer, String(a.qty || 1), String(a.note || '')]
              .map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','))
          }
        } catch { /* skip */ }
      }
    }
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }))
    const el = document.createElement('a')
    el.href = url; el.download = 'ffe-order-' + (scope ? scope.ownerName.replace(/\W+/g, '-').toLowerCase() : 'all') + '.csv'
    el.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search owner, unit or building"
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] shadow-soft w-64 max-w-full" />
        <span className="flex-1" />
        <button onClick={() => exportOrder()} disabled={!totals.toOrder}
          className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5 disabled:opacity-40">
          <Download className="w-3.5 h-3.5" /> Export all orders
        </button>
        <button onClick={load} className="rounded-xl border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold shadow-soft inline-flex items-center gap-1.5">
          <RefreshCw className={'w-3.5 h-3.5 ' + (loading ? 'animate-spin' : '')} /> Refresh
        </button>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { l: 'Owners', v: String(totals.owners), s: 'one link each' },
          { l: 'Units', v: String(totals.units), s: 'all linkable now' },
          { l: 'Complete', v: totals.complete + '/' + totals.units, s: 'marked done by the walker' },
          { l: 'Pieces to order', v: String(totals.toOrder), s: 'replace or add' },
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
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading owners and units…
        </div>
      ) : null}

      <div className="space-y-3">
        {owners.map(o => {
          const isOpen = !!open[o.ownerId]
          const pct = o.total ? Math.round((o.answered / o.total) * 100) : 0
          return (
            <div key={o.ownerId} className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
              <div className="px-4 py-3 flex items-center gap-2 flex-wrap border-b border-line">
                <button onClick={() => setOpen(s => ({ ...s, [o.ownerId]: !s[o.ownerId] }))}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
                  <span className="text-sm font-bold text-ink truncate">{o.ownerName}</span>
                  <span className="text-[11px] text-muted shrink-0">{o.units.length} unit{o.units.length === 1 ? '' : 's'}</span>
                  {o.toOrder > 0 ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">{o.toOrder} to order</span>
                  ) : null}
                  <span className="text-[11px] text-muted tabular-nums shrink-0">{o.complete}/{o.units.length} done · {pct}%</span>
                </button>
                {/* THE OWNER LINK — the one thing to share. */}
                <button onClick={() => copy('o:' + o.ownerId, hubUrl(o.code))}
                  title={hubUrl(o.code)}
                  className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0">
                  {copied === 'o:' + o.ownerId ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Owner link</>}
                </button>
                <a href={'/audit/ffe/hub/' + o.code} target="_blank" rel="noreferrer"
                  className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0 hover:border-brand-300">
                  <ExternalLink className="w-3.5 h-3.5" /> Open
                </a>
                {o.toOrder > 0 ? (
                  <button onClick={() => exportOrder(o)}
                    className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0 hover:border-brand-300">
                    <Download className="w-3.5 h-3.5" /> Order
                  </button>
                ) : null}
              </div>

              {isOpen ? (
                <>
                  {o.buildings.length > 1 ? (
                    <div className="px-4 py-2 border-b border-line bg-app flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-muted font-semibold">Building links:</span>
                      {o.buildings.map(b => (
                        <button key={b.building} onClick={() => copy('b:' + o.ownerId + b.building, hubUrl(b.code))}
                          title={hubUrl(b.code)}
                          className="text-[11.5px] font-semibold text-brand-700 hover:underline inline-flex items-center gap-1">
                          {copied === 'b:' + o.ownerId + b.building ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {b.building}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="divide-y divide-line">
                    {o.units.map(u => {
                      const st = STATUS[u.today] || STATUS.vacant
                      const upct = u.total ? Math.round((u.answered / u.total) * 100) : 0
                      return (
                        <div key={u.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[13px] font-semibold text-ink">{u.name}</span>
                              <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + st.cls}>{st.label}</span>
                              {u.completedAt ? <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-600 text-white">done</span> : null}
                              {u.toOrder > 0 ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{u.toOrder}</span> : null}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <div className="h-1.5 w-28 rounded-full bg-neutral-100 overflow-hidden">
                                <div className={'h-full ' + (u.completedAt ? 'bg-emerald-500' : 'bg-neutral-400')} style={{ width: upct + '%' }} />
                              </div>
                              <span className="text-[11px] text-muted tabular-nums">{u.answered}/{u.total}</span>
                            </div>
                          </div>
                          <button onClick={() => copy('u:' + u.id, unitUrl(u.code))} title={unitUrl(u.code)}
                            className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0 hover:border-brand-300">
                            {copied === 'u:' + u.id ? <><Check className="w-3.5 h-3.5 text-emerald-600" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Unit link</>}
                          </button>
                          <a href={'/audit/ffe/' + u.code} target="_blank" rel="noreferrer"
                            className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0 hover:border-brand-300">
                            <ExternalLink className="w-3.5 h-3.5" /> Open
                          </a>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : null}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-muted flex items-start gap-1.5">
        <Sofa size={12} className="mt-0.5 shrink-0" />
        Links exist for every owner and unit already — nothing to create. Share the owner link and the team walks
        from there, in or out of any unit, marking each one complete as they finish. FF&amp;E answers are a purchasing
        list only: nothing here creates a Breezeway task, a work order or a maintenance cost.
      </p>
    </div>
  )
}
