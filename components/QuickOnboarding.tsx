'use client'
// QUICK ONBOARDING — many units, one simple card each (Jon, 2026-10-02: "an onboarding form, simple,
// clean, but for multi units … bed count and sizes, room number, bathrooms, kitchen (coffee maker
// yes), utensils (no), stove, refrigerator yes, freezer yes … add photos, does not have to be so
// robust … think simple and clean for our team").
//
// LEFT: the units, grouped by building, each with how far its card is filled. RIGHT: the card —
// beds as counters, baths and guests as numbers, every feature a chip you tap (blank → Yes → No),
// a few picks, notes, photos. Saves itself as you go. "Copy to next unit" carries the answers to a
// new unit number for identical layouts (Salato 302 / 602 / 902). "Done" is a status, not a lock.
// The full room-by-room inventory stays at /onboarding for when a unit needs it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Check, Loader2, Camera, Trash2, Copy, ChevronLeft, Minus, Building2, Image as ImageIcon, X } from 'lucide-react'
import { BED_TYPES, FEATURE_GROUPS, PICKS, EMPTY_DATA, completion, bedsLabel, type QuickUnit, type QuickData, type Tri } from '@/lib/onboarding-quick'

const BTN = 'h-9 px-3 rounded-lg text-[12.5px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap'
const PRIMARY = BTN + ' bg-ink text-white hover:bg-ink/90'
const GHOST = BTN + ' border border-line bg-white text-ink hover:bg-app'
const INPUT = 'h-9 rounded-lg border border-line bg-white px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-200'

