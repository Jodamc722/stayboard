'use client'
// GUEST ORDERS BOARD — the team's side of the vending machine. One glance answers: what needs
// approving, what is paid and scheduled, what is with the crew today, what failed and why.
// Every row is a card with the ONLY buttons that make sense for its status.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShoppingBag, Check, X, RefreshCw, Copy, Send, Loader2, AlertTriangle, ExternalLink, Truck, Link2, Zap, Palette, Package, Save } from 'lucide-react'

type Line = { sku: string; name: string; qty: number; unit_price_usd: number; line_total_usd: number; unit_label?: string | null }
type Order = {
  id: string; link_code: string; reservation_id: string; unit: string | null; building: string | null; market: string | null; guest_name: string | null
  check_in: string | null; check_out: string | null; status: string; items: Line[]; subtotal_usd: number; tax_usd: number; total_usd: number; guest_note: string | null
  submitted_at: string; approved_at: string | null; approved_by: string | null; paid_at: string | null; payment_note: string | null; charge_error: string | null; folio_note: string | null
  delivery_date: string | null; delivery_note: string | null; requested_delivery?: string; requested_date?: string | null; pushed_at: string | null; breezeway_task_id: string | null; assignee_names: string[]; assign_note: string | null
  stock_note?: string | null; push_error: string | null; delivered_at: string | null; delivered_by: string | null; decline_reason: string | null; approve_token: string | null
}
type LinkRow = { code: string; url: string; reservation_id: string; unit: string | null; building: string | null; guest_name: string | null; source: string | null; check_in: string | null; check_out: string | null; sent_at: string | null; send_error: string | null; opened_at: string | null; orders: number; created_by: string | null }
type StockScope = { id: string; label: string }
type StockPer = { scope: string; label: string; onHand: number; reserved: number; lowAt: number; available: number; state: 'unset' | 'out' | 'low' | 'ok' }
type StockItem = { id: string; sku: string; name: string; category: string | null; image: string | null; active: boolean; per: StockPer[] }
type StockData = { scopes: StockScope[]; items: StockItem[]; alerts: { item: string; scope: string; state: string; available: number }[]; untracked: number }
type Data = { today: string; config: { enabled: boolean; chargeMode: string; customFieldName: string; createDaysBefore: number }; orders: Order[]; links: LinkRow[] }

const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(2)
const day = (s: string | null) => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
const when = (s: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''

const CHIP: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Needs approval', cls: 'bg-amber-100 text-amber-900' },
  approved: { label: 'Charging…', cls: 'bg-amber-100 text-amber-900' },
  awaiting_payment: { label: 'Awaiting payment', cls: 'bg-orange-100 text-orange-900' },
  payment_failed: { label: 'Charge failed', cls: 'bg-rose-100 text-rose-800' },
  paid: { label: 'Paid · scheduled', cls: 'bg-sky-100 text-sky-900' },
  pushed: { label: 'With the team', cls: 'bg-indigo-100 text-indigo-900' },
  delivered: { label: 'Delivered', cls: 'bg-emerald-100 text-emerald-900' },
  declined: { label: 'Declined', cls: 'bg-neutral-200 text-neutral-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-neutral-200 text-neutral-700' },
}
const LANES: { key: string; label: string; statuses: string[] }[] = [
  { key: 'approve', label: 'Needs approval', statuses: ['submitted', 'approved'] },
  { key: 'money', label: 'Payment problems', statuses: ['awaiting_payment', 'payment_failed'] },
  { key: 'scheduled', label: 'Paid · scheduled', statuses: ['paid'] },
  { key: 'crew', label: 'With the team', statuses: ['pushed'] },
  { key: 'done', label: 'Delivered / closed', statuses: ['delivered', 'declined', 'cancelled'] },
]

