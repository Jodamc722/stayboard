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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users2, Loader2, Save, Check, AlertTriangle, RotateCcw, Search } from 'lucide-react'

type Tasks = { total: number; cleans: number; maintenance: number; inspection: number; other: number }
type Person = {
  name: string; dept: string; source: string; sourceLabel: string; editable: boolean
  hours: number; payroll: number | null
  homebaseRole: string | null; staffRole: string | null
  agency: string | null; area: string | null
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
  const [staffEdits, setStaffEdits] = useState<Record<string, { agency?: string; area?: string }>>({})
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
  const setStaff = (name: string, patch: { agency?: string; area?: string }) =>
    setStaffEdits(s => ({ ...s, [name]: { ...s[name], ...patch } }))
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
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && <span className="text-[11.5px] font-semibold text-amber-700">{new Set([...Object.keys(edits), ...Object.keys(staffEdits)]).size} unsaved</span>}
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
        <table className="w-full text-[12.5px] min-w-[820px]">
          <thead>
            <tr className="border-b border-line text-left">
              {['Person', 'Crew', 'Agency / W2', 'Market', 'Hours', 'Payroll', 'Breezeway (context only)'].map((h, i) => (
                <th key={i} className={`px-2.5 py-2 text-[10px] uppercase tracking-[0.09em] font-semibold text-muted whitespace-nowrap ${i === 4 || i === 5 ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted">Nobody matches that.</td></tr>}
            {rows.map(p => {
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
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink whitespace-nowrap align-top">{p.hours ? p.hours.toLocaleString() + 'h' : '—'}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-ink whitespace-nowrap align-top">{money(p.payroll)}</td>
                  <td className="px-2.5 py-2 text-muted whitespace-nowrap align-top">
                    {p.tasks.total === 0 ? <span className="text-faint">no tasks</span> : (
                      <>{p.tasks.total} tasks
                        <span className="text-[11px]"> · {p.tasks.cleans} cleans · {p.tasks.maintenance} maint · {p.tasks.inspection} insp</span>
                      </>
                    )}
                    {p.staffRole && <div className="text-[10.5px] text-faint">Staffing role: {p.staffRole}</div>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-muted mt-2.5 max-w-[80ch]">
        <b className="text-ink">All three columns move money.</b> <b>Crew</b> decides which margin their wages land in.
        <b> Agency / W2</b> is what the agency invoice and its fees hang off — W2 means they are on our payroll directly.
        <b> Market</b> decides which tab their payroll counts against; an amber <em>Not set</em> leaves them out of Miami,
        Broward and North alike, which is why those tabs can add up to less than the company total.
        <b> Vendor</b> is deliberately its own bucket and never part of a geographic market.
        These write the same record as <b>Staffing &amp; agencies</b> below, so the two can never drift.
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
