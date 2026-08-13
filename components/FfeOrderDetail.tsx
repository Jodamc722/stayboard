'use client'
// ONE ORDER, AND EVERYTHING THAT HAPPENS TO IT AFTER IT IS SENT.
//
// Jon, 2026-08-12: "...and then actually managing it."
//
// The line, not the order, is the unit of truth here. An order is never simply "placed" — the beds
// ship in a week, the sofa is eight, and one nightstand is backordered until November. Stages sit on
// each line so the board can say "38 installed, 2 still with the vendor" instead of a single status
// that is wrong about both.
//
// Editing a line's price or product AFTER the owner approved is deliberately still allowed, but the
// order's status stays where the owner left it — we do not quietly re-mark a changed order as
// approved. If the number moved, you send it again and they see what moved.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Loader2, ArrowLeft, Copy, Check, Send, FileSpreadsheet, FileText, Trash2, Package,
  ExternalLink, Truck, Wrench, ShoppingBag, MessageSquare, ClipboardList, Store,
} from 'lucide-react'
import { money, ORDER_STATUS_LABEL, STAGE_LABEL } from '@/lib/ffe-catalog'

type Line = {
  id: string; listing_id: string; unit_name: string; building: string; room: string; item_key: string
  roomLabel: string; itemLabel: string; title: string | null
  catalog_id: string | null; code: string | null; product: string | null; image_url: string | null
  url: string | null; vendor: string | null; vendor_sku: string | null
  qty: number; unit_cost: number | null; placement: string | null; spec: string | null; stage: string
  po_number: string | null; vendor_ref: string | null; note: string | null; received_at: string | null
}
type Order = {
  id: string; order_no: string; title: string | null; owner_name: string | null; owner_id: string
  status: string; note: string | null; owner_note: string | null
  decided_at: string | null; decided_by: string | null; sent_at: string | null
}
type Prod = { id: string; code: string; name_en: string; category: string; item_keys: string[] | null; unit_cost: number | null }

const STAGE_CLS: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-600',
  sent: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-rose-100 text-rose-700',
  ordered: 'bg-blue-100 text-blue-700',
  delivered: 'bg-violet-100 text-violet-700',
  installed: 'bg-emerald-600 text-white',
}

