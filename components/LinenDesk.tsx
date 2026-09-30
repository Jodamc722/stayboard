'use client'
// LINEN DESK (Jon, 2026-09-29) — /onboarding/linens. Two views on one page:
//   STANDARD    the linen list form — Jon's standard, item by item (mattress protectors to duvet
//               covers, makeup cloths, hand towels, kitchen towels), with par, per-size counts,
//               vendor and price. "I create the standard, you just need to create a place where I
//               can edit that or update it."
//   CALCULATOR  pick units → how many of each piece to buy, priced when the standard has prices.
// All arithmetic is lib/linens.ts (tested in lib/__tests__/linens.test.mjs); this file only draws it.
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Copy, Download, Loader2, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { Pill, Tag, IconBtn, LeanList, LeanRow, LeanEmpty, type Tone } from '@/components/lean'
import {
  LINEN_GROUPS, LINEN_PER, LIMITS, DEFAULT_LINEN_STANDARD, normLinenStandard, linenNeeds, linenTotals, linenCsv, linenText, sortSizes,
  type LinenStandard, type LinenItem, type LinenGroup, type LinenPer, type LinenDeskUnit, type BedsSource, type LinenTotals,
} from '@/lib/linens'

type View = 'standard' | 'calculator'

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
}
const DEFAULT_PER: Record<LinenGroup, LinenPer> = { Bed: 'bed', Bath: 'guest', Kitchen: 'unit', Other: 'unit' }

/** '' → null, otherwise a finite number (the server clamps it again). */
const toNum = (v: string): number | null => { if (v.trim() === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null }
const money = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const when = (iso?: string) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
// Equal as data: key order ignored, a blank (null / undefined) field the same as an absent one — so
// typing a price and clearing it again does not leave the page thinking it has something to save.
const canon = (v: any): any => Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined && v[k] !== null).map(k => [k, canon(v[k])]))
  : v
