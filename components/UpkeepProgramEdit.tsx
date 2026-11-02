'use client'
// EDIT A PROGRAM FROM THE UPKEEP PAGE (Jon, 2026-11-02: "The upkeep section needs to be editable so
// we can customize programs, create tasks, and auto assign team. We need this to be easy to do, also
// be able to assign by buildings / units if needed.")
//
// One panel, five plain steps: name, how often, what Lighthouse does when it comes due (nothing /
// suggest / create the task), where it applies, and who gets it — a default team plus a different
// team for any building or unit. Saves into the same cadence catalogue Settings → Cadences edits
// (PUT /api/settings/cadences), so both screens always agree.
import { useEffect, useMemo, useState } from 'react'
import { Loader2, X, Check, Search, Building2, Home, Plus, Trash2, Users } from 'lucide-react'
import { useCachedFetch } from '@/lib/swr'
import type { CadenceDef, TeamRule } from '@/lib/cadences'

type Opts = { buildings: { key: string; units: number }[]; units: { id: string; name: string; building: string }[] }
type Hit = { kind: 'building' | 'unit'; ref: string; label: string; sub: string }
const DEPTS = [['maintenance', 'Maintenance'], ['housekeeping', 'Housekeeping'], ['inspection', 'Inspection']] as const
const MODES = [['off', 'Off', 'Nothing happens'], ['suggest', 'Suggest', 'Shows as due — someone books it'], ['auto', 'Create automatically', 'Lighthouse creates the task when it comes due']] as const
const EVERY = [[7, 'Weekly'], [30, 'Monthly'], [90, 'Every 3 months'], [180, 'Every 6 months'], [365, 'Yearly']] as const
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const chip = (on: boolean) => 'h-7 px-2.5 rounded-full border text-[11.5px] font-semibold ' + (on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink/40')

function PeoplePicker({ names, roster, onChange, placeholder }: { names: string[]; roster: string[]; onChange: (n: string[]) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const hits = q.trim() ? roster.filter(n => n.toLowerCase().includes(q.trim().toLowerCase()) && names.indexOf(n) < 0).slice(0, 8) : []
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5 flex-wrap items-center">
        {names.map(n => <span key={n} className="h-7 pl-2.5 pr-1 rounded-full bg-ink text-white text-[11.5px] font-semibold inline-flex items-center gap-1">{n}<button onClick={() => onChange(names.filter(x => x !== n))} className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-white/20" title="Remove"><X size={11} /></button></span>)}
        <label className="flex items-center gap-1.5 h-7 rounded-full border border-line px-2.5"><Plus size={12} className="text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder || 'Add a person'} className="w-[130px] bg-transparent text-[12px] outline-none" /></label>
      </div>
      {hits.length ? <div className="flex gap-1.5 flex-wrap">{hits.map(n => <button key={n} onClick={() => { onChange(names.concat([n])); setQ('') }} className={chip(false)}>{n}</button>)}</div> : null}
    </div>
  )
}

function PlaceSearch({ options, taken, onPick, placeholder }: { options: Opts | null; taken: Set<string>; onPick: (h: Hit) => void; placeholder: string }) {
  const [q, setQ] = useState('')
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n || !options) return [] as Hit[]
    const b = options.buildings.filter(x => x.key.toLowerCase().includes(n) && !taken.has('building:' + x.key.toLowerCase()))
      .slice(0, 6).map(x => ({ kind: 'building' as const, ref: x.key, label: x.key, sub: 'Building · ' + x.units + ' unit' + (x.units === 1 ? '' : 's') }))
    const u = options.units.filter(x => x.name.toLowerCase().includes(n) && !taken.has('unit:' + x.id.toLowerCase()))
      .slice(0, 8).map(x => ({ kind: 'unit' as const, ref: x.id, label: x.name, sub: 'Unit · ' + x.building }))
    return (b as Hit[]).concat(u)
  }, [q, options, taken])
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 h-9 rounded-lg border border-line px-2.5"><Search size={14} className="text-muted" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} className="flex-1 bg-transparent text-[13px] outline-none" /></label>
      {hits.length ? (
        <div className="rounded-xl border border-line divide-y divide-line">
          {hits.map(h => (
            <button key={h.kind + h.ref} onClick={() => { onPick(h); setQ('') }} className="w-full px-3 py-1.5 flex items-center gap-2 text-left hover:bg-slate-50">
              {h.kind === 'unit' ? <Home size={13} className="text-muted" /> : <Building2 size={13} className="text-muted" />}
              <span className="text-[12.5px] font-semibold text-ink">{h.label}</span><span className="text-[11.5px] text-muted">{h.sub}</span>
              <Plus size={13} className="ml-auto text-muted" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function UpkeepProgramEdit({ cadenceKey, onClose, onSaved }: { cadenceKey?: string; onClose: () => void; onSaved: (label: string) => void }) {
  const [cfg, setCfg] = useState<any>(null)
  const [c, setC] = useState<CadenceDef | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const opts = useCachedFetch<{ options: Opts | null }>('/api/upkeep/programs?options=1', { ttl: 5 * 60_000 })
  const roster = useCachedFetch<any>('/api/breezeway/people', { ttl: 10 * 60_000 })
  const options = opts.data?.options || null
  const names: string[] = useMemo(() => {
    const raw: any[] = Array.isArray(roster.data) ? roster.data : roster.data?.people || []
    return Array.from(new Set(raw.map(x => String(x.name || [x.first_name, x.last_name].filter(Boolean).join(' ')).trim()).filter(Boolean))).sort()
  }, [roster.data])
  const unitName = (id: string) => options?.units.find(u => u.id === id)?.name || id

  useEffect(() => {
    let dead = false
    fetch('/api/settings/cadences').then(r => r.json()).then(j => {
      if (dead) return
      if (!j?.ok) { setErr(j?.error || 'Could not load programs'); return }
      setCfg(j.config)
      const found = cadenceKey ? (j.config.cadences as CadenceDef[]).find(x => x.key === cadenceKey) : null
      setC(found ? JSON.parse(JSON.stringify(found)) : {
        key: '', label: '', everyDays: 30, dept: 'maintenance', match: '', needsVacant: false, needsDays: 0, minutes: 30, mode: 'suggest',
        seedIfNever: false, requiresAmenity: '', scopeBuildings: [], scopeUnits: [], needsScope: false, successor: true, leadDays: 14, perBuilding: false, equipment: 'any', team: [], teamBy: [],
      } as CadenceDef)
    }).catch(e => !dead && setErr(String(e?.message || e)))
    return () => { dead = true }
  }, [cadenceKey])

  if (err && !c) return <section className="rounded-2xl border border-line bg-white p-3 text-[12.5px] text-rose-700">{err} <button onClick={onClose} className="ml-2 underline text-ink">Close</button></section>
  if (!c) return <section className="rounded-2xl border border-line bg-white p-6 text-center text-muted"><Loader2 className="inline animate-spin" size={18} /></section>

  const set = (patch: Partial<CadenceDef>) => setC(x => (x ? { ...x, ...patch } : x))
  const isNew = !cadenceKey
  const scopeB = c.scopeBuildings || [], scopeU = c.scopeUnits || []
  const everywhere = !scopeB.length && !scopeU.length
  const rules: TeamRule[] = c.teamBy || []
  const setRule = (i: number, patch: Partial<TeamRule>) => set({ teamBy: rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) })
  const canSave = c.label.trim().length > 1 && c.everyDays >= 1

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const label = c.label.trim()
      let next = { ...c, label }
      if (isNew) {
        const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28) || 'program'
        let key = base, n = 2
        while ((cfg.cadences as CadenceDef[]).some(x => x.key === key)) key = base.slice(0, 26) + '_' + n++
        // What counts as done: a finished task whose name starts with the program's name (which is
        // exactly how Lighthouse names the tasks it creates: "<name> — <unit>").
        next = { ...next, key, match: '^\\s*' + esc(label) }
      }
      next.teamBy = rules.filter(r => r.names.length)
      const cadences = isNew ? cfg.cadences.concat([next]) : cfg.cadences.map((x: CadenceDef) => (x.key === next.key ? next : x))
      const r = await fetch('/api/settings/cadences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { ...cfg, cadences } }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) throw new Error(j?.error || 'Could not save')
      onSaved(label)
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }

  const step = (n: number, t: string) => <div className="text-[12px] font-bold uppercase tracking-wide text-muted">{n} · {t}</div>
  return (
    <section className="rounded-2xl border border-line bg-white">
      <header className="px-3 py-2.5 border-b border-line flex items-center gap-2">
        <div className="flex-1 text-[14px] font-bold text-ink">{isNew ? 'New program' : 'Edit ' + (cadenceKey && cfg?.cadences?.find((x: CadenceDef) => x.key === cadenceKey)?.label)}</div>
        <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-ink" title="Close without saving"><X size={16} /></button>
      </header>
      <div className="p-3 space-y-5">
        <div className="space-y-1.5">
          {step(1, 'Name')}
          <input value={c.label} onChange={e => set({ label: e.target.value })} placeholder="A/C filter change" className="w-full h-9 rounded-lg border border-line px-2.5 text-[13px]" />
          <div className="flex gap-1 flex-wrap">{DEPTS.map(([k, l]) => <button key={k} onClick={() => set({ dept: k })} className={chip(c.dept === k)}>{l}</button>)}</div>
          {!isNew ? <p className="text-[11.5px] text-muted">Tasks are named “{c.label || 'Name'} — unit”.</p> : null}
        </div>

        <div className="space-y-1.5">
          {step(2, 'How often')}
          <div className="flex gap-1 flex-wrap items-center">
            {EVERY.map(([d, l]) => <button key={d} onClick={() => set({ everyDays: d })} className={chip(c.everyDays === d)}>{l}</button>)}
            <span className="text-[12px] text-muted ml-1">or every</span>
            <input type="number" min={1} max={3650} value={c.everyDays} onChange={e => set({ everyDays: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className="w-[72px] h-7 rounded-lg border border-line px-2 text-[12.5px]" />
            <span className="text-[12px] text-muted">days</span>
          </div>
          <button onClick={() => set({ needsVacant: !c.needsVacant, needsDays: !c.needsVacant ? Math.max(1, c.needsDays || 1) : 0 })} className={chip(!!c.needsVacant)}>{c.needsVacant ? '✓ ' : ''}Unit must be empty</button>
        </div>

        <div className="space-y-1.5">
          {step(3, 'When it comes due')}
          <div className="flex gap-1.5 flex-wrap">
            {MODES.map(([k, l, tip]) => <button key={k} onClick={() => set({ mode: k })} title={tip} className={chip(c.mode === k)}>{l}</button>)}
          </div>
          <p className="text-[11.5px] text-muted">{MODES.find(m => m[0] === c.mode)?.[2]}. Never a second copy: a task not finished moves to the next day.</p>
        </div>

        <div className="space-y-2">
          {step(4, 'Where')}
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => set({ scopeBuildings: [], scopeUnits: [] })} className={chip(everywhere)}>Every unit</button>
            <span className={chip(!everywhere) + ' inline-flex items-center'}>Only these buildings / units</span>
          </div>
          <PlaceSearch options={options} placeholder="Add a building or unit — type Eden, Capri 109…"
            taken={new Set(scopeB.map(b => 'building:' + b.toLowerCase()).concat(scopeU.map(u => 'unit:' + u.toLowerCase())))}
            onPick={h => h.kind === 'building' ? set({ scopeBuildings: scopeB.concat([h.ref]) }) : set({ scopeUnits: scopeU.concat([h.ref]) })} />
          {!everywhere ? (
            <div className="flex gap-1.5 flex-wrap">
              {scopeB.map(b => <span key={'b' + b} className="h-7 pl-2 pr-1 rounded-full border border-line text-[11.5px] font-semibold inline-flex items-center gap-1"><Building2 size={11} />{b}<button onClick={() => set({ scopeBuildings: scopeB.filter(x => x !== b) })} className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-slate-100"><X size={11} /></button></span>)}
              {scopeU.map(u => <span key={'u' + u} className="h-7 pl-2 pr-1 rounded-full border border-line text-[11.5px] font-semibold inline-flex items-center gap-1"><Home size={11} />{unitName(u)}<button onClick={() => set({ scopeUnits: scopeU.filter(x => x !== u) })} className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-slate-100"><X size={11} /></button></span>)}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          {step(5, 'Who gets it')}
          <div className="text-[12px] text-ink font-semibold inline-flex items-center gap-1"><Users size={13} /> Team for every unit</div>
          <PeoplePicker names={c.team || []} roster={names} onChange={n => set({ team: n })} />
          {!(c.team || []).length ? <p className="text-[11.5px] text-muted">No team: whoever of the trade is already going there, else the area supervisor.</p> : null}
          <div className="pt-2 text-[12px] text-ink font-semibold">Different team for a building or unit</div>
          <PlaceSearch options={options} placeholder="Pick a building or unit to give it its own team"
            taken={new Set(rules.map(r => r.kind + ':' + r.ref.toLowerCase()))}
            onPick={h => set({ teamBy: rules.concat([{ kind: h.kind, ref: h.ref, label: h.label, names: [] }]) })} />
          <ul className="space-y-2">
            {rules.map((r, i) => (
              <li key={r.kind + r.ref} className="rounded-xl border border-line p-2.5 space-y-1.5">
                <div className="flex items-center gap-2 text-[12.5px]">
                  {r.kind === 'unit' ? <Home size={13} className="text-muted" /> : <Building2 size={13} className="text-muted" />}
                  <span className="font-semibold text-ink flex-1">{r.label}</span>
                  <button onClick={() => set({ teamBy: rules.filter((_, k) => k !== i) })} className="text-muted hover:text-rose-700" title="Remove — back to the default team"><Trash2 size={13} /></button>
                </div>
                <PeoplePicker names={r.names} roster={names} onChange={n => setRule(i, { names: n })} placeholder={'Add to ' + r.label} />
              </li>
            ))}
          </ul>
          {rules.length ? <p className="text-[11.5px] text-muted">A unit’s own team wins, then its building’s, then the team for every unit.</p> : null}
        </div>

        {err ? <p className="text-[12.5px] text-rose-700">{err}</p> : null}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button onClick={save} disabled={!canSave || busy} className="h-9 px-4 rounded-lg bg-ink text-white text-[13px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save program</button>
          <button onClick={onClose} className="h-9 px-3 rounded-lg border border-line bg-white text-[13px] font-semibold text-ink">Cancel</button>
          <span className="text-[11.5px] text-muted ml-auto">Fine settings (equipment, billing, approvers) stay in Settings → Cadences.</span>
        </div>
      </div>
    </section>
  )
}
