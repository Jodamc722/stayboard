'use client'
// GUEST ORDERS BOARD — the team's side of the vending machine. One glance answers: what needs
// approving, what is paid and scheduled, what is with the crew today, what failed and why.
// Every row is one line with the ONE verb its status wants first (Approve / Push / Delivered); the
// items, notes, payment steps and every other button that makes sense for the status open under it.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, X, RefreshCw, Copy, Send, Loader2, AlertTriangle, ExternalLink, Truck, Link2, Zap, Palette, Package } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanEmpty, Pill, Tag, IconBtn, Tip, type Tone } from '@/components/lean'
import { InventoryBoard } from '@/components/InventoryBoard'
import { CouponsPanel } from '@/components/CouponsPanel'
import { KNOWN_BUILDINGS } from '@/lib/segments'

type Line = { sku: string; name: string; qty: number; unit_price_usd: number; line_total_usd: number; unit_label?: string | null }
type Order = {
  id: string; link_code: string; reservation_id: string; unit: string | null; building: string | null; market: string | null; guest_name: string | null
  check_in: string | null; check_out: string | null; status: string; items: Line[]; subtotal_usd: number; tax_usd: number; total_usd: number; guest_note: string | null
  discount_usd?: number; discount_note?: string | null; coupon_code?: string | null
  submitted_at: string; approved_at: string | null; approved_by: string | null; paid_at: string | null; payment_note: string | null; charge_error: string | null; folio_note: string | null
  delivery_date: string | null; delivery_note: string | null; requested_delivery?: string; requested_date?: string | null; pushed_at: string | null; breezeway_task_id: string | null; assignee_names: string[]; assign_note: string | null
  stock_note?: string | null; push_error: string | null; delivered_at: string | null; delivered_by: string | null; decline_reason: string | null; approve_token: string | null
  collect_method?: 'card_on_file' | 'payment_link' | 'airbnb_resolution' | null; collect_card?: string | null
}
type LinkRow = { code: string; url: string; reservation_id: string; unit: string | null; building: string | null; guest_name: string | null; source: string | null; check_in: string | null; check_out: string | null; sent_at: string | null; send_error: string | null; opened_at: string | null; orders: number; created_by: string | null }
type Data = { today: string; config: { enabled: boolean; chargeMode: string; customFieldName: string; createDaysBefore: number }; orders: Order[]; links: LinkRow[] }

const money = (n: number) => '$' + (Math.round(n * 100) / 100).toFixed(2)
const day = (s: string | null) => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'
const when = (s: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''

const CHIP: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: 'Needs approval', tone: 'amber' },
  approved: { label: 'Charging…', tone: 'amber' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'amber' },
  payment_failed: { label: 'Charge failed', tone: 'rose' },
  paid: { label: 'Paid · scheduled', tone: 'sky' },
  pushed: { label: 'With the team', tone: 'violet' },
  delivered: { label: 'Delivered', tone: 'emerald' },
  declined: { label: 'Declined', tone: 'slate' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
}
const LANES: { key: string; label: string; statuses: string[] }[] = [
  { key: 'approve', label: 'Needs approval', statuses: ['submitted', 'approved'] },
  { key: 'money', label: 'Payment problems', statuses: ['awaiting_payment', 'payment_failed'] },
  { key: 'scheduled', label: 'Paid · scheduled', statuses: ['paid'] },
  { key: 'crew', label: 'With the team', statuses: ['pushed'] },
  { key: 'done', label: 'Delivered / closed', statuses: ['delivered', 'declined', 'cancelled'] },
]

// ORDERS · LINKS · STOCK · PRICING — everything about guest orders on one page. Stock is per
// shelf and belongs to whoever is restocking; Pricing is per item and belongs at a desk; keeping
// them as separate tabs rather than one board is what stops either becoming a wall of numbers.
const TABS = ['orders', 'links', 'catalog', 'stock', 'coupons'] as const
type Tab = typeof TABS[number]
const TAB_LABEL: Record<Tab, string> = { orders: 'Orders', links: 'Links', catalog: 'Catalog', stock: 'Stock', coupons: 'Coupons' }

