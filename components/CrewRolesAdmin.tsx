'use client'
// Admin console — CREW & ROLES. Who is on which crew, and therefore whose wages land in which margin.
//
// This is the setting the labor numbers have always run on (app_settings 'crew_roles') and it had
// no UI until 2026-08-21 — you had to edit the row in Supabase by hand. Without it the app guessed,
// and its last-resort guess was "whatever this person did in Breezeway that week", which is how a
// maintenance tech's wages ended up inside the cost per clean.
//
// The design follows from Jon's rule (2026-08-21): Homebase and departure cleans calculate,
// Breezeway paints the story. So the Homebase hours and payroll are the spine of each row, the
// Breezeway task mix sits beside it clearly labelled as context, and PEOPLE NOBODY HAS PLACED ARE
// SORTED TO THE TOP with the payroll they represent — a visible gap beats a quiet guess.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Users2, Loader2, Save, Check, AlertTriangle, RotateCcw, Search, Wand2 } from 'lucide-react'

// HOMEBASE'S ROLE TEXT CARRIES THREE FACTS AT ONCE (Jon, 2026-08-24: "In Homebase you should be
// able to see the roles, the agency in the role section. So HK might be HK Atlantic which would
// be the agency"). "Housekeeper Miami (Atlantic)" = role Housekeeper, market Miami, agency
// Atlantic. This parses all three, so one click can pre-fill every blank — the audit made
// actionable. Order matters: "Supervisor Maintenance …" is a maintenance lead (maintenance),
// while "Housekeeper Supervisor" is a supervisor.
function parseHomebaseRole(txt: string | null | undefined): { role?: string; agency?: string; area?: string } {
  const s = String(txt || '').toLowerCase()
  if (!s) return {}
  const out: { role?: string; agency?: string; area?: string } = {}
  if (/atlantic/.test(s)) out.agency = 'atlantic'
  else if (/city\s*best/.test(s)) out.agency = 'citybest'
  else if (/opal/.test(s)) out.agency = 'opal'
  if (/miami/.test(s)) out.area = 'miami'
  else if (/broward/.test(s)) out.area = 'broward'
  else if (/north/.test(s)) out.area = 'north'
  if (/maint|handy|tech/.test(s)) out.role = 'Maintenance'
  else if (/\bccs\b.*manager|manager.*\bccs\b/.test(s)) out.role = 'CCS Manager'
  else if (/coordinat|\bccs\b/.test(s)) out.role = 'Field Coordinator'
  else if (/supervis|lead/.test(s)) out.role = 'Supervisor'
  else if (/inspect/.test(s)) out.role = 'Inspector'
  else if (/housekeep|\bhk\b/.test(s)) out.role = 'Housekeeper'
  else if (/front|desk/.test(s)) out.role = 'Front desk'
  return out
}

type Tasks = { total: number; cleans: number; maintenance: number; inspection: number; other: number }
type Person = {
  name: string; dept: string; source: string; sourceLabel: string; editable: boolean
  hours: number; payroll: number | null
  homebaseRole: string | null; staffRole: string | null
  agency: string | null; area: string | null
  // Pay rides the same record as the crew (migration 057) — one row per person, one place to edit.
  title?: string | null
  salaried?: boolean
  salaryHourly?: number | null
  salaryHoursPerWeek?: number | null
  salaryAnnual?: number | null
  tasks: Tasks
}
type Opt = { key: string; label: string }
type Data = {
  people: Person[]
  depts: { key: string; label: string }[]
  counts: Record<string, number>
  agencies: Opt[]
  areas: Opt[]
  gap: { people: number; hours: number; payroll: number | null }
  outside: { people: number; names: string[]; tasks: number }
  from: string; to: string; days: number
  payrollComplete: boolean
  /** false = migration 057 not applied, so crew and pay cannot persist to the staff row yet. */
  singleSource?: boolean
}

