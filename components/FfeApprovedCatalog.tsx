'use client'
// A CATALOG — REVIEW, APPROVE, THE APPROVED LIST, MANAGE (Jon, 2026-10-20 → 10-27).
//
// "Make this easy to review, approve, and build our 17 West furniture catalog, so when needing to
// replace, we know what we are approved to replace it with."
//
// Every item from the sourcing sheet sits on one card with its options side by side: the HostGPO
// member price through Article, the Amazon listing from the sheet, and a City Home (delivered and
// set up) or Wayfair (chairs and sofas; flat-pack) match. Tap Approve on each option that is
// acceptable for the property; mark a card "Not for 17 West" when none is. Decisions save to the
// server as you go, so the whole team sees the same list. "Approved catalog" hides everything else
// — that view IS the replacement list.
//
// Vendor rules this reflects (Jon, 2026-10-20): City Furniture (now City Home) rather than flat-pack
// for case goods; Wayfair is fine for chairs and sofas; Amazon is fine for build-it-yourself pieces
// like nightstands; flat-pack options carry an "Assembly needed" tag.
//
// 2026-10-27: catalogs became per-property (lib/ffe-approved-catalog). This page now has tabs:
//   Review         the cards, Approve per option, suggestions from the listing photos
//   Approved list  one row per approved item with the link, supplier and price — the order list
//   Manage         the supplier pick list, add items, add options with links (edit access)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Link2, Loader2, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { useCachedFetch } from '@/lib/swr'

type OptionSrc = string
type Opt = { id?: string; src: OptionSrc; vendor: string; name: string; url: string | null; price: number | null; each?: string; image: string | null; chips: string[]; fit: 'cover' | 'contain' }
type Item = { id?: string; key: string; section: 'compare' | 'vendor' | 'amenity'; category: string; name: string; options: Opt[] }
type Catalog = { property: string; title: string; kind?: 'default' | 'property'; suppliers?: string[]; tier?: string | null; styleBrief?: string | null; sourceSheet: string; asOf: string; items: Item[]; misc: Record<string, string[]>; fromDb?: boolean }
type Decision = { approved: OptionSrc[]; rejected: boolean; note: string; suggested?: string[]; suggestNote?: string }
type Supplier = { key: string; name: string; note: string }
type Payload = { ok: boolean; catalog: Catalog; decisions: Record<string, Decision>; suppliers?: Supplier[]; canEdit: boolean }