export function QuickOnboarding() {
  const [units, setUnits] = useState<QuickUnit[] | null>(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<string>('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/onboarding-quick', { cache: 'no-store' }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load.'); setUnits(j.units) }
    catch (e: any) { setErr(String(e?.message || e)); setUnits(u => u || []) }
  }, [])
  useEffect(() => { load() }, [load])

  const post = async (body: any) => { const r = await fetch('/api/onboarding-quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || 'That did not save.'); return j }

  const create = async (building: string, unit_no: string, from?: string) => {
    setErr('')
    try { const j = await post({ action: 'create', building, unit_no, from }); setUnits(u => [...(u || []), j.unit]); setSel(j.unit.id); setAdding(false) } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const remove = async (id: string) => {
    if (!window.confirm('Delete this unit card? Photos stay in storage; the answers are gone.')) return
    try { await post({ action: 'delete', id }); setUnits(u => (u || []).filter(x => x.id !== id)); if (sel === id) setSel('') } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const onSaved = (u: QuickUnit) => setUnits(list => (list || []).map(x => x.id === u.id ? u : x))

  const groups = useMemo(() => {
    const g: Record<string, QuickUnit[]> = {}
    for (const u of units || []) (g[u.building] ||= []).push(u)
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])).map(([building, list]) => [building, list.sort((a, b) => a.unit_no.localeCompare(b.unit_no, undefined, { numeric: true }))] as const)
  }, [units])
  const current = (units || []).find(u => u.id === sel) || null
  const buildings = groups.map(g => g[0])

  return (
    <div className="pb-16">
      <header className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink tracking-tight inline-flex items-center gap-2"><Building2 size={18} className="text-brand-600" /> Quick onboarding</h1>
          <p className="text-[12.5px] text-muted">One card per unit: beds, baths, what the kitchen has, photos. <Link href="/onboarding" className="text-brand-700 font-semibold hover:underline">Full room-by-room inventory →</Link></p>
        </div>
        <button onClick={() => setAdding(true)} className={PRIMARY}><Plus size={14} /> Add unit</button>
      </header>
      {err && <p className="mb-3 text-[12.5px] text-rose-700 font-semibold">{err}</p>}
      {adding && <AddUnit buildings={buildings} onCancel={() => setAdding(false)} onCreate={create} />}

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
        {/* LEFT — the units */}
        <aside className={'space-y-3 ' + (current ? 'hidden lg:block' : '')}>
          {units === null && <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
          {units && !units.length && <div className="rounded-2xl border border-dashed border-line bg-white/60 px-5 py-10 text-center text-[13px] text-muted">No units yet. Add the first one and the building appears here.</div>}
          {groups.map(([building, list]) => (
            <section key={building} className="rounded-2xl border border-line bg-white overflow-hidden">
              <header className="px-3.5 py-2.5 border-b border-line/60 flex items-center gap-2">
                <h2 className="text-[13px] font-bold text-ink truncate">{building}</h2>
                <span className="text-[11.5px] text-muted">{list.filter(u => u.status === 'done').length}/{list.length} done</span>
                <button onClick={() => create(building, '', undefined)} className="ml-auto text-[11.5px] font-semibold text-brand-700 hover:underline" title="Add a unit to this building" onClickCapture={e => { e.stopPropagation(); const n = window.prompt('Unit number for ' + building + ':', ''); if (n && n.trim()) create(building, n.trim()); e.preventDefault() }}>+ unit</button>
              </header>
              <ul className="divide-y divide-line/60">
                {list.map(u => {
                  const c = completion(u.data)
                  return (
                    <li key={u.id}>
                      <button onClick={() => setSel(u.id)} className={'w-full text-left px-3.5 py-2.5 flex items-center gap-3 hover:bg-app/50 ' + (sel === u.id ? 'bg-brand-50/70' : '')}>
                        <span className={'w-9 h-9 rounded-xl grid place-items-center text-[12px] font-bold shrink-0 ' + (u.status === 'done' ? 'bg-emerald-600 text-white' : 'bg-app text-ink')}>{u.status === 'done' ? <Check size={16} strokeWidth={3} /> : u.unit_no.slice(0, 4)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-bold text-ink">Unit {u.unit_no}</span>
                          <span className="block text-[11.5px] text-muted truncate">{bedsLabel(u.data)}{u.data.bathrooms != null ? ` · ${u.data.bathrooms} bath` : ''}{u.data.photos.length ? ` · ${u.data.photos.length} photo${u.data.photos.length === 1 ? '' : 's'}` : ''}</span>
                        </span>
                        <span className="w-10 text-right text-[11.5px] font-semibold tabular-nums text-muted">{c.pct}%</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </aside>

        {/* RIGHT — the card */}
        <main className="min-w-0">
          {!current && units && units.length > 0 && <div className="hidden lg:block rounded-2xl border border-dashed border-line bg-white/60 px-6 py-16 text-center text-[13px] text-muted">Pick a unit on the left, or add one.</div>}
          {current && <UnitCard key={current.id} unit={current} onSaved={onSaved} onBack={() => setSel('')} onDelete={() => remove(current.id)} onCopy={(n) => create(current.building, n, current.id)} />}
        </main>
      </div>
    </div>
  )
}

function AddUnit({ buildings, onCancel, onCreate }: { buildings: string[]; onCancel: () => void; onCreate: (b: string, u: string) => void }) {
  const [building, setBuilding] = useState(buildings[0] || '')
  const [unit, setUnit] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="mb-4 rounded-2xl border border-line bg-white p-4 flex items-end gap-2 flex-wrap">
      <label className="block min-w-[200px] flex-1">
        <span className="block text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1">Building</span>
        <input list="oq-buildings" value={building} onChange={e => setBuilding(e.target.value)} placeholder="Salato" className={INPUT + ' w-full'} autoFocus={!buildings.length} />
        <datalist id="oq-buildings">{buildings.map(b => <option key={b} value={b} />)}</datalist>
      </label>
      <label className="block w-36">
        <span className="block text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1">Unit #</span>
        <input value={unit} onChange={e => setUnit(e.target.value)} placeholder="302" className={INPUT + ' w-full'} autoFocus={!!buildings.length} onKeyDown={e => { if (e.key === 'Enter' && building.trim() && unit.trim()) { setBusy(true); onCreate(building.trim(), unit.trim()) } }} />
      </label>
      <button onClick={onCancel} className={GHOST}>Cancel</button>
      <button onClick={() => { setBusy(true); onCreate(building.trim(), unit.trim()) }} disabled={busy || !building.trim() || !unit.trim()} className={PRIMARY}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create</button>
    </div>
  )
}

function UnitCard({ unit, onSaved, onBack, onDelete, onCopy }: { unit: QuickUnit; onSaved: (u: QuickUnit) => void; onBack: () => void; onDelete: () => void; onCopy: (unitNo: string) => void }) {
  const [d, setD] = useState<QuickData>({ ...EMPTY_DATA, ...unit.data })
  const [meta, setMeta] = useState({ building: unit.building, unit_no: unit.unit_no, status: unit.status })
  const [state, setState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const [uploading, setUploading] = useState(false)
  const timer = useRef<any>(null)
  const latest = useRef({ d, meta })
  latest.current = { d, meta }

  // AUTO-SAVE: a change marks the card dirty and saves 700 ms after the last tap.
  const save = useCallback(async () => {
    setState('saving')
    try {
      const r = await fetch('/api/onboarding-quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: unit.id, data: latest.current.d, building: latest.current.meta.building, unit_no: latest.current.meta.unit_no, status: latest.current.meta.status }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) throw new Error(j.error || 'save failed')
      onSaved({ ...j.unit, data: { ...j.unit.data, photos: latest.current.d.photos } })
      setState('saved')
    } catch { setState('error') }
  }, [unit.id, onSaved])
  const touch = (next: Partial<QuickData>) => { setD(x => ({ ...x, ...next })); setState('dirty'); clearTimeout(timer.current); timer.current = setTimeout(save, 700) }
  const touchMeta = (next: Partial<typeof meta>) => { setMeta(x => ({ ...x, ...next })); setState('dirty'); clearTimeout(timer.current); timer.current = setTimeout(save, 700) }
  useEffect(() => () => clearTimeout(timer.current), [])

  const cycle = (key: string) => { const v = d.features[key]; const next: Tri = v == null ? 'yes' : v === 'yes' ? 'no' : null; touch({ features: { ...d.features, [key]: next } }) }
  const setAll = (keys: string[], v: Tri) => touch({ features: { ...d.features, ...Object.fromEntries(keys.map(k => [k, v])) } })
  const bed = (k: string, delta: number) => { const n = Math.max(0, (d.beds as any)[k] || 0) + delta; touch({ beds: { ...d.beds, [k]: n > 0 ? n : undefined } }) }
  const c = completion(d)

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files).slice(0, 10)) {
        const fd = new FormData(); fd.append('id', unit.id); fd.append('file', f)
        const r = await fetch('/api/onboarding-quick/photo', { method: 'POST', body: fd }); const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.ok) throw new Error(j.error || 'upload failed')
        setD(x => ({ ...x, photos: j.photos }))
      }
    } catch (e: any) { alert(String(e?.message || e)) }
    setUploading(false)
  }
  const removePhoto = async (url: string) => {
    const r = await fetch('/api/onboarding-quick/photo', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: unit.id, url }) }); const j = await r.json().catch(() => ({}))
    if (j.ok) setD(x => ({ ...x, photos: j.photos }))
  }

  return (
    <div className="rounded-2xl border border-line bg-white">
      {/* header */}
      <div className="px-4 py-3 border-b border-line/60 flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="lg:hidden h-9 w-9 rounded-lg border border-line grid place-items-center text-muted"><ChevronLeft size={16} /></button>
        <input value={meta.building} onChange={e => touchMeta({ building: e.target.value })} className={INPUT + ' w-40 font-bold'} aria-label="Building" />
        <span className="text-muted">·</span>
        <span className="text-[13px] text-muted">Unit</span>
        <input value={meta.unit_no} onChange={e => touchMeta({ unit_no: e.target.value })} className={INPUT + ' w-24 font-bold'} aria-label="Unit number" />
        <span className="ml-auto inline-flex items-center gap-2">
          <span className={'text-[11.5px] font-semibold ' + (state === 'error' ? 'text-rose-700' : state === 'saved' ? 'text-emerald-700' : 'text-muted')}>{state === 'saving' ? 'Saving…' : state === 'dirty' ? 'Unsaved' : state === 'error' ? 'Could not save — try again' : 'Saved'}</span>
          <span className="h-1.5 w-20 rounded-full bg-line overflow-hidden"><span className={'block h-full ' + (c.pct === 100 ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: c.pct + '%' }} /></span>
          <span className="text-[11.5px] tabular-nums text-muted">{c.pct}%</span>
        </span>
      </div>

      <div className="p-4 space-y-6">
        {/* BEDS / BATHS / GUESTS */}
        <section>
          <H>Beds</H>
          <div className="flex items-center gap-2 flex-wrap">
            {BED_TYPES.map(b => {
              const n = (d.beds as any)[b.key] || 0
              return (
                <div key={b.key} className={'inline-flex items-center rounded-xl border h-10 overflow-hidden ' + (n ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink')}>
                  <button onClick={() => bed(b.key, -1)} disabled={!n} className="w-8 h-full grid place-items-center disabled:opacity-30" aria-label={'fewer ' + b.label}><Minus size={13} /></button>
                  <span className="px-1 text-[12.5px] font-bold tabular-nums min-w-[64px] text-center">{n ? n + ' ' : ''}{b.label}</span>
                  <button onClick={() => bed(b.key, 1)} className="w-8 h-full grid place-items-center" aria-label={'more ' + b.label}><Plus size={13} /></button>
                </div>
              )
            })}
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Num label="Bathrooms" value={d.bathrooms} step={0.5} onChange={v => touch({ bathrooms: v })} />
            <Num label="Half baths" value={d.halfBaths} onChange={v => touch({ halfBaths: v })} />
            <Num label="Max guests" value={d.maxGuests} onChange={v => touch({ maxGuests: v })} />
            <Txt label="Floor" value={d.floor} onChange={v => touch({ floor: v })} placeholder="3" />
            <Txt label="Sq ft" value={d.sqft} onChange={v => touch({ sqft: v })} placeholder="850" />
          </div>
        </section>

        {/* PICKS */}
        <section>
          <H>Setup</H>
          <div className="space-y-2">
            {PICKS.map(p => (
              <div key={p.key} className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-semibold text-muted w-28 shrink-0">{p.label}</span>
                {p.options.map(o => <button key={o} onClick={() => touch({ picks: { ...d.picks, [p.key]: d.picks[p.key] === o ? '' : o } })} className={'h-8 px-2.5 rounded-lg border text-[12px] font-semibold ' + (d.picks[p.key] === o ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:bg-app')}>{o}</button>)}
              </div>
            ))}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[12px] font-semibold text-muted w-28 shrink-0">Wi-Fi</span>
              <input value={d.wifi} onChange={e => touch({ wifi: e.target.value })} placeholder="Network · password" className={INPUT + ' flex-1 min-w-[200px]'} />
            </div>
          </div>
        </section>

        {/* FEATURES: tap to cycle */}
        {FEATURE_GROUPS.map(g => {
          const keys = g.items.map(i => i.key)
          const answered = keys.filter(k => d.features[k]).length
          return (
            <section key={g.key}>
              <div className="flex items-center gap-2 mb-2">
                <H inline>{g.label}</H>
                <span className="text-[11.5px] text-muted tabular-nums">{answered}/{keys.length}</span>
                <span className="ml-auto inline-flex items-center gap-1">
                  <button onClick={() => setAll(keys, 'yes')} className="h-7 px-2 rounded-md border border-line text-[11px] font-semibold text-muted hover:text-ink bg-white">All yes</button>
                  <button onClick={() => setAll(keys, null)} className="h-7 px-2 rounded-md border border-line text-[11px] font-semibold text-muted hover:text-ink bg-white">Clear</button>
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {g.items.map(it => {
                  const v = d.features[it.key]
                  const cls = v === 'yes' ? 'bg-emerald-600 border-emerald-600 text-white' : v === 'no' ? 'bg-rose-50 border-rose-300 text-rose-800 line-through decoration-rose-400' : 'bg-white border-line text-ink hover:bg-app'
                  return <button key={it.key} onClick={() => cycle(it.key)} title="Tap: Yes → No → blank" className={'h-9 px-3 rounded-xl border text-[12.5px] font-semibold inline-flex items-center gap-1.5 ' + cls}>{v === 'yes' && <Check size={13} strokeWidth={3} />}{v === 'no' && <X size={13} strokeWidth={3} />}{it.label}</button>
                })}
              </div>
            </section>
          )
        })}

        {/* NOTES */}
        <section>
          <H>Notes</H>
          <textarea value={d.notes} onChange={e => touch({ notes: e.target.value })} rows={3} placeholder="Anything the team should know: quirks, what is missing, where things are." className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] leading-snug focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </section>

        {/* PHOTOS */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <H inline>Photos</H>
            <span className="text-[11.5px] text-muted">{d.photos.length ? d.photos.length : 'none yet'}</span>
            <label className={GHOST + ' ml-auto cursor-pointer'}>{uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} Add photos<input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => upload(e.target.files)} /></label>
          </div>
          {d.photos.length ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {d.photos.map(p => (
                <div key={p.url} className="relative group aspect-square rounded-xl overflow-hidden border border-line bg-app">
                  <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.caption || 'unit photo'} className="w-full h-full object-cover" loading="lazy" /></a>
                  <button onClick={() => removePhoto(p.url)} className="absolute top-1 right-1 w-7 h-7 rounded-lg bg-white/90 text-rose-700 grid place-items-center opacity-0 group-hover:opacity-100" title="Remove"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          ) : <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-muted inline-flex items-center justify-center gap-2 w-full"><ImageIcon size={16} /> A few photos of the unit — living room, kitchen, each bedroom, bath.</div>}
        </section>

        {/* FOOTER */}
        <div className="pt-2 border-t border-line/60 flex items-center gap-2 flex-wrap">
          <button onClick={() => touchMeta({ status: meta.status === 'done' ? 'draft' : 'done' })} className={meta.status === 'done' ? GHOST : PRIMARY}>{meta.status === 'done' ? <>Reopen</> : <><Check size={14} /> Mark done</>}</button>
          <button onClick={() => { const n = window.prompt('Copy these answers to a new unit. Unit number:', ''); if (n && n.trim()) onCopy(n.trim()) }} className={GHOST} title="Same layout, another number — photos are not copied"><Copy size={14} /> Copy to another unit</button>
          <button onClick={onDelete} className={BTN + ' ml-auto text-rose-700 hover:bg-rose-50'}><Trash2 size={14} /> Delete</button>
        </div>
      </div>
    </div>
  )
}

function H({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return <h3 className={'text-[11px] font-bold uppercase tracking-wider text-ink ' + (inline ? '' : 'mb-2')}>{children}</h3>
}
function Num({ label, value, onChange, step = 1 }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1">{label}</span>
      <input type="number" inputMode="decimal" min={0} step={step} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} className={INPUT + ' w-full'} />
    </label>
  )
}
function Txt({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={INPUT + ' w-full'} />
    </label>
  )
}