const same = (a: any, b: any) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const store = {
  get(k: string): string | null { try { return window.localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { window.localStorage.setItem(k, v) } catch { /* private window — the page works without it */ } },
}
const VIEW_KEY = 'lighthouse.linens.view'
const PICK_KEY = 'lighthouse.linens.selected'

export function LinenDesk() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [level, setLevel] = useState<string>('view')
  const [saved, setSaved] = useState<LinenStandard>(() => normLinenStandard(DEFAULT_LINEN_STANDARD))
  const [draft, setDraft] = useState<LinenStandard>(() => normLinenStandard(DEFAULT_LINEN_STANDARD))
  const [edited, setEdited] = useState(false)
  const [units, setUnits] = useState<LinenDeskUnit[]>([])
  const [partial, setPartial] = useState(false)
  const [view, setView] = useState<View>('standard')
  const [picked, setPicked] = useState<string[]>([])
  const [ready, setReady] = useState(false)   // the standard loaded — never show the starting values as if they were Jon's list

  useEffect(() => {
    const v = store.get(VIEW_KEY); if (v === 'calculator' || v === 'standard') setView(v)
    ;(async () => {
      try {
        const r = await fetch('/api/onboard/linens', { cache: 'no-store' })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.ok) throw new Error(j.message || j.error || 'Could not load the linen standard')
        const std = normLinenStandard(j.standard)
        setSaved(std); setDraft(std); setEdited(!!j.edited); setLevel(String(j.level || 'view'))
        const us: LinenDeskUnit[] = Array.isArray(j.units) ? j.units : []
        setUnits(us); setPartial(!!j.partial)
        try { const p = JSON.parse(store.get(PICK_KEY) || '[]'); if (Array.isArray(p)) setPicked(p.filter((id: any) => us.some(u => u.id === id))) } catch { /* nothing remembered */ }
        setErr(''); setReady(true)
      } catch (e: any) { setErr(String(e?.message || e)) }
      setLoading(false)
    })()
  }, [])

  const dirty = !same(draft, saved)
  // Leaving with unsaved edits to the standard asks first (the browser's own prompt).
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const pick = (ids: string[]) => { setPicked(ids); store.set(PICK_KEY, JSON.stringify(ids)) }
  const go = (v: View) => { setView(v); store.set(VIEW_KEY, v) }
  const activeCount = draft.items.filter(i => i.active !== false).length
  const canStd = level === 'full'
  const canBeds = level === 'edit' || level === 'full'

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
          {dirty && <Pill tone="amber" title="The standard has edits that are not saved yet — the calculator already uses them">unsaved</Pill>}
          <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12.5px]" role="tablist">
            {([['standard', 'Standard', 'The linen list — what every unit gets, per bed, bath, guest or unit'], ['calculator', 'Calculator', 'Pick units and get the order: quantities and cost at your prices']] as const).map(([k, label, tip]) => (
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
        : view === 'standard'
          ? <StandardView draft={draft} setDraft={setDraft} saved={saved} edited={edited} canEdit={canStd}
              onSaved={(s) => { setSaved(s); setDraft(s); setEdited(true) }} />
          : <CalculatorView standard={draft} dirty={dirty} units={units} setUnits={setUnits} partial={partial} picked={picked} pick={pick} canBeds={canBeds} />}
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
  const dirty = !same(draft, saved)

  const patch = (id: string, p: Partial<LinenItem>) => setDraft(s => ({ ...s, items: s.items.map(i => i.id === id ? { ...i, ...p } : i) }))
  const remove = (id: string) => setDraft(s => ({ ...s, items: s.items.filter(i => i.id !== id) }))
  const add = (group: LinenGroup) => {
    const id = 'item-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    setDraft(s => {
      // New items land at the end of their own group, so the list keeps reading Bed → Bath → Kitchen → Other.
      const last = s.items.map(i => i.group).lastIndexOf(group)
      const items = [...s.items]
      items.splice(last < 0 ? items.length : last + 1, 0, { id, name: '', group, per: DEFAULT_PER[group], qty: 1, rotates: group !== 'Other', active: true })
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
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || 'Could not save')
      onSaved(normLinenStandard(j.standard)); setMsg({ text: done })
    } catch (e: any) { setMsg({ text: String(e?.message || e), bad: true }) }
    setBusy(false)
  }
  const save = () => {
    if (draft.items.some(i => !i.name.trim())) { setMsg({ text: 'Give every item a name (or remove the blank one) before saving.', bad: true }); return }
    put(draft, 'Saved — the calculator uses this list from now on.')
  }
  const reset = () => { setConfirmReset(false); put(normLinenStandard(DEFAULT_LINEN_STANDARD), 'Back to the starting values.') }

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
        </div>
        <div className="mt-3 flex items-center gap-1.5 flex-wrap text-[12px] text-muted">
          {!edited ? <Tag title="Nothing saved yet — these are the starting values to edit">Starting values</Tag>
            : saved.updatedAt ? <span>Last saved{saved.updatedBy ? ' by ' + saved.updatedBy : ''} at {when(saved.updatedAt)}</span>
              : <span>Saved</span>}
          {!canEdit && <Tag tone="slate" title="Changing the standard needs full access on Onboarding — ask Jon">Read-only</Tag>}
        </div>
      </section>

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
              <span className="w-14 text-right">Par</span><span className="w-32">Vendor</span><span className="w-20 text-right">Price</span><span className="w-12">On</span><span className="w-8" />
            </div>
            {!rows.length && <div className="px-4 py-3 text-[12.5px] text-muted">Nothing here yet.</div>}
            <div className="divide-y divide-line/70">
              {rows.map(it => <ItemRow key={it.id} it={it} std={draft} canEdit={canEdit} autoFocus={fresh === it.id} patch={p => patch(it.id, p)} remove={() => remove(it.id)} />)}
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
              Put the starting values back? Your list is replaced.
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

