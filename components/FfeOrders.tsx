'use client'
// ORDERS — the board, and the builder that turns walk answers into one.
//
// Jon, 2026-08-12: "world class ordering form and then actually managing it."
//
// THE BUILDER OPENS IN "BY ITEM" ON PURPOSE. An owner with 53 studios comes back from the walk with
// 23 lines that all say "Lamps". Picking a product 23 times is how a good system becomes a chore
// nobody finishes, so the default view rolls identical items together: choose the lamp once and it
// lands on all 23 lines. By unit is one tap away for the cases that genuinely differ — the corner
// unit with the odd ceiling, the two-bedroom that needs a bigger sofa.
//
// Nothing is written until Create. Until then this is a plan on your screen.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, Plus, ArrowLeft, Package, Copy, Check, ExternalLink, ShoppingCart, Building2, ChevronRight,
} from 'lucide-react'
import { money, ORDER_STATUS_LABEL, STAGE_LABEL } from '@/lib/ffe-catalog'

type OwnerRow = { ownerId: string; ownerName: string; flagged: number; units: number }
type Prod = {
  id: string; code: string; name_en: string; category: string; item_keys: string[] | null
  vendor: string | null; vendor_sku: string | null; unit_cost: number | null; url: string | null
  image_url: string | null; room_hint: string | null
}
type PendItem = {
  room: string; itemKey: string; itemLabel: string; title: string | null
  answer: string; qty: number; note: string | null; spec: string | null; photoUrl: string | null; category: string
  replacementUrl?: string | null; replacementPhoto?: string | null; estCost?: number | null
}
type PendRoom = { room: string; roomLabel: string; items: PendItem[] }
type PendUnit = { listingId: string; unitName: string; building: string; bedrooms: number | null; rooms: PendRoom[] }
type Order = {
  id: string; order_no: string; title: string | null; owner_name: string | null; status: string
  created_at: string; sent_at: string | null; decided_at: string | null; shareCode: string
  roll: { lines: number; value: number; priced: number; byStage: Record<string, number> }
}

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-neutral-200 text-neutral-700',
  sent: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-700',
  changes: 'bg-rose-100 text-rose-700',
  closed: 'bg-neutral-100 text-neutral-500',
}
const key = (listingId: string, room: string, itemKey: string) => listingId + '|' + room + '|' + itemKey

