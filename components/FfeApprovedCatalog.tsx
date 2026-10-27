'use client'
// THE 17 WEST CATALOG — REVIEW AND APPROVE (Jon, 2026-10-20).
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Link2, Loader2, RefreshCw, X } from 'lucide-react'
import { useCachedFetch } from '@/lib/swr'

type OptionSrc = 'host' | 'amz' | 'ch' | 'wf'
type Opt = { src: OptionSrc; vendor: string; name: string; url: string | null; price: number | null; each?: string; image: string | null; chips: string[]; fit: 'cover' | 'contain' }
type Item = { key: string; section: 'compare' | 'vendor' | 'amenity'; category: string; name: string; options: Opt[] }
type Catalog = { property: string; title: string; sourceSheet: string; asOf: string; items: Item[]; misc: Record<string, string[]> }
type Decision = { approved: OptionSrc[]; rejected: boolean; note: string }
type Payload = { ok: boolean; catalog: Catalog; decisions: Record<string, Decision>; canEdit: boolean }

const money = (v: number | null | undefined) => (v == null ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const SRC_LABEL: Record<OptionSrc, string> = { host: 'HostGPO', amz: 'Amazon', ch: 'City Home', wf: 'Wayfair' }
const SRC_TONE: Record<OptionSrc, string> = {
  host: 'text-brand-700', amz: 'text-amber-700', ch: 'text-sky-700', wf: 'text-violet-700',
}
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
  const { data, loading, error } = useCachedFetch<Payload>(isPublic ? `/api/public/catalog/${publicCode}` : `/api/audit/ffe/approved-catalog?property=${property}`, { ttl: 15_000, persist: false, live: !isPublic })
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [view, setView] = useState<'all' | 'approved'>(isPublic ? 'approved' : 'all')
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
    try { if ((window.location.hash || '') === '#approved') setView('approved') } catch { /* no-op */ }
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
      <div className="flex flex-wrap items-center gap-3">
        {!isPublic && <Toggle value={view} onChange={v => { setView(v as any); try { window.history.replaceState(null, '', v === 'approved' ? '#approved' : '#') } catch { /* no-op */ } }}
          options={[['all', 'Everything'], ['approved', 'Approved catalog']]} />}
        {view === 'all' && <Toggle value={order} onChange={v => setOrder(v as any)} options={[['group', 'By room item'], ['rank', 'Biggest savings first']]} />}
        <span className="text-xs text-muted" aria-live="polite">
          {isPublic ? 'Approved options only.'
            : !canEdit ? 'View only — approving needs edit access to FF&E.' : saving || 'Approvals save as you go and are shared with the whole team.'}
        </span>
        {!isPublic && <ShareLink property={property} canEdit={canEdit} />}
      </div>

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
                {list.map(it => { const o = it.options[0]; const on = !!decisions[it.key]?.approved.includes('host'); return (
                  <tr key={it.key} className="border-b border-line last:border-0">
                    <td className="px-3 py-2"><div className="w-11 h-11 rounded-md bg-app flex items-center justify-center overflow-hidden">
                      {o.image ? <img src={o.image} alt="" className="w-full h-full object-contain p-0.5 mix-blend-multiply" loading="lazy" /> : <span className="font-bold text-muted">{o.vendor.slice(0, 1)}</span>}</div></td>
                    <td className="px-2 py-2 font-semibold text-ink whitespace-nowrap">{it.name}</td>
                    <td className="px-2 py-2"><span className="block text-[11px] uppercase tracking-wider text-muted font-semibold">{o.vendor}</span>
                      {o.url ? <a href={o.url} target="_blank" rel="noopener" className="underline decoration-line hover:text-brand-700">{o.name}</a> : o.name}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{money(o.price)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap font-semibold text-brand-700">{o.each || '—'}</td>
                    <td className="px-3 py-2 text-right">{o.price != null && (view === 'all' || on) && (isPublic ? (on && <Approved />) : <ApproveBtn on={on} disabled={!canEdit} onClick={() => toggle(it.key, 'host')} small />)}</td>
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

      <p className="text-xs text-muted max-w-3xl border-t border-line pt-4">
        Prices as recorded in the <em>{data.catalog.sourceSheet}</em> sheet ({data.catalog.asOf}); HostGPO member pricing, Amazon, City Home and Wayfair listing prices as found, and they change. Photos come from each vendor&apos;s listing and link to it. City Home and Wayfair alternatives were selected by visual and functional similarity, not verified dimensions; City Home beds are shown in queen.
      </p>
    </div>
  )
}

// ---------- pieces ----------

function savings(it: Item) {
  const host = it.options.find(o => o.src === 'host')?.price ?? 0
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
  const host = item.options.find(o => o.src === 'host')!
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
            <div key={o.src} className={'min-w-0 border-r border-line last:border-r-0 ' + (o.src === 'host' ? 'bg-gradient-to-b from-brand-50 to-transparent' : '')}>
              <Photo o={o} />
              <div className="p-3 grid gap-1 content-start">
                <div className={'text-[11px] uppercase tracking-wider font-semibold ' + SRC_TONE[o.src]}>{o.vendor}</div>
                <div className="text-[13.5px] font-medium leading-snug break-words">{o.url ? <a href={o.url} target="_blank" rel="noopener" className="underline decoration-line hover:text-brand-700">{o.name}</a> : o.name}</div>
                {o.chips.length > 0 && <div className="flex flex-wrap gap-1">{o.chips.map(c => <span key={c} className={'text-[11px] font-semibold rounded-full px-2 py-0.5 ' + CHIP_TONE(c)}>{c}</span>)}</div>}
                <div className={'text-xl font-bold tabular-nums mt-1 ' + (o.src === 'host' ? 'text-brand-700' : 'text-ink')}>{money(o.price)}</div>
                {o.src !== 'host' && <div><Diff ref_={host.price || 0} price={o.price} /></div>}
                {o.price != null && (view === 'all' || on) && (isPublic ? (on && <Approved />) : <ApproveBtn on={on} disabled={!canEdit} onClick={() => onToggle(item.key, o.src)} />)}
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
  const onMain = !!d?.approved.includes('host'); const onAlt = !!(alt && d?.approved.includes(alt.src))
  return (
    <article className="rounded-xl border border-line bg-white shadow-soft overflow-hidden flex flex-col" id={item.key}>
      {(view === 'all' || onMain) && <Photo o={main} />}
      <div className="p-3 grid gap-1 content-start">
        <div className="flex items-center justify-between gap-2"><span className="text-[11px] uppercase tracking-wider text-muted font-semibold">{(view === 'all' || onMain) ? main.vendor : item.name}</span><StatusPill s={status} n={d?.approved.length || 0} /></div>
        {(view === 'all' || onMain) && <>
          <div className="text-[13.5px] font-medium leading-snug break-words">{main.url ? <a href={main.url} target="_blank" rel="noopener" className="underline decoration-line hover:text-brand-700">{main.name}</a> : main.name}</div>
          {main.chips.length > 0 && <div className="flex flex-wrap gap-1">{main.chips.map(c => <span key={c} className={'text-[11px] font-semibold rounded-full px-2 py-0.5 ' + CHIP_TONE(c)}>{c}</span>)}</div>}
          <div className="text-lg font-bold tabular-nums text-brand-700">{money(main.price)}</div>
          {main.price != null && (isPublic ? (onMain && <Approved />) : <ApproveBtn on={onMain} disabled={!canEdit} onClick={() => onToggle(item.key, 'host')} />)}
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
          </div>
        </div>
      )}
    </article>
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

