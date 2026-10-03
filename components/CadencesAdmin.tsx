'use client'
// PREVENTATIVE CADENCES — the settings screen for work that comes due on a clock.
//
// Jon, 2026-08-26: "Next big thing we want to do is push suggestions per day of tasks that should
// be done, battery changes, deep clean ac, filter change, Deep Cleaning (every 6 months), etc…
// this should live in user setting where you can have automations (suggestion sent)."
//
// Two halves, and they are separated on purpose:
//
//   THE JOBS      — one row per cadence: how often, how long it needs, whether the unit must be
//                   empty, and whether it is Off / Suggested / Created automatically.
//   THE RESTRAINT — the caps. This is the half that keeps the promise: "we can't have 200 tasks
//                   just auto populate". Every number here is a ceiling, and the preview below
//                   shows the real output of today's real rules before anything is turned on.
//
// PREVIEW BEFORE TRUST — the same contract as Task automation. Preview runs the live engine against
// the live calendar and shows exactly what would be proposed, creating nothing.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock, Loader2, Save, Eye, RotateCcw, Check, AlertTriangle, Wrench, Sparkles, ClipboardList,
} from 'lucide-react'

type Cad = {
  key: string; label: string; everyDays: number
  dept: 'maintenance' | 'housekeeping' | 'inspection'
  match: string; needsVacant: boolean; needsDays: number; minutes: number
  mode: 'off' | 'suggest' | 'auto'; seedIfNever: boolean; requiresAmenity?: string
  scopeBuildings?: string[]; scopeUnits?: string[]; needsScope?: boolean
  successor?: boolean; leadDays?: number; perBuilding?: boolean; equipment?: 'any' | 'central' | 'mini-split' | 'window' | 'non-central'
}
type Cfg = {
  enabled: boolean; dailyCap: number; perUnitCap: number; perPersonMinutes: number
  requireStaffOnSite: boolean; escapeAfterDays: number; cadences: Cad[]
  updatedAt?: string; updatedBy?: string | null
}

const DEPT_ICON: Record<Cad['dept'], any> = {
  maintenance: Wrench, housekeeping: Sparkles, inspection: ClipboardList,
}
// Months read better than days for anything on a seasonal clock, which is most of these.
function everyLabel(d: number) {
  if (d % 365 === 0 && d >= 365) return `${d / 365} year${d === 365 ? '' : 's'}`
  if (d >= 28) { const m = Math.round(d / 30.4); return `~${m} month${m === 1 ? '' : 's'}` }
  return `${d} days`
}

