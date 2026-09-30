'use client'
// LINEN DESK (Jon, 2026-09-29; tiers and ordering 2026-09-30) — /onboarding/linens. Three views:
//   STANDARD    the linen list form — Jon's standard, item by item (mattress protectors to duvet
//               covers, makeup cloths, hand towels, kitchen towels), with par and per-size counts, and
//               per TIER (Low / Mid / Luxury) the product, vendor, SKU, price per piece and how it is
//               sold (pieces per case, minimum cases). Plus the vendors, markup and tax. "I create the
//               standard, you just need to create a place where I can edit that or update it."
//   CALCULATOR  pick units → how many of each piece to buy at a tier, the vendor order in whole
//               cases, and the documents.
//   QUOTE       no listing yet: type in bedrooms, baths, guests and beds → the three tiers side by
//               side, the owner's invoice and the vendor order ("if we don't have a listing, to
//               calculate it where we just input the bedroom count, the occupancy, the bed types,
//               bathrooms, etc."). Opened as ?unit=onboard:<code> from the onboarding desk.
// All arithmetic is lib/linens.ts (tested in lib/__tests__/linens.test.mjs); this file only draws it.
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Copy, Download, FileText, Loader2, Minus, Pencil, Plus, RotateCcw, Search, Trash2, Truck, X } from 'lucide-react'
import { Pill, Tag, IconBtn, LeanList, LeanRow, LeanEmpty, type Tone } from '@/components/lean'
import {
  LINEN_GROUPS, LINEN_PER, LINEN_TIERS, LIMITS, MANUAL_LIMITS, DEFAULT_LINEN_STANDARD, normLinenStandard, linenNeeds, linenTotals, linenCsv, linenText, sortSizes,
  linenQuoteAllTiers, vendorOrder, quoteText, manualUnits, fmtUsd, tierOf,
  type LinenStandard, type LinenItem, type LinenGroup, type LinenPer, type LinenDeskUnit, type BedsSource, type LinenTotals, type LinenTier, type TierOption,
  type LinenVendor, type LinenQuote, type VendorOrder, type LinenQuoteChoice, type ManualUnitInput,
} from '@/lib/linens'

type View = 'standard' | 'calculator' | 'quote'

const CARD = 'rounded-2xl border border-line bg-white'
const EYEBROW = 'text-[11px] uppercase tracking-wider text-muted font-semibold'
const INPUT = 'rounded-lg border border-line bg-white px-3 py-2 text-[13px] focus:outline-none focus:border-ink disabled:bg-app disabled:text-ink/80'
const NUM = 'rounded-lg border border-line bg-white px-2 py-1.5 text-[13px] tabular-nums text-right focus:outline-none focus:border-ink disabled:bg-app disabled:text-ink/80'
const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold text-[13px] min-h-[36px] px-3 disabled:opacity-50'
const PRIMARY = BTN + ' bg-neutral-900 text-white hover:bg-neutral-800'
const GHOST = BTN + ' border border-line bg-white text-ink hover:bg-app'

const SOURCE: Record<BedsSource, { label: string; tone: Tone; title: string }> = {
  guesty: { label: 'from Guesty', tone: 'sky', title: "Beds read from the listing's rooms in Guesty" },
  saved: { label: 'saved', tone: 'emerald', title: 'Bed sizes set on this page' },
  onboarding: { label: 'from onboarding', tone: 'violet', title: "Beds from the unit's onboarding form" },
  assumed: { label: 'assumed', tone: 'amber', title: 'No bed data yet — assumed one Queen per bedroom (a studio counts as one). Set the real sizes with the pencil.' },
  manual: { label: 'typed in', tone: 'slate', title: 'Beds typed into the quote' },
}
const DEFAULT_PER: Record<LinenGroup, LinenPer> = { Bed: 'bed', Bath: 'guest', Kitchen: 'unit', Other: 'unit' }
const BILLED_LINE = 'The owner is billed for the pieces the unit gets, not whole cases — the case overage goes to stock.'

