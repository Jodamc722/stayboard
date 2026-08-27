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
  mode: 'off' | 'suggest' | 'auto'; seedIfNever: boolean
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
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [preview, setPreview] = useState<any | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/cadences', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && j.config) { setCfg(j.config); setSaved(JSON.stringify(j.config)) }
    } catch { /* stays empty; a reload retries */ }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (patch: Partial<Cfg>) => setCfg(c => (c ? { ...c, ...patch } : c))
  const setCad = (key: string, patch: Partial<Cad>) =>
    setCfg(c => (c ? { ...c, cadences: c.cadences.map(x => (x.key === key ? { ...x, ...patch } : x)) } : c))
  const dirty = cfg ? JSON.stringify(cfg) !== saved : false

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
              <span className="font-semibold text-ink">Only where somebody is already working</span>{' '}
              <span className="text-muted">
                — a filter change in a building a tech is standing in is twenty minutes; the same job across
                the county is a two-hour round trip that does not happen. Past {cfg.escapeAfterDays || '—'} days
                overdue it is proposed anyway, because &ldquo;nobody is ever near it&rdquo; cannot mean &ldquo;never&rdquo;.
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