export function GuestOrdersBoard({ canEdit, canMoney }: { canEdit: boolean; canMoney: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<'orders' | 'links' | 'stock'>(typeof window !== 'undefined' && /[?&]tab=stock/.test(window.location.search) ? 'stock' : 'orders')
  const [stockData, setStockData] = useState<StockData | null>(null)
  const [stockEdits, setStockEdits] = useState<Record<string, { onHand?: number; lowAt?: number }>>({})
  const [lane, setLane] = useState<string>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [paidNote, setPaidNote] = useState<Record<string, string>>({})
  const [newRes, setNewRes] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/guest-orders', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || j.message || 'Could not load'); return }
      setData(j); setErr('')
    } catch { setErr('Network error') }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])
  const loadStock = useCallback(async () => {
    try { const r = await fetch('/api/guest-orders/stock', { cache: 'no-store' }); const j = await r.json(); if (r.ok && j.ok) { setStockData(j); setStockEdits({}) } } catch { /* tab shows loading */ }
  }, [])
  useEffect(() => { if (tab === 'stock') loadStock() }, [tab, loadStock])
  async function saveStock() {
    if (!stockData) return
    setBusy('stock:save'); setFlash(null)
    const rows = Object.keys(stockEdits).map(k => { const [itemId, scope] = k.split('|'); const it = stockData.items.find(i => i.id === itemId); const cur = it?.per.find(p => p.scope === scope); return { itemId, scope, onHand: stockEdits[k].onHand ?? cur?.onHand ?? 0, lowAt: stockEdits[k].lowAt ?? cur?.lowAt ?? 3 } })
    try {
      const r = await fetch('/api/guest-orders/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) })
      const j = await r.json()
      setFlash(r.ok && j.ok ? { tone: 'ok', text: 'Stock updated (' + j.saved + ')' } : { tone: 'bad', text: (j.errors || [j.error || 'Failed']).join(', ') })
      await loadStock()
    } catch { setFlash({ tone: 'bad', text: 'Network error' }) }
    setBusy(null)
  }

  async function act(action: string, id: string, extra: Record<string, any> = {}) {
    if (busy) return
    setBusy(id + ':' + action); setFlash(null)
    try {
      const r = await fetch('/api/guest-orders/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id, ...extra }) })
      const j = await r.json()
      if (!r.ok || !j.ok) setFlash({ tone: 'bad', text: j.error || j.message || 'Failed' })
      else {
        const o: Order | undefined = j.order
        const text = action === 'approve' ? (o && o.status === 'paid' ? 'Charged — ' + (o.payment_note || '') : o && o.status === 'awaiting_payment' ? 'Approved but not charged: ' + (o.charge_error || '') : 'Done')
          : action === 'push_now' ? 'Pushed — Breezeway task ' + (j.taskId || '') + (o && o.assignee_names?.length ? ' → ' + o.assignee_names.join(' + ') : '')
          : action === 'create_link' ? (j.created ? 'Link created' : 'Link already existed') + ' · ' + (j.guesty && j.guesty.ok ? 'written to Guesty' : 'Guesty: ' + (j.guesty ? j.guesty.note : ''))
          : action === 'run_cron' ? 'Links: ' + j.links.created + ' created, ' + j.links.written + ' written · Pushes: ' + j.pushes.pushed + ' of ' + j.pushes.due + (j.links.errors?.length ? ' · ' + j.links.errors[0] : '')
          : action === 'write_link' ? j.note : 'Done'
        setFlash({ tone: 'ok', text })
        if (j.url) { try { await navigator.clipboard.writeText(j.url) } catch { /* no clipboard */ } }
      }
      await load()
    } catch { setFlash({ tone: 'bad', text: 'Network error' }) }
    setBusy(null)
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const l of LANES) c[l.key] = (data?.orders || []).filter(o => l.statuses.indexOf(o.status) >= 0).length
    return c
  }, [data])
  const shown = useMemo(() => {
    const all = data?.orders || []
    if (lane === 'all') return all.filter(o => ['declined', 'cancelled'].indexOf(o.status) < 0 || Date.now() - new Date(o.submitted_at).getTime() < 3 * 86_400_000)
    const L = LANES.find(l => l.key === lane)
    return L ? all.filter(o => L.statuses.indexOf(o.status) >= 0) : all
  }, [data, lane])

  if (err) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>
  if (!data) return <div className="text-sm text-muted py-8 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading orders…</div>

  const manual = data.config.chargeMode === 'manual'
  const todayDue = data.orders.filter(o => (o.status === 'paid' || o.status === 'pushed') && o.delivery_date && o.delivery_date <= data.today).length

  return (
    <div className="space-y-4">
      {!data.config.enabled ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          <div><b>Automation is off.</b> Links are not being created for arrivals and paid orders are not being pushed to the team. Turn it on in <a href="/users" className="underline font-semibold">App settings → Guest orders</a>. Everything on this board still works by hand.</div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {LANES.map(l => (
          <button key={l.key} onClick={() => { setTab('orders'); setLane(lane === l.key ? 'all' : l.key) }} className={'rounded-2xl border px-3.5 py-3 text-left transition ' + (lane === l.key ? 'border-brand-400 bg-brand-50' : 'border-line bg-white hover:border-brand-200')}>
            <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">{l.label}</div>
            <div className="text-2xl font-bold text-ink mt-0.5 tabular-nums">{counts[l.key] || 0}</div>
            {l.key === 'crew' && todayDue ? <div className="text-[11px] text-indigo-700 mt-0.5">{todayDue} due today</div> : null}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-xl border border-line bg-white p-0.5">
          {(['orders', 'links', 'stock'] as const).map(t => <button key={t} onClick={() => setTab(t)} className={'px-3.5 py-1.5 rounded-lg text-[13px] font-semibold ' + (tab === t ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{t === 'orders' ? 'Orders' : t === 'links' ? 'Links · upcoming arrivals' : 'Stock'}</button>)}
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? <a href="/guest-orders/design" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300"><Palette size={13} /> Design studio</a> : null}
          <a href="/orders-live" target="_blank" className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-line bg-white text-ink hover:border-brand-300"><ExternalLink size={13} /> Live link for the team</a>
          {canMoney ? <button onClick={() => act('run_cron', '')} disabled={!!busy} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-50"><Zap size={13} /> Run now</button> : null}
        </div>
      </div>

      {flash ? <div className={'rounded-xl px-3.5 py-2.5 text-[13px] ' + (flash.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200')}>{flash.text}</div> : null}

      {tab === 'stock' ? (
        !stockData ? <div className="text-sm text-muted py-6 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading stock…</div> : (
          <div className="space-y-3">
            {stockData.alerts.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                <b>{stockData.alerts.filter(a => a.state === 'out').length} out · {stockData.alerts.filter(a => a.state === 'low').length} low.</b> {stockData.alerts.map(a => a.item + ' @ ' + a.scope + (a.state === 'out' ? ' (out — hidden from guests)' : ' (' + a.available + ' left)')).join(' · ')}
              </div>
            ) : null}
            {stockData.items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-[13px] text-muted">No item is tracking stock yet. Turn on <b>Track stock</b> on an item in the <a href="/guest-orders/design" className="underline">Design studio</a>; the {stockData.untracked} untracked item{stockData.untracked === 1 ? '' : 's'} always show.</div>
            ) : (
              <div className="rounded-2xl border border-line bg-white overflow-x-auto">
                <table className="w-full text-[12.5px] min-w-[640px]">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-line"><th className="px-3 py-2">Item</th>{stockData.scopes.map(sc => <th key={sc.id} className="px-3 py-2">{sc.label}<div className="text-[10px] normal-case font-normal">on hand · held · low at</div></th>)}</tr></thead>
                  <tbody>
                    {stockData.items.map(it => (
                      <tr key={it.id} className="border-b border-line/60 last:border-0 align-top">
                        <td className="px-3 py-2"><div className="flex items-center gap-2">{it.image ? <img src={it.image} alt="" className="w-8 h-8 rounded-lg object-cover" /> : null}<div><div className="font-semibold text-ink">{it.name}</div><div className="text-[11px] text-muted">{it.category || ''}{!it.active ? ' · off' : ''}</div></div></div></td>
                        {it.per.map(p => { const k = it.id + '|' + p.scope; const e = stockEdits[k] || {}; const onHand = e.onHand ?? p.onHand; const lowAt = e.lowAt ?? p.lowAt; const avail = Math.max(0, onHand - p.reserved); const state = avail <= 0 ? 'out' : avail <= lowAt ? 'low' : 'ok'; return (
                          <td key={p.scope} className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <input type="number" min={0} value={onHand} disabled={!canEdit} onChange={ev => setStockEdits(x => ({ ...x, [k]: { ...x[k], onHand: Number(ev.target.value) } }))} className="w-16 text-[12.5px] px-2 py-1 rounded-lg border border-line" />
                              <span className="text-muted tabular-nums w-6 text-center" title="held by paid orders">{p.reserved}</span>
                              <input type="number" min={0} value={lowAt} disabled={!canEdit} onChange={ev => setStockEdits(x => ({ ...x, [k]: { ...x[k], lowAt: Number(ev.target.value) } }))} className="w-12 text-[12.5px] px-2 py-1 rounded-lg border border-line" />
                              <span className={'text-[10.5px] font-bold px-1.5 py-0.5 rounded ' + (state === 'out' ? 'bg-rose-100 text-rose-800' : state === 'low' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800')}>{state === 'out' ? 'OUT' : state === 'low' ? 'LOW' : avail}</span>
                            </div>
                          </td>) })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {canEdit && stockData.items.length ? <div className="flex items-center gap-2"><button onClick={saveStock} disabled={!!busy || !Object.keys(stockEdits).length} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-50">{busy === 'stock:save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save stock-take</button><span className="text-[11.5px] text-muted">Held = reserved by paid orders, released if cancelled, consumed when delivered. Hub rows fall back to the global shelf when empty.</span></div> : null}
          </div>
        )
      ) : tab === 'orders' ? (
        shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center">
            <ShoppingBag size={22} className="mx-auto text-muted" />
            <div className="text-sm font-semibold text-ink mt-2">No orders here</div>
            <div className="text-[12.5px] text-muted mt-1">Guests order from the link in their reservation’s “{data.config.customFieldName}” field. New baskets land in <b>Needs approval</b>.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map(o => {
              const chip = CHIP[o.status] || { label: o.status, cls: 'bg-neutral-200 text-neutral-700' }
              const b = (a: string) => busy === o.id + ':' + a
              const inHouse = o.check_in && data.today > o.check_in
              return (
                <div key={o.id} className="rounded-2xl border border-line bg-white overflow-hidden">
                  <div className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[15px] font-bold text-ink">{o.unit || 'Unit'}</span>
                        <span className={'text-[11px] font-semibold px-2 py-0.5 rounded-full ' + chip.cls}>{chip.label}</span>
                        {o.building ? <span className="text-[11.5px] text-muted">{o.building}</span> : null}
                      </div>
                      <div className="text-[12.5px] text-muted mt-0.5">{o.guest_name || 'Guest'} · {day(o.check_in)} → {day(o.check_out)}{inHouse ? ' · in-house' : ''} · ordered {when(o.submitted_at)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[17px] font-bold text-ink tabular-nums">{money(o.total_usd)}</div>
                      {o.delivery_date ? <div className={'text-[11.5px] ' + (o.delivery_date <= data.today && o.status !== 'delivered' ? 'text-indigo-700 font-semibold' : 'text-muted')}>Deliver {o.delivery_date === data.today ? 'today' : day(o.delivery_date)}{o.delivery_note ? ' · ' + o.delivery_note : ''}</div>
                        : o.delivery_note ? <div className="text-[11.5px] text-amber-700 font-semibold">{o.delivery_note}</div> : null}
                    </div>
                  </div>
                  <div className="px-4 pb-3">
                    <div className="flex flex-wrap gap-1.5">
                      {o.items.map((l, i) => <span key={i} className="text-[12.5px] px-2 py-1 rounded-lg bg-app border border-line text-ink"><b>{l.qty}×</b> {l.name}</span>)}
                    </div>
                    {o.requested_delivery && o.requested_delivery !== 'auto' ? <div className="mt-2 text-[12px] text-ink"><span className="text-muted">Guest asked for:</span> {o.requested_delivery === 'asap' ? 'as soon as possible' : o.requested_delivery === 'arrival' ? 'arrival day' : day(o.requested_date || null)}</div> : null}
                    {o.guest_note ? <div className="mt-2 text-[12.5px] italic text-muted">“{o.guest_note}”</div> : null}
                    {o.payment_note ? <div className="mt-2 text-[12px] text-emerald-800">{o.payment_note}</div> : null}
                    {o.charge_error ? <div className="mt-2 text-[12.5px] text-rose-700 bg-rose-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {o.charge_error}</div> : null}
                    {o.push_error ? <div className="mt-2 text-[12.5px] text-rose-700 bg-rose-50 rounded-lg px-3 py-2">Push failed: {o.push_error}</div> : null}
                    {o.folio_note ? <div className="mt-2 text-[12.5px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {o.folio_note}</div> : null}
                    {o.stock_note ? <div className={'mt-2 text-[12px] ' + (/SHORT/.test(o.stock_note) ? 'text-rose-700 font-semibold' : 'text-muted')}><Package size={12} className="inline mr-1 -mt-0.5" />{o.stock_note}</div> : null}
                    {o.status === 'pushed' || o.status === 'delivered' ? (
                      <div className="mt-2 text-[12px] text-muted"><Truck size={12} className="inline mr-1 -mt-0.5" />{o.assignee_names.length ? o.assignee_names.join(' + ') : 'unassigned'}{o.assign_note ? ' — ' + o.assign_note : ''}{o.breezeway_task_id ? ' · Breezeway #' + o.breezeway_task_id : ''}{o.delivered_at ? ' · delivered ' + when(o.delivered_at) + (o.delivered_by ? ' by ' + o.delivered_by : '') : ''}</div>
                    ) : null}
                    {o.decline_reason ? <div className="mt-2 text-[12px] text-muted">Declined: {o.decline_reason}</div> : null}

                    {canEdit ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {o.status === 'submitted' || (o.status === 'approved' && o.approved_at && Date.now() - new Date(o.approved_at).getTime() > 10 * 60_000) ? (<>
                          {canMoney ? <button onClick={() => act('approve', o.id)} disabled={!!busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">{b('approve') ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {o.status === 'approved' ? 'Retry charge' : manual ? 'Approve' : 'Approve & charge'}</button> : <span className="text-[12px] text-muted">Approval needs full access</span>}
                          {o.status === 'submitted' ? <button onClick={() => { const reason = window.prompt('Reason for the guest (optional)') || ''; act('decline', o.id, { reason }) }} disabled={!!busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-line text-ink disabled:opacity-50"><X size={13} /> Decline</button> : null}
                        </>) : o.status === 'approved' ? <span className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Charging in Guesty — refresh in a moment</span> : null}
                        {o.status === 'awaiting_payment' || o.status === 'payment_failed' ? (<>
                          {canMoney && !manual ? <button onClick={() => act('approve', o.id)} disabled={!!busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-line text-ink disabled:opacity-50">{b('approve') ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Retry charge</button> : null}
                          {canMoney ? (
                            <span className="inline-flex items-center gap-1.5">
                              <input value={paidNote[o.id] || ''} onChange={e => setPaidNote(p => ({ ...p, [o.id]: e.target.value }))} placeholder="how it was paid" className="text-[12px] px-2 py-1.5 rounded-lg border border-line w-36" />
                              <button onClick={() => act('mark_paid', o.id, { note: paidNote[o.id] || '', recordInGuesty: window.confirm('Also record this payment on the Guesty folio?') })} disabled={!!busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"><Check size={13} /> Mark paid</button>
                            </span>
                          ) : null}
                          <button onClick={() => act('decline', o.id, { reason: 'could not collect payment' })} disabled={!!busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-line text-ink disabled:opacity-50"><X size={13} /> Decline</button>
                        </>) : null}
                        {o.status === 'paid' ? (<>
                          <button onClick={() => act('push_now', o.id)} disabled={!!busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-50">{b('push_now') ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Push to team now</button>
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">Deliver:
                            {inHouse ? <button onClick={() => act('set_delivery', o.id, { date: 'asap' })} disabled={!!busy} className="px-2 py-1 rounded-lg border border-line bg-white text-ink font-semibold disabled:opacity-50">ASAP</button>
                              : <button onClick={() => act('set_delivery', o.id, { date: 'arrival' })} disabled={!!busy} className="px-2 py-1 rounded-lg border border-line bg-white text-ink font-semibold disabled:opacity-50">Arrival day</button>}
                            <input type="date" defaultValue={o.delivery_date || ''} min={o.check_in || undefined} onChange={e => { if (e.target.value) act('set_delivery', o.id, { date: e.target.value }) }} className="px-2 py-1 rounded-lg border border-line text-ink" title="Pick a date" />
                          </span>
                          {canMoney ? <button onClick={() => { if (window.confirm('Cancel this paid order? Refund it in Guesty separately.')) act('cancel', o.id) }} disabled={!!busy} className="text-[12px] text-muted hover:text-rose-700 px-2">Cancel</button> : null}
                        </>) : null}
                        {o.status === 'pushed' ? (<>
                          <button onClick={() => act('delivered', o.id)} disabled={!!busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50"><Check size={13} /> Delivered</button>
                          <button onClick={() => act('push_now', o.id)} disabled={!!busy} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-white border border-line text-ink disabled:opacity-50"><RefreshCw size={13} /> Re-notify</button>
                        </>) : null}
                        <a href={'/order/' + o.link_code} target="_blank" className="text-[12px] text-muted hover:text-ink px-2 inline-flex items-center gap-1"><Link2 size={12} /> guest page</a>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
        <div className="space-y-3">
          {canEdit ? (
            <div className="rounded-2xl border border-line bg-white px-4 py-3 flex flex-wrap items-center gap-2">
              <div className="text-[12.5px] text-muted flex-1 min-w-[200px]">Links are created automatically {data.config.createDaysBefore} days before arrival and written to the reservation’s <b>{data.config.customFieldName}</b> field. Need one sooner? Paste a Guesty reservation id.</div>
              <input value={newRes} onChange={e => setNewRes(e.target.value)} placeholder="Guesty reservation id" className="text-[12.5px] px-2.5 py-1.5 rounded-lg border border-line w-56" />
              <button onClick={() => { if (newRes.trim()) act('create_link', '', { reservationId: newRes.trim() }) }} disabled={!!busy || !newRes.trim()} className="inline-flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-50"><Link2 size={13} /> Create & copy link</button>
            </div>
          ) : null}
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-line"><th className="px-3 py-2">Arrives</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2">Guest</th><th className="px-3 py-2">In Guesty</th><th className="px-3 py-2">Opened</th><th className="px-3 py-2">Orders</th><th className="px-3 py-2"></th></tr></thead>
              <tbody>
                {data.links.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No links yet — they appear as arrivals enter the window{data.config.enabled ? '' : ' once automation is on'}.</td></tr> : null}
                {data.links.map(l => (
                  <tr key={l.code} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">{day(l.check_in)}</td>
                    <td className="px-3 py-2 font-semibold text-ink">{l.unit || '—'}<div className="text-[11px] text-muted font-normal">{l.building || ''}</div></td>
                    <td className="px-3 py-2">{l.guest_name || '—'}<div className="text-[11px] text-muted">{l.source || ''}</div></td>
                    <td className="px-3 py-2">{l.sent_at ? <span className="text-emerald-700">✓ {when(l.sent_at)}</span> : l.send_error ? <span className="text-rose-700" title={l.send_error}>✗ {l.send_error.slice(0, 60)}</span> : <span className="text-muted">not yet</span>}</td>
                    <td className="px-3 py-2">{l.opened_at ? <span className="text-emerald-700">✓</span> : <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2 tabular-nums">{l.orders || ''}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={async () => { try { await navigator.clipboard.writeText(l.url); setFlash({ tone: 'ok', text: 'Copied ' + l.url }) } catch { setFlash({ tone: 'bad', text: l.url }) } }} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg border border-line bg-white hover:border-brand-300"><Copy size={12} /> Copy</button>
                      {canEdit && !l.sent_at ? <button onClick={() => act('write_link', '', { code: l.code })} disabled={!!busy} className="ml-1.5 inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg border border-line bg-white hover:border-brand-300 disabled:opacity-50"><Send size={12} /> Write to Guesty</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