function ItemRow({ it, std, canEdit, autoFocus, patch, remove }: {
  it: LinenItem; std: LinenStandard; canEdit: boolean; autoFocus: boolean; patch: (p: Partial<LinenItem>) => void; remove: () => void
}) {
  const off = it.active === false
  // Sizes shown under a per-bed item: the standard's sizes, then any size this item still has a count for.
  const sizes = it.per === 'bed' ? sortSizes(Array.from(new Set([...std.bedSizes, ...Object.keys(it.qtyBySize || {}), ...Object.keys(it.priceBySize || {})])), std.bedSizes) : []
  const setSized = (field: 'qtyBySize' | 'priceBySize', size: string, v: string) => {
    const n = toNum(v)
    const next: Record<string, number> = { ...(it[field] || {}) }
    if (n === null) delete next[size]; else next[size] = Math.max(0, n)
    patch({ [field]: Object.keys(next).length ? next : undefined } as Partial<LinenItem>)
  }
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
        <input value={it.vendor || ''} onChange={e => patch({ vendor: e.target.value || undefined })} disabled={!canEdit} maxLength={LIMITS.vendor}
          placeholder="Vendor" title="Where it is bought (e.g. Complete Jantex)" className={INPUT + ' w-32 py-1.5'} />
        <span className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted pointer-events-none">$</span>
          <input type="number" inputMode="decimal" min={0} step="any" value={it.price ?? ''} disabled={!canEdit}
            onChange={e => { const n = toNum(e.target.value); patch({ price: n === null ? null : Math.max(0, n) }) }}
            placeholder="price" title={it.per === 'bed' ? 'Unit price — for any size without its own price below' : 'Unit price at the vendor (optional)'}
            className={NUM + ' w-20 pl-4'} />
        </span>
        <button onClick={() => canEdit && patch({ active: off })} disabled={!canEdit}
          title={off ? 'Off: kept on the list, not counted. Click to count it.' : 'On: counted in every unit. Click to switch it off without deleting it.'}
          className={'w-12 rounded-lg border px-1.5 py-1.5 text-[12px] font-semibold ' + (off ? 'border-line bg-white text-muted' : 'border-emerald-200 bg-emerald-50 text-emerald-700') + (canEdit ? '' : ' cursor-default')}>
          {off ? 'Off' : 'On'}
        </button>
        {canEdit ? <IconBtn title="Remove this item from the standard" tone="bad" onClick={remove}><Trash2 size={13} /></IconBtn> : <span className="w-8" />}
      </div>
      {it.per === 'bed' && sizes.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted mr-0.5" title="Per bed of each size. Blank = the qty and price above.">By size</span>
          {sizes.map(s => (
            <span key={s} className="inline-flex items-center gap-1 rounded-lg border border-line bg-app/60 pl-2 pr-1 py-0.5">
              <span className="text-[11.5px] font-semibold text-ink">{s}</span>
              <input type="number" inputMode="decimal" min={0} max={LIMITS.num} step="any" value={it.qtyBySize?.[s] ?? ''} placeholder={String(it.qty)} disabled={!canEdit}
                onChange={e => setSized('qtyBySize', s, e.target.value)} title={`How many on a ${s} bed (blank = ${it.qty})`} className={NUM + ' w-12 py-1'} />
              <input type="number" inputMode="decimal" min={0} step="any" value={it.priceBySize?.[s] ?? ''} placeholder={it.price != null ? '$' + it.price : '$'} disabled={!canEdit}
                onChange={e => setSized('priceBySize', s, e.target.value)} title={`Price for the ${s} size (blank = ${it.price != null ? '$' + it.price : 'no price'})`} className={NUM + ' w-16 py-1'} />
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CALCULATOR ────────────────────────────────────────────────────────────────────────────────────
function CalculatorView({ standard, dirty, units, setUnits, partial, picked, pick, canBeds }: {
  standard: LinenStandard; dirty: boolean; units: LinenDeskUnit[]; setUnits: (f: (u: LinenDeskUnit[]) => LinenDeskUnit[]) => void; partial: boolean
  picked: string[]; pick: (ids: string[]) => void; canBeds: boolean
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
  const totals = useMemo(() => linenTotals(standard, chosen), [standard, chosen])

  const toggle = (id: string) => pick(pickedSet.has(id) ? picked.filter(x => x !== id) : [...picked, id])
  const allShownIn = shown.length > 0 && shown.every(u => pickedSet.has(u.id))
  const selectShown = () => pick(allShownIn ? picked.filter(id => !shown.some(u => u.id === id)) : Array.from(new Set([...picked, ...shown.map(u => u.id)])))
  const SHOW_MAX = 80
  const scope = bld === 'all' ? (q.trim() ? 'shown' : 'units') : 'in ' + bld

  const title = chosen.length === 1 ? 'Linens — ' + chosen[0].name : `Linens — ${chosen.length} units` + (chosen.length <= 6 ? ': ' + chosen.map(u => u.name).join(', ') : '')
  const download = () => {
    const blob = new Blob([linenCsv(totals)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'linens-' + new Date().toISOString().slice(0, 10) + '.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const copy = async () => { try { await navigator.clipboard.writeText(linenText(totals, title)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked — the CSV still works */ } }

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
          <TotalsCard totals={totals} onCsv={download} onCopy={copy} copied={copied} />
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
        {canBeds && <IconBtn title={editing ? 'Close the bed editor' : "Set this unit's bed sizes"} onClick={onEdit}><Pencil size={13} /></IconBtn>}
        <IconBtn title="Take this unit off the order" onClick={onRemove}><X size={14} /></IconBtn>
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

function TotalsCard({ totals, onCsv, onCopy, copied }: { totals: LinenTotals; onCsv: () => void; onCopy: () => void; copied: boolean }) {
  const pieces = totals.rows.reduce((a, r) => a + r.qty, 0)
  return (
    <section className={CARD + ' mb-3 overflow-hidden'}>
      <div className="px-3 sm:px-4 py-2.5 flex items-center gap-2 flex-wrap border-b border-line">
        <h2 className={EYEBROW}>Order</h2>
        <span className="text-[12.5px] text-muted tabular-nums">{totals.units} unit{totals.units === 1 ? '' : 's'} · {pieces.toLocaleString('en-US')} pieces</span>
        {totals.priced > 0 && <Pill tone="emerald" title={totals.unpriced ? `${totals.unpriced} line${totals.unpriced === 1 ? ' has' : 's have'} no price and are not in this total` : 'Every line is priced'}>{money(totals.grandTotal)}</Pill>}
        <span className="ml-auto flex items-center gap-1.5">
          <button onClick={onCsv} disabled={!totals.rows.length} title="Download the order as a spreadsheet (CSV)" className={GHOST}><Download size={13} /> Download CSV</button>
          <button onClick={onCopy} disabled={!totals.rows.length} title="Copy the order as plain text — paste it into an email or message to the vendor" className={GHOST}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy list'}</button>
        </span>
      </div>
      {!totals.rows.length ? <p className="px-4 py-4 text-[12.5px] text-muted">Nothing on the standard applies to these units.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted">
              <tr><th className="text-left font-semibold px-3 sm:px-4 py-2">Item</th><th className="text-left font-semibold px-2 py-2">Size</th><th className="text-right font-semibold px-2 py-2">Qty</th>
                <th className="text-right font-semibold px-2 py-2">Unit price</th><th className="text-right font-semibold px-3 sm:px-4 py-2">Cost</th></tr>
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
                      <td className="px-3 sm:px-4 py-1.5 text-ink">{r.name}{r.vendor ? <span className="text-muted text-[11.5px]"> · {r.vendor}</span> : null}</td>
                      <td className="px-2 py-1.5 text-muted">{r.size || ''}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{r.qty.toLocaleString('en-US')}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted">{r.price != null ? money(r.price) : '—'}</td>
                      <td className="px-3 sm:px-4 py-1.5 text-right tabular-nums">{r.cost != null ? money(r.cost) : '—'}</td>
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
      {totals.priced === 0 && totals.rows.length > 0 && <p className="px-3 sm:px-4 py-2 border-t border-line text-[12px] text-muted">No prices yet — add them on the Standard to get a cost.</p>}
    </section>
  )
}

