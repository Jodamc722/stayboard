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
  Building2, Layers, Split, Link2, AlertTriangle, Sparkles, ChevronDown, ChevronRight,
} from 'lucide-react'
import { money, ORDER_STATUS_LABEL, STAGE_LABEL } from '@/lib/ffe-catalog'
import { BEDROOM_NO, ROOM_ORDER, stripVariant } from '@/lib/ffe-checklist'

type Line = {
  id: string; listing_id: string; unit_name: string; building: string; room: string; item_key: string
  roomLabel: string; itemLabel: string; title: string | null
  catalog_id: string | null; code: string | null; product: string | null; image_url: string | null
  url: string | null; vendor: string | null; vendor_sku: string | null
  qty: number; unit_cost: number | null; placement: string | null; spec: string | null; stage: string
  po_number: string | null; vendor_ref: string | null; note: string | null; received_at: string | null
  // From the walk, joined live by the API (Jon, 2026-08-17: "need to see the photo from the audit
  // and notes, if any, in the order form").
  walkPhoto?: string | null; walkReplacementPhoto?: string | null; walkUrl?: string | null
  walkNote?: string | null; walkSpec?: string | null
  // Our recommendation strength (Jon, 2026-08-18): must / recommended / nice, with a why.
  priority?: string | null; priority_reason?: string | null
}
type Order = {
  id: string; order_no: string; title: string | null; owner_name: string | null; owner_id: string
  status: string; note: string | null; owner_note: string | null
  decided_at: string | null; decided_by: string | null; sent_at: string | null
  ai_brief?: string | null
}
type Prod = { id: string; code: string; name_en: string; category: string; item_keys: string[] | null; unit_cost: number | null }

// The three recommendation tiers, and the one-tap cycle a human uses to overrule the AI.
const TIERS = ['must', 'recommended', 'nice'] as const
const TIER_LABEL: Record<string, string> = { must: 'Needs replacing', recommended: 'We recommend', nice: 'Nice to have' }
const TIER_CLS: Record<string, string> = {
  must: 'bg-rose-100 text-rose-700 border-rose-200',
  recommended: 'bg-sky-100 text-sky-700 border-sky-200',
  nice: 'bg-neutral-100 text-neutral-600 border-neutral-200',
}
const nextTier = (p: string | null | undefined): string =>
  !p ? 'must' : TIERS[(TIERS.indexOf(p as any) + 1) % TIERS.length]

const STAGE_CLS: Record<string, string> = {
  draft: 'bg-neutral-100 text-neutral-600',
  sent: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-rose-100 text-rose-700',
  ordered: 'bg-blue-100 text-blue-700',
  delivered: 'bg-violet-100 text-violet-700',
  installed: 'bg-emerald-600 text-white',
}

