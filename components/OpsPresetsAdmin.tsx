'use client'
// Admin console — OPS PRESETS. The operating rules that used to be hardcoded across the app:
// which buildings a vendor cleans, the cleaner roster and staffing ratios, and the timing rules
// (4pm deadline, at-risk warning, audit cadence, clean-time benchmarks).
//
// Owner-only: these change what the whole team's scheduler and ops board do. Everything falls back
// to the shipped defaults, so an empty/partial settings row behaves exactly like the old code.
import { useEffect, useMemo, useState } from 'react'
import {
  Building2, Users, Timer, Loader2, Check, AlertTriangle, Save, Plus, Trash2, RotateCcw, Info,
} from 'lucide-react'
import { DEFAULT_PRESETS, mergePresets, type OpsPresets, type VendorBuilding } from '@/lib/ops-presets'
import { clearOpsPresetsCache } from '@/lib/useOpsPresets'

const MARKETS = ['Miami', 'Broward', 'North']

const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const hhmmToMin = (s: string) => { const [h, m] = String(s || '').split(':').map(Number); return (isFinite(h) ? h : 16) * 60 + (isFinite(m) ? m : 0) }
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'building'

export function OpsPresetsAdmin({ isOwner }: { isOwner: boolean }) {
  const [p, setP] = useState<OpsPresets>(DEFAULT_PRESETS)
  const [saved, setSaved] = useState<string>('')       // JSON of last-loaded/saved state
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [open, setOpen] = useState<'clean' | 'roster' | 'timing'>('clean')

  useEffect(() => {
    fetch('/api/settings/ops', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const m = mergePresets(j?.presets)
      setP(m); setSaved(JSON.stringify(m)); setLoaded(true)
    }).catch(() => { setP(DEFAULT_PRESETS); setSaved(JSON.stringify(DEFAULT_PRESETS)); setLoaded(true) })
  }, [])

  const dirty = useMemo(() => loaded && JSON.stringify(p) !== saved, [p, saved, loaded])
  const edit = (fn: (d: OpsPresets) => void) => setP(prev => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next })

  async function save() {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await fetch('/api/settings/ops', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presets: p }) })
      const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Could not save.')
      const m = mergePresets(j?.presets)
      setP(m); setSaved(JSON.stringify(m))
      clearOpsPresetsCache()
      setMsg('Saved. The scheduler, forecast and ops board pick this up within a minute.')
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  const TABS: { k: typeof open; label: string; Icon: any }[] = [
    { k: 'clean', label: 'Cleaning', Icon: Building2 },
    { k: 'roster', label: 'Roster & staffing', Icon: Users },
    { k: 'timing', label: 'Timing rules', Icon: Timer },
  ]

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
        <Building2 size={15} className="text-brand-600" />
        <span className="text-sm font-bold text-ink">Ops presets</span>
        {dirty && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Unsaved</span>}
        <button onClick={save} disabled={!isOwner || busy || !dirty}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save presets
        </button>
      </div>

      <div className="p-4 space-y-4">
        {!isOwner && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> These rules change how the whole team&apos;s scheduler works, so only the owner can edit them. You can look, but Save is off.
          </div>
        )}
        {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}
        {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {msg}</div>}

        <div className="flex flex-wrap gap-1.5">
          {TABS.map(({ k, label, Icon }) => (
            <button key={k} onClick={() => setOpen(k)}
              className={`inline-flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg border font-semibold transition-colors ${open === k ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-line text-muted hover:border-brand-300'}`}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        {open === 'clean' && <CleaningSection p={p} edit={edit} isOwner={isOwner} />}
        {open === 'roster' && <RosterSection p={p} edit={edit} isOwner={isOwner} />}
        {open === 'timing' && <TimingSection p={p} edit={edit} isOwner={isOwner} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ cleaning

function CleaningSection({ p, edit, isOwner }: { p: OpsPresets; edit: (fn: (d: OpsPresets) => void) => void; isOwner: boolean }) {
  const [newName, setNewName] = useState('')
  const list = p.vendorBuildings

  const addBuilding = () => {
    const label = newName.trim(); if (!label) return
    edit(d => { d.vendorBuildings.push({ id: slug(label) + '-' + Math.random().toString(36).slice(2, 6), label, terms: [label.toLowerCase()], enabled: true }) })
    setNewName('')
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted">
        Buildings an outside vendor cleans. Switch one to <b>In house</b> and its cleans start counting toward your cleaner demand,
        its cleaning fees come back into revenue, and it moves out of the &quot;Vendor&quot; column into its real market.
      </p>

      <div className="space-y-2">
        {list.length === 0 && <p className="text-[12px] text-muted">No vendor buildings — every clean counts as ours.</p>}
        {list.map((v, i) => (
          <div key={v.id} className={`rounded-xl border p-3 ${v.enabled ? 'border-line bg-app/40' : 'border-emerald-200 bg-emerald-50/40'}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-lg border border-line overflow-hidden">
                <button disabled={!isOwner} onClick={() => edit(d => { d.vendorBuildings[i].enabled = true })}
                  className={`text-[11px] px-2.5 py-1 font-semibold transition-colors disabled:cursor-not-allowed ${v.enabled ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:bg-app'}`}>Vendor</button>
                <button disabled={!isOwner} onClick={() => edit(d => { d.vendorBuildings[i].enabled = false })}
                  className={`text-[11px] px-2.5 py-1 font-semibold transition-colors disabled:cursor-not-allowed ${!v.enabled ? 'bg-emerald-600 text-white' : 'bg-white text-muted hover:bg-app'}`}>In house</button>
              </div>
              <input value={v.label} disabled={!isOwner} onChange={e => { const val = e.target.value; edit(d => { d.vendorBuildings[i].label = val }) }}
                className="text-[13px] font-semibold text-ink rounded-lg border border-line bg-white px-2.5 py-1 w-44 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
              <label className={`inline-flex items-center gap-1.5 text-[11px] ${v.enabled ? 'text-muted' : 'text-muted/40'}`}>
                <input type="checkbox" checked={!!v.untracked} disabled={!isOwner || !v.enabled}
                  onChange={e => { const c = e.target.checked; edit(d => { d.vendorBuildings[i].untracked = c }) }} />
                Doesn&apos;t close Breezeway tasks
              </label>
              <label className={`inline-flex items-center gap-1.5 text-[11px] ${v.enabled ? 'text-muted' : 'text-muted/40'}`} title="The building is not in Breezeway at all. Its checkouts are read straight from Guesty and the boards offer no Breezeway actions on them.">
                <input type="checkbox" checked={!!v.noBreezeway} disabled={!isOwner || !v.enabled}
                  onChange={e => { const c2 = e.target.checked; edit(d => { d.vendorBuildings[i].noBreezeway = c2 }) }} />
                Not in Breezeway at all
              </label>
              <button disabled={!isOwner} onClick={() => edit(d => { d.vendorBuildings.splice(i, 1) })}
                className="ml-auto text-rose-500 hover:text-rose-700 disabled:opacity-30" title="Remove"><Trash2 size={14} /></button>
            </div>
            <div className="mt-1.5 text-[11px] text-muted">
              Matches units containing: <code className="text-[10px]">{[...(v.terms || []), ...(v.wordTerms || []).map(w => `${w} (whole word)`)].join(', ') || '—'}</code>
              {v.untracked && v.enabled ? ' · no 4pm deadline or at-risk alarm' : ''}
              {v.noBreezeway && v.enabled ? ' · Guesty-only: checkouts come from Guesty, no Breezeway task' : ''}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-muted mb-0.5">Add a vendor-cleaned building</label>
          <input value={newName} disabled={!isOwner} onChange={e => setNewName(e.target.value)} placeholder="Building name"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBuilding() } }}
            className="text-[12px] rounded-lg border border-line bg-white px-2.5 py-1.5 w-56 focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </div>
        <button disabled={!isOwner || !newName.trim()} onClick={addBuilding}
          className="inline-flex items-center gap-1 rounded-lg border border-brand-300 bg-white text-brand-700 px-2.5 py-1.5 text-[12px] font-semibold hover:bg-brand-50 disabled:opacity-40"><Plus size={13} /> Add</button>
      </div>
      <p className="text-[11px] text-muted flex items-start gap-1.5"><Info size={12} className="mt-0.5 flex-shrink-0" />
        The name is matched against the unit and building name, so &quot;Botanica&quot; covers every Botanica unit.</p>
    </div>
  )
}

// ------------------------------------------------------------------ roster

function RosterSection({ p, edit, isOwner }: { p: OpsPresets; edit: (fn: (d: OpsPresets) => void) => void; isOwner: boolean }) {
  const [add, setAdd] = useState<Record<string, string>>({})
  const r = p.roster

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted">
        The default roster the weekly planner seeds from, and how many cleans one cleaner covers in a day.
        A saved week keeps whatever you set on it — this is the starting point for new weeks.
      </p>

      <div className="grid gap-3 lg:grid-cols-3">
        {MARKETS.map(mk => {
          const team = r.teams[mk] || []
          return (
            <div key={mk} className="rounded-xl border border-line bg-app/40 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[12px] font-bold text-ink">{mk}</span>
                <label className="ml-auto text-[11px] text-muted inline-flex items-center gap-1">
                  <input type="number" min={1} max={20} value={r.rate[mk] ?? 4} disabled={!isOwner}
                    onChange={e => { const n = Number(e.target.value) || 0; edit(d => { d.roster.rate[mk] = n }) }}
                    className="w-14 text-[12px] rounded border border-line bg-white px-1.5 py-0.5 text-right" />
                  cleans / cleaner / day
                </label>
              </div>
              <div className="flex flex-wrap gap-1">
                {team.length === 0 && <span className="text-[11px] text-muted">No one yet.</span>}
                {team.map(m => (
                  <span key={m} className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md border ${r.nonCleaners[m] ? 'bg-white border-line text-muted' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                    {m}{r.nonCleaners[m] ? <span className="text-muted/70">· {r.nonCleaners[m]}</span> : null}
                    <button disabled={!isOwner} onClick={() => edit(d => { d.roster.teams[mk] = (d.roster.teams[mk] || []).filter(x => x !== m) })}
                      className="text-muted hover:text-rose-600 disabled:opacity-30">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1 mt-2">
                <input value={add[mk] || ''} disabled={!isOwner} placeholder="Add name"
                  onChange={e => setAdd(a => ({ ...a, [mk]: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    const n = (add[mk] || '').trim(); if (!n) return
                    edit(d => { d.roster.teams[mk] = [...(d.roster.teams[mk] || []), n] })
                    setAdd(a => ({ ...a, [mk]: '' }))
                  }}
                  className="flex-1 text-[11px] rounded border border-line bg-white px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-line bg-app/40 p-3">
        <div className="text-[12px] font-bold text-ink mb-1.5">Not counted as cleaners</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {Object.entries(r.nonCleaners).map(([name, role]) => (
            <span key={name} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-line bg-white">
              <b className="font-semibold text-ink">{name}</b>
              <input value={role} disabled={!isOwner} onChange={e => { const v = e.target.value; edit(d => { d.roster.nonCleaners[name] = v }) }}
                className="w-24 text-[11px] rounded border border-line bg-app px-1.5 py-0.5" />
              <button disabled={!isOwner} onClick={() => edit(d => { delete d.roster.nonCleaners[name] })}
                className="text-muted hover:text-rose-600 disabled:opacity-30">×</button>
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted">Supervisors, ops and handymen stay on the roster but don&apos;t count toward cleaners needed.</p>
      </div>

      <label className="inline-flex items-center gap-2 text-[12px] text-ink">
        <span className="font-semibold">Growth buffer</span>
        <input type="number" min={0} max={100} value={r.growth} disabled={!isOwner}
          onChange={e => { const n = Number(e.target.value) || 0; edit(d => { d.roster.growth = n }) }}
          className="w-16 text-[12px] rounded border border-line bg-white px-2 py-1 text-right" />
        <span className="text-muted">% added on top of projected cleaner need</span>
      </label>
    </div>
  )
}

// ------------------------------------------------------------------ timing

function TimingSection({ p, edit, isOwner }: { p: OpsPresets; edit: (fn: (d: OpsPresets) => void) => void; isOwner: boolean }) {
  const t = p.timing
  const num = (v: number, on: (n: number) => void, min = 0, max = 100000, w = 'w-16') => (
    <input type="number" min={min} max={max} value={v} disabled={!isOwner}
      onChange={e => on(Number(e.target.value) || 0)}
      className={`${w} text-[12px] rounded border border-line bg-white px-2 py-1 text-right disabled:opacity-60`} />
  )

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-app/40 p-3 space-y-2">
        <div className="text-[12px] font-bold text-ink">Departure cleans</div>
        <label className="flex items-center gap-2 text-[12px] text-ink flex-wrap">
          <span className="font-semibold w-40">Must be clean by</span>
          <input type="time" value={minToHHMM(t.deadlineMin)} disabled={!isOwner}
            onChange={e => { const m = hhmmToMin(e.target.value); edit(d => { d.timing.deadlineMin = m }) }}
            className="text-[12px] rounded border border-line bg-white px-2 py-1 disabled:opacity-60" />
          <span className="text-muted">ET — when the next guest can check in</span>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink flex-wrap">
          <span className="font-semibold w-40">Flag &quot;at risk&quot; under</span>
          {num(Math.round(t.atRiskMin / 60 * 10) / 10, n => edit(d => { d.timing.atRiskMin = Math.round(n * 60) }), 0, 24)}
          <span className="text-muted">hours left, if the clean hasn&apos;t started</span>
        </label>
      </div>

      <div className="rounded-xl border border-line bg-app/40 p-3 space-y-2">
        <div className="text-[12px] font-bold text-ink">Clean-time benchmarks</div>
        <p className="text-[11px] text-muted">Minutes a clean should take. Over benchmark shows amber on the schedule. Visibility only — this is duration, not labour cost.</p>
        <div className="flex flex-wrap gap-3">
          {([['Studio / 1BR', 'studio'], ['2BR', 'two'], ['3BR+', 'threePlus'], ['Unknown', 'unknown']] as const).map(([lab, k]) => (
            <label key={k} className="inline-flex items-center gap-1.5 text-[12px] text-ink">
              <span className="text-muted">{lab}</span>
              {num(t.cleanMinutes[k], n => edit(d => { d.timing.cleanMinutes[k] = n }), 0, 600)}
              <span className="text-muted">min</span>
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-app/40 p-3">
        <label className="flex items-center gap-2 text-[12px] text-ink flex-wrap">
          <span className="font-semibold w-40">Audit every unit every</span>
          {num(t.auditDueDays, n => edit(d => { d.timing.auditDueDays = n }), 1, 3650, 'w-20')}
          <span className="text-muted">days — drives the &quot;audits due&quot; list</span>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink flex-wrap mt-2">
          <span className="font-semibold w-40">Long stay is</span>
          {num(t.longStayNights, n => edit(d => { d.timing.longStayNights = n }), 2, 365, 'w-20')}
          <span className="text-muted">nights or more — flags the departure clean (more mess) and the arrival (bigger booking, make sure it is ready)</span>
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink flex-wrap mt-2">
          <span className="font-semibold w-40">Same area within</span>
          {num(t.areaRadiusKm, n => edit(d => { d.timing.areaRadiusKm = n }), 1, 40, 'w-20')}
          <span className="text-muted">km — buildings this close are one run in &quot;By area&quot; (Oasis↔Rustic is 1.8km, Hendricks↔Oasis 3.5km)</span>
        </label>
      </div>

      <button disabled={!isOwner} onClick={() => edit(d => { d.timing = JSON.parse(JSON.stringify(DEFAULT_PRESETS.timing)) })}
        className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-brand-700 disabled:opacity-40">
        <RotateCcw size={12} /> Reset timing to defaults
      </button>
    </div>
  )
}