/** '' → null, otherwise a finite number (the server clamps it again). */
const toNum = (v: string): number | null => { if (v.trim() === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null }
const money = fmtUsd
const when = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
// Equal as data: key order ignored, a blank (null / undefined) field or an emptied object the same as
// an absent one — so typing a price and clearing it again does not leave the page thinking it has
// something to save.
const canon = (v: any): any => {
  if (Array.isArray(v)) return v.map(canon)
  if (!v || typeof v !== 'object') return v
  const out: Record<string, any> = {}
  for (const k of Object.keys(v).sort()) {
    if (v[k] === undefined || v[k] === null) continue
    const c = canon(v[k])
    if (c && typeof c === 'object' && !Array.isArray(c) && !Object.keys(c).length) continue
    out[k] = c
  }
  return out
}
const same = (a: any, b: any) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const store = {
  get(k: string): string | null { try { return window.localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { window.localStorage.setItem(k, v) } catch { /* private window — the page works without it */ } },
}
const VIEW_KEY = 'lighthouse.linens.view'
const PICK_KEY = 'lighthouse.linens.selected'
const TIER_KEY = 'lighthouse.linens.tier'
const isTier = (v: any): v is LinenTier => LINEN_TIERS.includes(v)

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function LinenDesk({ initialUnit }: { initialUnit?: string }) {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [level, setLevel] = useState<string>('view')
  const [saved, setSaved] = useState<LinenStandard>(() => normLinenStandard(DEFAULT_LINEN_STANDARD))
  const [draft, setDraft] = useState<LinenStandard>(() => normLinenStandard(DEFAULT_LINEN_STANDARD))
  const [edited, setEdited] = useState(false)
  const [units, setUnits] = useState<LinenDeskUnit[]>([])
  const [focus, setFocus] = useState<LinenDeskUnit | null>(null)
  const [quotes, setQuotes] = useState<Record<string, LinenQuoteChoice>>({})
  const [partial, setPartial] = useState(false)
  const [view, setView] = useState<View>(initialUnit ? 'quote' : 'standard')
  const [picked, setPicked] = useState<string[]>([])
  const [tier, setTierState] = useState<LinenTier>('mid')
  const [ready, setReady] = useState(false)   // the standard loaded — never show the starting values as if they were Jon's list

  useEffect(() => {
    const v = store.get(VIEW_KEY); if (!initialUnit && (v === 'calculator' || v === 'standard' || v === 'quote')) setView(v)
    const t = store.get(TIER_KEY); if (isTier(t)) setTierState(t)
    ;(async () => {
      try {
        const r = await fetch('/api/onboard/linens' + (initialUnit ? '?unit=' + encodeURIComponent(initialUnit) : ''), { cache: 'no-store' })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.ok) throw new Error(j.message || j.error || 'Could not load the linen standard')
        const std = normLinenStandard(j.standard)
        setSaved(std); setDraft(std); setEdited(!!j.edited); setLevel(String(j.level || 'view'))
        const us: LinenDeskUnit[] = Array.isArray(j.units) ? j.units : []
        setUnits(us); setPartial(!!j.partial)
        setFocus(j.focus && typeof j.focus === 'object' ? j.focus : null)
        setQuotes(j.quotes && typeof j.quotes === 'object' ? j.quotes : {})
        try { const p = JSON.parse(store.get(PICK_KEY) || '[]'); if (Array.isArray(p)) setPicked(p.filter((id: any) => us.some(u => u.id === id))) } catch { /* nothing remembered */ }
        setErr(''); setReady(true)
      } catch (e: any) { setErr(String(e?.message || e)) }
      setLoading(false)
    })()
  }, [initialUnit])

  const dirty = !same(draft, saved)
  // Leaving with unsaved edits to the standard asks first (the browser's own prompt).
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const pick = (ids: string[]) => { setPicked(ids); store.set(PICK_KEY, JSON.stringify(ids)) }
  const [quoteOpened, setQuoteOpened] = useState(false)
  useEffect(() => { if (view === 'quote') setQuoteOpened(true) }, [view])
  const go = (v: View) => { setView(v); store.set(VIEW_KEY, v) }
  const setTier = (t: LinenTier) => { setTierState(t); store.set(TIER_KEY, t) }
  const activeCount = draft.items.filter(i => i.active !== false).length
  const canStd = level === 'full'
  const canBeds = level === 'edit' || level === 'full'
  const prefill = useMemo(() => {
    if (!initialUnit) return null
    const id = initialUnit.toLowerCase().startsWith('onboard:') ? initialUnit.toLowerCase() : initialUnit
    return units.find(u => u.id === id) || (focus && focus.id === id ? focus : null)
  }, [initialUnit, units, focus])

  const TABS: [View, string, string][] = [
    ['standard', 'Standard', 'The linen list — what every unit gets, per bed, bath, guest or unit, and what is bought at each tier'],
    ['calculator', 'Calculator', 'Pick units and get the order: quantities, whole cases per vendor, and cost at your prices'],
    ['quote', 'Quote', 'No listing yet? Type in bedrooms, baths, guests and beds — the three tiers, the invoice and the vendor order'],
  ]

  return (
    <div>
      <header className="flex items-end justify-between gap-3 flex-wrap mb-3">
        <div className="min-w-0">
          <a href="/onboarding" title="Back to the onboarding desk" className={EYEBROW + ' inline-flex items-center gap-1 hover:text-ink'}><ArrowLeft size={11} /> Onboarding</a>
          <h1 className="text-3xl font-bold text-ink tracking-tight">Linens</h1>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {ready && <Pill title="Items on the standard that are counted (switched-off items are kept but not counted)">{activeCount} items</Pill>}
          {ready && <Pill title="Sets in rotation: one on the bed, one in the wash, one on the shelf">par {draft.par}</Pill>}
          {dirty && <Pill tone="amber" title="The standard has edits that are not saved yet — the calculator and quote already use them; the documents wait for a save">unsaved</Pill>}
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12.5px]" role="tablist">
            {TABS.map(([k, label, tip]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => go(k)} title={tip}
                className={'px-3 py-1.5 font-semibold border-l border-line first:border-l-0 ' + (view === k ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>
                {label}{k === 'calculator' && picked.length ? <span className="ml-1 opacity-70 tabular-nums">{picked.length}</span> : null}
              </button>
            ))}
          </div>
        </div>
      </header>

      {err && <p className="text-[12.5px] text-rose-600 font-semibold mb-2">{err}</p>}
      {loading ? <LeanEmpty><Loader2 className="animate-spin inline mr-1.5 -mt-0.5" size={14} />Loading…</LeanEmpty>
        : !ready ? <LeanEmpty>The linen standard did not load — reload the page to try again.</LeanEmpty>
        : <>
          {view === 'standard' && <StandardView draft={draft} setDraft={setDraft} saved={saved} edited={edited} canEdit={canStd}
              onSaved={(s) => { setSaved(s); setDraft(s); setEdited(true) }} />}
          {view === 'calculator' && <CalculatorView standard={draft} dirty={dirty} units={units} setUnits={setUnits} partial={partial} picked={picked} pick={pick} canBeds={canBeds} tier={tier} setTier={setTier} />}
          {/* The Quote view stays mounted once opened, so what was typed (and Bill to) survives a tab switch. */}
          <div hidden={view !== 'quote'}>
            {(view === 'quote' || quoteOpened) && <QuoteView standard={draft} dirty={dirty} tier={tier} setTier={setTier} prefill={prefill} missing={!!initialUnit && !prefill}
                quotes={quotes} canChoose={canBeds} onChosen={(code, q) => setQuotes(m => { const n = { ...m }; if (q) n[code] = q; else delete n[code]; return n })} />}
          </div>
        </>}
    </div>
  )
}

// ── shared pieces ─────────────────────────────────────────────────────────────────────────────────
/** A segmented Low | Mid | Luxury switch. */
function TierSwitch({ std, value, onChange, title }: { std: LinenStandard; value: LinenTier; onChange: (t: LinenTier) => void; title: (t: LinenTier) => string }) {
  return (
    <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12.5px]" role="tablist">
      {LINEN_TIERS.map(t => (
        <button key={t} role="tab" aria-selected={value === t} onClick={() => onChange(t)} title={title(t)}
          className={'px-3 py-1.5 font-semibold border-l border-line first:border-l-0 ' + (value === t ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink')}>
          {std.tierLabels[t]}
        </button>
      ))}
    </div>
  )
}

/** The three tiers side by side: pick one, see its total, see what is still unpriced. */
function TierCards({ quotes, value, onChange, chosen }: { quotes: Record<LinenTier, LinenQuote>; value: LinenTier; onChange: (t: LinenTier) => void; chosen?: LinenTier | null }) {
  return (
    <div className="grid grid-cols-3 gap-2 mb-3">
      {LINEN_TIERS.map(t => {
        const q = quotes[t]
        const on = value === t
        return (
          <button key={t} onClick={() => onChange(t)} aria-pressed={on}
            title={`${q.label}: ${q.pieces.toLocaleString('en-US')} pieces${q.priced ? ', ' + money(q.total) + (q.markup || q.tax ? ' with markup and tax' : '') : ''} — click to see its lines`}
            className={'min-w-0 rounded-xl border bg-white px-2.5 py-2 sm:px-3 sm:py-2.5 text-left transition ' + (on ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-ink')}>
            <span className="flex items-center gap-1 flex-wrap">
              <span className="text-[12px] sm:text-[12.5px] font-semibold text-ink truncate">{q.label}</span>
              {chosen === t && <Tag tone="emerald" title="The tier picked for this unit — it shows on the onboarding desk and the onboarding deck">chosen</Tag>}
            </span>
            <span className="block mt-1 text-[14px] sm:text-[18px] font-bold tabular-nums text-ink truncate">
              {q.priced ? money(q.total) : <Tag tone="amber" title={`No line in ${q.label} has a price yet — add prices on the Standard, ${q.label} tier`}>unpriced</Tag>}
            </span>
            <span className="mt-1 flex items-center gap-1 flex-wrap text-[11.5px] text-muted tabular-nums">
              {q.pieces.toLocaleString('en-US')} pcs
              {q.priced > 0 && (q.markup > 0 || q.tax > 0) && <Tag title={"The owner's total: pieces × price" + (q.markup ? ', + ' + q.markupPct + '% markup' : '') + (q.tax ? ', + ' + q.taxPct + '% tax' : '')}>owner total</Tag>}
              {q.priced > 0 && q.unpriced > 0 && <Tag tone="amber" title={`${q.unpriced} line${q.unpriced === 1 ? ' has' : 's have'} no price and ${q.unpriced === 1 ? 'is' : 'are'} not in this total`}>+{q.unpriced} unpriced</Tag>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** One tier's lines as the owner is billed for them, with markup, tax and the total. */
function QuoteCard({ q }: { q: LinenQuote }) {
  return (
    <section className={CARD + ' mb-3 overflow-hidden'}>
      <div className="px-3 sm:px-4 py-2.5 flex items-center gap-2 flex-wrap border-b border-line">
        <h2 className={EYEBROW}>{q.label} package</h2>
        <span className="text-[12.5px] text-muted tabular-nums">{q.units} unit{q.units === 1 ? '' : 's'} · {q.pieces.toLocaleString('en-US')} pieces</span>
        {q.off.length > 0 && <Tag tone="slate" title={`Left out of ${q.label}: ${q.off.map(o => o.name).join(', ')}`}>{q.off.length} not in {q.label}</Tag>}
      </div>
      {!q.rows.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Nothing on the standard applies to this unit.</p> : (
        <div className="overflow-x-auto">
          {/* Fits a phone without sideways scrolling: below sm the piece price moves under the item. */}
          <table className="w-full text-[13px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted">
              <tr><th className="text-left font-semibold px-3 sm:px-4 py-2">Item</th><th className="text-left font-semibold px-2 py-2">Size</th><th className="text-right font-semibold px-2 py-2">Qty</th>
                <th className="hidden sm:table-cell text-right font-semibold px-2 py-2" title="Price per piece">Each</th><th className="text-right font-semibold px-3 sm:px-4 py-2">Amount</th></tr>
            </thead>
            {LINEN_GROUPS.map(g => {
              const rows = q.rows.filter(r => r.group === g)
              if (!rows.length) return null
              return (
                <tbody key={g} className="border-t border-line">
                  <tr className="bg-app/60"><td colSpan={4} className={EYEBROW + ' px-3 sm:px-4 py-1.5'}>{g}</td><td className="hidden sm:table-cell" /></tr>
                  {rows.map(r => (
                    <tr key={r.key} className="border-t border-line/60">
                      <td className="px-3 sm:px-4 py-1.5 text-ink">{r.name}
                        {(r.product || r.price != null) ? <span className="block text-muted text-[11.5px]">{r.product}{r.price != null ? <span className="sm:hidden tabular-nums">{r.product ? ' · ' : ''}{money(r.price)} each</span> : null}</span> : null}</td>
                      <td className="px-2 py-1.5 text-muted">{r.size || ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{r.qty.toLocaleString('en-US')}</td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-right tabular-nums text-muted">{r.price != null ? money(r.price) : ''}</td>
                      <td className="px-3 sm:px-4 py-1.5 text-right tabular-nums">{r.cost != null ? money(r.cost) : <Tag tone="amber" title="No price for this line at this tier — add it on the Standard">unpriced</Tag>}</td>
                    </tr>
                  ))}
                </tbody>
              )
            })}
            {q.priced > 0 && (
              <tfoot className="text-[12.5px]">
                <tr className="border-t-2 border-line"><td colSpan={3} className="px-3 sm:px-4 pt-2 text-muted">Subtotal</td><td className="hidden sm:table-cell" /><td className="px-3 sm:px-4 pt-2 text-right tabular-nums">{money(q.subtotal)}</td></tr>
                {q.markup > 0 && <tr><td colSpan={3} className="px-3 sm:px-4 text-muted">Markup ({q.markupPct}%)</td><td className="hidden sm:table-cell" /><td className="px-3 sm:px-4 text-right tabular-nums">{money(q.markup)}</td></tr>}
                {q.tax > 0 && <tr><td colSpan={3} className="px-3 sm:px-4 text-muted">Tax ({q.taxPct}%)</td><td className="hidden sm:table-cell" /><td className="px-3 sm:px-4 text-right tabular-nums">{money(q.tax)}</td></tr>}
                <tr><td colSpan={3} className="px-3 sm:px-4 py-2 font-bold text-ink text-[13px]">Total{q.unpriced ? <span className="font-normal text-[12px] text-muted"> · {q.unpriced} line{q.unpriced === 1 ? '' : 's'} with no price left out</span> : null}</td>
                  <td className="hidden sm:table-cell" /><td className="px-3 sm:px-4 py-2 text-right font-bold tabular-nums text-ink text-[13px]">{money(q.total)}</td></tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="px-3 sm:px-4 py-2 border-t border-line text-[12px] text-muted">{q.priced === 0 && q.rows.length ? `No prices at ${q.label} yet — add them on the Standard. ` : ''}{BILLED_LINE}</p>
    </section>
  )
}

/** What to buy, vendor by vendor, in whole cases. */
function VendorOrderCard({ order }: { order: VendorOrder }) {
  if (!order.groups.length) return null
  return (
    <section className="mb-3">
      <div className="mb-1.5 px-1 flex items-center gap-2 flex-wrap">
        <h2 className={EYEBROW}>Vendor order</h2>
        <span className="text-[12px] text-muted tabular-nums" title="Pieces are pooled across every unit and rounded up to whole cases; the overage goes to stock">
          {order.piecesNeeded.toLocaleString('en-US')} needed → {order.piecesOrdered.toLocaleString('en-US')} ordered{order.overage ? ` (+${order.overage.toLocaleString('en-US')} to stock)` : ''}
        </span>
        {order.priced > 0 && <Pill tone="emerald" title={order.unpriced ? `${order.unpriced} line${order.unpriced === 1 ? ' has' : 's have'} no price and are not in this total` : 'Whole cases at the vendor prices'}>{money(order.total)}</Pill>}
      </div>
      <LeanList>
        {order.groups.map(g => (
          <LeanRow key={g.vendor || '~none'}
            name={g.vendor || 'No vendor set'}
            meta={`${g.lines.length} line${g.lines.length === 1 ? '' : 's'} · ${g.piecesOrdered.toLocaleString('en-US')} pcs${g.info?.orderVia ? ' · ' + g.info.orderVia : ''}`}
            tags={<>
              {!g.vendor && <Tag tone="amber" title="These lines have no vendor at this tier — set one on the Standard">set a vendor</Tag>}
              {g.vendor && !g.info && <Tag tone="slate" title="Not on the vendor list yet — add it on the Standard for contact, minimum and lead time">not on list</Tag>}
              {g.leadDays !== null && <Tag tone="sky" title={`Lead time: ${g.leadDays} day${g.leadDays === 1 ? '' : 's'} from order to delivery`}>{g.leadDays}d lead</Tag>}
              {g.minOrder !== null && !g.belowMinimum && <Tag tone="slate" title={`This vendor's minimum order is ${money(g.minOrder)} — met`}>min {money(g.minOrder)}</Tag>}
              {g.belowMinimum && <Tag tone="rose" title={`Priced lines total ${money(g.subtotal)} — ${money(g.shortBy)} short of the ${money(g.minOrder as number)} minimum. Add stock or combine with another order.`}>below min</Tag>}
              {g.unpriced > 0 && <Tag tone="amber" title={`${g.unpriced} line${g.unpriced === 1 ? ' has' : 's have'} no price`}>{g.unpriced} unpriced</Tag>}
            </>}
            actions={<span className="text-[12.5px] font-semibold tabular-nums text-ink" title="Whole cases × pieces per case × price per piece">{g.priced ? money(g.subtotal) : ''}</span>}
          >
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[520px] text-[12.5px]">
                <thead className="bg-app text-[10.5px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="text-left font-semibold px-3 py-1.5">Item</th><th className="text-left font-semibold px-2 py-1.5">Size</th>
                    <th className="text-right font-semibold px-2 py-1.5" title="Pieces the units need">Needed</th>
                    <th className="text-right font-semibold px-2 py-1.5" title="Whole cases × pieces per case">Cases</th>
                    <th className="text-right font-semibold px-2 py-1.5" title="Pieces bought; the overage goes to stock">Ordered</th>
                    <th className="text-right font-semibold px-3 py-1.5">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {g.lines.map(l => (
                    <tr key={l.key}>
                      <td className="px-3 py-1.5 text-ink">{l.name}{l.sku ? <span className="text-muted text-[11px]"> · {l.sku}</span> : null}{l.conflict ? <> <Tag tone="amber" title="Another line uses this SKU with a different price, pack size or minimum — check the Standard">{l.conflict}</Tag></> : null}</td>
                      <td className="px-2 py-1.5 text-muted">{l.size || ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{l.piecesNeeded}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted" title={l.packSize > 1 ? `${l.cases} case${l.cases === 1 ? '' : 's'} of ${l.packSize}${l.minCases ? ` (minimum ${l.minCases})` : ''}` : 'Sold singly'}>{l.packSize > 1 ? `${l.cases} × ${l.packSize}` : 'singly'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{l.piecesOrdered}{l.overage ? <span className="font-normal text-muted" title={`${l.overage} over the need — to stock`}> +{l.overage}</span> : null}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.cost != null ? money(l.cost) : <Tag tone="amber" title="No price for this line">unpriced</Tag>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </LeanRow>
        ))}
      </LeanList>
    </section>
  )
}

/** The documents: owner invoice (PDF), vendor order (PDF / CSV), and the copy-as-text. */
function DocActions({ tier, units, dirty, onCopy, copyLabel, priced = 1 }: { tier: LinenTier; units: ManualUnitInput[]; dirty: boolean; onCopy: () => Promise<boolean>; copyLabel: string; priced?: number }) {
  const [busy, setBusy] = useState<string>('')
  const [msg, setMsg] = useState('')
  const [billTo, setBillTo] = useState('')
  const [copied, setCopied] = useState(false)
  const none = !units.length
  const tooMany = units.reduce((a, u) => a + Math.max(1, Number(u.copies) || 1), 0) > MANUAL_LIMITS.units
  const why = dirty ? 'Save the standard first — documents use the saved prices' : none ? 'Nothing to put on a document yet' : tooMany ? `At most ${MANUAL_LIMITS.units} units on one document` : ''
  const run = async (doc: 'invoice' | 'order' | 'order-csv') => {
    setBusy(doc); setMsg('')
    try {
      const r = await fetch('/api/onboard/linens/doc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc, tier, units, billTo: billTo.trim() || undefined }) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || j.message || 'Could not build the document') }
      const blob = await r.blob()
      const m = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') || '')
      saveBlob(blob, m ? m[1] : 'linens-' + doc + (doc === 'order-csv' ? '.csv' : '.pdf'))
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy('')
  }
  const copy = async () => { if (await onCopy()) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }
  return (
    <section className={CARD + ' p-3 sm:p-4 mb-3'}>
      <div className="flex items-center gap-2 flex-wrap">
        <input value={billTo} onChange={e => setBillTo(e.target.value)} maxLength={120} placeholder="Bill to (owner, optional)" title="Printed on the invoice as Bill to"
          className={INPUT + ' py-1.5 w-full sm:w-56'} />
        <button onClick={() => run('invoice')} disabled={!!busy || !!why || !priced} title={why || (!priced ? 'Nothing in this tier is priced yet — add prices on the Standard' : "The owner's invoice for this tier, as a draft PDF — the pieces the unit gets at owner prices, plus tax")} className={GHOST}>
          {busy === 'invoice' ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Owner invoice
        </button>
        <button onClick={() => run('order')} disabled={!!busy || !!why} title={why || 'The vendor order as a PDF — a page per vendor, whole cases, contact, minimum and lead time'} className={GHOST}>
          {busy === 'order' ? <Loader2 size={13} className="animate-spin" /> : <Truck size={13} />} Vendor order
        </button>
        <button onClick={() => run('order-csv')} disabled={!!busy || !!why} title={why || 'The vendor order as a spreadsheet (CSV)'} className={GHOST}>
          {busy === 'order-csv' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} CSV
        </button>
        <button onClick={copy} disabled={none} title={copyLabel} className={GHOST}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}</button>
        {dirty && <Tag tone="amber" title="Documents use the saved standard — save your edits on the Standard to print them">save to print</Tag>}
        {msg && <span className="text-[12.5px] text-rose-600 font-semibold">{msg}</span>}
      </div>
    </section>
  )
}

/** A number with − and + beside it. */
function Stepper({ label, value, onChange, min, max, step = 1, title }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; title: string }) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n / step) * step))
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-line bg-white pl-2.5 pr-1 py-1" title={title}>
      <span className="text-[12.5px] font-semibold text-ink mr-0.5 whitespace-nowrap">{label}</span>
      <button type="button" onClick={() => onChange(clamp(value - step))} disabled={value <= min} title={`One fewer (${label})`} aria-label={`One fewer ${label}`}
        className="rounded-md p-1 text-muted hover:text-ink hover:bg-app disabled:opacity-30"><Minus size={12} /></button>
      <input type="number" inputMode="decimal" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={e => { const n = toNum(e.target.value); onChange(clamp(n ?? min)) }} className={NUM + ' w-12 py-1 px-1.5 text-center'} />
      <button type="button" onClick={() => onChange(clamp(value + step))} disabled={value >= max} title={`One more (${label})`} aria-label={`One more ${label}`}
        className="rounded-md p-1 text-muted hover:text-ink hover:bg-app disabled:opacity-30"><Plus size={12} /></button>
    </div>
  )
}

// ── STANDARD ──────────────────────────────────────────────────────────────────────────────────────
function StandardView({ draft, setDraft, saved, edited, canEdit, onSaved }: {
  draft: LinenStandard; setDraft: (f: (s: LinenStandard) => LinenStandard) => void; saved: LinenStandard; edited: boolean; canEdit: boolean
  onSaved: (s: LinenStandard) => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [newSize, setNewSize] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)   // the item just added — its name box takes focus
  const [edTier, setEdTierState] = useState<LinenTier>(() => { const t = typeof window === 'undefined' ? null : store.get(TIER_KEY + '.edit'); return isTier(t) ? t : 'mid' })
  const setEdTier = (t: LinenTier) => { setEdTierState(t); store.set(TIER_KEY + '.edit', t) }
  const dirty = !same(draft, saved)

  const patch = (id: string, p: Partial<LinenItem>) => setDraft(s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, ...p } : i) }))
  const patchTier = (id: string, t: LinenTier, p: Partial<TierOption>) =>
    setDraft(s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, tiers: { ...i.tiers, [t]: { ...(i.tiers[t] || {}), ...p } } } : i) }))
  const remove = (id: string) => setDraft(s => ({ ...s, items: s.items.filter(i => i.id !== id) }))
  const add = (group: LinenGroup) => {
    const id = 'item-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    setDraft(s => {
      // New items land at the end of their own group, so the list keeps reading Bed → Bath → Kitchen → Other.
      const last = s.items.map(i => i.group).lastIndexOf(group)
      const items = [...s.items]
      items.splice(last < 0 ? items.length : last + 1, 0, { id, name: '', group, per: DEFAULT_PER[group], qty: 1, rotates: group !== 'Other', active: true, tiers: {} })
      return { ...s, items }
    })
    setFresh(id)
  }
  const addSize = () => {
    const t = newSize.replace(/\s+/g, ' ').trim().slice(0, LIMITS.size)
    if (!t) return
    if (draft.bedSizes.some(s => s.toLowerCase() === t.toLowerCase())) { setMsg({ text: t + ' is already a bed size.', bad: true }); return }
    if (draft.bedSizes.length >= LIMITS.sizes) { setMsg({ text: 'That is the most bed sizes the list holds.', bad: true }); return }
    setDraft(s => ({ ...s, bedSizes: [...s.bedSizes, t] })); setNewSize(''); setMsg(null)
  }
  const removeSize = (size: string) => setDraft(s => ({ ...s, bedSizes: s.bedSizes.filter(x => x !== size) }))

  const put = async (standard: LinenStandard, done: string) => {
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/onboard/linens', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ standard }) })
      const j = await r.json().catch(() => ({}))
      if (r.status === 409 && j.stale) { setMsg({ text: j.error + ' Reload the page (your unsaved edits will be lost).', bad: true }); setBusy(false); return }
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || 'Could not save')
      onSaved(normLinenStandard(j.standard)); setMsg({ text: done })
    } catch (e: any) { setMsg({ text: String(e?.message || e), bad: true }) }
    setBusy(false)
  }
  const save = () => {
    if (draft.items.some(i => !i.name.trim())) { setMsg({ text: 'Give every item a name (or remove the blank one) before saving.', bad: true }); return }
    if (draft.vendors.some(v => !v.name.trim())) { setMsg({ text: 'Give every vendor a name (or remove the blank one) before saving.', bad: true }); return }
    put(draft, 'Saved — the calculator, quotes and documents use this list from now on.')
  }
  const reset = () => { setConfirmReset(false); put(normLinenStandard(DEFAULT_LINEN_STANDARD), 'Back to the starting values.') }
  const tl = draft.tierLabels[edTier]
  const active = draft.items.filter(i => i.active !== false)
  const pricedAt = (t: LinenTier) => active.filter(i => { const o = tierOf(i, t); return !o.off && (typeof o.price === 'number' || (o.priceBySize && Object.keys(o.priceBySize).length)) }).length
  const inAt = (t: LinenTier) => active.filter(i => !tierOf(i, t).off).length

  return (
    <div>
      <section className={CARD + ' p-3 sm:p-4 mb-3'}>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <label className="block">
            <span className={EYEBROW}>Par (sets in rotation)</span>
            <span className="flex items-center gap-2 mt-1">
              <input type="number" inputMode="numeric" min={0} max={LIMITS.num} value={draft.par} disabled={!canEdit}
                onChange={e => setDraft(s => ({ ...s, par: Math.max(0, Math.min(LIMITS.num, Math.round(toNum(e.target.value) ?? 0))) }))}
                title="How many sets of each rotating item a unit owns" className={NUM + ' w-16'} />
              <span className="text-[12px] text-muted">On the bed, in the wash, on the shelf.</span>
            </span>
          </label>
          <div className="min-w-0">
            <span className={EYEBROW}>Bed sizes</span>
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {draft.bedSizes.map(s => (
                <span key={s} className="inline-flex items-center gap-1 rounded-full border border-line bg-app pl-2.5 pr-1 py-0.5 text-[12.5px] font-semibold text-ink">
                  {s}
                  {canEdit && <button onClick={() => removeSize(s)} title={`Remove ${s} from the bed sizes (units that have one still count it)`} aria-label={`Remove ${s}`} className="rounded-full p-0.5 text-muted hover:text-rose-700 hover:bg-white"><X size={12} /></button>}
                </span>
              ))}
              {canEdit && (
                <span className="inline-flex items-center gap-1">
                  <input value={newSize} onChange={e => setNewSize(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSize() } }}
                    placeholder="Add a size" maxLength={LIMITS.size} className="rounded-full border border-line bg-white px-2.5 py-0.5 text-[12.5px] w-28 focus:outline-none focus:border-ink" />
                  <button onClick={addSize} disabled={!newSize.trim()} title="Add this bed size" aria-label="Add this bed size" className="rounded-full border border-line bg-white p-1 text-muted hover:text-ink disabled:opacity-40"><Plus size={12} /></button>
                </span>
              )}
            </div>
          </div>
          <div className="block">
            <span className={EYEBROW}>Owner bill</span>
            <span className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1" title="Markup on the owner's bill, on top of the piece prices (0 = at cost)">
                <input type="number" inputMode="decimal" min={0} max={LIMITS.markup} step="any" value={draft.markupPct} disabled={!canEdit}
                  onChange={e => setDraft(s => ({ ...s, markupPct: Math.max(0, Math.min(LIMITS.markup, toNum(e.target.value) ?? 0)) }))} className={NUM + ' w-16'} aria-label="Markup percent" />
                <span className="text-[12px] text-muted">% markup</span>
              </span>
              <span className="inline-flex items-center gap-1" title="Sales tax on the owner's bill, on top of prices and markup (0 = none)">
                <input type="number" inputMode="decimal" min={0} max={LIMITS.tax} step="any" value={draft.taxPct} disabled={!canEdit}
                  onChange={e => setDraft(s => ({ ...s, taxPct: Math.max(0, Math.min(LIMITS.tax, toNum(e.target.value) ?? 0)) }))} className={NUM + ' w-16'} aria-label="Tax percent" />
                <span className="text-[12px] text-muted">% tax</span>
              </span>
            </span>
          </div>
          <div className="block">
            <span className={EYEBROW}>Tier names</span>
            <span className="flex items-center gap-1.5 mt-1 flex-wrap">
              {LINEN_TIERS.map(t => (
                <input key={t} value={draft.tierLabels[t]} disabled={!canEdit} maxLength={LIMITS.tierLabel}
                  onChange={e => setDraft(s => ({ ...s, tierLabels: { ...s.tierLabels, [t]: e.target.value } }))}
                  title={`What this tier is called on quotes, invoices and the onboarding deck (${t === 'low' ? 'the first' : t === 'mid' ? 'the middle' : 'the top'} tier)`}
                  className={INPUT + ' w-24 py-1.5'} />
              ))}
            </span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 flex-wrap text-[12px] text-muted">
          {!edited ? <Tag title="Nothing saved yet — these are the starting values to edit">Starting values</Tag>
            : saved.updatedAt ? <span>Last saved{saved.updatedBy ? ' by ' + saved.updatedBy : ''} at {when(saved.updatedAt)}</span>
              : <span>Saved</span>}
          {!canEdit && <Tag tone="slate" title="Changing the standard needs full access on Onboarding — ask Jon">Read-only</Tag>}
        </div>
      </section>

      <VendorsCard vendors={draft.vendors} canEdit={canEdit} onChange={vendors => setDraft(s => ({ ...s, vendors }))} />
      <datalist id="linen-vendors">{draft.vendors.map(v => <option key={v.name} value={v.name} />)}</datalist>

      <div className="mb-2 px-1 flex items-center gap-2 flex-wrap">
        <span className={EYEBROW}>Tier</span>
        <TierSwitch std={draft} value={edTier} onChange={setEdTier} title={t => `Edit what is bought at ${draft.tierLabels[t]}: ${pricedAt(t)} of ${inAt(t)} items priced`} />
        <Tag tone={pricedAt(edTier) === inAt(edTier) && inAt(edTier) > 0 ? 'emerald' : 'amber'} title={`Items in ${tl} that have a price per piece`}>{pricedAt(edTier)}/{inAt(edTier)} priced</Tag>
        <span className="text-[12px] text-muted">Quantities are shared; product, vendor, price and case size are per tier.</span>
      </div>

      {LINEN_GROUPS.map(g => {
        const rows = draft.items.filter(i => i.group === g)
        return (
          <section key={g} className={CARD + ' mb-3 overflow-hidden'}>
            <div className="px-3 sm:px-4 py-2 flex items-center gap-2 border-b border-line bg-app/60">
              <h2 className={EYEBROW}>{g}</h2>
              <span className="text-[11px] text-muted tabular-nums">{rows.length}</span>
              {canEdit && <button onClick={() => add(g)} title={`Add an item to ${g}`} className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-ink/80 hover:text-ink"><Plus size={13} /> Add item</button>}
            </div>
            <div className="hidden lg:flex items-center gap-2 px-4 pt-2 text-[10.5px] uppercase tracking-wider text-muted font-semibold">
              <span className="flex-1">Item</span><span className="w-[7.5rem]">Counted</span><span className="w-16 text-right">Qty</span><span className="w-[5.5rem]">Rotation</span>
              <span className="w-14 text-right">Par</span><span className="w-12">On</span><span className="w-8" />
            </div>
            {!rows.length && <div className="px-4 py-3 text-[12.5px] text-muted">Nothing here yet.</div>}
            <div className="divide-y divide-line/70">
              {rows.map(it => <ItemRow key={it.id} it={it} std={draft} tier={edTier} canEdit={canEdit} autoFocus={fresh === it.id}
                patch={p => patch(it.id, p)} patchTier={p => patchTier(it.id, edTier, p)} remove={() => remove(it.id)} />)}
            </div>
          </section>
        )
      })}

      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-1 px-1 py-2 bg-app/95 backdrop-blur flex items-center gap-2 flex-wrap">
          <button onClick={save} disabled={busy || !dirty} title={dirty ? 'Save the standard' : 'No changes to save'} className={PRIMARY}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
          </button>
          {dirty && <button onClick={() => { setDraft(() => saved); setMsg(null) }} disabled={busy} title="Throw away the edits since the last save" className={GHOST}>Undo changes</button>}
          {confirmReset ? (
            <span className="inline-flex items-center gap-2 flex-wrap rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[12.5px] text-rose-800">
              Put the starting values back? Your list, prices and vendors are replaced.
              <button onClick={reset} disabled={busy} title="Replace the standard with the starting values" className="font-bold underline">Yes, reset</button>
              <button onClick={() => setConfirmReset(false)} title="Keep the list as it is" className="font-semibold text-ink/70">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmReset(true)} disabled={busy} title="Start over from the starting values (asks first)" className={GHOST + ' text-muted'}><RotateCcw size={13} /> Reset to starting values</button>
          )}
          {msg && <span className={'text-[12.5px] font-semibold ' + (msg.bad ? 'text-rose-600' : 'text-emerald-700')}>{msg.text}</span>}
        </div>
      )}
    </div>
  )
}

function ItemRow({ it, std, tier, canEdit, autoFocus, patch, patchTier, remove }: {
  it: LinenItem; std: LinenStandard; tier: LinenTier; canEdit: boolean; autoFocus: boolean
  patch: (p: Partial<LinenItem>) => void; patchTier: (p: Partial<TierOption>) => void; remove: () => void
}) {
  const off = it.active === false
  const opt = tierOf(it, tier)
  const tierOff = !!opt.off
  const tl = std.tierLabels[tier]
  // Sizes shown under a per-bed item: the standard's sizes, then any size this item still has a count or a price for.
  const sizes = it.per === 'bed' ? sortSizes(Array.from(new Set([...std.bedSizes, ...Object.keys(it.qtyBySize || {}), ...Object.keys(opt.priceBySize || {})])), std.bedSizes) : []
  const setSizedQty = (size: string, v: string) => {
    const n = toNum(v)
    const next: Record<string, number> = { ...(it.qtyBySize || {}) }
    if (n === null) delete next[size]; else next[size] = Math.max(0, n)
    patch({ qtyBySize: Object.keys(next).length ? next : undefined })
  }
  const setSizedPrice = (size: string, v: string) => {
    const n = toNum(v)
    const next: Record<string, number> = { ...(opt.priceBySize || {}) }
    if (n === null) delete next[size]; else next[size] = Math.max(0, n)
    patchTier({ priceBySize: Object.keys(next).length ? next : undefined })
  }
  const whole = (v: string) => { const n = toNum(v); return n === null ? undefined : Math.max(0, Math.round(n)) }
  return (
    <div className={'px-3 sm:px-4 py-2 ' + (off ? 'opacity-60' : '')}>
      <div className="flex items-center gap-2 flex-wrap lg:flex-nowrap">
        <input value={it.name} onChange={e => patch({ name: e.target.value })} disabled={!canEdit} autoFocus={autoFocus} maxLength={LIMITS.name}
          placeholder="Item name" title="Item name" className={INPUT + ' flex-1 min-w-[10rem] py-1.5 font-semibold ' + (!it.name.trim() ? 'border-rose-300' : '')} />
        <select value={it.per} disabled={!canEdit} onChange={e => patch({ per: e.target.value as LinenPer })} title="What the quantity is counted against"
          className={INPUT + ' w-[7.5rem] py-1.5 px-2'}>
          {LINEN_PER.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <input type="number" inputMode="decimal" min={0} max={LIMITS.num} step="any" value={it.qty} disabled={!canEdit}
          onChange={e => patch({ qty: Math.max(0, toNum(e.target.value) ?? 0) })}
          title={it.per === 'bed' ? 'How many per bed — for any size without its own number below' : 'How many ' + (LINEN_PER.find(p => p.key === it.per)?.label || '')}
          className={NUM + ' w-16'} />
        <button onClick={() => canEdit && patch({ rotates: !it.rotates })} disabled={!canEdit}
          title={it.rotates ? 'Rotates: bought par times — on the bed, in the wash, on the shelf. Click for one set.' : 'One set: bought once, not rotated (pillows, duvet inserts). Click to rotate it.'}
          className={'w-[5.5rem] rounded-lg border px-2 py-1.5 text-[12px] font-semibold ' + (it.rotates ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted') + (canEdit ? '' : ' cursor-default')}>
          {it.rotates ? 'Rotates' : 'One set'}
        </button>
        <input type="number" inputMode="numeric" min={0} max={LIMITS.num} value={it.rotates ? (it.par ?? '') : ''} disabled={!canEdit || !it.rotates}
          placeholder={it.rotates ? String(std.par) : '–'}
          onChange={e => { const n = toNum(e.target.value); patch({ par: n === null ? null : Math.max(0, Math.round(n)) }) }}
          title={it.rotates ? `This item's own par. Blank = the standard's par (${std.par}).` : 'One set — par does not apply'}
          className={NUM + ' w-14'} />
        <button onClick={() => canEdit && patch({ active: off })} disabled={!canEdit}
          title={off ? 'Off: kept on the list, not counted at any tier. Click to count it.' : 'On: counted in every unit. Click to switch it off without deleting it.'}
          className={'w-12 rounded-lg border px-1.5 py-1.5 text-[12px] font-semibold ' + (off ? 'border-line bg-white text-muted' : 'border-emerald-200 bg-emerald-50 text-emerald-700') + (canEdit ? '' : ' cursor-default')}>
          {off ? 'Off' : 'On'}
        </button>
        {canEdit ? <IconBtn title="Remove this item from the standard" tone="bad" onClick={remove}><Trash2 size={13} /></IconBtn> : <span className="w-8" />}
      </div>
      {/* What is bought at the tier being edited. */}
      <div className={'mt-1.5 flex items-center gap-1.5 flex-wrap ' + (tierOff ? 'opacity-60' : '')}>
        <Tag tone="violet" title={`The fields on this line are for the ${tl} tier — switch tiers above the list`}>{tl}</Tag>
        <input value={opt.product || ''} onChange={e => patchTier({ product: e.target.value || undefined })} disabled={!canEdit} maxLength={LIMITS.product}
          placeholder={`What you buy at ${tl}`} title={`The product at ${tl} (e.g. T-300 cotton percale) — shown on the quote, the invoice and the deck`} className={INPUT + ' flex-1 min-w-[9rem] py-1'} />
        <input value={opt.vendor || ''} onChange={e => patchTier({ vendor: e.target.value || undefined })} disabled={!canEdit} maxLength={LIMITS.vendor} list="linen-vendors"
          placeholder="Vendor" title="Where it is bought at this tier — pick from the vendor list so the order carries their contact, minimum and lead time" className={INPUT + ' w-40 py-1'} />
        <input value={opt.sku || ''} onChange={e => patchTier({ sku: e.target.value || undefined })} disabled={!canEdit} maxLength={LIMITS.sku}
          placeholder="SKU" title="The vendor's SKU — two items on the same SKU are ordered as one line" className={INPUT + ' w-24 py-1'} />
        <span className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted pointer-events-none">$</span>
          <input type="number" inputMode="decimal" min={0} step="any" value={opt.price ?? ''} disabled={!canEdit}
            onChange={e => { const n = toNum(e.target.value); patchTier({ price: n === null ? null : Math.max(0, n) }) }}
            placeholder="each" title={it.per === 'bed' ? `Price per piece at ${tl} — for any size without its own price below` : `Price per piece at ${tl} (not per case)`}
            className={NUM + ' w-20 pl-4 py-1'} />
        </span>
        <span className="inline-flex items-center gap-1" title="Pieces per case — blank or 1 = sold singly. The vendor order rounds up to whole cases; the overage goes to stock.">
          <input type="number" inputMode="numeric" min={1} max={LIMITS.num} value={opt.packSize ?? ''} disabled={!canEdit}
            onChange={e => patchTier({ packSize: whole(e.target.value) || undefined })} placeholder="1" aria-label="Pieces per case" className={NUM + ' w-14 py-1'} />
          <span className="text-[11px] text-muted">/case</span>
        </span>
        <span className="inline-flex items-center gap-1" title="The fewest cases the vendor sells on this line (blank = no minimum)">
          <input type="number" inputMode="numeric" min={0} max={LIMITS.num} value={opt.minCases ?? ''} disabled={!canEdit}
            onChange={e => patchTier({ minCases: whole(e.target.value) || undefined })} placeholder="–" aria-label="Minimum cases" className={NUM + ' w-12 py-1'} />
          <span className="text-[11px] text-muted">min</span>
        </span>
        <button onClick={() => canEdit && patchTier({ off: tierOff ? undefined : true })} disabled={!canEdit}
          title={tierOff ? `Not part of ${tl}: left out of its quote, invoice and order. Click to include it.` : `Part of ${tl}. Click to leave it out of this tier only.`}
          className={'rounded-lg border px-2 py-1 text-[11.5px] font-semibold whitespace-nowrap ' + (tierOff ? 'border-line bg-white text-muted' : 'border-violet-200 bg-violet-50 text-violet-700') + (canEdit ? '' : ' cursor-default')}>
          {tierOff ? 'Not in ' + tl : 'In ' + tl}
        </button>
      </div>
      {it.per === 'bed' && sizes.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted mr-0.5" title={`Per bed of each size: how many (every tier), and the ${tl} price. Blank = the qty and price above.`}>By size</span>
          {sizes.map(s => (
            <span key={s} className="inline-flex items-center gap-1 rounded-lg border border-line bg-app/60 pl-2 pr-1 py-0.5">
              <span className="text-[11.5px] font-semibold text-ink">{s}</span>
              <input type="number" inputMode="decimal" min={0} max={LIMITS.num} step="any" value={it.qtyBySize?.[s] ?? ''} placeholder={String(it.qty)} disabled={!canEdit}
                onChange={e => setSizedQty(s, e.target.value)} title={`How many on a ${s} bed, at every tier (blank = ${it.qty})`} className={NUM + ' w-12 py-1'} />
              <input type="number" inputMode="decimal" min={0} step="any" value={opt.priceBySize?.[s] ?? ''} placeholder={opt.price != null ? '$' + opt.price : '$'} disabled={!canEdit}
                onChange={e => setSizedPrice(s, e.target.value)} title={`${tl} price per piece for the ${s} size (blank = ${opt.price != null ? '$' + opt.price : 'no price'})`} className={NUM + ' w-16 py-1'} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** The vendors linen is bought from: how to order, the minimum, the lead time. */
function VendorsCard({ vendors, canEdit, onChange }: { vendors: LinenVendor[]; canEdit: boolean; onChange: (v: LinenVendor[]) => void }) {
  const [open, setOpen] = useState<number | null>(null)
  const set = (i: number, p: Partial<LinenVendor>) => onChange(vendors.map((v, j) => j === i ? { ...v, ...p } : v))
  const add = () => { if (vendors.length >= LIMITS.vendors) return; onChange([...vendors, { name: '' }]); setOpen(vendors.length) }
  const del = (i: number) => { onChange(vendors.filter((_, j) => j !== i)); setOpen(null) }
  const field = (i: number, k: keyof LinenVendor, label: string, tip: string, max: number, cls = '') => (
    <label className={'block ' + cls} title={tip}>
      <span className="block text-[10.5px] uppercase tracking-wider text-muted font-semibold mb-0.5">{label}</span>
      <input value={String(vendors[i][k] ?? '')} onChange={e => set(i, { [k]: e.target.value || undefined } as Partial<LinenVendor>)} disabled={!canEdit} maxLength={max} className={INPUT + ' w-full py-1.5'} />
    </label>
  )
  const numField = (i: number, k: 'minOrder' | 'leadDays', label: string, tip: string) => (
    <label className="block" title={tip}>
      <span className="block text-[10.5px] uppercase tracking-wider text-muted font-semibold mb-0.5">{label}</span>
      <input type="number" inputMode="decimal" min={0} step={k === 'leadDays' ? 1 : 'any'} value={vendors[i][k] ?? ''} disabled={!canEdit}
        onChange={e => { const n = toNum(e.target.value); set(i, { [k]: n === null ? null : Math.max(0, k === 'leadDays' ? Math.round(n) : n) } as Partial<LinenVendor>) }} className={NUM + ' w-full text-left'} />
    </label>
  )
  return (
    <section className="mb-3">
      <div className="mb-1.5 px-1 flex items-center gap-2">
        <h2 className={EYEBROW}>Vendors</h2>
        <span className="text-[11px] text-muted tabular-nums">{vendors.length}</span>
        {canEdit && vendors.length < LIMITS.vendors && <button onClick={add} title="Add a vendor — then pick it on an item's tier line" className="ml-auto inline-flex items-center gap-1 text-[12px] font-semibold text-ink/80 hover:text-ink"><Plus size={13} /> Add vendor</button>}
      </div>
      {!vendors.length ? <LeanEmpty>No vendors yet{canEdit ? ' — add one for its contact, how to order, minimum and lead time.' : '.'}</LeanEmpty> : (
        <LeanList>
          {vendors.map((v, i) => (
            <LeanRow key={i} open={open === i} onToggle={() => setOpen(open === i ? null : i)}
              name={v.name || <span className="text-rose-600">Unnamed vendor</span>}
              meta={[v.orderVia, v.contact].filter(Boolean).join(' · ')}
              tags={<>
                {typeof v.minOrder === 'number' && v.minOrder > 0 && <Tag tone="slate" title={`Minimum order ${money(v.minOrder)} — an order under it is flagged`}>min {money(v.minOrder)}</Tag>}
                {typeof v.leadDays === 'number' && <Tag tone="sky" title={`${v.leadDays} day${v.leadDays === 1 ? '' : 's'} from order to delivery`}>{v.leadDays}d lead</Tag>}
              </>}
              actions={canEdit ? <IconBtn title="Remove this vendor" tone="bad" onClick={() => del(i)}><Trash2 size={13} /></IconBtn> : undefined}
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {field(i, 'name', 'Name', 'The name items use to pick this vendor', LIMITS.vendor)}
                {field(i, 'contact', 'Contact', 'Who you deal with there', LIMITS.contact)}
                {field(i, 'email', 'Email', 'Where orders or questions go', LIMITS.email)}
                {field(i, 'phone', 'Phone', 'Their number', LIMITS.phone)}
                {field(i, 'orderVia', 'How to order', 'Portal, email, a rep — how an order is actually placed', LIMITS.orderVia, 'sm:col-span-2')}
                {numField(i, 'minOrder', 'Minimum $', 'The smallest order they take, in dollars — an order under it is flagged')}
                {numField(i, 'leadDays', 'Lead days', 'Days from order to delivery')}
                {field(i, 'notes', 'Notes', 'Anything else about ordering from them', LIMITS.notes, 'sm:col-span-2 lg:col-span-4')}
              </div>
            </LeanRow>
          ))}
        </LeanList>
      )}
    </section>
  )
}

// ── CALCULATOR ────────────────────────────────────────────────────────────────────────────────────
const shapeOf = (u: LinenDeskUnit): ManualUnitInput => ({ name: u.name, bedrooms: u.bedrooms, bathrooms: u.bathrooms, guests: u.guests, beds: u.beds })

function CalculatorView({ standard, dirty, units, setUnits, partial, picked, pick, canBeds, tier, setTier }: {
  standard: LinenStandard; dirty: boolean; units: LinenDeskUnit[]; setUnits: (f: (u: LinenDeskUnit[]) => LinenDeskUnit[]) => void; partial: boolean
  picked: string[]; pick: (ids: string[]) => void; canBeds: boolean; tier: LinenTier; setTier: (t: LinenTier) => void
}) {
  const [q, setQ] = useState('')
  const [bld, setBld] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const buildings = useMemo(() => {
    const c: Record<string, number> = {}
    for (const u of units) { const b = u.building || 'Unassigned'; c[b] = (c[b] || 0) + 1 }
    return Object.entries(c).sort((a, b) => a[0].localeCompare(b[0]))
  }, [units])
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    return units.filter(u => (bld === 'all' || (u.building || 'Unassigned') === bld) && (!n || (u.name + ' ' + (u.building || '')).toLowerCase().includes(n)))
  }, [units, q, bld])
  const pickedSet = useMemo(() => new Set(picked), [picked])
  const chosen = useMemo(() => units.filter(u => pickedSet.has(u.id)), [units, pickedSet])
  const totals = useMemo(() => linenTotals(standard, chosen, tier), [standard, chosen, tier])
  const allTiers = useMemo(() => linenQuoteAllTiers(standard, chosen), [standard, chosen])
  const order = useMemo(() => vendorOrder(standard, chosen, tier), [standard, chosen, tier])

  const toggle = (id: string) => pick(pickedSet.has(id) ? picked.filter(x => x !== id) : [...picked, id])
  const allShownIn = shown.length > 0 && shown.every(u => pickedSet.has(u.id))
  const selectShown = () => pick(allShownIn ? picked.filter(id => !shown.some(u => u.id === id)) : Array.from(new Set([...picked, ...shown.map(u => u.id)])))
  const SHOW_MAX = 80
  const scope = bld === 'all' ? (q.trim() ? 'shown' : 'units') : 'in ' + bld

  const title = chosen.length === 1 ? 'Linens — ' + chosen[0].name : `Linens — ${chosen.length} units` + (chosen.length <= 6 ? ': ' + chosen.map(u => u.name).join(', ') : '')
  const download = () => saveBlob(new Blob([linenCsv(totals)], { type: 'text/csv;charset=utf-8' }), 'linens-' + tier + '-' + new Date().toISOString().slice(0, 10) + '.csv')
  const copy = async () => { try { await navigator.clipboard.writeText(linenText(totals, title + ' (' + standard.tierLabels[tier] + ')')); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked — the CSV still works */ } }
  const shapes = useMemo(() => chosen.map(shapeOf), [chosen])

  return (
    <div>
      <section className={CARD + ' p-3 sm:p-4 mb-3'}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={EYEBROW}>Units</span>
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search unit or building" className={INPUT + ' w-full pl-8 py-1.5'} />
          </div>
          <span className="ml-auto text-[12.5px] text-muted tabular-nums"><b className="text-ink">{picked.length}</b> selected</span>
          {picked.length > 0 && <button onClick={() => pick([])} title="Unselect every unit" className="text-[12px] font-semibold text-muted hover:text-ink">Clear</button>}
        </div>
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          {[['all', units.length] as [string, number], ...buildings].map(([b, n]) => (
            <button key={b} onClick={() => setBld(b)} title={b === 'all' ? 'Every building' : 'Only ' + b}
              className={'px-2.5 py-1 rounded-full border text-[12px] font-semibold ' + (bld === b ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink')}>
              {b === 'all' ? 'All' : b} <span className="opacity-60 tabular-nums">{n}</span>
            </button>
          ))}
        </div>
        {shown.length > 0 && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button onClick={selectShown} title={allShownIn ? 'Unselect these units' : 'Add every unit listed here to the order'} className="text-[12px] font-bold text-brand-700 hover:underline">
              {allShownIn ? 'Unselect all ' + scope : `Select all ${shown.length} ${scope}`}
            </button>
          </div>
        )}
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {shown.slice(0, SHOW_MAX).map(u => {
            const on = pickedSet.has(u.id)
            return (
              <button key={u.id} onClick={() => toggle(u.id)} title={unitLine(u) + ' · ' + bedsText(u.beds, standard.bedSizes) + (on ? ' — click to take off the order' : ' — click to add to the order')}
                className={'px-2.5 py-1 rounded-full border text-[12px] font-semibold max-w-full truncate ' + (on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink') + (u.live ? '' : ' border-dashed')}>
                {on && <Check size={11} className="inline -mt-0.5 mr-0.5" />}{u.name}
              </button>
            )
          })}
          {shown.length > SHOW_MAX && <span className="text-[12px] text-muted self-center">+{shown.length - SHOW_MAX} more — search or pick a building to narrow</span>}
          {!shown.length && <span className="text-[12.5px] text-muted">{units.length ? 'No unit matches.' : 'No active units found.'}</span>}
        </div>
        {partial && <p className="mt-2 text-[12px] text-amber-800 font-semibold" title="The listings read stopped early — reload the page to try again">Some listings did not load — reload to get the full list.</p>}
      </section>

      {!chosen.length ? <LeanEmpty>Pick units above to size the order.</LeanEmpty> : (
        <>
          <div className="mb-1.5 px-1 flex items-center gap-2">
            <h2 className={EYEBROW}>Selected <span className="tabular-nums">{chosen.length}</span></h2>
            {dirty && <Tag tone="amber" title="The standard has edits that are not saved — these numbers already use them">unsaved standard</Tag>}
          </div>
          <div className="mb-3">
            <LeanList>
              {chosen.map(u => (
                <UnitRow key={u.id} u={u} std={standard} canBeds={canBeds}
                  open={openId === u.id || editId === u.id} editing={editId === u.id}
                  onToggle={() => { if (openId === u.id || editId === u.id) { setOpenId(null); setEditId(null) } else setOpenId(u.id) }}
                  onEdit={() => { setEditId(editId === u.id ? null : u.id); setOpenId(u.id) }}
                  onDoneEdit={() => setEditId(null)}
                  onRemove={() => toggle(u.id)}
                  onBeds={(beds, source) => setUnits(list => list.map(x => x.id === u.id ? { ...x, beds, bedsSource: source } : x))} />
              ))}
            </LeanList>
          </div>
          <TierCards quotes={allTiers} value={tier} onChange={setTier} />
          <TotalsCard totals={totals} label={standard.tierLabels[tier]} onCsv={download} onCopy={copy} copied={copied} />
          <VendorOrderCard order={order} />
          <DocActions tier={tier} units={shapes} dirty={dirty} priced={allTiers[tier].priced} copyLabel="Copy the owner quote for this tier as text"
            onCopy={async () => { try { await navigator.clipboard.writeText(quoteText(allTiers[tier], title)); return true } catch { return false } }} />
        </>
      )}
    </div>
  )
}

const unitLine = (u: LinenDeskUnit) => [u.bedrooms ? u.bedrooms + ' BR' : 'Studio', (u.bathrooms || 0) + ' BA', u.guests ? u.guests + ' guests' : 'guests ?'].join(' · ')
const bedsText = (beds: Record<string, number>, order: string[]) => sortSizes(Object.keys(beds).filter(k => beds[k] > 0), order).map(k => `${k} ×${beds[k]}`).join(', ') || 'no beds'

function UnitRow({ u, std, canBeds, open, editing, onToggle, onEdit, onDoneEdit, onRemove, onBeds }: {
  u: LinenDeskUnit; std: LinenStandard; canBeds: boolean; open: boolean; editing: boolean
  onToggle: () => void; onEdit: () => void; onDoneEdit: () => void; onRemove: () => void
  onBeds: (beds: Record<string, number>, source: BedsSource) => void
}) {
  const src = SOURCE[u.bedsSource] || SOURCE.assumed
  const rows = useMemo(() => linenNeeds(std, u), [std, u])
  const sizes = sortSizes(Object.keys(u.beds).filter(k => u.beds[k] > 0), std.bedSizes)
  return (
    <LeanRow open={open} onToggle={onToggle}
      name={u.name}
      meta={[u.building, unitLine(u)].filter(Boolean).join(' · ')}
      tags={<>
        {sizes.map(s => <Tag key={s} title={`${u.beds[s]} ${s} bed${u.beds[s] > 1 ? 's' : ''}`}>{s} ×{u.beds[s]}</Tag>)}
        <Tag tone={src.tone} title={src.title}>{src.label}</Tag>
        {!u.live && <Tag tone="violet" title="An onboarding unit that is not live in Guesty yet">not live</Tag>}
        {!u.guests && <Tag tone="rose" title="No max-guest count — per-guest items (towels, washcloths) are not counted for this unit">no guest count</Tag>}
      </>}
      actions={<>
        <IconBtn title="Quote this unit alone" href={'/onboarding/linens?unit=' + encodeURIComponent(u.id)}><FileText size={13} /></IconBtn>
        {canBeds && <IconBtn title={editing ? 'Close the bed editor' : "Set this unit's bed sizes"} onClick={onEdit}><Pencil size={13} /></IconBtn>}
        <IconBtn title="Take off the order" onClick={onRemove}><X size={14} /></IconBtn>
      </>}
    >
      {editing
        ? <BedEditor u={u} std={std} onDone={onDoneEdit} onBeds={onBeds} />
        : <NeedsTable rows={rows} />}
    </LeanRow>
  )
}

function NeedsTable({ rows }: { rows: ReturnType<typeof linenNeeds> }) {
  if (!rows.length) return <p className="text-[12.5px] text-muted">Nothing on the standard applies to this unit.</p>
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[420px] text-[12.5px]">
        <thead className="bg-app text-[10.5px] uppercase tracking-wider text-muted">
          <tr><th className="text-left font-semibold px-3 py-1.5">Item</th><th className="text-left font-semibold px-2 py-1.5">Size</th>
            <th className="text-right font-semibold px-2 py-1.5" title="One set on the unit">On the unit</th><th className="text-right font-semibold px-2 py-1.5" title="Sets in rotation (1 when the item does not rotate)">Par</th><th className="text-right font-semibold px-3 py-1.5">Total</th></tr>
        </thead>
        <tbody className="divide-y divide-line/70">
          {rows.map(r => (
            <tr key={r.itemId + '|' + (r.size || '')}>
              <td className="px-3 py-1.5 text-ink">{r.name}</td><td className="px-2 py-1.5 text-muted">{r.size || ''}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.perUnitQty}</td><td className="px-2 py-1.5 text-right tabular-nums text-muted">×{r.par}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BedEditor({ u, std, onDone, onBeds }: { u: LinenDeskUnit; std: LinenStandard; onDone: () => void; onBeds: (beds: Record<string, number>, source: BedsSource) => void }) {
  const sizes = sortSizes(Array.from(new Set([...std.bedSizes, ...Object.keys(u.beds)])), std.bedSizes)
  const [beds, setBeds] = useState<Record<string, number>>(() => ({ ...u.beds }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const total = Object.values(beds).reduce((a, b) => a + (b || 0), 0)
  const send = async (next: Record<string, number> | null) => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/onboard/linens', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unitBeds: { listingId: u.id, beds: next } }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || 'Could not save')
      if (j.beds) onBeds(j.beds, 'saved'); else onBeds(u.autoBeds, u.autoSource)
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const auto = SOURCE[u.autoSource] || SOURCE.assumed
  return (
    <div className="rounded-xl border border-line bg-app/50 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        {sizes.map(s => (
          <label key={s} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white pl-2.5 pr-1 py-1">
            <span className="text-[12.5px] font-semibold text-ink">{s}</span>
            <input type="number" inputMode="numeric" min={0} max={20} value={beds[s] ?? 0}
              onChange={e => { const n = Math.max(0, Math.min(20, Math.round(toNum(e.target.value) ?? 0))); setBeds(b => { const x = { ...b }; if (n) x[s] = n; else delete x[s]; return x }) }}
              title={`How many ${s} beds`} className={NUM + ' w-14 py-1'} />
          </label>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        <button onClick={() => send(beds)} disabled={busy || total === 0 || (same(beds, u.beds) && u.bedsSource === 'saved')} title={total === 0 ? 'A unit needs at least one bed' : 'Save these bed sizes for this unit'} className={PRIMARY}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save beds
        </button>
        <button onClick={onDone} disabled={busy} title="Close without saving" className={GHOST}>Cancel</button>
        {u.bedsSource === 'saved' && (
          <button onClick={() => send(null)} disabled={busy} title={`Forget the saved sizes and go back to ${auto.label} (${bedsText(u.autoBeds, std.bedSizes)})`} className="text-[12px] font-semibold text-muted hover:text-ink">
            Clear saved — use {auto.label}
          </button>
        )}
        {err && <span className="text-[12.5px] text-rose-600 font-semibold">{err}</span>}
      </div>
    </div>
  )
}

function TotalsCard({ totals, label, onCsv, onCopy, copied }: { totals: LinenTotals; label: string; onCsv: () => void; onCopy: () => void; copied: boolean }) {
  const pieces = totals.rows.reduce((a, r) => a + r.qty, 0)
  return (
    <section className={CARD + ' mb-3 overflow-hidden'}>
      <div className="px-3 sm:px-4 py-2.5 flex items-center gap-2 flex-wrap border-b border-line">
        <h2 className={EYEBROW}>Order · {label}</h2>
        <span className="text-[12.5px] text-muted tabular-nums">{totals.units} unit{totals.units === 1 ? '' : 's'} · {pieces.toLocaleString('en-US')} pieces</span>
        {totals.priced > 0 && <Pill tone="emerald" title={(totals.unpriced ? `${totals.unpriced} line${totals.unpriced === 1 ? ' has' : 's have'} no price and are not in this total. ` : 'Every line is priced. ') + 'Pieces at the piece price — before markup and tax, and before rounding to whole cases.'}>{money(totals.grandTotal)}</Pill>}
        <span className="ml-auto flex items-center gap-1.5">
          <button onClick={onCsv} disabled={!totals.rows.length} title="Download the pieces list as a spreadsheet (CSV)" className={GHOST}><Download size={13} /> Download CSV</button>
          <button onClick={onCopy} disabled={!totals.rows.length} title="Copy the pieces list as plain text — paste it into an email or message to the vendor" className={GHOST}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy list'}</button>
        </span>
      </div>
      {!totals.rows.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Nothing on the standard applies to these units.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted">
              <tr><th className="text-left font-semibold px-3 sm:px-4 py-2">Item</th><th className="text-left font-semibold px-2 py-2">Size</th><th className="text-right font-semibold px-2 py-2">Qty</th>
                <th className="text-right font-semibold px-2 py-2" title="Price per piece">Unit price</th><th className="text-right font-semibold px-3 sm:px-4 py-2">Cost</th></tr>
            </thead>
            {LINEN_GROUPS.map(g => {
              const rows = totals.rows.filter(r => r.group === g)
              if (!rows.length) return null
              const sub = rows.reduce((a, r) => a + (r.cost || 0), 0)
              return (
                <tbody key={g} className="border-t border-line">
                  <tr className="bg-app/60"><td colSpan={4} className={EYEBROW + ' px-3 sm:px-4 py-1.5'}>{g}</td>
                    <td className="px-3 sm:px-4 py-1.5 text-right text-[12px] text-muted tabular-nums">{sub > 0 ? money(sub) : ''}</td></tr>
                  {rows.map(r => (
                    <tr key={r.key} className="border-t border-line/60">
                      <td className="px-3 sm:px-4 py-1.5 text-ink">{r.name}{r.vendor ? <span className="text-muted text-[11.5px]"> · {r.vendor}</span> : null}{r.product ? <span className="block text-muted text-[11.5px]">{r.product}</span> : null}</td>
                      <td className="px-2 py-1.5 text-muted">{r.size || ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{r.qty.toLocaleString('en-US')}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">{r.price != null ? money(r.price) : ''}</td>
                      <td className="px-3 sm:px-4 py-1.5 text-right tabular-nums">{r.cost != null ? money(r.cost) : <Tag tone="amber" title="No price for this line at this tier — add it on the Standard">unpriced</Tag>}</td>
                    </tr>
                  ))}
                </tbody>
              )
            })}
            {totals.priced > 0 && (
              <tfoot>
                <tr className="border-t-2 border-line">
                  <td colSpan={4} className="px-3 sm:px-4 py-2 font-bold text-ink">Total{totals.unpriced ? <span className="font-normal text-[12px] text-muted"> · {totals.unpriced} line{totals.unpriced === 1 ? '' : 's'} with no price left out</span> : null}</td>
                  <td className="px-3 sm:px-4 py-2 text-right font-bold tabular-nums text-ink">{money(totals.grandTotal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {totals.priced === 0 && totals.rows.length > 0 && <p className="px-3 sm:px-4 py-2 border-t border-line text-[12px] text-muted">No prices at {label} yet — add them on the Standard to get a cost.</p>}
    </section>
  )
}

// ── QUOTE: a unit with no listing ─────────────────────────────────────────────────────────────────
type Draft = { name: string; bedrooms: number; bathrooms: number; guests: number; beds: Record<string, number>; copies: number }
const BLANK: Draft = { name: '', bedrooms: 1, bathrooms: 1, guests: 2, beds: { Queen: 1 }, copies: 1 }

function QuoteView({ standard, dirty, tier, setTier, prefill, missing, quotes, canChoose, onChosen }: {
  standard: LinenStandard; dirty: boolean; tier: LinenTier; setTier: (t: LinenTier) => void
  prefill: LinenDeskUnit | null; missing: boolean
  quotes: Record<string, LinenQuoteChoice>; canChoose: boolean; onChosen: (code: string, q: LinenQuoteChoice | null) => void
}) {
  const fromUnit = (u: LinenDeskUnit): Draft => ({ name: u.name, bedrooms: u.bedrooms, bathrooms: u.bathrooms, guests: u.guests, beds: { ...u.beds }, copies: 1 })
  const [d, setD] = useState<Draft>(() => prefill ? fromUnit(prefill) : { ...BLANK, beds: { ...BLANK.beds } })
  const [linked, setLinked] = useState<LinenDeskUnit | null>(prefill)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const code = linked && linked.id.startsWith('onboard:') ? linked.id.slice(8) : ''
  const chosen = code && quotes[code] ? quotes[code].tier : null
  // Opened for an onboarding unit that already has a tier picked: show that tier first.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (chosen) setTier(chosen) }, [code])

  const input: ManualUnitInput = useMemo(() => ({ name: d.name, bedrooms: d.bedrooms, bathrooms: d.bathrooms, guests: d.guests, beds: d.beds, copies: d.copies }), [d])
  const units = useMemo(() => manualUnits([input]).units, [input])
  const all = useMemo(() => linenQuoteAllTiers(standard, units), [standard, units])
  const order = useMemo(() => vendorOrder(standard, units, tier), [standard, units, tier])
  const sizes = sortSizes(Array.from(new Set([...standard.bedSizes, ...Object.keys(d.beds)])), standard.bedSizes)
  const bedCount = Object.values(d.beds).reduce((a, b) => a + (b || 0), 0)
  const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }))
  const setBed = (s: string, n: number) => setD(x => { const beds = { ...x.beds }; if (n > 0) beds[s] = n; else delete beds[s]; return { ...x, beds } })
  const label = d.name.trim() || 'Linen quote'

  const choose = async (t: LinenTier | null) => {
    if (!code) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/onboard/linens', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linenQuote: { code, tier: t } }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || 'Could not save the tier')
      onChosen(code, j.quote || null)
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy(false)
  }

  return (
    <div>
      <section className={CARD + ' p-3 sm:p-4 mb-3'}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={EYEBROW}>Unit</span>
          {linked && <Tag tone={linked.live ? 'sky' : 'violet'} title={`Filled in from ${linked.name} (${SOURCE[linked.bedsSource]?.label || 'beds'}). Changes here are for this quote only — set a unit's beds on the Calculator.`}>from {linked.name}</Tag>}
          {linked && <button onClick={() => setLinked(null)} title="Stop linking this quote to that unit (the numbers stay)" className="text-[12px] font-semibold text-muted hover:text-ink">Unlink</button>}
          {missing && !linked && <Tag tone="amber" title="The unit in the link was not found (archived, or not a live listing) — type it in">unit not found</Tag>}
          <button onClick={() => { setD({ ...BLANK, beds: { ...BLANK.beds } }); setLinked(null) }} title="Start a blank quote" className="ml-auto text-[12px] font-semibold text-muted hover:text-ink">Clear</button>
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <input value={d.name} onChange={e => set({ name: e.target.value })} maxLength={MANUAL_LIMITS.name} placeholder="Unit name (optional)" title="Printed on the invoice and the order"
            className={INPUT + ' py-1.5 w-full sm:w-56'} />
          <Stepper label="Units" value={d.copies} min={1} max={MANUAL_LIMITS.units} onChange={n => set({ copies: n })} title="How many identical units — the vendor order pools them into whole cases" />
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <Stepper label="Bedrooms" value={d.bedrooms} min={0} max={MANUAL_LIMITS.bedrooms} onChange={n => set({ bedrooms: n })} title="Bedrooms (0 = studio) — throws and extra blankets count per bedroom" />
          <Stepper label="Baths" value={d.bathrooms} min={0} max={MANUAL_LIMITS.bathrooms} step={0.5} onChange={n => set({ bathrooms: n })} title="Bathrooms, halves allowed — a half bath still gets its hand towels and mat" />
          <Stepper label="Guests" value={d.guests} min={0} max={MANUAL_LIMITS.guests} onChange={n => set({ guests: n })} title="Maximum occupancy — towels and washcloths count per guest" />
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted" title="Beds by size — a bunk bed is two Twins; a crib takes none of these linens">Beds</span>
          {sizes.map(s => <Stepper key={s} label={s} value={d.beds[s] || 0} min={0} max={MANUAL_LIMITS.bedsPerSize} onChange={n => setBed(s, n)} title={`How many ${s} beds${s === 'Twin' ? ' (a bunk is two Twins)' : ''}`} />)}
          {bedCount === 0 && <Tag tone="rose" title="No beds — nothing per bed (sheets, pillows, duvets) is counted">no beds</Tag>}
          {d.guests === 0 && <Tag tone="rose" title="No guests — per-guest items (towels, washcloths) are not counted">no guests</Tag>}
        </div>
      </section>

      <div className="mb-1.5 px-1 flex items-center gap-2 flex-wrap">
        <h2 className={EYEBROW}>Tiers</h2>
        {dirty && <Tag tone="amber" title="The standard has edits that are not saved — these numbers already use them">unsaved standard</Tag>}
        {code && canChoose && (chosen === tier
          ? <button onClick={() => choose(null)} disabled={busy} title={`Clear the tier picked for ${linked?.name}`} className="ml-auto text-[12px] font-semibold text-muted hover:text-ink">Clear the pick</button>
          : <button onClick={() => choose(tier)} disabled={busy} title={`Save ${standard.tierLabels[tier]} as ${linked?.name}'s linen tier — it shows on the onboarding desk now, and on the onboarding deck the next time it is generated`}
              className="ml-auto inline-flex items-center gap-1 text-[12px] font-bold text-brand-700 hover:underline">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Use {standard.tierLabels[tier]} for this unit
            </button>)}
        {msg && <span className="text-[12px] text-rose-600 font-semibold">{msg}</span>}
      </div>
      <TierCards quotes={all} value={tier} onChange={setTier} chosen={chosen} />
      <QuoteCard q={all[tier]} />
      <VendorOrderCard order={order} />
      <DocActions tier={tier} units={[input]} dirty={dirty} priced={all[tier].priced} copyLabel="Copy this tier's quote as text — for an email or a message to the owner"
        onCopy={async () => { try { await navigator.clipboard.writeText(quoteText(all[tier], label + (d.copies > 1 ? ' ×' + d.copies : ''))); return true } catch { return false } }} />
    </div>
  )
}