export function GuestOrdersBoard({ canEdit, canMoney }: { canEdit: boolean; canMoney: boolean }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('orders')
  const [lane, setLane] = useState<string>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [paidNote, setPaidNote] = useState<Record<string, string>>({})
  const [settle, setSettle] = useState<Record<string, 'guesty' | 'external' | 'outside'>>({})
  const [copied, setCopied] = useState<string>('')
  const [newRes, setNewRes] = useState('')

  const copy = useCallback((key: string, text: string) => {
    try { navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(c => (c === key ? '' : c)), 1600) } catch { /* clipboard blocked — the value is on screen anyway */ }
  }, [])

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
  // Jon, 2026-09-10: "the count and costs should be done in the guest order tab in the app." So
  // counting and pricing are tabs here rather than a page you navigate away to — /guest-orders is
  // the one place the whole thing lives. A ?tab= in the URL still picks one, so old bookmarks and
  // the links elsewhere in the app land where they meant to.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'pricing') setTab('catalog')
    else if (t && (TABS as readonly string[]).indexOf(t) >= 0) setTab(t as Tab)
  }, [])

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

  const head = (pills?: ReactNode) => (
    <LeanHead title={<span title="Pre-arrival extras guests pick from their reservation link. Approve, it is charged on the card in Guesty, then pushed to Breezeway and the crew on the delivery day.">Guest Orders</span>}>{pills}</LeanHead>
  )
  if (err) return <>{head()}<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div></>
  if (!data) return <>{head()}<LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1.5" />Loading orders…</LeanEmpty></>

  const manual = data.config.chargeMode === 'manual'
  const todayDue = data.orders.filter(o => (o.status === 'paid' || o.status === 'pushed') && o.delivery_date && o.delivery_date <= data.today).length
  const pickLane = (k: string) => { setTab('orders'); setLane(lane === k ? 'all' : k) }

  return (
    <div>
      {/* LEAN PASS (2026-09-22): the five lane tiles are header pills; clicking one filters Orders to
          that lane (click again for all). Every lane is also in the Orders filter dropdown. */}
      {head(<>
        {!data.config.enabled && <Pill tone="amber" onClick={() => { window.location.href = '/users' }} title="Automation is off: links are not being created for arrivals and paid orders are not pushed to the team. Everything here still works by hand. Click to open App settings, Guest orders.">Automation off</Pill>}
        {counts.approve ? <Pill tone="amber" onClick={() => pickLane('approve')} title="Baskets waiting for approval">{counts.approve} to approve</Pill> : null}
        {counts.money ? <Pill tone="rose" onClick={() => pickLane('money')} title="Awaiting payment or the charge failed">{counts.money} payment</Pill> : null}
        <Pill tone="sky" onClick={() => pickLane('scheduled')} title="Paid and scheduled for delivery">{counts.scheduled || 0} scheduled</Pill>
        <Pill tone="violet" onClick={() => pickLane('crew')} title={`With the team${todayDue ? ` · ${todayDue} due today or earlier` : ''}`}>{counts.crew || 0} with team{todayDue ? ` · ${todayDue} due` : ''}</Pill>
      </>)}

      <LeanTabs<Tab>
        tabs={TABS.map(t => ({ key: t, label: TAB_LABEL[t], n: t === 'orders' ? shown.length : t === 'links' ? data.links.length : null }))}
        value={tab} onChange={setTab}
        right={<>
          {tab === 'orders' && (
            <select value={lane} onChange={e => setLane(e.target.value)} title="Show one lane" className="text-[12px] py-1 px-2 rounded-lg border border-line bg-white text-ink">
              <option value="all">All open</option>
              {LANES.map(l => <option key={l.key} value={l.key}>{l.label} ({counts[l.key] || 0})</option>)}
            </select>
          )}
          {canEdit ? <IconBtn title="Design studio — the guest ordering page" href="/guest-orders/design"><Palette size={14} /></IconBtn> : null}
          <Tip label="Live orders link for the team (opens a new tab)">
            <a href="/orders-live" target="_blank" aria-label="Live orders link for the team" className="shrink-0 inline-flex items-center justify-center rounded-lg border border-line bg-white w-8 h-8 text-muted hover:text-ink hover:bg-app"><ExternalLink size={14} /></a>
          </Tip>
          {canMoney ? <IconBtn title="Run now — create due links and push due orders" onClick={() => act('run_cron', '')} disabled={!!busy}><Zap size={14} /></IconBtn> : null}
        </>}
      />

      {flash ? <div className={'mb-3 rounded-lg px-3 py-1.5 text-[12.5px] ' + (flash.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200')}>{flash.text}</div> : null}

      {tab === 'stock' || tab === 'catalog' ? <InventoryBoard canEdit={canEdit} view={tab} onSwitchView={v => setTab(v)} /> : null}
      {tab === 'coupons' ? <CouponsPanel canEdit={canEdit} canMoney={canMoney} buildings={KNOWN_BUILDINGS.map(b => b.label)} /> : null}

      {tab === 'orders' ? (
        shown.length === 0 ? (
          <LeanEmpty>No orders here. Guests order from the link in their reservation&apos;s &ldquo;{data.config.customFieldName}&rdquo; field; new baskets land in Needs approval.</LeanEmpty>
        ) : (
          <LeanList>
            {shown.map(o => {
              const chip = CHIP[o.status] || { label: o.status, tone: 'slate' as Tone }
              const b = (a: string) => busy === o.id + ':' + a
              const inHouse = !!(o.check_in && data.today > o.check_in)
              const staleApproved = o.status === 'approved' && !!o.approved_at && Date.now() - new Date(o.approved_at).getTime() > 10 * 60_000
              const needsApproval = o.status === 'submitted' || staleApproved
              const btn = 'shrink-0 inline-flex items-center gap-1 rounded-full px-3 h-8 text-[12px] font-semibold disabled:opacity-50'
              // THE VERB FIRST: the one thing this status wants done, as the row's lead button.
              const lead = !canEdit ? undefined
                : needsApproval && canMoney ? <Tip label={o.status === 'approved' ? 'Retry the charge in Guesty' : manual ? 'Approve the order' : 'Approve and charge the card in Guesty'}><button onClick={() => act('approve', o.id)} disabled={!!busy} className={btn + ' bg-emerald-600 text-white hover:bg-emerald-700'}>{b('approve') ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {o.status === 'approved' ? 'Retry' : 'Approve'}</button></Tip>
                : o.status === 'paid' ? <Tip label="Push to Breezeway and the crew now"><button onClick={() => act('push_now', o.id)} disabled={!!busy} className={btn + ' bg-ink text-white'}>{b('push_now') ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Push</button></Tip>
                : o.status === 'pushed' ? <Tip label="Mark delivered"><button onClick={() => act('delivered', o.id)} disabled={!!busy} className={btn + ' bg-emerald-600 text-white hover:bg-emerald-700'}><Check size={13} /> Delivered</button></Tip>
                : undefined
              const itemsText = o.items.map(l => l.qty + '× ' + l.name).join(', ')
              const deliverDue = !!o.delivery_date && o.delivery_date <= data.today && o.status !== 'delivered'
              return (
                <LeanRow key={o.id} tint={o.status === 'payment_failed' || o.charge_error || o.push_error ? 'rose' : needsApproval ? 'amber' : undefined}
                  lead={lead}
                  name={o.unit || 'Unit'}
                  meta={`${o.guest_name || 'Guest'} · ${day(o.check_in)}–${day(o.check_out)}${o.building ? ' · ' + o.building : ''}`}
                  tags={<>
                    <Tag tone={chip.tone}>{chip.label}</Tag>
                    <Tag title={itemsText + ' · ordered ' + when(o.submitted_at)}>{money(o.total_usd)}</Tag>
                    {o.discount_usd ? <Tag tone="emerald" title={o.coupon_code ? 'Coupon ' + o.coupon_code : o.discount_note || 'Discount'}>−{money(o.discount_usd)}</Tag> : null}
                    {inHouse && <Tag>In-house</Tag>}
                    {o.delivery_date ? <Tag tone={deliverDue ? 'violet' : 'slate'} title={o.delivery_note || 'Delivery day'}>Deliver {o.delivery_date === data.today ? 'today' : day(o.delivery_date)}</Tag>
                      : o.delivery_note ? <Tag tone="amber" title={o.delivery_note}>Delivery?</Tag> : null}
                    {o.charge_error && <Tag tone="rose" title={o.charge_error}>Charge error</Tag>}
                    {o.push_error && <Tag tone="rose" title={o.push_error}>Push failed</Tag>}
                    {o.folio_note && <Tag tone="amber" title={o.folio_note}>Folio</Tag>}
                    {o.stock_note && /SHORT/.test(o.stock_note) && <Tag tone="rose" title={o.stock_note}>Short stock</Tag>}
                    {o.guest_note && <Tag title={o.guest_note}>Note</Tag>}
                  </>}
                  actions={<IconBtn title="Open the guest's order page" href={'/order/' + o.link_code}><Link2 size={14} /></IconBtn>}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {o.items.map((l, i) => <span key={i} className="text-[12px] px-2 py-0.5 rounded-lg bg-app border border-line text-ink"><b>{l.qty}×</b> {l.name}</span>)}
                  </div>
                  <div className="text-[12px] text-muted">
                    Ordered {when(o.submitted_at)} · {money(o.subtotal_usd)} items{o.tax_usd ? ' + ' + money(o.tax_usd) + ' tax' : ''}
                    {o.discount_usd ? ' · −' + money(o.discount_usd) + (o.coupon_code ? ' code ' + o.coupon_code : o.discount_note ? ' ' + o.discount_note : '') : ''}
                    {o.delivery_note ? ' · ' + o.delivery_note : ''}
                  </div>
                  {o.requested_delivery && o.requested_delivery !== 'auto' ? <div className="text-[12px] text-ink"><span className="text-muted">Guest asked for:</span> {o.requested_delivery === 'asap' ? 'as soon as possible' : o.requested_delivery === 'arrival' ? 'arrival day' : day(o.requested_date || null)}</div> : null}
                  {o.guest_note ? <div className="text-[12.5px] italic text-muted">“{o.guest_note}”</div> : null}
                  {o.payment_note ? <div className="text-[12px] text-emerald-800">{o.payment_note}</div> : null}
                  {o.charge_error ? <div className="text-[12.5px] text-rose-700 bg-rose-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {o.charge_error}</div> : null}
                  {o.push_error ? <div className="text-[12.5px] text-rose-700 bg-rose-50 rounded-lg px-3 py-2">Push failed: {o.push_error}</div> : null}
                  {o.folio_note ? <div className="text-[12.5px] text-amber-800 bg-amber-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {o.folio_note}</div> : null}
                  {o.stock_note ? <div className={'text-[12px] ' + (/SHORT/.test(o.stock_note) ? 'text-rose-700 font-semibold' : 'text-muted')}><Package size={12} className="inline mr-1 -mt-0.5" />{o.stock_note}</div> : null}
                  {o.status === 'pushed' || o.status === 'delivered' ? (
                    <div className="text-[12px] text-muted"><Truck size={12} className="inline mr-1 -mt-0.5" />{o.assignee_names.length ? o.assignee_names.join(' + ') : 'unassigned'}{o.assign_note ? ' — ' + o.assign_note : ''}{o.breezeway_task_id ? ' · Breezeway #' + o.breezeway_task_id : ''}{o.delivered_at ? ' · delivered ' + when(o.delivered_at) + (o.delivered_by ? ' by ' + o.delivered_by : '') : ''}</div>
                  ) : null}
                  {o.decline_reason ? <div className="text-[12px] text-muted">Declined: {o.decline_reason}</div> : null}

                  {(o.status === 'awaiting_payment' || o.status === 'payment_failed') && canMoney ? (() => {
                    // Whoever opens this row should not have to work out what to do next. The amount
                    // is the total INCLUDING tax — it is the figure to type into Guesty.
                    const link = o.collect_method === 'payment_link'
                    const airbnb = o.collect_method === 'airbnb_resolution'
                    const headline = airbnb ? 'Request through the Airbnb Resolution Center'
                      : link ? 'Send a Guesty payment link'
                      : o.collect_card ? 'Charge the ' + o.collect_card + ' on file' : 'Charge the card on file in Guesty'
                    const ref = 'Guest order ' + o.id.slice(0, 8) + ' · ' + itemsText
                    return (
                      <div className={'rounded-xl border px-3 py-2.5 ' + (link || airbnb ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50')}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[12.5px] font-semibold text-ink">{headline}</span>
                          <span className="text-[15px] font-bold text-ink tabular-nums" title={money(o.subtotal_usd) + ' items' + (o.tax_usd ? ' + ' + money(o.tax_usd) + ' tax' : ' · no tax')}>{money(o.total_usd)}</span>
                          <button onClick={() => copy('amt:' + o.id, o.total_usd.toFixed(2))} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg bg-white border border-line text-ink"><Copy size={12} /> {copied === 'amt:' + o.id ? 'Copied' : 'Amount'}</button>
                          <button onClick={() => copy('ref:' + o.id, ref)} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg bg-white border border-line text-ink"><Copy size={12} /> {copied === 'ref:' + o.id ? 'Copied' : 'Note'}</button>
                          <a href={'https://app.guesty.com/reservations/' + o.reservation_id + '/summary'} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-brand-700 hover:underline inline-flex items-center gap-1">Open in Guesty <ExternalLink size={11} /></a>
                        </div>
                        <div className="mt-1 text-[11.5px] text-muted">The charge is already on the Guesty folio, so the card or a payment link both settle it. Mark paid here once the money lands.</div>
                      </div>
                    )
                  })() : null}

                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {needsApproval ? (<>
                        {/* Approve itself is the row's lead button. */}
                        {canMoney ? null : <span className="text-[12px] text-muted">Approval needs full access</span>}
                        {o.status === 'submitted' ? <button onClick={() => { const reason = window.prompt('Reason for the guest (optional)') || ''; act('decline', o.id, { reason }) }} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-white border border-line text-ink disabled:opacity-50"><X size={13} /> Decline</button> : null}
                      </>) : o.status === 'approved' ? <span className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Charging in Guesty — refresh in a moment</span> : null}
                      {o.status === 'awaiting_payment' || o.status === 'payment_failed' ? (<>
                        {canMoney && !manual ? <button onClick={() => act('approve', o.id)} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-white border border-line text-ink disabled:opacity-50">{b('approve') ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Retry charge</button> : null}
                        {canMoney ? (
                          <span className="inline-flex items-center gap-1.5 flex-wrap">
                            <select value={settle[o.id] || 'guesty'} onChange={e => setSettle(p => ({ ...p, [o.id]: e.target.value as any }))} className="text-[12px] px-2 py-1 rounded-lg border border-line bg-white text-ink" title="Where the money was actually taken — it decides what we write back to Guesty">
                              <option value="guesty">Taken in Guesty</option>
                              <option value="external">Taken elsewhere — record it in Guesty</option>
                              <option value="outside">Taken elsewhere — don’t touch Guesty</option>
                            </select>
                            <input value={paidNote[o.id] || ''} onChange={e => setPaidNote(p => ({ ...p, [o.id]: e.target.value }))} placeholder="note (optional)" className="text-[12px] px-2 py-1 rounded-lg border border-line w-32" />
                            <button onClick={() => act('mark_paid', o.id, { note: paidNote[o.id] || '', settle: settle[o.id] || 'guesty' })} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-emerald-600 text-white disabled:opacity-50"><Check size={13} /> Mark paid</button>
                          </span>
                        ) : null}
                        <button onClick={() => act('decline', o.id, { reason: 'could not collect payment' })} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-white border border-line text-ink disabled:opacity-50"><X size={13} /> Decline</button>
                      </>) : null}
                      {o.status === 'paid' ? (<>
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">Deliver:
                          {inHouse ? <button onClick={() => act('set_delivery', o.id, { date: 'asap' })} disabled={!!busy} className="px-2 py-1 rounded-lg border border-line bg-white text-ink font-semibold disabled:opacity-50">ASAP</button>
                            : <button onClick={() => act('set_delivery', o.id, { date: 'arrival' })} disabled={!!busy} className="px-2 py-1 rounded-lg border border-line bg-white text-ink font-semibold disabled:opacity-50">Arrival day</button>}
                          <input type="date" defaultValue={o.delivery_date || ''} min={o.check_in || undefined} onChange={e => { if (e.target.value) act('set_delivery', o.id, { date: e.target.value }) }} className="px-2 py-1 rounded-lg border border-line text-ink" title="Pick a delivery date" />
                        </span>
                        {canMoney ? <button onClick={() => { if (window.confirm('Cancel this paid order? Refund it in Guesty separately.')) act('cancel', o.id) }} disabled={!!busy} className="text-[12px] text-muted hover:text-rose-700 px-2">Cancel order</button> : null}
                      </>) : null}
                      {o.status === 'pushed' ? (
                        <button onClick={() => act('push_now', o.id)} disabled={!!busy} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-white border border-line text-ink disabled:opacity-50"><RefreshCw size={13} /> Re-notify the crew</button>
                      ) : null}
                    </div>
                  ) : null}
                </LeanRow>
              )
            })}
          </LeanList>
        )
      ) : tab === 'links' ? (
        <div className="space-y-3">
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <input value={newRes} onChange={e => setNewRes(e.target.value)} placeholder="Guesty reservation id"
                title={`Links are created automatically ${data.config.createDaysBefore} days before arrival and written to the reservation's ${data.config.customFieldName} field. Need one sooner? Paste a Guesty reservation id.`}
                className="text-[12px] px-2.5 py-1 rounded-lg border border-line w-full sm:w-56" />
              <button onClick={() => { if (newRes.trim()) act('create_link', '', { reservationId: newRes.trim() }) }} disabled={!!busy || !newRes.trim()} className="inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-ink text-white disabled:opacity-50"><Link2 size={13} /> Create & copy link</button>
              <span className="text-[11px] text-muted">Auto {data.config.createDaysBefore}d before arrival</span>
            </div>
          ) : null}
          {data.links.length === 0 ? (
            <LeanEmpty>No links yet — they appear as arrivals enter the window{data.config.enabled ? '' : ' once automation is on'}.</LeanEmpty>
          ) : (
            <LeanList>
              {data.links.map(l => (
                <LeanRow key={l.code}
                  name={l.unit || '—'}
                  meta={`${l.guest_name || '—'} · arrives ${day(l.check_in)}${l.building ? ' · ' + l.building : ''}`}
                  tags={<>
                    {l.source && <Tag>{l.source}</Tag>}
                    {l.sent_at ? <Tag tone="emerald" title={'Written to Guesty ' + when(l.sent_at)}>In Guesty</Tag>
                      : l.send_error ? <Tag tone="rose" title={l.send_error}>Guesty error</Tag>
                      : <Tag title="Not written to the reservation yet">Not in Guesty</Tag>}
                    {l.opened_at && <Tag tone="brand" title="The guest has opened the link">Opened</Tag>}
                    {l.orders ? <Tag tone="violet">{l.orders} order{l.orders === 1 ? '' : 's'}</Tag> : null}
                  </>}
                  actions={<>
                    <IconBtn title="Copy the guest's order link" onClick={async () => { try { await navigator.clipboard.writeText(l.url); setFlash({ tone: 'ok', text: 'Copied ' + l.url }) } catch { setFlash({ tone: 'bad', text: l.url }) } }}><Copy size={14} /></IconBtn>
                    {canEdit && !l.sent_at ? <IconBtn title="Write the link to the reservation in Guesty" onClick={() => act('write_link', '', { code: l.code })} disabled={!!busy}><Send size={14} /></IconBtn> : null}
                  </>}
                />
              ))}
            </LeanList>
          )}
        </div>
      ) : null}
    </div>
  )
}