const money = (v: number | null | undefined) => (v == null ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const TONES: Record<string, string> = { host: 'text-brand-700', amz: 'text-amber-700', ch: 'text-sky-700', wf: 'text-violet-700' }
const SRC_TONE = new Proxy(TONES, { get: (t, k: string) => t[k] || 'text-muted' }) as Record<string, string>
const CHIP_TONE = (c: string) =>
  /Assembly/.test(c) ? 'bg-amber-50 text-amber-800'
    : /Delivered/.test(c) ? 'bg-sky-50 text-sky-800'
      : /Contract|Bundle|Hospitality|Good|Better|Best/.test(c) ? 'bg-brand-50 text-brand-700'
        : /Set of|piece/.test(c) ? 'bg-amber-50 text-amber-800'
          : 'bg-app text-muted'

// publicCode: the page is being read through a share link — read-only, opens on the approved list,
// and the data comes from the public endpoint (which checks the code) instead of the gated one.
export function FfeApprovedCatalog({ property = '17-west', publicCode }: { property?: string; publicCode?: string }) {
  const isPublic = !!publicCode
  const { data, loading, error, refresh } = useCachedFetch<Payload>(isPublic ? `/api/public/catalog/${publicCode}` : `/api/audit/ffe/approved-catalog?property=${property}`, { ttl: 15_000, persist: false, live: !isPublic })
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [view, setView] = useState<'all' | 'approved'>(isPublic ? 'approved' : 'all')
  const [tab, setTab] = useState<'review' | 'list' | 'manage'>('review')
  const [order, setOrder] = useState<'group' | 'rank'>('group')
  const [saving, setSaving] = useState<string>('')
  // The latest decisions, readable outside render (the save path reads it, never the updater).
  const latest = useRef<Record<string, Decision>>({})
  // Items this viewer changed in the last few seconds: a teammate's poll must not overwrite them.
  const dirtyAt = useRef<Record<string, number>>({})
  const seeded = useRef(false)

  // Seed from the server, then MERGE each re-poll (useCachedFetch re-reads every 30 s / on focus) so a
  // teammate's approvals show up without a reload — except items this viewer just touched.
  useEffect(() => {
    if (!data?.decisions) return
    const incoming = data.decisions
    setDecisions(prev => {
      const out: Record<string, Decision> = seeded.current ? { ...prev } : {}
      const now = Date.now()
      for (const k of Object.keys(incoming)) { if (!seeded.current || (now - (dirtyAt.current[k] || 0)) > 5000) out[k] = incoming[k] }
      seeded.current = true
      latest.current = out
      return out
    })
  }, [data])
  useEffect(() => {
    try { const h = (window.location.hash || '').replace('#', ''); if (h === 'approved' || h === 'list') setTab('list'); if (h === 'manage') setTab('manage') } catch { /* no-op */ }
  }, [])

  const canEdit = !isPublic && !!data?.canEdit
  const items = data?.catalog.items || []

  // One in-flight save per item; a change made while one is saving is sent after it (last one wins),
  // and a failed save puts the item back to what the server last confirmed.
  const inflight = useRef<Record<string, { next: Decision | null }>>({})
  const confirmed = useRef<Record<string, Decision>>({})
  const save = useCallback(async (itemKey: string, d: Decision) => {
    if (inflight.current[itemKey]) { inflight.current[itemKey].next = d; return }
    inflight.current[itemKey] = { next: null }
    setSaving('Saving…')
    let ok = false, msg = ''
    try {
      const r = await fetch('/api/audit/ffe/approved-catalog', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property, itemKey, approved: d.approved, rejected: d.rejected, note: d.note }),
      })
      const j = await r.json().catch(() => ({}))
      ok = r.ok && !!j.ok; msg = ok ? 'Saved' : (j.error || 'That did not save.')
    } catch { msg = 'That did not save.' }
    const queued = inflight.current[itemKey]?.next || null
    delete inflight.current[itemKey]
    if (ok) confirmed.current[itemKey] = d
    else {
      const back = confirmed.current[itemKey] || data?.decisions?.[itemKey] || { approved: [], rejected: false, note: '' }
      setDecisions(prev => { const out = { ...prev, [itemKey]: back }; latest.current = out; return out })
    }
    setSaving(msg)
    if (queued && ok) save(itemKey, queued)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property])

  const noteTimers = useRef<Record<string, any>>({})
  const decide = (key: string, patch: (d: Decision) => Decision, debounce = false) => {
    if (!canEdit) return
    const cur = latest.current[key] || { approved: [], rejected: false, note: '' }
    const next = patch(cur)
    const out = { ...latest.current, [key]: next }
    latest.current = out; dirtyAt.current[key] = Date.now()
    setDecisions(out)
    if (debounce) { clearTimeout(noteTimers.current[key]); noteTimers.current[key] = setTimeout(() => save(key, next), 700) }
    else save(key, next)
  }
  const toggle = (key: string, src: OptionSrc) => decide(key, d => {
    const has = d.approved.includes(src)
    return { ...d, approved: has ? d.approved.filter(s => s !== src) : [...d.approved, src], rejected: has ? d.rejected : false }
  })
  const reject = (key: string) => decide(key, d => (d.rejected ? { ...d, rejected: false } : { approved: [], rejected: true, note: d.note }))
  const note = (key: string, v: string) => decide(key, d => ({ ...d, note: v }), true)
  const acceptSuggestion = (key: string) => decide(key, d => ({ ...d, approved: Array.from(new Set([...d.approved, ...(d.suggested || [])])), rejected: false }))
  const acceptAll = () => { for (const it of items) { const d = decisions[it.key]; if (d?.suggested?.length && !d.approved.length && !d.rejected) acceptSuggestion(it.key) } }
  const nSuggested = items.filter(it => { const d = decisions[it.key]; return d?.suggested?.length && !d.approved.length && !d.rejected }).length

  const status = (key: string) => {
    const d = decisions[key]
    if (!d) return 'pending'
    if (d.rejected) return 'rejected'
    return d.approved.length ? 'approved' : 'pending'
  }
  const stats = useMemo(() => {
    let reviewed = 0, approved = 0
    for (const it of items) { const s = status(it.key); if (s !== 'pending') reviewed++; if (s === 'approved') approved++ }
    return { total: items.length, reviewed, approved }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, decisions])

  if (loading && !data) return <div className="text-sm text-muted inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading the catalog…</div>
  if (error && !data) return <div className="text-sm text-rose-700">{error}</div>
  if (!data) return null

  const visible = (it: Item) => view === 'all' || status(it.key) === 'approved'
  const compare = items.filter(i => i.section === 'compare').filter(visible)
  const vendor = items.filter(i => i.section === 'vendor').filter(visible)
  const amenity = items.filter(i => i.section === 'amenity').filter(visible)
  const ranked = order === 'rank'
    ? [...compare].sort((a, b) => savings(b) - savings(a))
    : compare

  return (
    <div className="space-y-8">
      {/* Summary + view */}
      <div className="grid grid-cols-2 gap-3 max-w-lg">
        <Kpi v={`${stats.reviewed}`} l={`of ${stats.total} items reviewed`} tone="text-brand-700" />
        <Kpi v={`${stats.approved}`} l="items with an approved option" tone="text-emerald-700" />
      </div>
      {data.catalog.styleBrief && (
        <div className="rounded-xl border border-line bg-brand-50/60 px-4 py-3 text-sm text-ink max-w-3xl">
          <div className="text-[11px] uppercase tracking-wider text-brand-700 font-semibold mb-1 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> The look, from the listing photos{data.catalog.tier ? ` · ${data.catalog.tier === 'midlux' ? 'Mid-lux' : data.catalog.tier[0].toUpperCase() + data.catalog.tier.slice(1)}` : ''}</div>
          {data.catalog.styleBrief}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!isPublic && <Toggle value={tab} onChange={v => { setTab(v as any); setView(v === 'list' ? 'approved' : 'all'); try { window.history.replaceState(null, '', v === 'review' ? '#' : '#' + v) } catch { /* no-op */ } }}
          options={canEdit ? [['review', 'Review'], ['list', 'Approved list'], ['manage', 'Manage']] : [['review', 'Review'], ['list', 'Approved list']]} />}
        {!isPublic && tab === 'review' && <Toggle value={order} onChange={v => setOrder(v as any)} options={[['group', 'By room item'], ['rank', 'Biggest savings first']]} />}
        {!isPublic && tab === 'review' && canEdit && nSuggested > 0 && (
          <button type="button" onClick={acceptAll} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-50 text-brand-700 text-[12.5px] font-semibold px-3 py-1.5"><Sparkles className="w-3.5 h-3.5" /> Approve all {nSuggested} suggestions</button>
        )}
        <span className="text-xs text-muted" aria-live="polite">
          {isPublic ? 'Approved options only.'
            : !canEdit ? 'View only — approving needs edit access to FF&E.' : saving || 'Approvals save as you go and are shared with the whole team.'}
        </span>
        {!isPublic && <ShareLink property={property} canEdit={canEdit} />}
      </div>

      {!isPublic && tab === 'list' && <ApprovedList items={items} decisions={decisions} />}
      {!isPublic && tab === 'manage' && canEdit && <Manage property={property} catalog={data.catalog} suppliers={data.suppliers || []} onChanged={() => refresh()} />}
      {(isPublic || tab === 'review') && <>

      {/* Head-to-head */}
      <section>
        <h2 className="text-xl font-bold text-ink tracking-tight">Head-to-head: HostGPO · Amazon · City Home or Wayfair</h2>
        <p className="text-sm text-muted mt-1 max-w-3xl">Amazon listings are the ones recorded in the sheet. City Home and Wayfair matches were picked by style and function and may not be like-for-like: watch the quantity chips (sets vs. single pieces), the Contract Grade tag, and whether assembly is needed.</p>
        {ranked.length === 0 && <Empty />}
        <div className="grid gap-4 lg:grid-cols-2 mt-4">
          {groupBy(ranked, order === 'rank' ? () => '' : i => i.category).map(([cat, list]) => (
            <Group key={cat || 'ranked'} title={cat} count={list.length}>
              {list.map(it => (
                <CompareCard key={it.key} item={it} d={decisions[it.key]} status={status(it.key)} canEdit={canEdit} view={view} isPublic={isPublic}
                  onToggle={toggle} onReject={reject} onNote={note} />
              ))}
            </Group>
          ))}
        </div>
      </section>

      {/* Vendor-only */}
      <section>
        <h2 className="text-xl font-bold text-ink tracking-tight">Vendor-only items</h2>
        <p className="text-sm text-muted mt-1 max-w-3xl">Items in the sheet with HostGPO pricing but no Amazon pick yet. Where a City Home or Wayfair match was found it sits under the card with the price difference.</p>
        {vendor.length === 0 && <Empty />}
        {groupBy(vendor, i => i.category).map(([cat, list]) => (
          <div key={cat} className="mt-5">
            <h3 className="text-[15px] font-bold text-ink mb-2">{cat}</h3>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {list.map(it => <SoloCard key={it.key} item={it} d={decisions[it.key]} status={status(it.key)} canEdit={canEdit} view={view} isPublic={isPublic} onToggle={toggle} />)}
            </div>
          </div>
        ))}
      </section>

      {/* Amenities */}
      <section>
        <h2 className="text-xl font-bold text-ink tracking-tight">Amenities</h2>
        <p className="text-sm text-muted mt-1 max-w-3xl">Case pricing from the sheet with the per-unit cost worked out. Thumbnails show the vendor&apos;s retail packaging; hospitality case packs can differ.</p>
        {amenity.length === 0 && <Empty />}
        {groupBy(amenity, i => i.category).map(([cat, list]) => (
          <div key={cat} className="mt-4 rounded-xl border border-line bg-white shadow-soft overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <caption className="text-left font-bold text-ink px-4 pt-3 pb-2 text-[15px]">{cat}</caption>
              <thead><tr className="text-[11px] uppercase tracking-wider text-muted border-b border-line">
                <th className="w-14" /><th className="text-left px-2 py-1.5">Item</th><th className="text-left px-2 py-1.5">Vendor &amp; product</th>
                <th className="text-right px-2 py-1.5">Case</th><th className="text-right px-2 py-1.5">Per unit</th><th className="text-right px-3 py-1.5">Approved</th>
              </tr></thead>
              <tbody>
                {list.map(it => { const o = it.options[0]; if (!o) return null; const on = !!decisions[it.key]?.approved.includes(o.src); return (
                  <tr key={it.key} className="border-b border-line last:border-0">
                    <td className="px-3 py-2"><div className="w-11 h-11 rounded-md bg-app flex items-center justify-center overflow-hidden">
                      {o.image ? <img src={o.image} alt="" className="w-full h-full object-contain p-0.5 mix-blend-multiply" loading="lazy" /> : <span className="font-bold text-muted">{o.vendor.slice(0, 1)}</span>}</div></td>
                    <td className="px-2 py-2 font-semibold text-ink whitespace-nowrap">{it.name}</td>
                    <td className="px-2 py-2"><span className="block text-[11px] uppercase tracking-wider text-muted font-semibold">{o.vendor}</span>
                      {o.url ? <a href={o.url} target="_blank" rel="noopener" className="underline decoration-line hover:text-brand-700">{o.name}</a> : o.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{money(o.price)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap font-semibold text-brand-700">{o.each || '—'}</td>
                    <td className="px-3 py-2 text-right">{o.price != null && (view === 'all' || on) && (isPublic ? (on && <Approved />) : <ApproveBtn on={on} disabled={!canEdit} onClick={() => toggle(it.key, o.src)} small />)}</td>
                  </tr>) })}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {view === 'all' && !isPublic && (
        <section>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div><h2 className="text-xl font-bold text-ink tracking-tight">Miscellaneous</h2>
              <p className="text-sm text-muted mt-1">Small goods still to be priced per unit.</p></div>
            <span className="text-xs font-semibold text-brand-700 bg-brand-50 rounded-full px-3 py-1">Sterling Collective quote received</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3 mt-4">
            {Object.entries(data.catalog.misc).map(([grp, list]) => (
              <div key={grp} className="rounded-xl border border-line bg-white shadow-soft p-4">
                <h3 className="font-bold text-ink text-[15px] flex justify-between"><span>{grp}</span><span className="text-xs text-muted font-medium">{list.length}</span></h3>
                <ul className="mt-2 grid gap-1.5 text-sm">{list.map(x => <li key={x} className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded border border-line bg-white" />{x}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>
      )}

      </>}

      <p className="text-xs text-muted max-w-3xl border-t border-line pt-4">
        Prices as recorded in the <em>{data.catalog.sourceSheet}</em> sheet ({data.catalog.asOf}); HostGPO member pricing, Amazon, City Home and Wayfair listing prices as found, and they change. Photos come from each vendor&apos;s listing and link to it. City Home and Wayfair alternatives were selected by visual and functional similarity, not verified dimensions; City Home beds are shown in queen.
      </p>
    </div>
  )
}

// ---------- pieces ----------

function savings(it: Item) {
  const host = (it.options.find(o => o.src === 'host') || it.options[0])?.price ?? 0
  const alts = it.options.filter(o => o.src !== 'host').map(o => o.price).filter((p): p is number => p != null)
  return alts.length ? host - Math.min(...alts) : 0
}
function groupBy(list: Item[], keyOf: (i: Item) => string): [string, Item[]][] {
  const out: [string, Item[]][] = []
  for (const it of list) { const k = keyOf(it); const last = out[out.length - 1]; if (last && last[0] === k) last[1].push(it); else out.push([k, [it]]) }
  return out
}

function Kpi({ v, l, tone = 'text-ink' }: { v: string; l: string; tone?: string }) {
  return <div className="rounded-xl border border-line bg-white shadow-soft px-4 py-3"><div className={'text-2xl font-bold tabular-nums ' + tone}>{v}</div><div className="text-xs text-muted mt-0.5">{l}</div></div>
}
function Toggle({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="inline-flex rounded-full border border-line bg-white p-0.5">
      {options.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}
          className={'px-3 py-1.5 text-[12.5px] font-semibold rounded-full ' + (value === k ? 'bg-ink text-white' : 'text-muted hover:text-ink')}>{label}</button>
      ))}
    </div>
  )
}
function Empty() { return <p className="text-sm text-muted mt-3">Nothing approved here yet.</p> }
function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <>
      {title && <h3 className="lg:col-span-2 text-[15px] font-bold text-ink mt-2 -mb-1">{title} <span className="text-xs text-muted font-medium">{count} {count === 1 ? 'item' : 'items'}</span></h3>}
      {children}
    </>
  )
}
function StatusPill({ s, n }: { s: string; n: number }) {
  const cls = s === 'approved' ? 'bg-emerald-50 text-emerald-700' : s === 'rejected' ? 'bg-rose-50 text-rose-700' : 'bg-app text-muted'
  const label = s === 'approved' ? (n > 1 ? `Approved · ${n} options` : 'Approved') : s === 'rejected' ? 'Not for 17 West' : 'Pending review'
  return <span className={'text-[11px] font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap ' + cls}>{label}</span>
}
function ApproveBtn({ on, disabled, onClick, small }: { on: boolean; disabled?: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      className={'inline-flex items-center gap-1.5 rounded-lg border font-semibold disabled:opacity-60 ' + (small ? 'px-2 py-1 text-[11.5px]' : 'px-2.5 py-1.5 text-[12.5px] mt-1') +
        (on ? ' bg-emerald-600 border-emerald-600 text-white' : ' bg-white border-line text-ink hover:border-ink')}>
      <span className={'w-3.5 h-3.5 rounded border flex items-center justify-center ' + (on ? 'bg-white border-white' : 'border-line')}>{on && <Check className="w-3 h-3 text-emerald-700" strokeWidth={3} />}</span>
      {on ? 'Approved' : 'Approve'}
    </button>
  )
}
function Photo({ o, cls }: { o: Opt; cls?: string }) {
  return (
    <div className={'bg-[#f1f2ee] aspect-square overflow-hidden flex items-center justify-center ' + (cls || '')}>
      {o.image ? <img src={o.image} alt={o.name} loading="lazy" className={'w-full h-full ' + (o.fit === 'cover' ? 'object-cover' : 'object-contain p-[8%] mix-blend-multiply')} />
        : <span className="text-[11px] uppercase tracking-wider text-muted">no photo yet</span>}
    </div>
  )
}
function Diff({ ref_, price }: { ref_: number; price: number | null }) {
  if (price == null) return <span className="text-[11.5px] text-muted">no match found</span>
  const d = ref_ - price; const p = ref_ ? Math.abs(d) / ref_ * 100 : 0
  if (d === 0) return <span className="text-[11.5px] text-muted">same price</span>
  return <span className={'text-[11.5px] font-semibold rounded px-1.5 py-0.5 ' + (d > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{d > 0 ? '−' : '+'}{money(Math.abs(d))} <span className="font-medium opacity-80">({p.toFixed(0)}% {d > 0 ? 'less' : 'more'})</span></span>
}

function CompareCard({ item, d, status, canEdit, view, isPublic, onToggle, onReject, onNote }: {
  item: Item; d?: Decision; status: string; canEdit: boolean; view: 'all' | 'approved'; isPublic?: boolean
  onToggle: (k: string, s: OptionSrc) => void; onReject: (k: string) => void; onNote: (k: string, v: string) => void
}) {
  const host = item.options.find(o => o.src === 'host') || item.options[0]
  if (!host) return null
  const opts = view === 'approved' ? item.options.filter(o => d?.approved.includes(o.src)) : item.options
  return (
    <article className="rounded-xl border border-line bg-white shadow-soft overflow-hidden" id={item.key}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-line">
        <div className="font-bold text-ink text-[15px] min-w-0"><span className="text-[11px] uppercase tracking-wider text-muted font-semibold mr-2">{item.category}</span>{item.name}</div>
        <StatusPill s={status} n={d?.approved.length || 0} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}>
        {opts.map(o => {
          const on = !!d?.approved.includes(o.src)
          return (
            <div key={o.id || o.src} className={'min-w-0 border-r border-line last:border-r-0 ' + (o.src === 'host' ? 'bg-gradient-to-b from-brand-50 to-transparent' : '')}>
              <Photo o={o} />
              <div className="p-3 grid gap-1 content-start">
                <div className={'text-[11px] uppercase tracking-wider font-semibold ' + SRC_TONE[o.src]}>{o.vendor}</div>
                <div className="text-[13.5px] font-medium leading-snug break-words">{o.url ? <a href={o.url} target="_blank" rel="noopener" className="underline decoration-line hover:text-brand-700">{o.name}</a> : o.name}</div>
                {o.chips.length > 0 && <div className="flex flex-wrap gap-1">{o.chips.map(c => <span key={c} className={'text-[11px] font-semibold rounded-full px-2 py-0.5 ' + CHIP_TONE(c)}>{c}</span>)}</div>}
                <div className={'text-xl font-bold tabular-nums mt-1 ' + (o.src === 'host' ? 'text-brand-700' : 'text-ink')}>{money(o.price)}</div>
                {o !== host && host.price != null && <div><Diff ref_={host.price || 0} price={o.price} /></div>}
                {(o.price != null || o.url) && (view === 'all' || on) && (isPublic ? (on && <Approved />) : <ApproveBtn on={on} disabled={!canEdit} onClick={() => onToggle(item.key, o.src)} />)}
                {!isPublic && view === 'all' && d?.suggested?.includes(o.src) && <Suggested why={d.suggestNote} />}
              </div>
            </div>
          )
        })}
      </div>
      {view === 'all' && !isPublic && (
        <div className="border-t border-line px-4 py-2 grid gap-2 items-center" style={{ gridTemplateColumns: '1fr auto' }}>
          <textarea rows={1} value={d?.note || ''} readOnly={!canEdit} onChange={e => onNote(item.key, e.target.value)} placeholder="Notes — e.g. order 2 per unit, walnut only, confirm dimensions"
            className="text-[13px] rounded-md border border-line bg-app px-2 py-1.5 resize-y min-h-[32px] w-full" />
          <button type="button" aria-pressed={!!d?.rejected} disabled={!canEdit} onClick={() => onReject(item.key)}
            className={'inline-flex items-center gap-1 text-xs font-semibold rounded-lg border px-2.5 py-1.5 whitespace-nowrap disabled:opacity-60 ' + (d?.rejected ? 'bg-rose-50 border-rose-300 text-rose-700' : 'border-line text-muted hover:text-ink')}>
            <X className="w-3 h-3" /> Not for 17 West
          </button>
        </div>
      )}
      {(view === 'approved' || isPublic) && d?.note && <div className="border-t border-line px-4 py-2 text-[13px]"><span className="text-[11px] uppercase tracking-wider text-muted font-semibold mr-2">Note</span>{d.note}</div>}
    </article>
  )
}

function SoloCard({ item, d, status, canEdit, view, isPublic, onToggle }: { item: Item; d?: Decision; status: string; canEdit: boolean; view: 'all' | 'approved'; isPublic?: boolean; onToggle: (k: string, s: OptionSrc) => void }) {
  const main = item.options[0]; const alt = item.options[1]
  if (!main) return null
  const onMain = !!d?.approved.includes(main.src); const onAlt = !!(alt && d?.approved.includes(alt.src))
  return (
    <article className="rounded-xl border border-line bg-white shadow-soft overflow-hidden flex flex-col" id={item.key}>
      {(view === 'all' || onMain) && <Photo o={main} />}
      <div className="p-3 grid gap-1 content-start">
        <div className="flex items-center justify-between gap-2"><span className="text-[11px] uppercase tracking-wider text-muted font-semibold">{(view === 'all' || onMain) ? main.vendor : item.name}</span><StatusPill s={status} n={d?.approved.length || 0} /></div>
        {(view === 'all' || onMain) && <>
          <div className="text-[13.5px] font-medium leading-snug break-words">{main.url ? <a href={main.url} target="_blank" rel="noopener" className="underline decoration-line hover:text-brand-700">{main.name}</a> : main.name}</div>
          {main.chips.length > 0 && <div className="flex flex-wrap gap-1">{main.chips.map(c => <span key={c} className={'text-[11px] font-semibold rounded-full px-2 py-0.5 ' + CHIP_TONE(c)}>{c}</span>)}</div>}
          <div className="text-lg font-bold tabular-nums text-brand-700">{money(main.price)}</div>
          {(main.price != null || main.url) && (isPublic ? (onMain && <Approved />) : <ApproveBtn on={onMain} disabled={!canEdit} onClick={() => onToggle(item.key, main.src)} />)}
          {!isPublic && view === 'all' && d?.suggested?.includes(main.src) && <Suggested why={d.suggestNote} />}
        </>}
      </div>
      {alt && (view === 'all' || onAlt) && (
        <div className={'mt-auto border-t border-dashed border-line grid gap-2.5 p-3 ' + (alt.src === 'ch' ? 'bg-sky-50/60' : 'bg-violet-50/60')} style={{ gridTemplateColumns: '64px 1fr' }}>
          <div className="w-16 h-16 rounded-md bg-[#f1f2ee] overflow-hidden flex items-center justify-center">{alt.image ? <img src={alt.image} alt="" loading="lazy" className={'w-full h-full ' + (alt.fit === 'cover' ? 'object-cover' : 'object-contain p-1 mix-blend-multiply')} /> : null}</div>
          <div className="grid gap-0.5 min-w-0">
            <div className={'text-[11px] uppercase tracking-wider font-semibold ' + SRC_TONE[alt.src]}>{alt.vendor} · {alt.chips[0]?.toLowerCase()}</div>
            <div className="text-[13px] font-medium leading-snug break-words">{alt.url ? <a href={alt.url} target="_blank" rel="noopener" className="underline decoration-line hover:text-brand-700">{alt.name}</a> : alt.name}</div>
            <div className="text-[15px] font-bold tabular-nums flex items-center gap-2 flex-wrap">{money(alt.price)} <Diff ref_={main.price || 0} price={alt.price} /></div>
            {(view === 'all' || onAlt) && (isPublic ? (onAlt && <Approved />) : <ApproveBtn on={onAlt} disabled={!canEdit} onClick={() => onToggle(item.key, alt.src)} small />)}
            {!isPublic && view === 'all' && d?.suggested?.includes(alt.src) && <Suggested why={d.suggestNote} />}
          </div>
        </div>
      )}
    </article>
  )
}

function Suggested({ why }: { why?: string }) {
  return <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 bg-brand-50 rounded-full px-2 py-0.5 w-fit" title={why || ''}><Sparkles className="w-3 h-3" /> Suggested{why ? ` · ${why}` : ''}</span>
}

// THE APPROVED LIST (Jon, 2026-10-27: "when you click approve, there will be a tab with the links to
// each item"). One row per approved option: what it is, where to buy it, the link, the price, the note.
function ApprovedList({ items, decisions }: { items: Item[]; decisions: Record<string, Decision> }) {
  const rows: { item: Item; o: Opt; note: string }[] = []
  for (const it of items) { const d = decisions[it.key]; if (!d || d.rejected || !d.approved.length) continue; for (const o of it.options) if (d.approved.includes(o.src)) rows.push({ item: it, o, note: d.note }) }
  if (!rows.length) return <p className="text-sm text-muted">Nothing approved yet. Approve options on the Review tab and they show up here with their links.</p>
  const groups = groupBy(rows.map(r => r.item), i => i.category).map(([cat]) => cat).filter((c, i, a) => a.indexOf(c) === i)
  const copyAll = async () => {
    const text = rows.map(r => `${r.item.name}\t${r.o.vendor}\t${r.o.name}\t${money(r.o.price)}\t${r.o.url || ''}\t${r.note || ''}`).join('\n')
    try { await navigator.clipboard.writeText('Item\tSupplier\tProduct\tPrice\tLink\tNote\n' + text) } catch { /* no-op */ }
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted">{rows.length} approved {rows.length === 1 ? 'option' : 'options'} across {new Set(rows.map(r => r.item.key)).size} items. These are the links to order from.</p>
        <button type="button" onClick={copyAll} className="inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border border-line bg-white px-2.5 py-1.5 hover:border-ink"><Copy className="w-3.5 h-3.5" /> Copy as table</button>
      </div>
      {groups.map(cat => (
        <div key={cat} className="rounded-xl border border-line bg-white shadow-soft overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <caption className="text-left font-bold text-ink px-4 pt-3 pb-2 text-[15px]">{cat}</caption>
            <thead><tr className="text-[11px] uppercase tracking-wider text-muted border-b border-line"><th className="w-14" /><th className="text-left px-2 py-1.5">Item</th><th className="text-left px-2 py-1.5">Buy</th><th className="text-right px-2 py-1.5">Price</th><th className="text-left px-2 py-1.5">Note</th><th className="px-3 py-1.5" /></tr></thead>
            <tbody>
              {rows.filter(r => r.item.category === cat).map(r => (
                <tr key={r.item.key + r.o.src + (r.o.id || '')} className="border-b border-line last:border-0">
                  <td className="px-3 py-2"><div className="w-11 h-11 rounded-md bg-[#f1f2ee] flex items-center justify-center overflow-hidden">{r.o.image ? <img src={r.o.image} alt="" loading="lazy" className={'w-full h-full ' + (r.o.fit === 'cover' ? 'object-cover' : 'object-contain p-0.5 mix-blend-multiply')} /> : null}</div></td>
                  <td className="px-2 py-2 font-semibold text-ink">{r.item.name}</td>
                  <td className="px-2 py-2"><span className={'block text-[11px] uppercase tracking-wider font-semibold ' + SRC_TONE[r.o.src]}>{r.o.vendor}</span>{r.o.name}{r.o.chips.length > 0 && <span className="ml-2 text-[11px] text-muted">{r.o.chips.join(' · ')}</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap font-semibold">{money(r.o.price)}{r.o.each ? <span className="block text-[11px] font-medium text-muted">{r.o.each} each</span> : null}</td>
                  <td className="px-2 py-2 text-[13px] text-muted max-w-[220px]">{r.note}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{r.o.url ? <a href={r.o.url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg border border-line px-2.5 py-1 hover:border-ink">Open <ExternalLink className="w-3 h-3" /></a> : <span className="text-[12px] text-muted">no link</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

// MANAGE (Jon, 2026-10-27: "links, select suppliers"): the catalog's supplier pick list, new items,
// and new options with a link and price. Reads the catalog with every supplier (all=1) so a hidden
// supplier's options can still be seen and re-enabled.
function Manage({ property, catalog, suppliers, onChanged }: { property: string; catalog: Catalog; suppliers: Supplier[]; onChanged: () => void }) {
  const { data, refresh } = useCachedFetch<Payload>(`/api/audit/ffe/approved-catalog?property=${property}&all=1`, { ttl: 5_000, persist: false, live: false })
  const full = data?.catalog || catalog
  const [picked, setPicked] = useState<string[]>(catalog.suppliers || [])
  const [msg, setMsg] = useState('')
  const [newItem, setNewItem] = useState({ name: '', category: '', section: 'vendor' })
  const [optFor, setOptFor] = useState<string | null>(null)
  const [opt, setOpt] = useState({ src: 'amz', name: '', url: '', price: '', each: '', image: '' })
  const post = async (body: any) => {
    setMsg('Saving…')
    const r = await fetch('/api/audit/ffe/catalogs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, slug: property }) })
    const j = await r.json().catch(() => ({}))
    setMsg(j.ok ? 'Saved' : (j.error || 'That did not save.'))
    if (j.ok) { refresh(); onChanged() }
    return j
  }
  const toggleSupplier = (k: string) => { const next = picked.includes(k) ? picked.filter(x => x !== k) : [...picked, k]; setPicked(next); post({ action: 'update', suppliers: next }) }
  const cats = Array.from(new Set(full.items.map(i => i.category)))
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white shadow-soft p-4">
        <h3 className="font-bold text-ink text-[15px]">Suppliers for this catalog</h3>
        <p className="text-sm text-muted mt-1">Options from suppliers that aren&apos;t ticked are hidden from the review and from the share link. Nothing ticked means everything shows.</p>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 mt-3">
          {suppliers.map(sp => (
            <label key={sp.key} className="flex items-start gap-2 text-sm rounded-lg border border-line px-3 py-2 cursor-pointer hover:border-ink">
              <input type="checkbox" checked={picked.includes(sp.key)} onChange={() => toggleSupplier(sp.key)} className="mt-1" />
              <span><span className="font-semibold text-ink">{sp.name}</span><span className="block text-[12px] text-muted">{sp.note}</span></span>
            </label>
          ))}
        </div>
        <div className="text-xs text-muted mt-2" aria-live="polite">{msg}</div>
      </section>

      <section className="rounded-xl border border-line bg-white shadow-soft p-4">
        <h3 className="font-bold text-ink text-[15px]">Add an item</h3>
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto_auto] mt-3 items-end">
          <label className="grid gap-1 text-[12px] font-semibold text-muted">Item<input value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} placeholder="e.g. Bar cart" className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2" /></label>
          <label className="grid gap-1 text-[12px] font-semibold text-muted">Category<input list="cat-list" value={newItem.category} onChange={e => setNewItem({ ...newItem, category: e.target.value })} placeholder="e.g. Living room" className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2" /><datalist id="cat-list">{cats.map(c => <option key={c} value={c} />)}</datalist></label>
          <label className="grid gap-1 text-[12px] font-semibold text-muted">Section<select value={newItem.section} onChange={e => setNewItem({ ...newItem, section: e.target.value })} className="text-sm font-normal text-ink rounded-md border border-line px-2.5 py-2 bg-white"><option value="compare">Furniture (compare)</option><option value="vendor">Furniture (vendor-only)</option><option value="amenity">Amenity</option></select></label>
          <button type="button" onClick={async () => { const j = await post({ action: 'addItem', ...newItem }); if (j.ok) setNewItem({ name: '', category: '', section: 'vendor' }) }} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold px-3 py-2"><Plus className="w-3.5 h-3.5" /> Add item</button>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-bold text-ink text-[15px]">Items and their options</h3>
        {full.items.map(it => (
          <div key={it.key} className="rounded-xl border border-line bg-white shadow-soft p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="font-semibold text-ink"><span className="text-[11px] uppercase tracking-wider text-muted font-semibold mr-2">{it.category}</span>{it.name}</div>
              <div className="flex items-center gap-2">
                {it.id && <button type="button" onClick={() => { setOptFor(optFor === it.id ? null : it.id!); setOpt({ src: 'amz', name: '', url: '', price: '', each: '', image: '' }) }} className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg border border-line px-2.5 py-1 hover:border-ink"><Plus className="w-3 h-3" /> Add option</button>}
                {it.id && <button type="button" onClick={() => { if (window.confirm(`Remove "${it.name}" from this catalog?`)) post({ action: 'updateItem', itemId: it.id, archive: true }) }} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-rose-700"><Trash2 className="w-3 h-3" /> Remove</button>}
              </div>
            </div>
            <ul className="mt-2 grid gap-1">
              {it.options.map(o => (
                <li key={o.id || o.src} className={'flex items-center gap-2 text-[13px] ' + (picked.length && !picked.includes(o.src) ? 'opacity-50' : '')}>
                  <span className={'text-[11px] uppercase tracking-wider font-semibold w-28 shrink-0 ' + SRC_TONE[o.src]}>{o.vendor}</span>
                  <span className="min-w-0 truncate">{o.url ? <a href={o.url} target="_blank" rel="noopener" className="underline decoration-line hover:text-brand-700">{o.name}</a> : o.name}</span>
                  <span className="ml-auto tabular-nums font-semibold whitespace-nowrap">{money(o.price)}</span>
                  {o.id && <button type="button" title="Remove this option" onClick={() => post({ action: 'updateOption', optionId: o.id, archive: true })} className="text-muted hover:text-rose-700"><X className="w-3.5 h-3.5" /></button>}
                </li>
              ))}
              {it.options.length === 0 && <li className="text-[13px] text-muted">No options yet — add one with a link.</li>}
            </ul>
            {optFor === it.id && (
              <div className="mt-3 grid gap-2 md:grid-cols-[150px_1fr_1fr] lg:grid-cols-[150px_1.2fr_1.6fr_90px_90px_auto] items-end border-t border-line pt-3">
                <label className="grid gap-1 text-[12px] font-semibold text-muted">Supplier<select value={opt.src} onChange={e => setOpt({ ...opt, src: e.target.value })} className="text-sm font-normal text-ink rounded-md border border-line px-2 py-1.5 bg-white">{suppliers.map(sp => <option key={sp.key} value={sp.key}>{sp.name}</option>)}</select></label>
                <label className="grid gap-1 text-[12px] font-semibold text-muted">Product<input value={opt.name} onChange={e => setOpt({ ...opt, name: e.target.value })} className="text-sm font-normal text-ink rounded-md border border-line px-2 py-1.5" /></label>
                <label className="grid gap-1 text-[12px] font-semibold text-muted">Link<input value={opt.url} onChange={e => setOpt({ ...opt, url: e.target.value })} placeholder="https://…" className="text-sm font-normal text-ink rounded-md border border-line px-2 py-1.5" /></label>
                <label className="grid gap-1 text-[12px] font-semibold text-muted">Price<input value={opt.price} onChange={e => setOpt({ ...opt, price: e.target.value })} placeholder="$" className="text-sm font-normal text-ink rounded-md border border-line px-2 py-1.5" /></label>
                <label className="grid gap-1 text-[12px] font-semibold text-muted">Photo URL<input value={opt.image} onChange={e => setOpt({ ...opt, image: e.target.value })} placeholder="https://…" className="text-sm font-normal text-ink rounded-md border border-line px-2 py-1.5" /></label>
                <button type="button" onClick={async () => { const j = await post({ action: 'addOption', itemId: it.id, ...opt }); if (j.ok) setOptFor(null) }} className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold px-3 py-2"><Plus className="w-3.5 h-3.5" /> Save</button>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}

function Approved() {
  return <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700 mt-1"><Check className="w-3.5 h-3.5" strokeWidth={3} /> Approved</span>
}

// SHARE LINK (Jon, 2026-10-27): one unguessable link per property that opens the approved list with
// no sign-in. Regenerate replaces the code, which is how the old link stops working.
function ShareLink({ property, canEdit }: { property: string; canEdit: boolean }) {
  const [code, setCode] = useState<string | null>(null)
  const [views, setViews] = useState(0)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)
  useEffect(() => {
    fetch(`/api/audit/ffe/approved-catalog/share?property=${property}`).then(r => r.json()).then(j => { if (j?.ok) { setCode(j.code || null); setViews(j.views || 0) } }).catch(() => {})
  }, [property])
  const make = async (regenerate: boolean) => {
    setBusy(true); setConfirmRegen(false)
    try {
      const r = await fetch('/api/audit/ffe/approved-catalog/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ property, regenerate }) })
      const j = await r.json().catch(() => ({}))
      if (j?.ok && j.code) { setCode(j.code); setViews(0) }
    } finally { setBusy(false) }
  }
  const url = code && typeof window !== 'undefined' ? `${window.location.origin}/catalog/${code}` : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* the field is selectable */ }
  }
  if (!code) {
    return canEdit ? (
      <button type="button" onClick={() => make(false)} disabled={busy} className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-semibold rounded-lg border border-line bg-white px-3 py-1.5 hover:border-ink disabled:opacity-60">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />} Create share link
      </button>
    ) : null
  }
  return (
    <div className="ml-auto flex items-center gap-2 flex-wrap">
      <input readOnly value={url} onFocus={e => e.currentTarget.select()} className="text-[12px] rounded-md border border-line bg-white px-2 py-1.5 w-[260px] max-w-full text-muted" aria-label="Share link" />
      <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg border border-line bg-white px-2.5 py-1.5 hover:border-ink"><Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy'}</button>
      <span className="text-[11px] text-muted">{views} {views === 1 ? 'view' : 'views'} · opens the approved list, no sign-in</span>
      {canEdit && (confirmRegen
        ? <span className="inline-flex items-center gap-1 text-[11.5px]"><span className="text-muted">Old link stops working.</span><button type="button" onClick={() => make(true)} className="font-semibold text-rose-700">Regenerate</button><button type="button" onClick={() => setConfirmRegen(false)} className="text-muted">Cancel</button></span>
        : <button type="button" onClick={() => setConfirmRegen(true)} disabled={busy} className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-ink"><RefreshCw className="w-3 h-3" /> Regenerate</button>)}
    </div>
  )
}

