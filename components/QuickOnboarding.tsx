'use client'
// QUICK ONBOARDING — a building form with its units on one page (Jon, 2026-10-02: "simple and clean …
// a building form with multiple units. For each unit: the bed count, bathroom count, bed types, a
// mini checklist. Got a kitchen? If it does, it prompts basic questions about the amenities").
//
// Pick a building (or start one). Its units stack down the page; each one is a card that opens to:
// beds by type (tap +/−), bathrooms and guests, "Kitchen?" — and only if yes, what the kitchen has —
// a short checklist for the unit and for safety, photos, a note. Everything saves as you tap. Copy a
// finished unit to the next number when the layout is the same. That is the whole form.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Check, Loader2, Camera, Trash2, Copy, Minus, Building2, X, ChevronDown } from 'lucide-react'
import { BED_TYPES, FEATURE_GROUPS, EMPTY_DATA, completion, bedsLabel, type QuickUnit, type QuickData, type Tri } from '@/lib/onboarding-quick'

const BTN = 'h-9 px-3 rounded-lg text-[12.5px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap'
const PRIMARY = BTN + ' bg-ink text-white hover:bg-ink/90'
const GHOST = BTN + ' border border-line bg-white text-ink hover:bg-app'
const INPUT = 'h-9 rounded-lg border border-line bg-white px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand-200'
const CHIP = (on: boolean) => 'h-9 px-3 rounded-xl border text-[12.5px] font-semibold inline-flex items-center gap-1.5 ' + (on ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:bg-app')

export function QuickOnboarding() {
  const [units, setUnits] = useState<QuickUnit[] | null>(null)
  const [err, setErr] = useState('')
  const [building, setBuilding] = useState<string>('')
  const [newBuilding, setNewBuilding] = useState(false)
  const [openId, setOpenId] = useState<string>('')

  const load = useCallback(async () => {
    try { const r = await fetch('/api/onboarding-quick', { cache: 'no-store' }); const j = await r.json(); if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load.'); setUnits(j.units); if (!building && j.units.length) setBuilding(j.units[0].building) }
    catch (e: any) { setErr(String(e?.message || e)); setUnits(u => u || []) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  const post = async (body: any) => { const r = await fetch('/api/onboarding-quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || 'That did not save.'); return j }

  const create = async (b: string, unit_no: string, from?: string) => {
    setErr('')
    try { const j = await post({ action: 'create', building: b, unit_no, from }); setUnits(u => [...(u || []), j.unit]); setBuilding(b); setOpenId(j.unit.id); setNewBuilding(false) } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const remove = async (id: string) => {
    if (!window.confirm('Delete this unit? The answers are gone; photos stay in storage.')) return
    try { await post({ action: 'delete', id }); setUnits(u => (u || []).filter(x => x.id !== id)) } catch (e: any) { setErr(String(e?.message || e)) }
  }
  const onSaved = (u: QuickUnit) => setUnits(list => (list || []).map(x => x.id === u.id ? u : x))

  const buildings = useMemo(() => Array.from(new Set((units || []).map(u => u.building))).sort(), [units])
  const list = useMemo(() => (units || []).filter(u => u.building === building).sort((a, b) => a.unit_no.localeCompare(b.unit_no, undefined, { numeric: true })), [units, building])
  const demo = /migration 142/.test(err)

  return (
    <div className="pb-16 max-w-3xl">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-ink tracking-tight inline-flex items-center gap-2"><Building2 size={18} className="text-brand-600" /> Onboarding</h1>
        <p className="text-[12.5px] text-muted">A building and its units. Beds, baths, kitchen, a short checklist, photos. <Link href="/onboarding" className="text-brand-700 font-semibold hover:underline">Full inventory →</Link></p>
      </header>
      {err && <p className="mb-3 text-[12.5px] text-rose-700 font-semibold">{err}</p>}

      {/* BUILDING */}
      {!demo && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          {buildings.map(b => <button key={b} onClick={() => setBuilding(b)} className={CHIP(building === b && !newBuilding)}>{b}</button>)}
          {newBuilding ? (
            <NewBuilding onCancel={() => setNewBuilding(false)} onCreate={(b, u) => create(b, u)} />
          ) : <button onClick={() => setNewBuilding(true)} className={GHOST}><Plus size={14} /> New building</button>}
        </div>
      )}

      {units === null && !err && <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>}

      {/* UNITS */}
      {(building || demo) && (
        <section className="space-y-2">
          {!demo && (
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-[15px] font-bold text-ink">{building}</h2>
              <span className="text-[12px] text-muted">{list.filter(u => u.status === 'done').length}/{list.length} done</span>
              <AddUnitInline onAdd={n => create(building, n)} />
            </div>
          )}
          {demo && <p className="mb-2 text-[12.5px] text-muted">Preview of a unit card until migration 142 is run — nothing saves yet.</p>}
          {(demo ? [DEMO] : list).map(u => (
            <UnitCard key={u.id} unit={u} open={demo || openId === u.id} onToggle={() => setOpenId(o => o === u.id ? '' : u.id)} onSaved={onSaved} onDelete={() => remove(u.id)} onCopy={n => create(u.building, n, u.id)} demo={demo} />
          ))}
          {!demo && list.length === 0 && <div className="rounded-2xl border border-dashed border-line bg-white/60 px-5 py-8 text-center text-[13px] text-muted">No units in {building} yet — type a unit number above.</div>}
        </section>
      )}
      {!demo && !building && units && units.length === 0 && !newBuilding && <div className="rounded-2xl border border-dashed border-line bg-white/60 px-5 py-10 text-center text-[13px] text-muted">Start with a building.</div>}
    </div>
  )
}

const DEMO: QuickUnit = { id: 'demo', building: 'Salato', unit_no: '302', status: 'draft', data: EMPTY_DATA, listing_id: null, created_by: null, updated_by: null, created_at: '', updated_at: '' }

function NewBuilding({ onCancel, onCreate }: { onCancel: () => void; onCreate: (b: string, u: string) => void }) {
  const [b, setB] = useState(''); const [u, setU] = useState('')
  const go = () => { if (b.trim() && u.trim()) onCreate(b.trim(), u.trim()) }
  return (
    <span className="inline-flex items-center gap-1.5">
      <input autoFocus value={b} onChange={e => setB(e.target.value)} placeholder="Building" className={INPUT + ' w-36'} onKeyDown={e => e.key === 'Enter' && go()} />
      <input value={u} onChange={e => setU(e.target.value)} placeholder="First unit #" className={INPUT + ' w-28'} onKeyDown={e => e.key === 'Enter' && go()} />
      <button onClick={go} disabled={!b.trim() || !u.trim()} className={PRIMARY}><Plus size={14} /> Start</button>
      <button onClick={onCancel} className="h-9 w-9 rounded-lg border border-line grid place-items-center text-muted"><X size={14} /></button>
    </span>
  )
}
function AddUnitInline({ onAdd }: { onAdd: (n: string) => void }) {
  const [n, setN] = useState('')
  return (
    <span className="ml-auto inline-flex items-center gap-1.5">
      <input value={n} onChange={e => setN(e.target.value)} placeholder="Unit #" className={INPUT + ' w-24'} onKeyDown={e => { if (e.key === 'Enter' && n.trim()) { onAdd(n.trim()); setN('') } }} />
      <button onClick={() => { if (n.trim()) { onAdd(n.trim()); setN('') } }} disabled={!n.trim()} className={PRIMARY}><Plus size={14} /> Add unit</button>
    </span>
  )
}

function UnitCard({ unit, open, onToggle, onSaved, onDelete, onCopy, demo }: { unit: QuickUnit; open: boolean; onToggle: () => void; onSaved: (u: QuickUnit) => void; onDelete: () => void; onCopy: (unitNo: string) => void; demo?: boolean }) {
  const [d, setD] = useState<QuickData>({ ...EMPTY_DATA, ...unit.data })
  const [status, setStatus] = useState(unit.status)
  const [state, setState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved')
  const [uploading, setUploading] = useState(false)
  const timer = useRef<any>(null)
  const latest = useRef({ d, status }); latest.current = { d, status }

  const save = useCallback(async () => {
    if (demo) { setState('saved'); return }
    setState('saving')
    try {
      const r = await fetch('/api/onboarding-quick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', id: unit.id, data: latest.current.d, status: latest.current.status }) })
      const j = await r.json().catch(() => ({})); if (!r.ok || !j.ok) throw new Error(j.error || 'save failed')
      onSaved({ ...j.unit, data: { ...j.unit.data, photos: latest.current.d.photos } }); setState('saved')
    } catch { setState('error') }
  }, [unit.id, onSaved, demo])
  const queue = () => { setState('dirty'); clearTimeout(timer.current); timer.current = setTimeout(save, 600) }
  const touch = (next: Partial<QuickData>) => { setD(x => ({ ...x, ...next })); queue() }
  useEffect(() => () => clearTimeout(timer.current), [])

  const cycle = (key: string) => { const v = d.features[key]; const next: Tri = v == null ? 'yes' : v === 'yes' ? 'no' : null; touch({ features: { ...d.features, [key]: next } }) }
  const bed = (k: string, delta: number) => { const n = Math.max(0, (d.beds as any)[k] || 0) + delta; touch({ beds: { ...d.beds, [k]: n > 0 ? n : undefined } }) }
  const pick = (k: string, v: string) => touch({ picks: { ...d.picks, [k]: d.picks[k] === v ? '' : v } })
  const c = completion(d)
  const hasKitchen = d.picks.kitchen === 'yes'
  const bedCount = Object.values(d.beds).reduce((a, n) => a + (n || 0), 0)

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return
    if (demo) { setD(x => ({ ...x, photos: [...x.photos, ...Array.from(files).slice(0, 10).map(f => ({ url: URL.createObjectURL(f), at: '' }))] })); return }
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
    if (demo) { setD(x => ({ ...x, photos: x.photos.filter(p => p.url !== url) })); return }
    const r = await fetch('/api/onboarding-quick/photo', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: unit.id, url }) }); const j = await r.json().catch(() => ({}))
    if (j.ok) setD(x => ({ ...x, photos: j.photos }))
  }

  return (
    <div className={'rounded-2xl border bg-white ' + (status === 'done' ? 'border-emerald-300' : 'border-line')}>
      {/* ROW — always visible */}
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center gap-3 text-left">
        <span className={'w-10 h-10 rounded-xl grid place-items-center text-[13px] font-bold shrink-0 ' + (status === 'done' ? 'bg-emerald-600 text-white' : 'bg-app text-ink')}>{status === 'done' ? <Check size={18} strokeWidth={3} /> : unit.unit_no}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-ink">Unit {unit.unit_no}</span>
          <span className="block text-[12px] text-muted truncate">{bedCount ? `${bedCount} bed${bedCount === 1 ? '' : 's'} · ${bedsLabel(d)}` : 'no beds yet'}{d.bathrooms != null ? ` · ${d.bathrooms} bath` : ''}{d.picks.kitchen === 'yes' ? ' · kitchen' : d.picks.kitchen === 'no' ? ' · no kitchen' : ''}{d.photos.length ? ` · ${d.photos.length} photo${d.photos.length === 1 ? '' : 's'}` : ''}</span>
        </span>
        <span className="h-1.5 w-16 rounded-full bg-line overflow-hidden shrink-0 hidden sm:block"><span className={'block h-full ' + (c.pct === 100 ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: c.pct + '%' }} /></span>
        <span className="text-[11.5px] tabular-nums text-muted w-9 text-right">{c.pct}%</span>
        <ChevronDown size={16} className={'text-muted transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-line/60 space-y-5">
          {/* BEDS */}
          <Field label="Beds">
            <div className="flex items-center gap-2 flex-wrap">
              {BED_TYPES.map(b => {
                const n = (d.beds as any)[b.key] || 0
                return (
                  <div key={b.key} className={'inline-flex items-center rounded-xl border h-9 overflow-hidden ' + (n ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink')}>
                    <button onClick={() => bed(b.key, -1)} disabled={!n} className="w-8 h-full grid place-items-center disabled:opacity-30" aria-label={'fewer ' + b.label}><Minus size={12} /></button>
                    <span className="px-1 text-[12.5px] font-bold tabular-nums min-w-[60px] text-center">{n ? n + ' ' : ''}{b.label}</span>
                    <button onClick={() => bed(b.key, 1)} className="w-8 h-full grid place-items-center" aria-label={'more ' + b.label}><Plus size={12} /></button>
                  </div>
                )
              })}
            </div>
          </Field>

          {/* BATHS + GUESTS */}
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            <Field label="Bathrooms"><Stepper value={d.bathrooms} step={0.5} onChange={v => touch({ bathrooms: v })} /></Field>
            <Field label="Sleeps"><Stepper value={d.maxGuests} step={1} onChange={v => touch({ maxGuests: v })} /></Field>
          </div>

          {/* KITCHEN GATE */}
          <Field label="Kitchen?">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => pick('kitchen', 'yes')} className={CHIP(d.picks.kitchen === 'yes')}><Check size={13} /> Yes</button>
              <button onClick={() => pick('kitchen', 'no')} className={CHIP(d.picks.kitchen === 'no')}><X size={13} /> No</button>
              {hasKitchen && <>
                <span className="w-px h-6 bg-line mx-1" />
                {['Full kitchen', 'Kitchenette'].map(o => <button key={o} onClick={() => pick('kitchenType', o)} className={CHIP(d.picks.kitchenType === o)}>{o}</button>)}
              </>}
            </div>
            {hasKitchen && (
              <div className="mt-3 space-y-2">
                <Chips group={FEATURE_GROUPS[0]} d={d} cycle={cycle} />
                {d.features.coffee === 'yes' && (
                  <div className="flex items-center gap-2 flex-wrap pl-1">
                    <span className="text-[12px] text-muted">Coffee maker:</span>
                    {['Drip', 'Keurig', 'Nespresso'].map(o => <button key={o} onClick={() => pick('coffeeType', o)} className={'h-8 px-2.5 rounded-lg border text-[12px] font-semibold ' + (d.picks.coffeeType === o ? 'bg-ink text-white border-ink' : 'bg-white border-line text-ink hover:bg-app')}>{o}</button>)}
                  </div>
                )}
              </div>
            )}
          </Field>

          {/* MINI CHECKLIST */}
          <Field label="In the unit"><Chips group={FEATURE_GROUPS[1]} d={d} cycle={cycle} /></Field>
          <Field label="Safety"><Chips group={FEATURE_GROUPS[2]} d={d} cycle={cycle} /></Field>

          {/* PHOTOS */}
          <Field label="Photos" right={<label className={GHOST + ' cursor-pointer h-8'}>{uploading ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />} Add<input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={e => upload(e.target.files)} /></label>}>
            {d.photos.length ? (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {d.photos.map(p => (
                  <div key={p.url} className="relative group aspect-square rounded-xl overflow-hidden border border-line bg-app">
                    <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="" className="w-full h-full object-cover" loading="lazy" /></a>
                    <button onClick={() => removePhoto(p.url)} className="absolute top-1 right-1 w-6 h-6 rounded-md bg-white/90 text-rose-700 grid place-items-center opacity-0 group-hover:opacity-100" title="Remove"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            ) : <p className="text-[12.5px] text-muted">Living room, kitchen, each bedroom, bath.</p>}
          </Field>

          {/* NOTE */}
          <Field label="Note">
            <textarea value={d.notes} onChange={e => touch({ notes: e.target.value })} rows={2} placeholder="Wi-Fi, quirks, what is missing." className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] leading-snug focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </Field>

          {/* FOOTER */}
          <div className="pt-3 border-t border-line/60 flex items-center gap-2 flex-wrap">
            <button onClick={() => { setStatus(s => s === 'done' ? 'draft' : 'done'); queue() }} className={status === 'done' ? GHOST : PRIMARY}>{status === 'done' ? 'Reopen' : <><Check size={14} /> Done</>}</button>
            <button onClick={() => { const n = window.prompt('Same layout — new unit number:', ''); if (n && n.trim()) onCopy(n.trim()) }} className={GHOST} title="Copies the answers, not the photos"><Copy size={14} /> Copy to another unit</button>
            <span className={'ml-auto text-[11.5px] font-semibold ' + (state === 'error' ? 'text-rose-700' : state === 'saved' ? 'text-emerald-700' : 'text-muted')}>{state === 'saving' ? 'Saving…' : state === 'dirty' ? '…' : state === 'error' ? 'Could not save' : demo ? 'Preview' : 'Saved'}</span>
            <button onClick={onDelete} className="h-9 w-9 rounded-lg grid place-items-center text-muted hover:text-rose-700 hover:bg-rose-50" title="Delete this unit"><Trash2 size={14} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink">{label}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </div>
  )
}
function Chips({ group, d, cycle }: { group: { items: { key: string; label: string }[] }; d: QuickData; cycle: (k: string) => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {group.items.map(it => {
        const v = d.features[it.key]
        const cls = v === 'yes' ? 'bg-emerald-600 border-emerald-600 text-white' : v === 'no' ? 'bg-rose-50 border-rose-300 text-rose-800' : 'bg-white border-line text-ink hover:bg-app'
        return <button key={it.key} onClick={() => cycle(it.key)} title="Tap: Yes → No → blank" className={'h-9 px-3 rounded-xl border text-[12.5px] font-semibold inline-flex items-center gap-1.5 ' + cls}>{v === 'yes' && <Check size={13} strokeWidth={3} />}{v === 'no' && <X size={13} strokeWidth={3} />}{it.label}</button>
      })}
    </div>
  )
}
function Stepper({ value, onChange, step }: { value: number | null; onChange: (v: number | null) => void; step: number }) {
  const v = value ?? 0
  return (
    <div className="inline-flex items-center rounded-xl border border-line bg-white h-9 overflow-hidden">
      <button onClick={() => onChange(Math.max(0, v - step) || null)} disabled={!value} className="w-9 h-full grid place-items-center text-ink disabled:opacity-30"><Minus size={13} /></button>
      <span className="min-w-[44px] text-center text-[14px] font-bold tabular-nums text-ink">{value ?? '—'}</span>
      <button onClick={() => onChange(v + step)} className="w-9 h-full grid place-items-center text-ink"><Plus size={13} /></button>
    </div>
  )
}