const money = (n: number | null | undefined) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'))
// A guess and a stated fact should never look the same on screen.
const SOURCE_TONE: Record<string, string> = {
  override: 'bg-brand-50 text-brand-700 border-brand-200',
  declared: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  staff: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  homebase: 'bg-app text-muted border-line',
  inferred: 'bg-amber-50 text-amber-700 border-amber-200',
  unrostered: 'bg-rose-50 text-rose-700 border-rose-200',
}

export function CrewRolesAdmin({ isOwner }: { isOwner: boolean }) {
  const [d, setD] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  type StaffEdit = {
    agency?: string; area?: string; role?: string; title?: string
    salaried?: boolean; salaryHourly?: string; salaryHoursPerWeek?: string; salaryAnnual?: string
  }
  const [staffEdits, setStaffEdits] = useState<Record<string, StaffEdit>>({})
  const [consolidating, setConsolidating] = useState(false)
  const [q, setQ] = useState('')
  const [onlyGaps, setOnlyGaps] = useState(false)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    fetch('/api/settings/crew-roles?days=30', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (j?.ok) { setD(j); setEdits({}); setStaffEdits({}) } else setErr(j?.error || 'Could not load the roster.') })
      .catch(e => setErr(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const deptOf = (p: Person) => (p.name in edits ? edits[p.name] : p.dept)
  const agencyOf = (p: Person) => (staffEdits[p.name]?.agency ?? (p.agency || ''))
  const areaOf = (p: Person) => (staffEdits[p.name]?.area ?? (p.area || ''))
  const roleOf = (p: Person) => (staffEdits[p.name]?.role ?? (p.staffRole || ''))
  const setStaff = (name: string, patch: StaffEdit) =>
    setStaffEdits(s => ({ ...s, [name]: { ...s[name], ...patch } }))
  const salariedOf = (p: Person) => (staffEdits[p.name]?.salaried ?? !!p.salaried)
  const payOf = (p: Person, k: 'salaryHourly' | 'salaryHoursPerWeek' | 'salaryAnnual') => {
    const pend = staffEdits[p.name]?.[k]
    if (pend !== undefined) return pend
    const v = p[k]
    return v == null ? '' : String(v)
  }
  // What this person costs a week on the rate as stated — the same arithmetic lib/salary uses,
  // shown live while you type so a typo is obvious before it reaches a margin.
  const weeklyOf = (p: Person): number | null => {
    const h = Number(payOf(p, 'salaryHourly')), hw = Number(payOf(p, 'salaryHoursPerWeek')) || 40
    if (Number.isFinite(h) && h > 0) return Math.round(h * hw * 100) / 100
    const a = Number(payOf(p, 'salaryAnnual'))
    if (Number.isFinite(a) && a > 0) return Math.round((a / 52) * 100) / 100
    return null
  }

  async function consolidate() {
    setConsolidating(true); setErr(null); setMsg(null)
    try {
      const r = await fetch('/api/settings/crew-roles', { method: 'POST' })
      const j = await r.json()
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Could not consolidate.')
      setMsg(`${j.written} ${j.written === 1 ? 'person now states their crew' : 'people now state their crew'} on their own record; ${j.skipped} already did or are still unplaced. Nobody changed crews.`)
      load()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setConsolidating(false) }
  }
  const dirty = Object.keys(edits).length > 0 || Object.keys(staffEdits).length > 0

  const rows = useMemo(() => {
    if (!d) return []
    const needle = q.trim().toLowerCase()
    return d.people.filter(p => {
      if (onlyGaps && !(p.source === 'unrostered' || p.source === 'inferred')) return false
      if (needle && !p.name.toLowerCase().includes(needle)) return false
      return true
    })
  }, [d, q, onlyGaps])

  async function save() {
    if (!dirty) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const r = await fetch('/api/settings/crew-roles', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: edits, staff: staffEdits }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Failed to save.')
      const bits = [
        j.set ? `${j.set} placed on a crew` : '',
        j.cleared ? `${j.cleared} handed back to the roster` : '',
        j.staffSaved ? `${j.staffSaved} employment/market change${j.staffSaved === 1 ? '' : 's'}` : '',
      ].filter(Boolean)
      if (Array.isArray(j.staffErrors) && j.staffErrors.length) setErr(`Some rows did not save — ${j.staffErrors.join('; ')}`)
      else if (j.migrationPending) setErr('Crew and pay could not be written to the staff record — migration 057 has not been applied. The crew is still held in settings, so nothing was lost, but this page is not yet the single source.')
      setMsg(`Saved${bits.length ? ' — ' + bits.join(', ') : ''}. Every labor number recalculates from here.`)
      load()
    } catch (e: any) { setErr(e.message || String(e)) } finally { setSaving(false) }
  }

  if (loading && !d) return <div className="text-sm text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Reading Homebase and the roster…</div>

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <p className="text-[12px] text-muted max-w-[66ch]">
          Which crew a person is on decides which margin their wages land in. It is a fact about employment,
          so it is <b className="text-ink">stated here</b>, never inferred from last week&apos;s task list.
          Hours and payroll are Homebase; the task mix beside them is Breezeway, shown as context only.
          Crew, role, market, agency and pay all live on <b className="text-ink">one record per person</b> — this one.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {d && d.singleSource === false && (
            <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
              Migration 057 not applied
            </span>
          )}
          {d && d.singleSource !== false && (
            <button
              onClick={consolidate}
              disabled={consolidating}
              title="Write every person's current crew onto their own record. Nobody changes crews — the answer they already have stops being re-derived from five places and becomes a stated fact."
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:bg-app disabled:opacity-60">
              {consolidating ? <Loader2 size={13} className="animate-spin" /> : <Users2 size={13} />} Pull everyone onto one record
            </button>
          )}
          {dirty && <span className="text-[11.5px] font-semibold text-amber-700">{new Set([...Object.keys(edits), ...Object.keys(staffEdits)]).size} unsaved</span>}
          <button
            onClick={() => {
              // Fill BLANKS ONLY from Homebase's own role text — never overwrite a stated fact.
              // Everything lands as pending edits (highlighted below) for review before Save.
              if (!d) return
              let filled = 0
              for (const p of d.people) {
                const hint = parseHomebaseRole(p.homebaseRole)
                const patch: { role?: string; agency?: string; area?: string } = {}
                if (!roleOf(p) && hint.role) patch.role = hint.role
                if (!agencyOf(p) && hint.agency) patch.agency = hint.agency
                if (!areaOf(p) && hint.area) patch.area = hint.area
                if (Object.keys(patch).length) { setStaff(p.name, patch); filled++ }
              }
              setMsg(filled
                ? `${filled} people pre-filled from Homebase role text ("HK Atlantic" → Housekeeper + Atlantic). Review the highlighted picks, then Save.`
                : 'Nothing to fill — every blank either has no Homebase role text or is already set.')
            }}
            disabled={!isOwner}
            title='Parse Homebase role text like "Housekeeper Miami (Atlantic)" into Role + Market + Agency for anyone not yet set'
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 text-brand-700 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-brand-100 disabled:opacity-40">
            <Wand2 size={13} /> Fill from Homebase
          </button>
          <button onClick={save} disabled={!isOwner || saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
          </button>
        </div>
      </div>

      {!isOwner && <Note tone="warn">This decides whose wages land in which margin, so only an owner can change it. You can read everything here.</Note>}
      {err && <Note tone="bad">{err}</Note>}
      {msg && <Note tone="good">{msg}</Note>}
      {d && !d.payrollComplete && <Note tone="warn">Homebase did not return every week in this window, so the hours and payroll below are understated. The crew assignments are still correct.</Note>}

      {d && d.gap.people > 0 && (
        <Note tone="bad">
          <span>
            <b>{d.gap.people} {d.gap.people === 1 ? 'person is' : 'people are'} on payroll with no crew stated</b> — {d.gap.hours.toLocaleString()}h
            {d.gap.payroll != null && <> and {money(d.gap.payroll)} of wages</>} sitting in Other instead of a margin.
            They are at the top of the list. Set them and every labor number sharpens.
          </span>
        </Note>
      )}

      {d && d.outside.people > 0 && (
        <Note tone="warn">
          <span>
            <b>{d.outside.people} names did {d.outside.tasks} tasks in Breezeway but never clocked a Homebase hour</b> — vendor
            and outside cleaners. They cost us no payroll, so they belong in Other: placing one on a crew would add
            its cleans to that crew&apos;s denominator with no wages behind them and quietly make every clean look cheaper.
            They are at the bottom of the list; leave them unless one of them is actually ours.
          </span>
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a person…"
            className="w-full rounded-xl border border-line bg-white pl-9 pr-3 py-1.5 text-[13px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </div>
        <button onClick={() => setOnlyGaps(v => !v)}
          className={`text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg border ${onlyGaps ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:text-ink'}`}>
          Only the ones nobody has placed
        </button>
        {d && <span className="text-[11.5px] text-muted">
          {d.depts.map(x => `${d.counts[x.key] || 0} ${x.label.toLowerCase()}`).join(' · ')} · last {d.days} days
        </span>}
      </div>

      <div className="rounded-xl border border-line bg-white overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[980px]">
          <thead>
            <tr className="border-b border-line text-left">
              {['Person', 'Crew', 'Role', 'Agency / W2', 'Market', 'Pay', 'Hours', 'Payroll', 'Breezeway (context only)'].map((h, i) => (
                <th key={i} className={`px-2.5 py-2 text-[10px] uppercase tracking-[0.09em] font-semibold text-muted whitespace-nowrap ${i === 6 || i === 7 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">Nobody matches that.</td></tr>}
            {/* GROUPED BY DEPARTMENT (Jon, 2026-08-24: "make sure we separate the departments in
                Maintenance, Housekeeping, and Supervisors"). A row moves to its new section the
                moment you change its Crew — before saving — so the separation is always live. */}
            {([
              ['housekeeping', 'Housekeeping'], ['supervision', 'Supervisors'], ['ccs', 'CCS team'],
              ['maintenance', 'Maintenance'], ['inspection', 'Inspection'], ['other', 'Other / not placed'],
            ] as [string, string][]).map(([gk, gl]) => {
              const grp = rows.filter(p => deptOf(p) === gk)
              if (!grp.length) return null
              return (
                <Fragment key={gk}>
                  <tr className="bg-app/80 border-y border-line">
                    <td colSpan={8} className="px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] font-bold text-ink">{gl} <span className="text-muted font-semibold">· {grp.length}</span></td>
                  </tr>
                  {grp.map(p => {
              const cur = deptOf(p)
              const changed = p.name in edits && edits[p.name] !== p.dept
              return (
                <tr key={p.name} className={`border-b border-line/60 last:border-b-0 ${changed ? 'bg-brand-50/40' : ''}`}>
                  <td className="px-2.5 py-2 font-semibold text-ink whitespace-nowrap">{p.name}</td>
                  <td className="px-2.5 py-2 align-top">
                    <select
                      value={cur} disabled={!isOwner}
                      onChange={e => setEdits(s => ({ ...s, [p.name]: e.target.value }))}
                      className="rounded-lg border border-line bg-white px-2 py-1 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60">
                      {(d?.depts || []).map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                    {/* Provenance stays — it is how you tell a stated fact from a guess — but it is a
                        footnote under the answer now rather than a column of its own. */}
                    <div className="mt-1 whitespace-nowrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${SOURCE_TONE[p.source] || SOURCE_TONE.homebase}`}>{p.sourceLabel}</span>
                      {p.source === 'override' && isOwner && (
                        <button onClick={() => setEdits(s => ({ ...s, [p.name]: '' }))} title="Clear this override and hand them back to the roster"
                          className="ml-1 text-muted hover:text-ink align-middle"><RotateCcw size={10} /></button>
                      )}
                    </div>
                  </td>
                  <td className="px-2.5 py-2 align-top">
                    <select
                      value={roleOf(p)} disabled={!isOwner}
                      onChange={e => setStaff(p.name, { role: e.target.value })}
                      title="The job we call them — with Market, this is what the loaded-cost assumptions below break down by."
                      className={`rounded-lg border bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60 ${staffEdits[p.name]?.role !== undefined ? 'border-brand-300 text-brand-700 font-semibold' : roleOf(p) ? 'border-line text-ink' : 'border-amber-300 text-amber-700'}`}>
                      {['', 'Housekeeper', 'Maintenance', 'Handyman', 'Supervisor', 'Field Coordinator', 'CCS Manager', 'Operations Manager', 'Inspector', 'Front desk', 'Office'].map(r => (
                        <option key={r} value={r}>{r || 'Not set'}</option>
                      ))}
                    </select>
                    {!roleOf(p) && p.homebaseRole && <div className="mt-1 text-[10px] text-muted whitespace-nowrap" title="What Homebase's free-text role says — pick the real one above">HB: {p.homebaseRole}</div>}
                  </td>
                  <td className="px-2.5 py-2 align-top">
                    <select
                      value={agencyOf(p)} disabled={!isOwner}
                      onChange={e => setStaff(p.name, { agency: e.target.value })}
                      title="W2 means they are on our payroll directly. An agency here is what the invoice and its fees hang off."
                      className={`rounded-lg border bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60 ${staffEdits[p.name]?.agency !== undefined ? 'border-brand-300 text-brand-700 font-semibold' : 'border-line text-ink'}`}>
                      {(d?.agencies || []).map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2.5 py-2 align-top">
                    <select
                      value={areaOf(p)} disabled={!isOwner}
                      onChange={e => setStaff(p.name, { area: e.target.value })}
                      title="Which market their payroll counts against. Blank leaves them out of every market tab. Vendor is its own bucket, never part of Miami or Broward."
                      className={`rounded-lg border bg-white px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60 ${!areaOf(p) ? 'border-amber-300 text-amber-700' : staffEdits[p.name]?.area !== undefined ? 'border-brand-300 text-brand-700 font-semibold' : 'border-line text-ink'}`}>
                      {(d?.areas || []).map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                  </td>
                  {/* PAY — on the same record as the crew (Jon, 2026-08-26: one source of data).
                      Salaried means the salary IS the cost: Homebase punches stay visible in the
                      two columns to the right for comparison, and are never charged. */}
                  <td className="px-2.5 py-2 align-top whitespace-nowrap">
                    <label className="inline-flex items-center gap-1 text-[11px] text-muted cursor-pointer">
                      <input
                        type="checkbox" disabled={!isOwner}
                        checked={salariedOf(p)}
                        onChange={e => setStaff(p.name, { salaried: e.target.checked })}
                        className="accent-brand-600"
                      />
                      Salary
                    </label>
                    {salariedOf(p) && (
                      <div className="mt-1 flex items-center gap-1">
                        <input
                          value={payOf(p, 'salaryHourly')} disabled={!isOwner} inputMode="decimal" placeholder="$/hr"
                          onChange={e => setStaff(p.name, { salaryHourly: e.target.value })}
                          title="Hourly rate as stated. With hours a week, this is the weekly cost."
                          className="w-14 rounded-lg border border-line bg-white px-1.5 py-1 text-[12px] tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60"
                        />
                        <span className="text-[10px] text-muted">×</span>
                        <input
                          value={payOf(p, 'salaryHoursPerWeek')} disabled={!isOwner} inputMode="decimal" placeholder="40"
                          onChange={e => setStaff(p.name, { salaryHoursPerWeek: e.target.value })}
                          title="Hours a week. Blank counts as 40 — a half-typed rate must never read as a free employee."
                          className="w-11 rounded-lg border border-line bg-white px-1.5 py-1 text-[12px] tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60"
                        />
                        <span className="text-[10px] text-muted">h/wk</span>
                      </div>
                    )}
                    {salariedOf(p) && (
                      <div className="mt-1 text-[10px] text-muted">
                        {weeklyOf(p) != null
                          ? <>= <b className="text-ink tabular-nums">${weeklyOf(p)!.toLocaleString('en-US')}</b>/wk</>
                          : <span className="text-amber-700">rate not set — they will cost nothing</span>}
                        {p.hours > 0 && weeklyOf(p) != null && (
                          <span title="What the clock said over this window, for comparison only. The salary is what gets charged.">
                            {' '}· clock {money(p.payroll)}
                          </span>
                        )}
                      </div>
                    )}
                    {!salariedOf(p) && <div className="mt-1 text-[10px] text-muted">hourly, from Homebase</div>}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink whitespace-nowrap align-top">{p.hours ? p.hours.toLocaleString() + 'h' : '—'}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink whitespace-nowrap align-top">{money(p.payroll)}</td>
                  <td className="px-2.5 py-2 text-muted whitespace-nowrap align-top">
                    {p.tasks.total === 0 ? <span className="text-faint">no tasks</span> : (
                      <>{p.tasks.total} tasks
                        <span className="text-[11px]"> · {p.tasks.cleans} cleans · {p.tasks.maintenance} maint · {p.tasks.inspection} insp</span>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-muted mt-2 max-w-[80ch]">
        <b className="text-ink">Salaried management:</b> Roberto Chiriboga — $80,000/yr (Jon, 2026-08-24). The labor engine
        carries his salary as a fixed Management line, pro-rated to whatever window you look at, and keeps any hourly
        punches of his out of the supervisor payroll so he is never counted twice.
      </p>

      <p className="text-[11.5px] text-muted mt-2.5 max-w-[80ch]">
        <b className="text-ink">All three columns move money.</b> <b>Crew</b> decides which margin their wages land in.
        <b> Agency / W2</b> is what the agency invoice and its fees hang off — W2 means they are on our payroll directly.
        <b> Market</b> decides which tab their payroll counts against; an amber <em>Not set</em> leaves them out of Miami,
        Broward and North alike, which is why those tabs can add up to less than the company total.
        <b> Vendor</b> is deliberately its own bucket and never part of a geographic market.
      </p>

      {/* LOADED-COST ASSUMPTIONS (Jon, 2026-08-23: "put the role, the agency, and their pay
          agency fees so I can get a better assumption of labor cost based on market area and
          role"). Average loaded $/hr — Homebase wage plus the agency's % and $/hr markup — for
          this window's punches, sliced by the Market and Role columns above. Re-slices as you
          edit, before you even save. */}
      {d && (() => {
        const feeBy: Record<string, any> = {}
        for (const a of (d.agencies || []) as any[]) feeBy[a.key] = a
        const cell: Record<string, Record<string, { h: number; cost: number; n: Set<string> }>> = {}
        const areaLabels: Record<string, string> = { miami: 'Miami', broward: 'Broward', north: 'North', vendor: 'Vendor', '': 'No market set' }
        for (const p of d.people) {
          if (!p.hours || p.payroll == null || p.payroll <= 0) continue
          const area = areaOf(p) || ''
          const role = roleOf(p) || 'Not set'
          const a = feeBy[agencyOf(p)]
          const pct = a ? Number(a.fee_percent) || 0 : 0
          const perH = a ? Number(a.fee_per_hour) || 0 : 0
          const loaded = p.payroll * (1 + pct / 100) + p.hours * perH
          const r = (cell[area] = cell[area] || {})
          const c = (r[role] = r[role] || { h: 0, cost: 0, n: new Set<string>() })
          c.h += p.hours; c.cost += loaded; c.n.add(p.name)
        }
        const areas = ['miami', 'broward', 'north', 'vendor', ''].filter(k => cell[k])
        if (!areas.length) return null
        const roleCols = Array.from(new Set(areas.flatMap(k => Object.keys(cell[k]))))
        return (
          <div className="mt-5 rounded-xl border border-line p-3 overflow-x-auto">
            <p className="text-[12px] font-bold text-ink">Loaded cost assumptions <span className="font-normal text-[11px] text-muted">· avg $/hr by market × role — wage + agency markup, this window&apos;s punches, weighted by hours</span></p>
            <table className="text-[12px] mt-2">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-muted">
                <th className="py-1 pr-4">Market</th>{roleCols.map(r => <th key={r} className="py-1 pr-4 text-right">{r}</th>)}
              </tr></thead>
              <tbody>
                {areas.map(k => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5 pr-4 font-medium text-ink whitespace-nowrap">{areaLabels[k] || k}</td>
                    {roleCols.map(r => {
                      const c = cell[k][r]
                      return <td key={r} className="py-1.5 pr-4 text-right tabular-nums whitespace-nowrap">{c ? <span><b>${(c.cost / c.h).toFixed(2)}</b><span className="text-muted"> · {c.n.size}p</span></span> : <span className="text-faint">—</span>}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10.5px] text-muted mt-1.5 max-w-[80ch]">
              Flat weekly agency fees are excluded from this per-hour view (they still land in the engine&apos;s true totals).
              Fill Role and Market for everyone above and these assumptions sharpen — the table re-slices as you edit, before saving.
              An amber Role or Market above means that person is sitting in &ldquo;Not set&rdquo; here.
            </p>
          </div>
        )
      })()}

      <AgencyFees isOwner={isOwner} />
    </div>
  )
}

// ── AGENCY FEES + INVOICES — merged in from the old "Staffing & agencies" card (Jon,
// 2026-08-22: "you have two different sections for the agencies' pay. Let's merge those two
// sections as the real data for feeding the labor models."). One roster above, one fee table
// here, one save path — and the labor engine reads BOTH: every agency person's wages carry
// their agency's markup (% of wages + $ per hour + flat per weekly invoice) in every cost per
// clean, margin and brief. Fees left at 0 load nothing.
function AgencyFees({ isOwner }: { isOwner: boolean }) {
  type Agency = { key: string; label: string; fee_percent: number; fee_per_hour: number; fee_flat: number; active: boolean }
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [dirty, setDirty] = useState(false)
  const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const daysAgoISO = (n: number) => new Date(Date.now() - n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const [invFrom, setInvFrom] = useState(daysAgoISO(6))
  const [invTo, setInvTo] = useState(todayISO())

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/staffing', { cache: 'no-store' })
      const j = await r.json()
      if (r.ok && j.ok) { setAgencies((j.agencies || []).filter((a: Agency) => a.key)); setDirty(false) }
    } catch { /* fee table simply stays empty */ }
  }, [])
  useEffect(() => { load() }, [load])

  const patch = (key: string, p: Partial<Agency>) => {
    setAgencies(list => list.map(a => (a.key === key ? { ...a, ...p } : a)))
    setDirty(true)
  }
  const save = async () => {
    setBusy('save'); setMsg(null)
    try {
      const r = await fetch('/api/settings/staffing', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agencies }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error((j.errors || []).join('; ') || j.error || 'Could not save fees.')
      setDirty(false)
      setMsg({ tone: 'ok', text: 'Fees saved — the labor engine loads them onto every agency person’s wages from the next refresh.' })
    } catch (e: any) { setMsg({ tone: 'bad', text: e.message || String(e) }) } finally { setBusy(null) }
  }

  return (
    <div className="mt-5 rounded-xl border border-line p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-bold text-ink">Agency fees &amp; invoices</span>
        <span className="text-[11px] text-muted">what each agency charges on top of Homebase wages — this IS the labor model’s loaded cost</span>
        <button onClick={save} disabled={!isOwner || busy !== null || !dirty}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-2.5 py-1 text-[11px] font-semibold hover:bg-brand-700 disabled:opacity-40">
          {busy === 'save' ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Save fees
        </button>
      </div>
      {msg && (
        <div className={`mt-2 rounded-lg border px-3 py-1.5 text-[12px] ${msg.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{msg.text}</div>
      )}
      {/* Five columns of fee inputs — they scroll inside this card rather than dragging the whole
          page sideways and taking the heading that says what you are reading with them. */}
      <div className="lh-hscroll -mx-3 px-3 sm:mx-0 sm:px-0">
      <table className="w-full text-sm mt-2 min-w-[620px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-wide text-muted">
            <th className="py-1 pr-3">Agency</th>
            <th className="py-1 pr-3 text-right">% of wages</th>
            <th className="py-1 pr-3 text-right">$ / hour</th>
            <th className="py-1 pr-3 text-right">Flat / weekly invoice</th>
            <th className="py-1 pr-3">Invoice export</th>
          </tr>
        </thead>
        <tbody>
          {agencies.map(a => (
            <tr key={a.key} className="border-t border-line">
              <td className="py-1.5 pr-3 font-medium text-ink">{a.label}</td>
              {(['fee_percent', 'fee_per_hour', 'fee_flat'] as const).map(f => (
                <td key={f} className="py-1.5 pr-3 text-right">
                  <input type="number" step="0.01" min={0} disabled={!isOwner} value={a[f] ?? 0}
                    onChange={e => patch(a.key, { [f]: Number(e.target.value) || 0 } as any)}
                    className="w-20 text-right text-[12px] bg-app border border-line rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
                </td>
              ))}
              <td className="py-1.5 pr-3 whitespace-nowrap">
                <a className="text-[11px] font-semibold text-brand-700 hover:underline"
                  href={`/api/labor/agency-invoice?from=${invFrom}&to=${invTo}&agency=${a.key}&format=csv`} target="_blank" rel="noreferrer">CSV</a>
                <a className="ml-2 text-[11px] font-semibold text-brand-700 hover:underline"
                  href={`/api/labor/agency-invoice?from=${invFrom}&to=${invTo}&agency=${a.key}`} target="_blank" rel="noreferrer">preview</a>
              </td>
            </tr>
          ))}
          {!agencies.length && <tr><td colSpan={5} className="py-2 text-[12px] text-muted">No agencies yet.</td></tr>}
        </tbody>
      </table>
      </div>
      {/* Two date pickers plus a sentence: iOS renders each picker at 16px, which overflowed the row
          on a phone. Let it wrap. */}
      <div className="flex flex-wrap items-center gap-2 mt-2 text-[11.5px] text-muted">
        Invoice window:
        <input type="date" value={invFrom} onChange={e => setInvFrom(e.target.value)} className="text-[11px] border border-line rounded px-1 py-0.5 bg-white" />
        →
        <input type="date" value={invTo} onChange={e => setInvTo(e.target.value)} className="text-[11px] border border-line rounded px-1 py-0.5 bg-white" />
        <span className="ml-1">hours come live from Homebase at export time — a corrected punch changes the next export with nothing to re-sync.</span>
      </div>
      <p className="text-[11px] text-muted mt-2 max-w-[80ch]">
        All three fee kinds stack and each defaults to 0. The labor engine loads them onto every assigned person’s
        wages — the flat fee is spread across that agency’s people by their share of hours, one invoice per week —
        so cost per clean, margins, briefs and the planner all run on what Stay actually pays, not the bare wage.
      </p>
    </div>
  )
}

function Note({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  const c = tone === 'good' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'bad' ? 'border-rose-200 bg-rose-50 text-rose-800'
      : 'border-amber-200 bg-amber-50 text-amber-800'
  const Icon = tone === 'good' ? Check : AlertTriangle
  return <div className={`mb-3 rounded-xl border px-3.5 py-2.5 text-[12.5px] flex items-start gap-2 ${c}`}><Icon size={14} className="mt-0.5 shrink-0" />{children}</div>
}