// The forward journey, in the order the strip reads. Declined sits apart — it is an owner's answer,
// not a step on the way.
const PIPE = ['draft', 'sent', 'approved', 'ordered', 'delivered', 'installed'] as const

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
  // AI: one button classifies every line into a tier and writes the owner brief; per-bedroom
  // suggestions come back as proposals and apply only on a human tap.
  const [aiBusy, setAiBusy] = useState(false)
  const [sugFor, setSugFor] = useState('')
  const [sugs, setSugs] = useState<any[] | null>(null)
  const [sugBusy, setSugBusy] = useState('')
  const aiOrganize = async () => {
    setAiBusy(true); setErr('')
    try {
      const r = await fetch('/api/audit/ffe/orders/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, mode: 'organize' }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'AI could not organize this order.')
      setMsg('Organized: every line now carries a recommendation tier — tap any tier chip to overrule it.')
      await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setAiBusy(false)
  }
  const aiBedrooms = async (itemKey: string) => {
    setSugFor(itemKey); setSugs(null); setErr('')
    try {
      const r = await fetch('/api/audit/ffe/orders/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, mode: 'bedrooms', itemKey }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.error || 'Could not suggest per-bedroom styles.')
      setSugs(j.suggestions || [])
    } catch (e: any) { setErr(String(e?.message || e)); setSugFor('') }
  }
  const setTier = (l: Line) => post({ action: 'setLine', lineId: l.id, priority: nextTier(l.priority), priorityReason: 'Set by the team.' })

  // TWO WAYS TO READ THE SAME ORDER, because two different people read it.
  //   By unit  — what goes in 1101. This is the install crew's view and the work order's shape.
  //   By item  — every nightstand in the order at once. This is the BUYER's view, and it is where
  //              the decision actually gets made: you pick one nightstand and it lands on all
  //              twelve units, instead of choosing the same product twelve times.
  //
  // DEFAULT IS THE FULL LIST (Jon, 2026-08-17: opened Rock Soffer's 200-line order and "don't see
  // the long list of items" — the grouped view had collapsed it to 32 rows and read as missing
  // data). Grouping is a tool you reach for, never the thing that hides the order. The last choice
  // is remembered per person.
  const [view, setViewRaw] = useState<'unit' | 'item'>('unit')
  useEffect(() => { try { const v = localStorage.getItem('ffe_order_view'); if (v === 'item' || v === 'unit') setViewRaw(v) } catch {} }, [])
  const setView = (v: 'unit' | 'item') => { setViewRaw(v); try { localStorage.setItem('ffe_order_view', v) } catch {} }
  // Which By-item groups are expanded to show their underlying lines.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  // Jon, 2026-08-13: "make it default to have the same item, but... select one style for bedroom 3
  // and bedroom 1." So bedroom items arrive MERGED — one nightstand decision covering every
  // bedroom — and splitting is a deliberate click, per item, when you want the primary to differ
  // from the guest rooms. Split state is per item_key: split the nightstands without splitting the
  // dressers.
  const [split, setSplit] = useState<Record<string, boolean>>({})

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
  const unitCount = useMemo(() => new Set(lines.map(l => l.unit_name || l.listing_id)).size, [lines])

  // ── FOCUS, NEVER CONCEALMENT ────────────────────────────────────────────────────────────────
  // The pipeline strip and the tier chips are FILTERS the person can see and undo: while one is on,
  // a banner keeps "showing X of Y lines" in view. A filtered list that looks complete is how a
  // 200-line order reads as missing data (Jon, 2026-08-17) — so the narrowing is always announced.
  const [stageFilter, setStageFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const visLines = useMemo(() => lines.filter(l =>
    (!stageFilter || l.stage === stageFilter) &&
    (!tierFilter || (tierFilter === 'none' ? !l.priority : l.priority === tierFilter))
  ), [lines, stageFilter, tierFilter])
  const stageRoll = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of lines) m[l.stage] = (m[l.stage] || 0) + 1
    return m
  }, [lines])
  const tierRoll = useMemo(() => {
    const r: Record<string, { n: number; v: number }> = { must: { n: 0, v: 0 }, recommended: { n: 0, v: 0 }, nice: { n: 0, v: 0 }, none: { n: 0, v: 0 } }
    for (const l of live) {
      const k = l.priority && r[l.priority] ? l.priority : 'none'
      r[k].n += 1; r[k].v += l.unit_cost == null ? 0 : Number(l.unit_cost) * l.qty
    }
    return r
  }, [live])

  const byUnit = useMemo(() => {
    const m: Record<string, Line[]> = {}
    for (const l of visLines) (m[l.unit_name || l.listing_id] = m[l.unit_name || l.listing_id] || []).push(l)
    return m
  }, [visLines])

  // ── ONE DECISION PER ROW ────────────────────────────────────────────────────────────────────
  // A group is one buying decision: "the nightstands", not "the nightstand in 1101". Bedroom items
  // collapse across bedrooms unless that item has been split, so the default really is the same
  // product everywhere and difference is something you choose.
  type Group = {
    key: string; itemKey: string; label: string; where: string
    bedroom: boolean; slots: number[]; splitable: boolean; lines: Line[]; sort: number
  }
  const groups = useMemo(() => {
    const m: Record<string, Group> = {}
    // How many bedroom slots this item spans across the whole order — a 1-bed-only item has
    // nothing to split, so it should not offer to.
    const slotsPerItem: Record<string, Set<number>> = {}
    for (const l of lines) {
      const bn = BEDROOM_NO[l.room]
      if (bn) (slotsPerItem[l.item_key] = slotsPerItem[l.item_key] || new Set()).add(bn)
    }

    for (const l of visLines) {
      const bn = BEDROOM_NO[l.room]
      const spans = bn ? (slotsPerItem[l.item_key]?.size || 1) : 0
      const merged = !!bn && spans > 1 && !split[l.item_key]
      const key = merged ? 'bed::' + l.item_key : l.room + '::' + l.item_key
      if (!m[key]) {
        m[key] = {
          key, itemKey: l.item_key,
          label: merged ? stripVariant(l.itemLabel) : l.itemLabel,
          where: '', bedroom: !!bn, slots: [], splitable: !!bn && spans > 1,
          lines: [], sort: (ROOM_ORDER[l.room] ?? 99) * 100 + (merged ? 0 : (bn || 0)),
        }
      }
      const g = m[key]
      g.lines.push(l)
      if (bn && g.slots.indexOf(bn) < 0) g.slots.push(bn)
      if (!bn && !g.where) g.where = l.roomLabel
      // An order can hold 1-bed and 3-bed units together, so the same group can see both
      // "Nightstands" and "Nightstands — Order 1". Keep the fuller label rather than whichever unit
      // happened to sort first — and keep it language-agnostic by comparing length, not parsing.
      if (!merged && l.itemLabel.length > g.label.length) g.label = l.itemLabel
    }

    const out = Object.values(m)
    for (const g of out) {
      g.slots.sort((a, b) => a - b)
      if (g.bedroom) {
        g.where = g.slots.length > 1
          ? 'Bedrooms ' + g.slots.slice(0, -1).join(', ') + ' & ' + g.slots[g.slots.length - 1]
          : 'Bedroom ' + g.slots[0]
      }
      g.lines.sort((a, b) => (a.unit_name || '').localeCompare(b.unit_name || '', undefined, { numeric: true }))
    }
    return out.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
  }, [lines, visLines, split])

  /** What a group currently points at: one product, several, or nothing yet. */
  const productOf = (g: Group) => {
    const ids = Array.from(new Set(g.lines.map(l => l.catalog_id || '')))
    if (ids.length === 1 && ids[0]) {
      const l = g.lines.find(x => x.catalog_id)
      return { one: true, id: ids[0], label: (l?.code ? l.code + ' · ' : '') + (l?.product || '') }
    }
    if (ids.length === 1) return { one: false, id: '', label: '' }
    return { one: false, id: '', label: ids.filter(Boolean).length + ' different products' }
  }

  /** Set one product across every line in the group — the whole point of this view. */
  const applyToGroup = async (g: Group, catalogId: string) => {
    if (!catalogId) return
    await post({ action: 'applyProduct', lineIds: g.lines.map(l => l.id), catalogId })
  }

  /**
   * Re-merge a split item: bedroom 1's product becomes every bedroom's product, then the rows
   * collapse back into one. Without the apply this would only hide the difference, not undo it.
   */
  const matchBedrooms = async (itemKey: string) => {
    const fam = lines.filter(l => l.item_key === itemKey && BEDROOM_NO[l.room])
    const lead = fam.find(l => BEDROOM_NO[l.room] === 1 && l.catalog_id)
    const rest = fam.filter(l => l.id !== lead?.id)
    if (lead?.catalog_id && rest.length) {
      await post({ action: 'applyProduct', lineIds: rest.map(l => l.id), catalogId: lead.catalog_id })
    }
    setSplit(s => { const n = { ...s }; delete n[itemKey]; return n })
  }

  const undecided = groups.filter(g => !productOf(g).one).length

  // WHAT TO DO NEXT — one sentence, computed from where the lines actually are. A world-class order
  // page answers "so what do I do now?" without the person reconstructing the lifecycle in their head.
  const hint = useMemo(() => {
    if (!lines.length) return 'No lines on this order yet.'
    if (order?.status === 'changes') return 'The owner asked for changes — read their note below, adjust the lines, and send again.'
    if (order?.status === 'draft') return undecided
      ? `${undecided} buying decision${undecided === 1 ? '' : 's'} still open — pick products in By item, run AI organize, then send to the owner.`
      : 'Ready to go — AI organize writes the brief and the recommendation tiers, then send it to the owner.'
    if ((stageRoll.approved || 0) > 0) return `${stageRoll.approved} approved and waiting to be bought — Export → Buy list, then select lines and mark them ordered as you place them.`
    if (order?.status === 'sent') return 'With the owner. Copy the link to nudge them, or keep editing and send again.'
    if ((stageRoll.ordered || 0) > 0) return `${stageRoll.ordered} with vendors — select lines and mark them delivered as they arrive.`
    if ((stageRoll.delivered || 0) > 0) return `${stageRoll.delivered} delivered — mark them installed once they are in the room.`
    if (live.length && (stageRoll.installed || 0) === live.length) return 'Everything is installed. This one is done.'
    return ''
  }, [lines.length, order?.status, undecided, stageRoll, live.length])

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
      {/* ── THE ORDER, IN ONE CARD (Jon, 2026-08-18: "consolidate the order experience") ────────
          Name and money on top; the journey as a strip you can tap; the recommendation mix with
          dollars; one contextual next step; and every action in one bar — Export is a single menu
          instead of five loose buttons. The strip and the chips focus the list below, and the
          banner further down keeps the full count on screen the whole time a filter is narrowing. */}
      <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden">
        <div className="px-4 pt-3 flex items-center gap-3 flex-wrap">
          <a href="/ffe#orders" className="text-[12.5px] font-semibold text-muted inline-flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" /> Orders
          </a>
          <h2 className="text-xl font-bold text-ink">{order.order_no}</h2>
          <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' +
            (order.status === 'approved' ? 'bg-emerald-100 text-emerald-700'
              : order.status === 'changes' ? 'bg-rose-100 text-rose-700'
                : order.status === 'sent' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-200 text-neutral-700')}>
            {ORDER_STATUS_LABEL[order.status] || order.status}
          </span>
          <span className="text-[12.5px] text-muted truncate max-w-[320px]">{order.title || order.owner_name}</span>
          <div className="flex-1" />
          <div className="text-right">
            <div className="text-xl font-bold text-ink tabular-nums leading-tight">{money(total)}</div>
            <div className="text-[11px] text-muted">
              {live.length} line{live.length === 1 ? '' : 's'} · {unitCount} unit{unitCount === 1 ? '' : 's'}
              {unpriced ? <span className="text-amber-700 font-semibold"> · {unpriced} unpriced</span> : null}
            </div>
          </div>
        </div>

        {/* the journey — tap a stage to see exactly those lines */}
        <div className="px-4 pt-3">
          <div className="lh-hscroll -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="flex gap-1 items-stretch">
            {PIPE.map(s => {
              const n = stageRoll[s] || 0
              const on = stageFilter === s
              return (
                <button key={s} onClick={() => setStageFilter(on ? '' : s)}
                  title={n ? `${STAGE_LABEL[s]} — ${n} line${n === 1 ? '' : 's'}. Tap to see only these.` : `No lines ${STAGE_LABEL[s].toLowerCase()} yet.`}
                  className={'flex-1 min-w-[72px] sm:min-w-0 rounded-lg px-1 py-1.5 text-center border transition ' +
                    (on ? 'border-ink ring-1 ring-ink ' : 'border-transparent ') +
                    (n ? STAGE_CLS[s] : 'bg-app text-muted/50')}>
                  <div className="text-[13px] font-bold tabular-nums leading-none">{n}</div>
                  <div className="text-[10px] sm:text-[8.5px] font-bold uppercase tracking-wide mt-0.5 truncate">{STAGE_LABEL[s]}</div>
                </button>
              )
            })}
            {stageRoll.declined ? (
              <button onClick={() => setStageFilter(stageFilter === 'declined' ? '' : 'declined')}
                title="Lines the owner said no to. Tap to see only these."
                className={'shrink-0 rounded-lg px-2 py-1.5 text-center border transition ' +
                  (stageFilter === 'declined' ? 'border-ink ring-1 ring-ink ' : 'border-transparent ') + STAGE_CLS.declined}>
                <div className="text-[13px] font-bold tabular-nums leading-none">{stageRoll.declined}</div>
                <div className="text-[10px] sm:text-[8.5px] font-bold uppercase tracking-wide mt-0.5">Not taken</div>
              </button>
            ) : null}
          </div>
          </div>
        </div>

        {/* the recommendation mix, with dollars — and the view, one control, in one place */}
        <div className="px-4 py-2.5"><div className="lh-actions flex flex-wrap items-center gap-1.5">
          {TIERS.map(k => tierRoll[k].n ? (
            <button key={k} onClick={() => setTierFilter(tierFilter === k ? '' : k)}
              title="Tap to see only these lines."
              className={'text-[10.5px] font-bold px-2 py-1 rounded-lg border ' + TIER_CLS[k] + (tierFilter === k ? ' ring-1 ring-ink' : '')}>
              {TIER_LABEL[k]} {tierRoll[k].n}{tierRoll[k].v ? ' · ' + money(tierRoll[k].v) : ''}
            </button>
          ) : null)}
          {tierRoll.none.n && (tierRoll.must.n || tierRoll.recommended.n || tierRoll.nice.n) ? (
            <button onClick={() => setTierFilter(tierFilter === 'none' ? '' : 'none')}
              className={'text-[10.5px] font-bold px-2 py-1 rounded-lg border border-dashed border-neutral-300 text-neutral-500 bg-white' + (tierFilter === 'none' ? ' ring-1 ring-ink' : '')}>
              No tier yet {tierRoll.none.n}
            </button>
          ) : null}
          {undecided ? (
            <span className="text-[10.5px] font-bold px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
              {undecided} product decision{undecided === 1 ? '' : 's'} open
            </span>
          ) : null}
          <div className="flex-1" />
          <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
            <button onClick={() => setView('item')}
              className={'rounded-md px-2.5 py-1 text-[11.5px] font-semibold inline-flex items-center gap-1 ' +
                (view === 'item' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              <Layers className="w-3 h-3" /> By item
            </button>
            <button onClick={() => setView('unit')}
              className={'rounded-md px-2.5 py-1 text-[11.5px] font-semibold inline-flex items-center gap-1 ' +
                (view === 'unit' ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>
              <Building2 className="w-3 h-3" /> By unit
            </button>
          </div>
        </div></div>

        {/* every action, one bar */}
        <div className="px-3 py-2.5 border-t border-line bg-app/40 flex flex-wrap items-center gap-2">
          <button onClick={send} disabled={busy || !lines.length}
            className="rounded-xl bg-ink text-white px-3 py-2 text-[12px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5" /> {order.status === 'draft' ? 'Send to owner' : 'Send again'}
          </button>
          {order.status !== 'draft' ? (
            <button onClick={copy} className="rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
              {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Owner link</>}
            </button>
          ) : null}
          <button onClick={aiOrganize} disabled={aiBusy || !lines.length}
            className="rounded-xl bg-violet-600 text-white px-3 py-2 text-[12px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5 hover:bg-violet-700">
            {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} AI organize
          </button>
          <div className="relative">
            <button onClick={() => setExportOpen(o => !o)}
              className="rounded-xl border border-line bg-white px-3 py-2 text-[12px] font-semibold text-ink inline-flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Export <ChevronDown className="w-3 h-3" />
            </button>
            {exportOpen ? (
              <div className="absolute left-0 top-full mt-1 z-20 w-60 rounded-xl border border-line bg-white shadow-lg overflow-hidden"
                onClick={() => setExportOpen(false)}>
                {/* Two sheets, two jobs, on top: the buy list for whoever places the orders, the
                    work orders for whoever puts the furniture in. The paperwork under them. */}
                <a href={'/api/audit/ffe/orders/export?fmt=buylist&id=' + id} className="flex items-center gap-2 px-3 py-2 text-[12px] font-bold text-ink hover:bg-app">
                  <Store className="w-3.5 h-3.5 text-muted" /> Buy list — by supplier
                </a>
                <a href={'/api/audit/ffe/orders/export?fmt=workorder&id=' + id} className="flex items-center gap-2 px-3 py-2 text-[12px] font-bold text-ink hover:bg-app border-b border-line">
                  <ClipboardList className="w-3.5 h-3.5 text-muted" /> Work orders — by unit
                </a>
                <a href={'/api/audit/ffe/orders/export?fmt=pdf&id=' + id} className="flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-ink/80 hover:bg-app">
                  <FileText className="w-3.5 h-3.5 text-muted" /> PDF quote
                </a>
                <a href={'/api/audit/ffe/orders/export?fmt=xlsx&id=' + id} className="flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-ink/80 hover:bg-app">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-muted" /> Excel
                </a>
                <a href={'/api/audit/ffe/orders/export?fmt=csv&id=' + id} className="flex items-center gap-2 px-3 py-2 text-[12px] font-semibold text-ink/80 hover:bg-app">
                  <span className="w-3.5" /> CSV
                </a>
              </div>
            ) : null}
          </div>
          <div className="flex-1" />
        </div>
        {hint ? (
          <div className="px-4 py-2 border-t border-line flex items-start gap-1.5 text-[11.5px] text-muted">
            <ChevronRight className="w-3.5 h-3.5 shrink-0 mt-[1px] text-brand-700" />
            <span><span className="font-bold text-ink">Next:</span> {hint}</span>
          </div>
        ) : null}
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

      {/* THE BRIEF — the order in plain words, organised by how strongly we recommend each group.
          Written by AI from the actual lines; the totals are computed, never generated. The owner
          sees this same text at the top of their link. */}
      {order.ai_brief ? (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider font-bold flex items-center gap-1.5 text-violet-700">
            <Sparkles className="w-3 h-3" /> The short version
          </p>
          <p className="text-[13px] text-ink mt-1 whitespace-pre-wrap leading-relaxed">{order.ai_brief}</p>
        </div>
      ) : null}

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

      {/* THE FILTER IS NEVER SILENT. While the strip or a tier chip narrows the list, the full
          count stays on screen with a one-tap way back to everything. */}
      {(stageFilter || tierFilter) ? (
        <div className="rounded-xl border border-ink/20 bg-white px-3 py-2 text-[12px] text-ink flex items-center gap-2 flex-wrap shadow-soft">
          <span className="font-bold">Showing {visLines.length} of {lines.length} lines</span>
          {stageFilter ? (
            <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (STAGE_CLS[stageFilter] || '')}>
              {stageFilter === 'declined' ? 'Not taken' : STAGE_LABEL[stageFilter]}
            </span>
          ) : null}
          {tierFilter ? (
            <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ' +
              (tierFilter === 'none' ? 'bg-white text-neutral-500 border-dashed border-neutral-300' : TIER_CLS[tierFilter])}>
              {tierFilter === 'none' ? 'No tier yet' : TIER_LABEL[tierFilter]}
            </span>
          ) : null}
          <button onClick={() => { setStageFilter(''); setTierFilter('') }}
            className="ml-auto text-[12px] font-bold text-brand-700">Show everything</button>
        </div>
      ) : (
        <p className="text-[11.5px] text-muted px-1">
          {view === 'item'
            ? <>Pick the product once and it lands on every unit. Bedrooms share one choice unless you split them.{undecided ? <span className="text-amber-700 font-semibold"> {undecided} still to decide.</span> : null}</>
            : <>What goes into each unit — the shape of the work order the install crew carries.</>}
        </p>
      )}

      {/* ── BY ITEM: one row per buying decision ─────────────────────────────────────────────── */}
      {view === 'item' ? groups.map(g => {
        const prod = productOf(g)
        const liveL = g.lines.filter(l => l.stage !== 'declined')
        const sub = liveL.reduce((a, l) => a + (l.unit_cost == null ? 0 : Number(l.unit_cost) * l.qty), 0)
        const pieces = liveL.reduce((a, l) => a + (l.qty || 1), 0)
        const units = Array.from(new Set(g.lines.map(l => l.unit_name).filter(Boolean)))
        const allSel = g.lines.every(l => sel[l.id])
        return (
          <div key={g.key} className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft">
            <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <input type="checkbox" checked={allSel}
                onChange={e => setSel(s => { const n = { ...s }; for (const l of g.lines) { if (e.target.checked) n[l.id] = true; else delete n[l.id] } return n })} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-bold text-ink">{g.label}</span>
                  {g.bedroom && !split[g.itemKey] && g.slots.length > 1
                    ? <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">same in every bedroom</span>
                    : null}
                </div>
                <div className="text-[11.5px] text-muted">
                  {g.where} · {units.length} unit{units.length === 1 ? '' : 's'} · {pieces} piece{pieces === 1 ? '' : 's'}
                  {(() => {
                    // The recommendation mix of this buying decision, so the buyer sees "9 needs
                    // replacing" without opening the lines.
                    const t: Record<string, number> = {}
                    for (const l of liveL) if (l.priority) t[l.priority] = (t[l.priority] || 0) + 1
                    const parts = TIERS.filter(k => t[k]).map(k => `${t[k]} ${TIER_LABEL[k].toLowerCase()}`)
                    return parts.length ? ' · ' + parts.join(' · ') : ''
                  })()}
                </div>
              </div>
              <div className="flex-1" />
              {/* THE DECISION. One select, every line in the group. */}
              <select value={prod.one ? prod.id : ''} disabled={busy}
                onChange={e => applyToGroup(g, e.target.value)}
                className={'rounded-lg border bg-white px-2 py-1.5 text-[12px] max-w-[280px] ' +
                  (prod.one ? 'border-line' : 'border-amber-300 bg-amber-50')}>
                <option value="">{prod.label || 'Choose a product…'}</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name_en}{p.unit_cost != null ? ' — ' + money(p.unit_cost) : ''}</option>)}
              </select>
              <span className="text-[13px] font-bold text-ink tabular-nums w-24 text-right">{sub ? money(sub) : '—'}</span>
            </div>

            <div className="px-4 pb-3 -mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {g.splitable ? (
                split[g.itemKey] ? (
                  <button onClick={() => matchBedrooms(g.itemKey)} disabled={busy}
                    className="text-[11.5px] font-semibold text-brand-700 inline-flex items-center gap-1">
                    <Link2 className="w-3 h-3" /> Use the same in every bedroom
                  </button>
                ) : (
                  <button onClick={() => setSplit(s => ({ ...s, [g.itemKey]: true }))}
                    className="text-[11.5px] font-semibold text-brand-700 inline-flex items-center gap-1">
                    <Split className="w-3 h-3" /> Different per bedroom
                  </button>
                )
              ) : null}
              {/* Jon, 2026-08-18: "if we have 3 rooms it should suggest 3 different ones." The AI
                  proposes one style per bedroom from the catalog; every pick lands only on a tap. */}
              {g.splitable ? (
                <button onClick={() => { if (sugFor === g.itemKey) { setSugFor(''); setSugs(null) } else aiBedrooms(g.itemKey) }}
                  className="text-[11.5px] font-semibold text-violet-700 inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> {sugFor === g.itemKey ? 'Hide suggestions' : 'Suggest a style per bedroom'}
                </button>
              ) : null}
              {!prod.one && prod.label ? (
                <span className="text-[11px] text-amber-700 font-semibold inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {prod.label} on these lines — choosing one above replaces them all
                </span>
              ) : null}
              {/* EVERY LINE IS ONE TAP AWAY (Jon, 2026-08-17: a 200-line order read as "I don't
                  see the long list" — a group must open into its items, never just summarise). */}
              <button onClick={() => setOpenGroups(o => ({ ...o, [g.key]: !o[g.key] }))}
                className="text-[11.5px] font-semibold text-brand-700 inline-flex items-center gap-1">
                {openGroups[g.key] ? 'Hide the lines' : `Show all ${g.lines.length} lines`}
              </button>
              <span className="text-[11px] text-muted truncate">
                {units.slice(0, 8).join(', ')}{units.length > 8 ? ` +${units.length - 8} more` : ''}
              </span>
            </div>
            {sugFor === g.itemKey ? (
              <div className="border-t border-violet-200 bg-violet-50/50 px-4 py-3 space-y-2">
                {sugs === null ? (
                  <div className="text-[12px] font-semibold text-violet-700 inline-flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Picking a style for each bedroom…
                  </div>
                ) : sugs.length === 0 ? (
                  <div className="text-[12px] text-muted">Couldn&apos;t vary this one — add a couple more products in this category first.</div>
                ) : sugs.map((sug: any) => (
                  <div key={sug.bedroom} className="flex items-center gap-2.5 flex-wrap text-[12px]">
                    <span className="font-bold text-ink shrink-0 w-32">Bedroom {sug.bedroom}{sug.bedroom === 1 ? ' · primary' : ''}</span>
                    <span className="font-semibold text-ink">{sug.product?.code} · {sug.product?.name}</span>
                    {sug.product?.cost != null ? <span className="tabular-nums text-muted">{money(sug.product.cost)} ea</span> : null}
                    <span className="text-ink/70 italic flex-1 min-w-[160px]">{sug.why}</span>
                    <button disabled={busy || !!sugBusy}
                      onClick={async () => {
                        setSugBusy(String(sug.bedroom))
                        await post({ action: 'applyProduct', lineIds: sug.lineIds, catalogId: sug.catalogId })
                        setSplit(s => ({ ...s, [g.itemKey]: true }))
                        setSugBusy('')
                      }}
                      className="ml-auto rounded-lg bg-violet-600 text-white px-2.5 py-1 text-[11.5px] font-bold disabled:opacity-50 inline-flex items-center gap-1">
                      {sugBusy === String(sug.bedroom) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Use this
                    </button>
                  </div>
                ))}
                {sugs && sugs.length > 0 ? (
                  <p className="text-[10.5px] text-violet-700/70">Suggestions come from your catalog — nothing changes until you tap “Use this”.</p>
                ) : null}
              </div>
            ) : null}
            {openGroups[g.key] ? (
              <div className="border-t border-line divide-y divide-line bg-app/30">
                {g.lines.map(l => (
                  <div key={l.id} className="px-4 py-2 flex items-center gap-2.5 flex-wrap text-[12px]">
                    {l.walkPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a href={l.walkPhoto} target="_blank" rel="noreferrer" title="From the walk — the piece being replaced">
                        <img src={l.walkPhoto} alt="" className="w-8 h-8 rounded-md object-cover border border-amber-300" />
                      </a>
                    ) : <span className="w-8 h-8 rounded-md bg-app border border-line grid place-items-center"><Package className="w-3.5 h-3.5 text-muted" /></span>}
                    <span className="font-bold text-ink shrink-0">{l.unit_name}</span>
                    <span className="text-muted shrink-0">{l.roomLabel}</span>
                    <span className="text-muted shrink-0 tabular-nums">×{l.qty}</span>
                    {(l.spec || l.walkSpec) && <span className="font-semibold text-ink shrink-0">{l.spec || l.walkSpec}</span>}
                    {(l.note || l.walkNote) && (
                      <span className="text-ink/70 italic flex-1 min-w-[140px] truncate" title={(l.note || '') + ' ' + (l.walkNote || '')}>
                        <MessageSquare className="w-3 h-3 inline mr-1 text-muted" />{l.note || l.walkNote}
                      </span>
                    )}
                    <span className="ml-auto tabular-nums font-semibold text-ink shrink-0">
                      {l.unit_cost == null ? '—' : money(Number(l.unit_cost) * l.qty)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )
      }) : null}

      {/* lines */}
      {view === 'unit' ? Object.keys(byUnit).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(unit => {
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
                  {/* Two pictures when both exist: what we're BUYING, and — from the walk — what's
                      being replaced (Jon, 2026-08-17: "need to see the photo from the audit"). */}
                  <span className="flex items-center gap-1 shrink-0">
                    {l.image_url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <a href={l.image_url} target="_blank" rel="noreferrer" title="The replacement"><img src={l.image_url} alt="" className="w-9 h-9 rounded-lg object-cover border border-line" /></a>
                      : <span className="w-9 h-9 rounded-lg bg-app border border-line grid place-items-center"><Package className="w-4 h-4 text-muted" /></span>}
                    {l.walkPhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a href={l.walkPhoto} target="_blank" rel="noreferrer" title="From the walk — the piece being replaced" className="relative">
                        <img src={l.walkPhoto} alt="" className="w-9 h-9 rounded-lg object-cover border border-amber-300" />
                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[7px] font-bold uppercase px-1 rounded bg-amber-500 text-white leading-[10px]">was</span>
                      </a>
                    ) : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {l.code ? <span className="text-[11px] font-mono font-bold text-brand-700">{l.code}</span> : null}
                      <span className="text-[12.5px] font-semibold text-ink">{l.product || l.itemLabel}</span>
                      <span className={'text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (STAGE_CLS[l.stage] || STAGE_CLS.draft)}>
                        {STAGE_LABEL[l.stage] || l.stage}
                      </span>
                      <button onClick={() => setTier(l)}
                        title={(l.priority_reason || 'Tap to set: needs replacing → we recommend → nice to have') + ' · tap to change'}
                        className={'text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ' + (l.priority ? TIER_CLS[l.priority] : 'bg-white text-neutral-400 border-dashed border-neutral-300')}>
                        {l.priority ? TIER_LABEL[l.priority] : '+ tier'}
                      </button>
                      {l.url ? <a href={l.url} target="_blank" rel="noreferrer" className="text-muted hover:text-ink"><ExternalLink className="w-3 h-3" /></a> : null}
                      {!l.url && l.walkUrl ? <a href={l.walkUrl} target="_blank" rel="noreferrer" title="Link the walker suggested" className="text-amber-600 hover:text-amber-700"><ExternalLink className="w-3 h-3" /></a> : null}
                    </div>
                    <div className="text-[11px] text-muted truncate">
                      {l.roomLabel}{l.placement && l.placement !== l.roomLabel ? ' — ' + l.placement : ''} · {l.itemLabel}
                      {l.received_at ? <span className="text-emerald-600 font-semibold"> · received</span> : null}
                      {l.spec ? ' · ' : ''}{l.spec ? <span className="font-semibold text-ink">{l.spec}</span> : null}
                      {!l.spec && l.walkSpec ? <> · <span className="font-semibold text-ink">{l.walkSpec}</span></> : null}
                      {l.vendor ? ' · ' + l.vendor : <span className="text-amber-700 font-semibold"> · no supplier yet</span>}{l.po_number ? ' · PO ' + l.po_number : ''}
                    </div>
                    {/* Anything a human wrote — on the line, or standing in the room. */}
                    {(l.note || l.walkNote) ? (
                      <div className="text-[11px] text-ink/70 italic mt-0.5">
                        <MessageSquare className="w-3 h-3 inline mr-1 text-muted" />
                        {l.note || ''}{l.note && l.walkNote && l.walkNote !== l.note ? ' · ' : ''}{l.walkNote && l.walkNote !== l.note ? l.walkNote : ''}
                      </div>
                    ) : null}
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
      }) : null}

      <p className="text-[11px] text-muted">
        This is a furniture order. Nothing here creates a Breezeway task, a maintenance ticket or a billing line —
        marking a piece installed records that it arrived and went in, and nothing more.
      </p>
    </div>
  )
}