export function CadencesAdmin({ isOwner }: { isOwner: boolean }) {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [shippedKeys, setShippedKeys] = useState<string[]>([])
  // EQUIPMENT (Jon, 2026-09-28): which units have central A/C, mini-splits, window units —
  // inferred with evidence, overridable, accepted in one click. Also the unit list every cadence's
  // "pick units" uses.
  const [equip, setEquip] = useState<{ units: any[]; counts: Record<string, number>; buildings: string[] } | null>(null)
  const [equipOpen, setEquipOpen] = useState(false)
  const [equipFilter, setEquipFilter] = useState<{ building: string; type: string }>({ building: '', type: '' })
  const [unitSearch, setUnitSearch] = useState<Record<string, string>>({})
  const loadEquip = useCallback(async () => {
    try { const r = await fetch('/api/settings/equipment', { cache: 'no-store' }); const j = await r.json(); if (j?.ok) setEquip({ units: j.units || [], counts: j.counts || {}, buildings: j.buildings || [] }) } catch { /* the panel says so */ }
  }, [])
  useEffect(() => { loadEquip() }, [loadEquip])
  const setAc = async (listingId: string, ac: string) => {
    try { await fetch('/api/settings/equipment', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, ac: ac || null }) }); loadEquip() } catch { /* shown on reload */ }
  }
  const acceptAll = async () => {
    setBusy('equip')
    try { const r = await fetch('/api/settings/equipment', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptAll: true }) }); const j = await r.json(); setMsg({ tone: 'ok', text: `Accepted ${j.accepted || 0} recommendation${j.accepted === 1 ? '' : 's'}.` }); loadEquip() } catch (e: any) { setMsg({ tone: 'bad', text: String(e?.message || e) }) }
    setBusy(null)
  }
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [preview, setPreview] = useState<any | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  // NEW CADENCE (Jon, 2026-09-28: "a place to add or create new cadences that are managed and
  // tasks created"). A small form; the key is derived from the label; it saves with everything else.
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<{ label: string; everyDays: number; dept: Cad['dept']; match: string; needsVacant: boolean; minutes: number; mode: Cad['mode'] }>({ label: '', everyDays: 180, dept: 'maintenance', match: '', needsVacant: false, minutes: 30, mode: 'suggest' })
  const [ledger, setLedger] = useState<any[] | null>(null)
  const [ledgerBusy, setLedgerBusy] = useState(false)
  const [pmRun, setPmRun] = useState<any | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/cadences', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && j.config) { setCfg(j.config); setSaved(JSON.stringify(j.config)); if (Array.isArray(j.defaults?.cadences)) setShippedKeys(j.defaults.cadences.map((c: any) => String(c.key))) }
    } catch { /* stays empty; a reload retries */ }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (patch: Partial<Cfg>) => setCfg(c => (c ? { ...c, ...patch } : c))
  const setCad = (key: string, patch: Partial<Cad>) =>
    setCfg(c => (c ? { ...c, cadences: c.cadences.map(x => (x.key === key ? { ...x, ...patch } : x)) } : c))
  const dirty = cfg ? JSON.stringify(cfg) !== saved : false
  const addCadence = () => {
    if (!cfg) return
    const label = draft.label.trim()
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
    if (!label || !key) { setMsg({ tone: 'bad', text: 'Give the job a name.' }); return }
    if (cfg.cadences.some(c => c.key === key)) { setMsg({ tone: 'bad', text: 'A cadence with that name already exists.' }); return }
    const match = draft.match.trim() || label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    try { new RegExp(match, 'i') } catch { setMsg({ tone: 'bad', text: 'That "counts as done" pattern is not valid.' }); return }
    const c: Cad = { key, label, everyDays: Math.max(1, Math.round(draft.everyDays || 180)), dept: draft.dept, match, needsVacant: draft.needsVacant, needsDays: draft.needsVacant ? 1 : 0, minutes: Math.max(5, Math.round(draft.minutes || 30)), mode: draft.mode, seedIfNever: false, requiresAmenity: '', scopeBuildings: [], scopeUnits: [], needsScope: false, successor: true, leadDays: 14 }
    set({ cadences: [...cfg.cadences, c] })
    setOpen(key); setAdding(false)
    setDraft({ label: '', everyDays: 180, dept: 'maintenance', match: '', needsVacant: false, minutes: 30, mode: 'suggest' })
    setMsg({ tone: 'ok', text: `Added "${label}" — press Save to keep it.` })
  }
  const removeCadence = (key: string) => { if (!cfg) return; set({ cadences: cfg.cadences.filter(c => c.key !== key) }); if (open === key) setOpen(null) }
  const loadLedger = useCallback(async () => {
    setLedgerBusy(true)
    try { const r = await fetch('/api/pm/schedule', { cache: 'no-store' }); const j = await r.json(); setLedger(Array.isArray(j?.rows) ? j.rows : []) } catch { setLedger([]) }
    setLedgerBusy(false)
  }, [])
  const runPm = async (dry: boolean) => {
    setBusy('pm')
    try { const r = await fetch('/api/pm/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: dry, force: true }) }); const j = await r.json(); setPmRun(j); if (!dry) loadLedger() } catch (e: any) { setPmRun({ ok: false, error: String(e?.message || e) }) }
    setBusy(null)
  }

  async function save() {
    if (!cfg) return
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/cadences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Could not save.')
      setCfg(j.config); setSaved(JSON.stringify(j.config))
      const autos = (j.config.cadences || []).filter((c: Cad) => c.mode === 'auto').length
      setMsg({
        tone: 'ok',
        text: !j.config.enabled ? 'Saved — suggestions stay OFF until you enable them.'
          : autos ? `Saved — at most ${j.config.dailyCap} a day, ${autos} of them created without asking.`
            : `Saved — at most ${j.config.dailyCap} suggestions a day, none created without a click.`,
      })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  async function reset() {
    setBusy('reset'); setMsg(null)
    try {
      const r = await fetch('/api/settings/cadences', { method: 'DELETE' })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Could not reset.')
      setCfg(j.config); setSaved(JSON.stringify(j.config))
      setMsg({ tone: 'ok', text: 'Back to the standard cadences.' })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  async function runPreview() {
    setBusy('preview'); setMsg(null); setPreview(null)
    try {
      const r = await fetch('/api/suggestions', { cache: 'no-store' })
      const j = await r.json()
      if (!j || j.ok === false) throw new Error(j?.error || 'Preview failed.')
      setPreview(j)
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  const scopedCount = (c: Cad) => (c.scopeBuildings?.length || 0) + (c.scopeUnits?.length || 0)
  const inertCadences = useMemo(() => (cfg?.cadences || []).filter(c => c.mode !== 'off' && c.needsScope && !scopedCount(c)), [cfg])
  const buildings: { name: string; units: number }[] = preview?.buildings || []

  const autoCount = useMemo(() => (cfg?.cadences || []).filter(c => c.mode === 'auto').length, [cfg])

  if (!cfg) return <p className="text-[12.5px] text-muted py-2"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />Loading&hellip;</p>

  const box = 'rounded-lg border border-line px-2 py-1 text-[12.5px]'

  return (
    <div className="space-y-3 pt-1">
      {/* ── MASTER SWITCH ─────────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <CalendarClock size={14} className={cfg.enabled ? 'text-amber-500' : 'text-muted'} />
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} onChange={e => set({ enabled: e.target.checked })} disabled={!isOwner} />
          <span className="text-[13px] font-bold text-ink">Suggest preventative work each day</span>
        </label>
        <span className={'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ' + (cfg.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500')}>
          {cfg.enabled ? 'On' : 'Off'}
        </span>
      </div>
      <p className="text-[12px] text-muted -mt-1">
        Every morning Lighthouse works out what is due on each unit, throws away everything that cannot
        happen today, and proposes <strong className="text-ink">at most {cfg.dailyCap}</strong> jobs — ranked by who is
        already working in that building, not by what is most overdue. Hundreds are due at any moment; a
        list of hundreds is a list nobody works.
      </p>

      {/* ── THE UNANSWERED QUESTION ───────────────────────────────────────────────────────
          A cadence that cannot know where it applies is worth more as a visible gap than as a
          quiet nothing — this is the banner that keeps it visible. */}
      {inertCadences.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="text-[12.5px] font-bold text-amber-900 flex items-center gap-1.5">
            <AlertTriangle size={13} /> {inertCadences.map(c => c.label).join(', ')} — suggesting nothing yet
          </p>
          <p className="text-[11.5px] text-amber-900/80 mt-1">
            {inertCadences.some(c => c.key === 'ac_filter') ? (
              <>
                Every one of your units records the amenity &ldquo;Air conditioning&rdquo; and not one records
                any form of &ldquo;central&rdquo;, so nothing we hold can tell a central system from a
                mini-split or a PTAC. Rather than guess and propose monthly filter changes for units with
                no filter to change, this cadence stays inert until you pick the buildings.
                {' '}<strong>Open it below and tick the ones on central air.</strong>
              </>
            ) : 'Open it below and pick which buildings or units it applies to.'}
          </p>
          {!buildings.length && (
            <p className="text-[11px] text-amber-900/70 mt-1">Press <strong>Preview today</strong> to load your building list into the picker.</p>
          )}
        </div>
      )}

      {/* ── THE JOBS ──────────────────────────────────────────────────────────────────────── */}
      <div className="border border-line rounded-xl overflow-hidden">
        <div className="px-3 py-1.5 bg-neutral-50 border-b border-line text-[11px] uppercase tracking-wider font-bold text-muted">
          The jobs
        </div>
        <div className="divide-y divide-line">
          {cfg.cadences.map(c => {
            const Icon = DEPT_ICON[c.dept] || Wrench
            const isOpen = open === c.key
            return (
              <div key={c.key} className="px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Icon size={13} className={c.mode === 'off' ? 'text-muted' : c.mode === 'auto' ? 'text-amber-500' : 'text-sky-500'} />
                  <button type="button" onClick={() => setOpen(isOpen ? null : c.key)}
                    className="text-[12.5px] font-semibold text-ink hover:underline text-left">
                    {c.label}
                  </button>
                  <span className="text-[11.5px] text-muted">every {everyLabel(c.everyDays)}</span>
                  {c.needsVacant && <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">needs an empty unit</span>}
                  {c.requiresAmenity && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">only units with the equipment</span>}
                  {scopedCount(c) > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">{[(c.scopeBuildings?.length || 0) ? `${c.scopeBuildings!.length} bldg` : '', (c.scopeUnits?.length || 0) ? `${c.scopeUnits!.length} unit${c.scopeUnits!.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span>}
                  {c.mode !== 'off' && c.needsScope && !scopedCount(c) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 font-bold">needs a list &mdash; inert</span>
                  )}
                  <span className="text-[11px] text-muted">{c.minutes} min</span>
                  <select value={c.mode} onChange={e => setCad(c.key, { mode: e.target.value as Cad['mode'] })}
                    disabled={!isOwner} className={box + ' ml-auto'}>
                    <option value="off">Off</option>
                    <option value="suggest">Suggest it</option>
                    <option value="auto">Create it automatically</option>
                  </select>
                </div>
                {isOpen && (
                  <div className="mt-2 pl-5 grid sm:grid-cols-2 gap-x-6 gap-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-muted w-28 shrink-0">Every</span>
                      <input type="number" min={1} max={3650} value={c.everyDays}
                        onChange={e => setCad(c.key, { everyDays: Number(e.target.value) || c.everyDays })}
                        className={box + ' w-[80px]'} disabled={!isOwner} />
                      <span className="text-[12px] text-muted">days ({everyLabel(c.everyDays)})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-muted w-28 shrink-0">Takes about</span>
                      <input type="number" min={5} max={600} value={c.minutes}
                        onChange={e => setCad(c.key, { minutes: Number(e.target.value) || c.minutes })}
                        className={box + ' w-[80px]'} disabled={!isOwner} />
                      <span className="text-[12px] text-muted">minutes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-muted w-28 shrink-0">Department</span>
                      <select value={c.dept} onChange={e => setCad(c.key, { dept: e.target.value as Cad['dept'] })}
                        className={box} disabled={!isOwner}>
                        <option value="maintenance">Maintenance</option>
                        <option value="housekeeping">Housekeeping</option>
                        <option value="inspection">Inspection</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-muted w-28 shrink-0">Clear days needed</span>
                      <input type="number" min={0} max={30} value={c.needsDays}
                        onChange={e => setCad(c.key, { needsDays: Number(e.target.value) })}
                        className={box + ' w-[80px]'} disabled={!isOwner} />
                    </div>
                    <label className="flex items-start gap-2 cursor-pointer sm:col-span-2">
                      <input type="checkbox" checked={c.needsVacant} onChange={e => setCad(c.key, { needsVacant: e.target.checked })} className="mt-0.5" disabled={!isOwner} />
                      <span className="text-[12px]"><span className="font-semibold text-ink">Only when the unit is empty</span> <span className="text-muted">— off means it can be done around a guest</span></span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer sm:col-span-2">
                      <input type="checkbox" checked={c.seedIfNever} onChange={e => setCad(c.key, { seedIfNever: e.target.checked })} className="mt-0.5" disabled={!isOwner} />
                      <span className="text-[12px]"><span className="font-semibold text-ink">Treat &ldquo;never recorded&rdquo; as due</span> <span className="text-muted">— on for jobs every unit certainly needs; off for ones only some units have</span></span>
                    </label>
                    {/* THE SUCCESSOR RULE (Jon, 2026-09-28): done → the next one is booked. */}
                    <label className="flex items-start gap-2 cursor-pointer sm:col-span-2">
                      <input type="checkbox" checked={c.successor !== false} onChange={e => setCad(c.key, { successor: e.target.checked })} className="mt-0.5" disabled={!isOwner} />
                      <span className="text-[12px]"><span className="font-semibold text-ink">When one is completed, book the next</span> <span className="text-muted">— the next task is put on the ledger for done + {everyLabel(c.everyDays)} and created in Breezeway</span>
                        {' '}<input type="number" min={0} max={120} value={c.leadDays ?? 14} onChange={e => setCad(c.key, { leadDays: Number(e.target.value) })} className={box + ' w-[64px] ml-1'} disabled={!isOwner || c.successor === false} /> <span className="text-muted">days before it is due{c.mode === 'auto' ? ' (created outright — this cadence is on auto)' : ' (as a proposal Eve asks a ✅ for)'}</span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer sm:col-span-2">
                      <input type="checkbox" checked={!!c.perBuilding} onChange={e => setCad(c.key, { perBuilding: e.target.checked })} className="mt-0.5" disabled={!isOwner} />
                      <span className="text-[12px]"><span className="font-semibold text-ink">One job per building</span> <span className="text-muted">— pressure washing, a vendor visit: one task on the building, not one per unit</span></span>
                    </label>
                    {!shippedKeys.includes(c.key) && isOwner && (
                      <button type="button" onClick={() => removeCadence(c.key)} className="sm:col-span-2 justify-self-start text-[11.5px] text-rose-700 underline decoration-dotted">Remove this cadence</button>
                    )}
                    <div className="flex items-center gap-2 sm:col-span-2">
                      <span className="text-[12px] text-muted w-28 shrink-0">Equipment</span>
                      <select value={c.equipment || 'any'} onChange={e => setCad(c.key, { equipment: e.target.value as Cad['equipment'] })} className={box} disabled={!isOwner}>
                        <option value="any">Every unit</option>
                        <option value="central">Central A/C only{equip ? ` (${equip.counts.central || 0})` : ''}</option>
                        <option value="mini-split">Mini-splits only{equip ? ` (${equip.counts['mini-split'] || 0})` : ''}</option>
                        <option value="window">Window / PTAC only{equip ? ` (${equip.counts.window || 0})` : ''}</option>
                        <option value="non-central">Mini-splits + window / wall units{equip ? ` (${(equip.counts['mini-split'] || 0) + (equip.counts.window || 0)})` : ''}</option>
                      </select>
                      {c.equipment && c.equipment !== 'any' && equip && (equip.counts.unknown || 0) > 0 ? <span className="text-[11px] text-amber-700">{equip.counts.unknown} units still unknown — set them in Equipment below</span> : null}
                    </div>
                    {(
                      <div className="sm:col-span-2">
                        <p className="text-[12px] text-muted mb-1">
                          Where it applies — leave both empty for every unit{c.equipment && c.equipment !== 'any' ? ' with that equipment' : ''}
                          {c.needsScope && !scopedCount(c) && <span className="text-amber-700 font-semibold"> — nothing is suggested until you pick at least one</span>}
                        </p>
                        {buildings.length === 0 && !(equip?.buildings || []).length ? (
                          <p className="text-[11.5px] text-muted">Press <strong className="text-ink">Preview today</strong> to load your buildings.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-[180px] overflow-y-auto">
                            {(buildings.length ? buildings : (equip?.buildings || []).map(name => ({ name, units: (equip?.units || []).filter(u => u.building === name).length }))).map(b => {
                              const on = (c.scopeBuildings || []).indexOf(b.name) >= 0
                              return (
                                <button key={b.name} type="button" disabled={!isOwner}
                                  onClick={() => setCad(c.key, {
                                    scopeBuildings: on
                                      ? (c.scopeBuildings || []).filter(x => x !== b.name)
                                      : (c.scopeBuildings || []).concat(b.name),
                                  })}
                                  className={'px-2 py-1 rounded-lg border text-[11.5px] ' + (on ? 'bg-ink border-ink text-white font-semibold' : 'bg-white border-line text-muted hover:text-ink')}>
                                  {b.name} <span className={on ? 'text-white/60' : 'text-muted'}>{b.units}</span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                        {/* INDIVIDUAL UNITS (Jon, 2026-09-28: "select building / individual units if needed"). */}
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] text-muted">Units:</span>
                          {(c.scopeUnits || []).map(u => {
                            const nm = (equip?.units || []).find(x => x.listingId === u)?.unit || u
                            return <button key={u} type="button" disabled={!isOwner} onClick={() => setCad(c.key, { scopeUnits: (c.scopeUnits || []).filter(x => x !== u) })} className="px-2 py-0.5 rounded-lg bg-ink text-white text-[11.5px] font-semibold">{nm} ×</button>
                          })}
                          <input value={unitSearch[c.key] || ''} onChange={e => setUnitSearch(m => ({ ...m, [c.key]: e.target.value }))} placeholder="add a unit…" className={box + ' w-40'} disabled={!isOwner} />
                          {(unitSearch[c.key] || '').length >= 2 && (equip?.units || []).filter(u => !(c.scopeUnits || []).includes(u.listingId) && (u.unit + ' ' + u.building).toLowerCase().includes((unitSearch[c.key] || '').toLowerCase())).slice(0, 8).map(u => (
                            <button key={u.listingId} type="button" onClick={() => { setCad(c.key, { scopeUnits: (c.scopeUnits || []).concat(u.listingId) }); setUnitSearch(m => ({ ...m, [c.key]: '' })) }} className="px-2 py-0.5 rounded-lg border border-line bg-white text-[11.5px] hover:border-ink">{u.unit} <span className="text-muted">· {u.building}</span></button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-muted shrink-0">Only units whose amenities match</span>
                        <input value={c.requiresAmenity || ''} onChange={e => setCad(c.key, { requiresAmenity: e.target.value })}
                          className={box + ' flex-1 font-mono text-[11.5px]'} disabled={!isOwner} placeholder="leave empty for every unit" />
                      </div>
                      <p className="text-[11px] text-muted mt-1">
                        A unit with <strong className="text-ink">no amenities recorded at all</strong> is excluded rather than
                        assumed to qualify &mdash; and counted separately in the preview, because &ldquo;we cannot tell&rdquo; is
                        not the same answer as &ldquo;it does not have one&rdquo;.
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-muted shrink-0">Counts as done when a task is named</span>
                        <input value={c.match} onChange={e => setCad(c.key, { match: e.target.value })}
                          className={box + ' flex-1 font-mono text-[11.5px]'} disabled={!isOwner} />
                      </div>
                      <p className="text-[11px] text-muted mt-1">
                        A completed Breezeway task whose name matches this <em>is</em> the record that the job was done —
                        there is no second system to keep. Pattern syntax is the same as Task categories.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── THE RESTRAINT ─────────────────────────────────────────────────────────────────── */}
      <div className="border border-line rounded-xl overflow-hidden">
        <div className="px-3 py-1.5 bg-neutral-50 border-b border-line text-[11px] uppercase tracking-wider font-bold text-muted">
          How much it may propose
        </div>
        <div className="px-3 py-2.5 grid sm:grid-cols-2 gap-x-6 gap-y-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted w-40 shrink-0">Most in one day</span>
            <input type="number" min={1} max={40} value={cfg.dailyCap}
              onChange={e => set({ dailyCap: Number(e.target.value) || cfg.dailyCap })} className={box + ' w-[80px]'} disabled={!isOwner} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted w-40 shrink-0">Most per unit per day</span>
            <input type="number" min={1} max={6} value={cfg.perUnitCap}
              onChange={e => set({ perUnitCap: Number(e.target.value) || cfg.perUnitCap })} className={box + ' w-[80px]'} disabled={!isOwner} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted w-40 shrink-0">Extra minutes per person</span>
            <input type="number" min={15} max={480} step={15} value={cfg.perPersonMinutes}
              onChange={e => set({ perPersonMinutes: Number(e.target.value) || cfg.perPersonMinutes })} className={box + ' w-[80px]'} disabled={!isOwner} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-muted w-40 shrink-0">Ignore proximity after</span>
            <input type="number" min={0} max={365} value={cfg.escapeAfterDays}
              onChange={e => set({ escapeAfterDays: Number(e.target.value) })} className={box + ' w-[80px]'} disabled={!isOwner} />
            <span className="text-[12px] text-muted">days overdue</span>
          </div>
          <label className="flex items-start gap-2 cursor-pointer sm:col-span-2">
            <input type="checkbox" checked={cfg.requireStaffOnSite} onChange={e => set({ requireStaffOnSite: e.target.checked })} className="mt-0.5" disabled={!isOwner} />
            <span className="text-[12px]">
              <span className="font-semibold text-ink">Only where somebody is already working nearby</span>{' '}
              <span className="text-muted">
                — a filter change in a building a tech is standing in is twenty minutes; the same job across
                the county is a two-hour round trip that does not happen. Somebody in the same building counts
                first and ranks far higher; somebody elsewhere in the same area still counts, but only just.
                A job with a real last-done date more than {cfg.escapeAfterDays || '—'} days past its interval is
                proposed anyway, because &ldquo;nobody is ever near it&rdquo; cannot mean &ldquo;never&rdquo; — a unit
                with no record at all does not get that pass, because a missing record is usually missing history.
              </span>
            </span>
          </label>
          <p className="text-[11.5px] text-muted sm:col-span-2 border-t border-line pt-2">
            <strong className="text-ink">On a heavy turn day it proposes nothing at all.</strong> Before ranking anything,
            the engine reads the day — open departure cleans against cleaners working. Above six cleans per cleaner the
            right number of extras is zero, and it says so instead of quietly producing {cfg.dailyCap} anyway.
          </p>
          {autoCount > 0 && (
            <p className="text-[11.5px] sm:col-span-2 flex items-start gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{autoCount} {autoCount === 1 ? 'cadence is' : 'cadences are'} set to create tasks without asking. They obey every cap above, but nobody sees them before they exist.</span>
            </p>
          )}
        </div>
      </div>

      {/* ── EQUIPMENT: which units have what ──────────────────────────────────────────────── */}
      <div className="border border-line rounded-xl overflow-hidden">
        <div className="px-3 py-1.5 bg-neutral-50 border-b border-line flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider font-bold text-muted">Equipment — A/C type per unit</span>
          {equip ? <span className="text-[11.5px] text-muted">central {equip.counts.central || 0} · mini-split {equip.counts['mini-split'] || 0} · window {equip.counts.window || 0} · unknown {equip.counts.unknown || 0}</span> : <span className="text-[11.5px] text-muted">Reading the listings, task history and guest messages…</span>}
          <button type="button" onClick={() => setEquipOpen(v => !v)} className="text-[11.5px] underline decoration-dotted text-ink">{equipOpen ? 'Hide' : 'Review'}</button>
          {isOwner && equip ? <button type="button" onClick={acceptAll} disabled={busy === 'equip'} className="ml-auto text-[11.5px] font-semibold underline decoration-dotted text-ink disabled:opacity-40">Accept all recommendations</button> : null}
        </div>
        {equipOpen && equip ? (
          <div>
            <div className="px-3 py-1.5 flex items-center gap-2 text-[12px] border-b border-line">
              <select value={equipFilter.building} onChange={e => setEquipFilter(f => ({ ...f, building: e.target.value }))} className={box}><option value="">All buildings</option>{equip.buildings.map(b => <option key={b} value={b}>{b}</option>)}</select>
              <select value={equipFilter.type} onChange={e => setEquipFilter(f => ({ ...f, type: e.target.value }))} className={box}><option value="">All types</option><option value="central">Central</option><option value="mini-split">Mini-split</option><option value="window">Window / PTAC</option><option value="unknown">Unknown</option></select>
              <span className="text-muted">A mini-split's filter is rinsed at every departure clean; its coils are the 6-month deep clean. Central units get the monthly filter change.</span>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-[11.5px]">
                <thead className="text-left text-muted sticky top-0 bg-white"><tr><th className="px-3 py-1 font-semibold">Unit</th><th className="px-2 py-1 font-semibold">Building</th><th className="px-2 py-1 font-semibold">Recommended</th><th className="px-2 py-1 font-semibold">Why</th><th className="px-2 py-1 font-semibold">Set</th></tr></thead>
                <tbody>
                  {equip.units.filter(u => (!equipFilter.building || u.building === equipFilter.building) && (!equipFilter.type || u.effective === equipFilter.type)).slice(0, 400).map(u => (
                    <tr key={u.listingId} className="border-t border-line/60">
                      <td className="px-3 py-1 whitespace-nowrap">{u.unit}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-muted">{u.building}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{u.inferred === 'unknown' ? <span className="text-muted">—</span> : <span>{u.inferred} <span className={'text-[10px] ' + (u.confidence === 'high' ? 'text-emerald-700' : u.confidence === 'medium' ? 'text-amber-700' : 'text-muted')}>{u.confidence}</span></span>}</td>
                      <td className="px-2 py-1 text-muted max-w-[360px] truncate" title={(u.evidence || []).join('\n')}>{(u.evidence || [])[0] || 'no evidence in the listing, the task history or guest messages'}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <select value={u.override || ''} onChange={e => setAc(u.listingId, e.target.value)} className={box + (u.override ? ' font-semibold' : '')} disabled={!isOwner}>
                          <option value="">{u.effective === 'unknown' ? 'unknown' : `(${u.effective})`}</option>
                          <option value="central">central</option><option value="mini-split">mini-split</option><option value="window">window / PTAC</option><option value="none">no A/C</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── NEW CADENCE ───────────────────────────────────────────────────────────────────── */}
      <div className="border border-line rounded-xl px-3 py-2.5">
        {!adding ? (
          <button type="button" onClick={() => setAdding(true)} disabled={!isOwner} className="text-[12.5px] font-semibold text-ink disabled:opacity-40">+ New cadence</button>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[12px]">
            <label className="sm:col-span-3"><span className="text-muted">Job</span><input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} placeholder="e.g. Remote batteries, Door-lock batteries, Central A/C filter clean" className={box + ' w-full mt-0.5'} autoFocus /></label>
            <label><span className="text-muted">Every (days)</span><input type="number" min={1} max={3650} value={draft.everyDays} onChange={e => setDraft(d => ({ ...d, everyDays: Number(e.target.value) }))} className={box + ' w-full mt-0.5'} /></label>
            <label><span className="text-muted">Department</span><select value={draft.dept} onChange={e => setDraft(d => ({ ...d, dept: e.target.value as Cad['dept'] }))} className={box + ' w-full mt-0.5'}><option value="maintenance">Maintenance</option><option value="housekeeping">Housekeeping</option><option value="inspection">Inspection</option></select></label>
            <label><span className="text-muted">Minutes</span><input type="number" min={5} max={600} value={draft.minutes} onChange={e => setDraft(d => ({ ...d, minutes: Number(e.target.value) }))} className={box + ' w-full mt-0.5'} /></label>
            <label className="sm:col-span-2"><span className="text-muted">Counts as done when a finished task name matches</span><input value={draft.match} onChange={e => setDraft(d => ({ ...d, match: e.target.value }))} placeholder="leave blank to match the job name · e.g. remote.*batter" className={box + ' w-full mt-0.5 font-mono'} /></label>
            <label><span className="text-muted">Mode</span><select value={draft.mode} onChange={e => setDraft(d => ({ ...d, mode: e.target.value as Cad['mode'] }))} className={box + ' w-full mt-0.5'}><option value="suggest">Propose (Eve asks)</option><option value="auto">Create without asking</option><option value="off">Off</option></select></label>
            <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={draft.needsVacant} onChange={e => setDraft(d => ({ ...d, needsVacant: e.target.checked }))} /> Only when the unit is empty</label>
            <div className="flex items-center gap-2 sm:col-span-3">
              <button type="button" onClick={addCadence} className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold">Add</button>
              <button type="button" onClick={() => setAdding(false)} className="text-[12px] text-muted">Cancel</button>
              <span className="text-[11.5px] text-muted">The first completed task that matches starts its clock; from then on each completion books the next.</span>
            </div>
          </div>
        )}
      </div>

      {/* ── THE LEDGER ────────────────────────────────────────────────────────────────────── */}
      <div className="border border-line rounded-xl overflow-hidden">
        <div className="px-3 py-1.5 bg-neutral-50 border-b border-line flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wider font-bold text-muted">What is booked next</span>
          <button type="button" onClick={loadLedger} disabled={ledgerBusy} className="text-[11.5px] underline decoration-dotted text-ink disabled:opacity-40">{ledgerBusy ? 'Loading…' : (ledger ? 'Refresh' : 'Show')}</button>
          <button type="button" onClick={() => runPm(true)} disabled={busy === 'pm'} className="text-[11.5px] underline decoration-dotted text-ink disabled:opacity-40">Preview the next run</button>
          {isOwner && <button type="button" onClick={() => runPm(false)} disabled={busy === 'pm'} className="text-[11.5px] underline decoration-dotted text-amber-800 disabled:opacity-40">Run now</button>}
        </div>
        {pmRun && (
          <div className="px-3 py-2 text-[11.5px] border-b border-line bg-amber-50/40">
            {pmRun.error ? <span className="text-rose-700">{pmRun.error}</span> : <span>{pmRun.enabled === false ? 'Cadences are off. ' : ''}ledger {pmRun.ledger} · created {pmRun.created} · proposed {pmRun.proposed} · moved {pmRun.moved} · waiting for an empty day {pmRun.waiting}</span>}
            {Array.isArray(pmRun.lines) && pmRun.lines.length > 0 && <ul className="mt-1 space-y-0.5 text-muted">{pmRun.lines.slice(0, 12).map((l: string, i: number) => <li key={i}>• {l}</li>)}</ul>}
          </div>
        )}
        {ledger && (
          ledger.length === 0 ? <p className="px-3 py-2 text-[12px] text-muted">Nothing on the ledger yet — it fills from the first completed task that matches a cadence (the next run of the automation, or Run now).</p> : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-[11.5px]">
                <thead className="text-left text-muted sticky top-0 bg-white"><tr><th className="px-3 py-1 font-semibold">Unit</th><th className="px-2 py-1 font-semibold">Job</th><th className="px-2 py-1 font-semibold">Last done</th><th className="px-2 py-1 font-semibold">Next due</th><th className="px-2 py-1 font-semibold">Status</th></tr></thead>
                <tbody>
                  {ledger.slice(0, 400).map((r: any) => (
                    <tr key={r.listing_id + r.cadence_key} className="border-t border-line/60">
                      <td className="px-3 py-1 whitespace-nowrap">{r.unit_name || r.listing_id}{r.building ? <span className="text-muted"> · {r.building}</span> : null}</td>
                      <td className="px-2 py-1">{r.label}</td>
                      <td className="px-2 py-1 whitespace-nowrap text-muted">{r.last_done || '—'}</td>
                      <td className={'px-2 py-1 whitespace-nowrap ' + (r.daysOver > 0 ? 'text-rose-700 font-semibold' : '')}>{r.next_due}{r.daysOver > 0 ? ` (${r.daysOver}d over)` : ''}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.status === 'created' ? <span>task #{r.task_id} · {r.task_date}{r.moved ? ` · moved ×${r.moved}` : ''}</span> : <span className="text-muted">{r.note || 'on the ledger'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* ── ACTIONS ───────────────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={!isOwner || !dirty || busy === 'save'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink text-white px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">
          {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
        </button>
        <button onClick={runPreview} disabled={busy === 'preview'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">
          {busy === 'preview' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Preview today
        </button>
        <button onClick={reset} disabled={!isOwner || busy === 'reset'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted disabled:opacity-40">
          {busy === 'reset' ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Standard cadences
        </button>
        {msg && (
          <span className={'text-[12px] inline-flex items-center gap-1 ' + (msg.tone === 'ok' ? 'text-emerald-600' : 'text-rose-600')}>
            {msg.tone === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />} {msg.text}
          </span>
        )}
      </div>

      {/* ── PREVIEW ───────────────────────────────────────────────────────────────────────── */}
      {preview && (
        <div className="border border-line rounded-xl overflow-hidden">
          <div className="px-3 py-2 bg-neutral-50 border-b border-line">
            <p className="text-[12.5px] font-semibold text-ink">{preview.day?.verdict || 'Today'}</p>
            <p className="text-[11.5px] text-muted mt-0.5">
              Looked at {preview.considered} unit-and-job combinations · proposing {preview.suggestions?.length || 0}
              {preview.day?.cap != null ? ` (cap ${preview.day.cap} today)` : ''}
              {preview.mix ? ` · ${preview.mix.building} where somebody is in the building, ${preview.mix.area} elsewhere in the area, ${preview.mix.none} with nobody near` : ''}
              {preview.historyComplete === false ? ' · history read hit its page limit, so some "never done" may be "long ago"' : ''}
            </p>
          </div>
          {(preview.suggestions || []).length === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-muted">Nothing worth adding today. That is a valid answer.</p>
          ) : (
            <div className="divide-y divide-line">
              {preview.suggestions.map((s: any) => (
                <div key={s.id} className="px-3 py-2">
                  <p className="text-[12.5px] font-semibold text-ink">{s.label} &mdash; {s.unit}</p>
                  <p className="text-[11.5px] text-muted mt-0.5">{s.why}</p>
                  <p className="text-[11px] text-muted mt-0.5">
                    {s.minutes} min · {s.dept}
                    {s.candidates?.length ? ` · could go to ${s.candidates.slice(0, 2).join(' or ')}` : ' · nobody on site'}
                  </p>
                </div>
              ))}
            </div>
          )}
          {preview.amenityStats && Object.keys(preview.amenityStats).length > 0 && (
            <div className="px-3 py-2 border-t border-line">
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1">Equipment check</p>
              {Object.entries(preview.amenityStats).map(([k, v]: any) => {
                const cad = cfg.cadences.find(c => c.key === k)
                return (
                  <p key={k} className="text-[11.5px] text-muted">
                    <strong className="text-ink">{cad?.label || k}</strong> — {v.has} unit{v.has === 1 ? '' : 's'} have it,
                    {' '}{v.hasNot} do not
                    {v.unknown > 0 && <span className="text-amber-700"> · {v.unknown} have no amenities recorded, so they are excluded</span>}
                  </p>
                )
              })}
            </div>
          )}
          {Array.isArray(preview.inert) && preview.inert.length > 0 && (
            <div className="px-3 py-2 border-t border-line bg-amber-50/60">
              {preview.inert.map((i: any) => (
                <p key={i.key} className="text-[11.5px] text-amber-900">
                  <strong>{i.label}</strong> — {i.why}
                </p>
              ))}
            </div>
          )}
          {Array.isArray(preview.climateVocab) && preview.climateVocab.length > 0 && (
            <div className="px-3 py-2 border-t border-line">
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1">
                Climate amenities actually recorded in the portfolio
              </p>
              <p className="text-[11.5px] text-muted">
                {preview.climateVocab.map((v: any) => `${v.term} (${v.units})`).join(' · ')}
              </p>
              <p className="text-[11px] text-muted mt-1">
                Write the equipment pattern against these exact words &mdash; a gate that matches none of
                them silently excludes the whole portfolio.
              </p>
            </div>
          )}
          {preview.dropped && Object.keys(preview.dropped).length > 0 && (
            <div className="px-3 py-2 border-t border-line bg-neutral-50">
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1">Ruled out today</p>
              <p className="text-[11.5px] text-muted">
                {Object.entries(preview.dropped).sort((a: any, b: any) => b[1] - a[1])
                  .map(([k, v]) => `${v} ${k}`).join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}

      {cfg.updatedAt && (
        <p className="text-[11px] text-muted">
          Last changed {new Date(cfg.updatedAt).toLocaleString('en-US')}{cfg.updatedBy ? ` by ${cfg.updatedBy}` : ''}.
        </p>
      )}
    </div>
  )
}