export function FfeOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [owners, setOwners] = useState<OwnerRow[]>([])
  const [err, setErr] = useState('')
  const [setup, setSetup] = useState('')
  const [building, setBuilding] = useState<string>('')   // ownerId being built, '' = board
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const [a, b] = await Promise.all([
        fetch('/api/audit/ffe/orders?list=1', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/audit/ffe/orders', { cache: 'no-store' }).then(r => r.json()),
      ])
      if (a?.setupRequired || b?.setupRequired) { setSetup(a?.error || b?.error); setOrders([]); return }
      if (!a?.ok) throw new Error(a?.error || 'Could not load orders.')
      setOrders(a.orders || [])
      setOwners(b?.owners || [])
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(window.location.origin + '/audit/ffe/order/' + code)
      setCopied(code); setTimeout(() => setCopied(''), 1600)
    } catch { /* clipboard blocked */ }
  }

  if (setup) return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
      <p className="font-bold">Ordering is not switched on yet.</p>
      <p className="mt-1">{setup}</p>
    </div>
  )
  if (err && !orders) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div>
  if (!orders) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading orders…</div>

  if (building) return <Builder ownerId={building} onBack={() => { setBuilding(''); load() }} />

  return (
    <div className="space-y-4">
      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}

      {/* start one */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
        <div className="px-4 py-3 border-b border-line">
          <p className="text-sm font-bold text-ink">Start an order</p>
          <p className="text-[12px] text-muted mt-0.5">
            Owners with furniture flagged on a walk and not yet on an order. Everything already ordered is
            filtered out, so you can come back a week later and only see what is new.
          </p>
        </div>
        {!owners.length ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-muted">
            Nothing flagged Replace or Add yet — the walk has to come back first.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {owners.map(o => (
              <button key={o.ownerId} onClick={() => setBuilding(o.ownerId)}
                className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-app/50">
                <Building2 className="w-4 h-4 text-muted shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink truncate">{o.ownerName}</div>
                  <div className="text-[11.5px] text-muted">{o.units} unit{o.units === 1 ? '' : 's'} with something flagged</div>
                </div>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 tabular-nums shrink-0">
                  {o.flagged} to order
                </span>
                <ChevronRight className="w-4 h-4 text-muted shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* the board */}
      <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
        <div className="px-4 py-3 border-b border-line flex items-center">
          <p className="text-sm font-bold text-ink flex-1">Orders</p>
          <span className="text-[11px] text-muted tabular-nums">{orders.length}</span>
        </div>
        {!orders.length ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-muted">No orders yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {orders.map(o => {
              const st = o.roll.byStage || {}
              const done = (st.installed || 0)
              const moving = (st.ordered || 0) + (st.delivered || 0)
              const pct = o.roll.lines ? Math.round(((done + moving * 0.5) / o.roll.lines) * 100) : 0
              return (
                <div key={o.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={'/ffe/order/' + o.id} className="text-[13.5px] font-bold text-ink hover:underline">
                      {o.order_no}
                    </a>
                    <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (STATUS_CLS[o.status] || STATUS_CLS.draft)}>
                      {ORDER_STATUS_LABEL[o.status] || o.status}
                    </span>
                    <span className="text-[12.5px] text-muted truncate">{o.title || o.owner_name}</span>
                    <div className="flex-1" />
                    <span className="text-[13px] font-bold text-ink tabular-nums">{money(o.roll.value)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <div className="h-1.5 flex-1 max-w-[200px] rounded-full bg-neutral-100 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: pct + '%' }} />
                    </div>
                    <span className="text-[11px] text-muted tabular-nums">
                      {o.roll.lines} line{o.roll.lines === 1 ? '' : 's'}
                      {st.declined ? ' · ' + st.declined + ' not taken' : ''}
                      {o.roll.priced < o.roll.lines ? ' · ' + (o.roll.lines - o.roll.priced) + ' unpriced' : ''}
                    </span>
                    <div className="flex-1" />
                    {o.status !== 'draft' ? (
                      <button onClick={() => copy(o.shareCode)} className="text-[11.5px] font-semibold text-brand-700 inline-flex items-center gap-1">
                        {copied === o.shareCode ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Owner link</>}
                      </button>
                    ) : null}
                    <a href={'/ffe/order/' + o.id} className="text-[11.5px] font-semibold text-ink inline-flex items-center gap-1">
                      Open <ChevronRight className="w-3 h-3" />
                    </a>
                  </div>
                  {Object.keys(st).length ? (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {Object.keys(st).map(s => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-app text-muted">
                          {STAGE_LABEL[s] || s} {st[s]}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────────────────────────

function Builder({ ownerId, onBack }: { ownerId: string; onBack: () => void }) {
  const [data, setData] = useState<{ owner: any; groups: PendUnit[]; products: Prod[] } | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'item' | 'unit'>('item')
  const [assign, setAssign] = useState<Record<string, string>>({})   // lineKey -> catalogId
  const [skip, setSkip] = useState<Record<string, boolean>>({})
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [restored, setRestored] = useState(false)

  // A DRAFT ORDER SURVIVES A CLOSED TAB. Assigning products across 53 units is twenty minutes of
  // work that lives nowhere until Create — so it is kept on the device as you go, and picked back
  // up if the browser dies. Cleared the moment the order is actually created.
  const stash = 'ffe-builder:' + ownerId
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(stash)
      if (!raw) return
      const s = JSON.parse(raw)
      if (s && typeof s === 'object') {
        setAssign(s.assign || {}); setSkip(s.skip || {})
        if (s.title) setTitle(s.title)
        if (s.note) setNote(s.note)
        setRestored(true)
      }
    } catch { /* a corrupt stash is not worth an error message */ }
  }, [stash])
  useEffect(() => {
    if (!data) return
    try { window.localStorage.setItem(stash, JSON.stringify({ assign, skip, title, note })) } catch { /* private mode */ }
  }, [assign, skip, title, note, data, stash])

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/audit/ffe/orders?pending=' + encodeURIComponent(ownerId), { cache: 'no-store' })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not load what is flagged.')
        setData({ owner: j.owner, groups: j.groups || [], products: j.products || [] })
        setTitle(t => t || ((j.owner?.ownerName || 'Owner') + ' — FF&E'))
      } catch (e: any) { setErr(String(e?.message || e)) }
    })()
  }, [ownerId])

  const prodById = useMemo(() => Object.fromEntries((data?.products || []).map(p => [p.id, p])), [data])

  // Every pending line, flattened once — both views and the totals read from this.
  const flat = useMemo(() => {
    const out: (PendItem & { listingId: string; unitName: string; building: string; k: string })[] = []
    for (const u of data?.groups || []) {
      for (const r of u.rooms) {
        for (const it of r.items) {
          out.push({ ...it, listingId: u.listingId, unitName: u.unitName, building: u.building, k: key(u.listingId, it.room, it.itemKey) })
        }
      }
    }
    return out
  }, [data])

  // The roll-up the builder opens on: one row per distinct item, across every unit.
  const itemGroups = useMemo(() => {
    const m: Record<string, { label: string; category: string; itemKey: string; lines: typeof flat; units: Set<string>; qty: number }> = {}
    for (const l of flat) {
      const gk = l.itemKey + '::' + l.itemLabel
      const g = m[gk] = m[gk] || { label: l.itemLabel, category: l.category, itemKey: l.itemKey, lines: [], units: new Set<string>(), qty: 0 }
      g.lines.push(l); g.units.add(l.listingId); g.qty += l.qty
    }
    return Object.values(m).sort((a, b) => b.lines.length - a.lines.length || a.label.localeCompare(b.label))
  }, [flat])

  const chosen = flat.filter(l => !skip[l.k])
  // A line is priced if a catalog product prices it OR the walker put a number on it in the unit.
  const priceOfLine = (l: typeof flat[number]) => {
    const p = prodById[assign[l.k]]
    if (p && p.unit_cost != null) return Number(p.unit_cost)
    return l.estCost == null ? null : Number(l.estCost)
  }
  const estimate = chosen.reduce((a, l) => { const c = priceOfLine(l); return a + (c == null ? 0 : c * l.qty) }, 0)
  const unpriced = chosen.filter(l => priceOfLine(l) == null).length

  /** Products worth showing for an item: the ones tagged for it, then its category, then the rest. */
  const optionsFor = (itemKey: string, category: string): Prod[] => {
    const all = data?.products || []
    const tagged = all.filter(p => (p.item_keys || []).indexOf(itemKey) >= 0)
    const sameCat = all.filter(p => p.category === category && tagged.indexOf(p) < 0)
    const rest = all.filter(p => tagged.indexOf(p) < 0 && sameCat.indexOf(p) < 0)
    return [...tagged, ...sameCat, ...rest]
  }

  const assignGroup = (lines: typeof flat, catalogId: string) =>
    setAssign(a => { const n = { ...a }; for (const l of lines) { if (catalogId) n[l.k] = catalogId; else delete n[l.k] } return n })
  const skipGroup = (lines: typeof flat, on: boolean) =>
    setSkip(s => { const n = { ...s }; for (const l of lines) { if (on) n[l.k] = true; else delete n[l.k] } return n })

  const create = async () => {
    if (!chosen.length) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/audit/ffe/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', ownerId, title, note,
          lines: chosen.map(l => ({
            listingId: l.listingId, room: l.room, itemKey: l.itemKey, title: l.itemLabel,
            qty: l.qty, catalogId: assign[l.k] || null,
            placement: l.itemLabel, note: l.note || null, spec: l.spec || null,
            replacementUrl: l.replacementUrl || null, replacementPhoto: l.replacementPhoto || null, estCost: l.estCost ?? null,
          })),
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not create the order.')
      try { window.localStorage.removeItem(stash) } catch { /* no-op */ }
      window.location.href = '/ffe/order/' + j.id
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false) }
  }

  if (err && !data) return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-[12.5px] font-semibold text-muted inline-flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Back</button>
      <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div>
    </div>
  )
  if (!data) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…</div>

  const picker = (lines: typeof flat, itemKey: string, category: string, value: string) => (
    <select value={value} onChange={e => assignGroup(lines, e.target.value)}
      className="rounded-lg border border-line bg-white px-2 py-1.5 text-[12px] max-w-[260px]">
      <option value="">Pick a product…</option>
      {optionsFor(itemKey, category).map(p => (
        <option key={p.id} value={p.id}>
          {p.code} · {p.name_en}{p.unit_cost != null ? ' — ' + money(p.unit_cost) : ''}
        </option>
      ))}
    </select>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="text-[12.5px] font-semibold text-muted inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> All orders
        </button>
        <h2 className="text-lg font-bold text-ink">{data.owner?.ownerName}</h2>
        <span className="text-[12px] text-muted">{flat.length} flagged across {new Set(flat.map(l => l.listingId)).size} units</span>
        <div className="flex-1" />
        <div className="flex items-center rounded-lg border border-line overflow-hidden">
          {([['item', 'By item'], ['unit', 'By unit']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)}
              className={'px-3 py-1.5 text-[12px] font-semibold ' + (view === k ? 'bg-ink text-white' : 'text-muted')}>{l}</button>
          ))}
        </div>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}
      {restored ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-2.5 text-[12.5px] text-muted flex items-center gap-2">
          Picked up where you left off — this draft was saved on this device.
          <button onClick={() => { setAssign({}); setSkip({}); setRestored(false); try { window.localStorage.removeItem(stash) } catch { /* no-op */ } }}
            className="ml-auto text-[12px] font-semibold text-ink">Start over</button>
        </div>
      ) : null}
      {!data.products.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          There are no products in the catalog yet, so lines will be created without codes or prices. Add products
          on the <span className="font-semibold">Catalog</span> tab first if you want this order to be orderable as it stands.
        </div>
      ) : null}

      {view === 'item' ? (
        <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft divide-y divide-line">
          {itemGroups.map(g => {
            const allSkipped = g.lines.every(l => skip[l.k])
            const val = assign[g.lines[0].k] && g.lines.every(l => assign[l.k] === assign[g.lines[0].k]) ? assign[g.lines[0].k] : ''
            const p = prodById[val]
            return (
              <div key={g.itemKey + g.label} className={'px-4 py-3 flex items-center gap-3 flex-wrap ' + (allSkipped ? 'opacity-45' : '')}>
                <input type="checkbox" checked={!allSkipped} onChange={e => skipGroup(g.lines, !e.target.checked)} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-ink">{g.label}</div>
                  <div className="text-[11.5px] text-muted">
                    {g.lines.length} line{g.lines.length === 1 ? '' : 's'} · {g.units.size} unit{g.units.size === 1 ? '' : 's'} · {g.qty} piece{g.qty === 1 ? '' : 's'}
                  </div>
                </div>
                {picker(g.lines, g.itemKey, g.category, val)}
                <span className="text-[12.5px] font-bold text-ink tabular-nums w-20 text-right">
                  {(() => {
                    const tot = g.lines.reduce((a: number, l: any) => { const c = priceOfLine(l); return a + (c == null ? 0 : c * l.qty) }, 0)
                    return tot ? money(tot) : '—'
                  })()}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {data.groups.map(u => (
            <div key={u.listingId} className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
              <div className="px-4 py-2.5 bg-app/50 border-b border-line flex items-center gap-2">
                <span className="text-[13px] font-bold text-ink">{u.unitName}</span>
                <span className="text-[11px] text-muted">{u.building}</span>
              </div>
              <div className="divide-y divide-line">
                {u.rooms.map(r => r.items.map(it => {
                  const k = key(u.listingId, it.room, it.itemKey)
                  const p = prodById[assign[k]]
                  return (
                    <div key={k} className={'px-4 py-2 flex items-center gap-3 flex-wrap ' + (skip[k] ? 'opacity-45' : '')}>
                      <input type="checkbox" checked={!skip[k]} onChange={e => setSkip(s => ({ ...s, [k]: !e.target.checked }))} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-semibold text-ink">{it.itemLabel}</div>
                        <div className="text-[11px] text-muted">
                          {r.roomLabel} · qty {it.qty}
                          {it.spec ? ' · ' + it.spec : ''}
                          {it.note ? ' · ' + it.note : ''}
                        </div>
                      </div>
                      {picker([{ ...it, listingId: u.listingId, unitName: u.unitName, building: u.building, k }] as any, it.itemKey, it.category, assign[k] || '')}
                      <span className="text-[12px] font-bold text-ink tabular-nums w-16 text-right">
                        {(() => {
                          const c = (p && p.unit_cost != null) ? Number(p.unit_cost) : (it.estCost == null ? null : Number(it.estCost))
                          return c == null ? '—' : money(c * it.qty)
                        })()}
                      </span>
                    </div>
                  )
                }))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* create */}
      <div className="rounded-2xl border border-line bg-white p-4 shadow-soft space-y-2.5">
        <div className="grid sm:grid-cols-2 gap-2">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Order name"
            className="rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note to the owner (shown on their page)"
            className="rounded-lg border border-line px-2.5 py-1.5 text-[13px]" />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={create} disabled={busy || !chosen.length}
            className="rounded-xl bg-ink text-white px-4 py-2 text-[12.5px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShoppingCart className="w-3.5 h-3.5" />}
            {busy ? 'Creating…' : `Create order — ${chosen.length} line${chosen.length === 1 ? '' : 's'}`}
          </button>
          <span className="text-[13px] font-bold text-ink tabular-nums">{money(estimate)}</span>
          {unpriced ? <span className="text-[11.5px] text-amber-700">{unpriced} line(s) with no product picked yet — you can add them on the order.</span> : null}
        </div>
      </div>
    </div>
  )
}