export function FfeOrderDetail({ id }: { id: string }) {
  const [order, setOrder] = useState<Order | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [shareCode, setShareCode] = useState('')
  const [products, setProducts] = useState<Prod[]>([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)
  const [po, setPo] = useState<{ po: string; ref: string } | null>(null)

  const load = useCallback(async () => {
    setErr('')
    try {
      const [a, b] = await Promise.all([
        fetch('/api/audit/ffe/orders?id=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/audit/ffe/catalog', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ products: [] })),
      ])
      if (!a?.ok) throw new Error(a?.error || 'Could not load this order.')
      setOrder(a.order); setLines(a.lines || []); setShareCode(a.shareCode || '')
      setProducts(b?.products || [])
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [id])
  useEffect(() => { load() }, [load])

  const post = async (body: any) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/audit/ffe/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'That did not save.')
      await load(); setBusy(false); return j
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(false); return null }
  }

  const selected = useMemo(() => lines.filter(l => sel[l.id]), [lines, sel])
  const live = useMemo(() => lines.filter(l => l.stage !== 'declined'), [lines])
  const total = live.reduce((a, l) => a + (l.unit_cost == null ? 0 : Number(l.unit_cost) * l.qty), 0)
  const unpriced = live.filter(l => l.unit_cost == null).length
  const byUnit = useMemo(() => {
    const m: Record<string, Line[]> = {}
    for (const l of lines) (m[l.unit_name || l.listing_id] = m[l.unit_name || l.listing_id] || []).push(l)
    return m
  }, [lines])

  const shareUrl = shareCode ? (typeof window !== 'undefined' ? window.location.origin : '') + '/audit/ffe/order/' + shareCode : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* blocked */ }
  }

  const send = async () => {
    const j = await post({ action: 'send', id })
    if (j) { setMsg(j.warning ? j.warning + ' The link is copied — send it to the owner.' : 'Sent. The owner link is copied to your clipboard.'); copy() }
  }
  const stage = async (s: string, extra: any = {}) => {
    if (!selected.length) return
    const j = await post({ action: 'stage', lineIds: selected.map(l => l.id), stage: s, ...extra })
    if (j) { setSel({}); setPo(null) }
  }

  if (err && !order) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div>
  if (!order) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading order…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <a href="/ffe" className="text-[12.5px] font-semibold text-muted inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> FF&amp;E
        </a>
        <h2 className="text-xl font-bold text-ink">{order.order_no}</h2>
        <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' +
          (order.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
            : order.status === 'changes' ? 'bg-rose-100 text-rose-700'
              : order.status === 'sent' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-200 text-neutral-700')}>
          {ORDER_STATUS_LABEL[order.status] || order.status}
        </span>
        <span className="text-[12.5px] text-muted">{order.title || order.owner_name}</span>
        <div className="flex-1" />
        <span className="text-lg font-bold text-ink tabular-nums">{money(total)}</span>
      </div>

      {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div> : null}
      {msg ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12.5px] text-emerald-800">{msg}</div> : null}

      {order.owner_note ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-3 shadow-soft">
          <p className="text-[11px] uppercase tracking-wider text-muted font-bold flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3" /> From {order.decided_by || order.owner_name}
          </p>
          <p className="text-[13px] text-ink mt-1 whitespace-pre-wrap">{order.owner_note}</p>
        </div>
      ) : null}

      {/* actions */}
      <div className="rounded-2xl border border-line bg-white p-3 shadow-soft flex flex-wrap items-center gap-2">
        <button onClick={send} disabled={busy || !lines.length}
          className="rounded-xl bg-ink text-white px-3 py-2 text-[12px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5" /> {order.status === 'draft' ? 'Send to owner' : 'Send again'}
        </button>
        {order.status !== 'draft' ? (
          <button onClick={copy} className="rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Owner link</>}
          </button>
        ) : null}
        <a href={'/api/audit/ffe/orders/export?fmt=pdf&id=' + id}
          className="rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> PDF quote
        </a>
        <a href={'/api/audit/ffe/orders/export?fmt=xlsx&id=' + id}
          className="rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
          <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
        </a>
        <a href={'/api/audit/ffe/orders/export?fmt=csv&id=' + id}
          className="rounded-xl border border-line px-3 py-2 text-[12px] font-semibold text-muted">CSV</a>
        {/* TWO SHEETS, TWO JOBS. The buy list is organised by supplier, for whoever places the
            orders; the work order by unit, for whoever puts the furniture in. */}
        <a href={'/api/audit/ffe/orders/export?fmt=buylist&id=' + id}
          className="rounded-xl border-2 border-ink px-3 py-2 text-[12px] font-bold text-ink inline-flex items-center gap-1.5">
          <Store className="w-3.5 h-3.5" /> Buy list
        </a>
        <a href={'/api/audit/ffe/orders/export?fmt=workorder&id=' + id}
          className="rounded-xl border-2 border-ink px-3 py-2 text-[12px] font-bold text-ink inline-flex items-center gap-1.5">
          <ClipboardList className="w-3.5 h-3.5" /> Work orders
        </a>
        <div className="flex-1" />
        <span className="text-[11.5px] text-muted">
          {live.length} line{live.length === 1 ? '' : 's'}
          {unpriced ? ' · ' + unpriced + ' unpriced' : ''}
          {lines.length - live.length ? ' · ' + (lines.length - live.length) + ' not taken' : ''}
        </span>
      </div>

      {/* bulk bar */}
      {selected.length ? (
        <div className="sticky top-2 z-10 rounded-2xl border border-ink bg-ink text-white p-3 shadow-lg flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-bold">{selected.length} selected</span>
          <select onChange={e => { if (e.target.value) { post({ action: 'applyProduct', lineIds: selected.map(l => l.id), catalogId: e.target.value }).then(() => setSel({})) } e.target.value = '' }}
            className="rounded-lg bg-white text-ink px-2 py-1.5 text-[12px] max-w-[240px]" defaultValue="">
            <option value="">Set product…</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name_en}{p.unit_cost != null ? ' — ' + money(p.unit_cost) : ''}</option>)}
          </select>
          <button onClick={() => setPo({ po: '', ref: '' })} className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1">
            <ShoppingBag className="w-3.5 h-3.5" /> Ordered
          </button>
          <button onClick={() => stage('delivered')} className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1">
            <Truck className="w-3.5 h-3.5" /> Delivered
          </button>
          <button onClick={() => stage('installed')} className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1">
            <Wrench className="w-3.5 h-3.5" /> Installed
          </button>
          <div className="flex-1" />
          <button onClick={() => post({ action: 'removeLine', lineIds: selected.map(l => l.id) }).then(() => setSel({}))}
            className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[12px] font-semibold inline-flex items-center gap-1">
            <Trash2 className="w-3.5 h-3.5" /> Remove
          </button>
          <button onClick={() => setSel({})} className="text-[12px] font-semibold text-white/70">Clear</button>
        </div>
      ) : null}

      {po ? (
        <div className="rounded-2xl border border-line bg-white p-3 shadow-soft flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-muted font-bold block">PO number</label>
            <input value={po.po} autoFocus onChange={e => setPo(p => p && ({ ...p, po: e.target.value }))}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" placeholder="optional" />
          </div>
          <div>
            <label className="text-[10.5px] uppercase tracking-wider text-muted font-bold block">Vendor order ref</label>
            <input value={po.ref} onChange={e => setPo(p => p && ({ ...p, ref: e.target.value }))}
              className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" placeholder="optional" />
          </div>
          <button onClick={() => stage('ordered', { poNumber: po.po, vendorRef: po.ref })}
            className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-semibold">
            Mark {selected.length} ordered
          </button>
          <button onClick={() => setPo(null)} className="text-[12px] font-semibold text-muted">Cancel</button>
        </div>
      ) : null}

      {/* lines */}
      {Object.keys(byUnit).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(unit => {
        const us = byUnit[unit]
        const sub = us.filter(l => l.stage !== 'declined').reduce((a, l) => a + (l.unit_cost == null ? 0 : Number(l.unit_cost) * l.qty), 0)
        const allSel = us.every(l => sel[l.id])
        return (
          <div key={unit} className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
            <div className="px-4 py-2.5 bg-app/50 border-b border-line flex items-center gap-2">
              <input type="checkbox" checked={allSel}
                onChange={e => setSel(s => { const n = { ...s }; for (const l of us) { if (e.target.checked) n[l.id] = true; else delete n[l.id] } return n })} />
              <span className="text-[13px] font-bold text-ink">{unit}</span>
              <span className="text-[11px] text-muted">{us[0]?.building}</span>
              <a href={'/api/audit/ffe/orders/export?fmt=workorder&id=' + id + '&unit=' + encodeURIComponent(unit)}
                title="Work order for this unit only"
                className="text-[11px] font-semibold text-brand-700 inline-flex items-center gap-1">
                <ClipboardList className="w-3 h-3" /> Work order
              </a>
              <div className="flex-1" />
              <span className="text-[12.5px] font-bold text-ink tabular-nums">{money(sub)}</span>
            </div>
            <div className="divide-y divide-line">
              {us.map(l => (
                <div key={l.id} className={'px-4 py-2.5 flex items-center gap-3 flex-wrap ' + (l.stage === 'declined' ? 'opacity-50' : '')}>
                  <input type="checkbox" checked={!!sel[l.id]} onChange={e => setSel(s => ({ ...s, [l.id]: e.target.checked }))} />
                  {l.image_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={l.image_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-line shrink-0" />
                    : <div className="w-9 h-9 rounded-lg bg-app border border-line shrink-0 grid place-items-center"><Package className="w-4 h-4 text-muted" /></div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {l.code ? <span className="text-[11px] font-mono font-bold text-brand-700">{l.code}</span> : null}
                      <span className="text-[12.5px] font-semibold text-ink">{l.product || l.itemLabel}</span>
                      <span className={'text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (STAGE_CLS[l.stage] || STAGE_CLS.draft)}>
                        {STAGE_LABEL[l.stage] || l.stage}
                      </span>
                      {l.url ? <a href={l.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink"><ExternalLink className="w-3 h-3" /></a> : null}
                    </div>
                    <div className="text-[11px] text-muted truncate">
                      {l.roomLabel}{l.placement && l.placement !== l.roomLabel ? ' — ' + l.placement : ''} · {l.itemLabel}
                      {l.received_at ? <span className="text-emerald-600 font-semibold"> · received</span> : null}
                      {l.spec ? ' · ' : ''}{l.spec ? <span className="font-semibold text-ink">{l.spec}</span> : null}
                      {l.vendor ? ' · ' + l.vendor : <span className="text-amber-700 font-semibold"> · no supplier yet</span>}{l.po_number ? ' · PO ' + l.po_number : ''}
                    </div>
                  </div>
                  <select value={l.catalog_id || ''} onChange={e => post({ action: 'setLine', lineId: l.id, catalogId: e.target.value })}
                    className="rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] max-w-[200px]">
                    <option value="">No product</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name_en}</option>)}
                  </select>
                  <input defaultValue={l.spec || ''} placeholder="size"
                    onBlur={e => { if (e.target.value !== (l.spec || '')) post({ action: 'setLine', lineId: l.id, spec: e.target.value }) }}
                    className="w-20 rounded-lg border border-line px-1.5 py-1 text-[11.5px] text-center" />
                  <input defaultValue={String(l.qty)} onBlur={e => { const v = Number(e.target.value); if (v && v !== l.qty) post({ action: 'setLine', lineId: l.id, qty: v }) }}
                    className="w-12 rounded-lg border border-line px-1.5 py-1 text-[12px] text-center tabular-nums" inputMode="numeric" />
                  <input defaultValue={l.unit_cost == null ? '' : String(l.unit_cost)} placeholder="$"
                    onBlur={e => { const v = e.target.value.trim(); if (v !== (l.unit_cost == null ? '' : String(l.unit_cost))) post({ action: 'setLine', lineId: l.id, unitCost: v }) }}
                    className="w-20 rounded-lg border border-line px-1.5 py-1 text-[12px] text-right tabular-nums" inputMode="decimal" />
                  <span className="text-[12.5px] font-bold text-ink tabular-nums w-20 text-right">
                    {l.unit_cost == null ? '—' : money(Number(l.unit_cost) * l.qty)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      <p className="text-[11px] text-muted">
        This is a furniture order. Nothing here creates a Breezeway task, a maintenance ticket or a billing line —
        marking a piece installed records that it arrived and went in, and nothing more.
      </p>
    </div>
  )
}
