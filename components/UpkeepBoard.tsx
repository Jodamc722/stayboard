'use client'
// UPKEEP — the recurring programs as a daily KPI page (Jon, 2026-10-03: "take the today page and
// build an operation page … track PM, deep cleans, AC filter changes, battery changes, inspections,
// FFE audits … late, coming soon, etc.").
//
// Built the way the Today page is built: a strip of tiles, one per program, grouped by trade; a
// tile opens the full list under it with the actions in place. The number on a tile is what is
// LATE, because that is the one that costs a guest something; "due in 14 days" is the second line
// so a supervisor can book next week before it turns red. A matrix view (Grid) shows every unit
// against every program for the building you are standing in.
//
// Where the facts come from (nothing new to maintain): the cadence catalogue in Settings → Cadences
// says what each program is and how often; a completed Breezeway task whose name matches the
// program IS the record it was done (and a finished /ffe walk, for FF&E audits). "No record" is a
// unit nobody has logged the job on — not "late", because it is far more often a data gap.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw, Plus, ExternalLink, Search, LayoutGrid, List, Wrench, Sparkles, Fan, ClipboardCheck } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { LeanHead, Pill, Tag, LeanEmpty, type Tone } from '@/components/lean'
import type { Upkeep, UpkeepProgram, UpkeepRow, UpkeepState } from '@/app/api/upkeep/route'

const url = (market: string) => '/api/upkeep?market=' + encodeURIComponent(market)
const bzTask = (id: string) => 'https://app.breezeway.io/task/' + encodeURIComponent(id)
const nice = (ymd: string | null) => { if (!ymd) return '—'; const d = new Date(ymd + 'T12:00:00Z'); return isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getUTCFullYear() === new Date().getFullYear() ? undefined : 'numeric', timeZone: 'UTC' }) }
const every = (d: number) => d % 365 === 0 ? (d / 365 === 1 ? 'yearly' : 'every ' + d / 365 + ' years') : d % 30 === 0 && d >= 60 ? 'every ' + d / 30 + ' months' : d === 182 || d === 180 ? 'every 6 months' : 'every ' + d + ' days'
const whenWord = (r: UpkeepRow) => r.state === 'none' ? 'never recorded' : r.daysOver > 0 ? r.daysOver + 'd late' : r.daysOver === 0 ? 'due today' : 'in ' + (-r.daysOver) + 'd'

const STATE: Record<UpkeepState, { label: string; tone: Tone; bar: string; dot: string }> = {
  late:   { label: 'Late',       tone: 'roseSolid', bar: 'bg-rose-500',    dot: 'bg-rose-500' },
  soon:   { label: 'Due soon',   tone: 'amber',     bar: 'bg-amber-400',   dot: 'bg-amber-400' },
  booked: { label: 'Booked',     tone: 'sky',       bar: 'bg-sky-400',     dot: 'bg-sky-400' },
  ok:     { label: 'On track',   tone: 'emerald',   bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  none:   { label: 'No record',  tone: 'slate',     bar: 'bg-slate-200',   dot: 'bg-slate-200' },
}
const ORDER: UpkeepState[] = ['late', 'soon', 'booked', 'ok', 'none']
const GROUPS: { key: UpkeepProgram['group']; label: string; Icon: any }[] = [
  { key: 'ac', label: 'Air conditioning', Icon: Fan },
  { key: 'housekeeping', label: 'Housekeeping', Icon: Sparkles },
  { key: 'maintenance', label: 'Maintenance', Icon: Wrench },
  { key: 'quality', label: 'Quality', Icon: ClipboardCheck },
  { key: 'other', label: 'Other programs', Icon: Wrench },
]

export function UpkeepBoard() {
  const [market, setMarket] = useState<string>(() => { try { return localStorage.getItem('upkeep.market') || 'all' } catch { return 'all' } })
  const { data, loading, error, refresh } = useCachedFetch<Upkeep & { error?: string }>(url(market), { ttl: 10 * 60_000 })
  const [open, setOpen] = useState<string>('')
  const [state, setState] = useState<UpkeepState | 'all'>('all')
  const [building, setBuilding] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [busy, setBusy] = useState('')
  const [filed, setFiled] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')
  const pickMarket = (m: string) => { setMarket(m); try { localStorage.setItem('upkeep.market', m) } catch { /* fine */ } }
  const reload = () => { invalidateCache(url(market)); refresh() }

  const programs = data?.programs || []
  const prog = programs.find(p => p.key === open) || null
  const rows = useMemo(() => {
    if (!prog) return [] as UpkeepRow[]
    const needle = q.trim().toLowerCase()
    return prog.rows
      .filter(r => state === 'all' ? r.state !== 'ok' || prog.late + prog.soon + prog.none === 0 : r.state === state)
      .filter(r => !building || r.building === building)
      .filter(r => !needle || (r.unit + ' ' + r.building).toLowerCase().includes(needle))
  }, [prog, state, building, q])

  // One row → one Breezeway task, through the route the Add sheet uses. The description says why
  // it exists, so whoever opens it in the field app is not guessing.
  const addTask = async (r: UpkeepRow) => {
    if (busy) return
    setBusy(r.id); setErr('')
    try {
      const res = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: r.listingId, title: r.label + ' — ' + r.unit, department: r.dept,
          priority: r.daysOver > 60 ? 'high' : 'normal',
          date: r.dueOn > (data?.today || '') ? r.dueOn : (data?.today || undefined),
          description: 'Recurring upkeep, on the cadence.\n' + (r.lastDone ? 'Last done ' + nice(r.lastDone) + ' — ' + whenWord(r) + '.' : 'No task in our history matches this job for this unit.') + '\nAbout ' + r.minutes + ' minutes.\n\nFiled from Lighthouse → Upkeep.',
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j?.error || 'Breezeway would not take it')
      setFiled(f => ({ ...f, [r.id]: String(j.taskId) }))
    } catch (e: any) { setErr(r.unit + ' — ' + String(e?.message || e)) }
    setBusy('')
  }

  const t = data?.totals
  const head = (
    <LeanHead title="Upkeep" sub={data ? `${new Set(programs.flatMap(p => p.rows.map(r => r.listingId))).size} units · ${programs.filter(p => !p.inert).length} programs · as of ${nice(data.today)}` : 'Recurring programs, every unit, on their clocks'}>
      {t ? <>
        <Pill tone={t.late ? 'roseSolid' : 'emerald'} title="Jobs past their due date">{t.late} late{t.lateUnits ? ' · ' + t.lateUnits + ' units' : ''}</Pill>
        <Pill tone="amber" title={'Due in the next ' + (data?.soonDays || 14) + ' days'}>{t.soon} due soon</Pill>
        <Pill tone="sky" title="Already on the board in Breezeway">{t.booked} booked</Pill>
        <Pill tone="slate" title="Never recorded on this unit — a data gap more often than neglect">{t.none} no record</Pill>
      </> : null}
      {data && data.markets.length > 1 ? (
        <select value={market} onChange={e => pickMarket(e.target.value)} className="h-8 rounded-lg border border-line bg-white px-2 text-[12px] font-semibold text-ink" aria-label="Area">
          <option value="all">All areas</option>
          {data.markets.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      ) : null}
      <button onClick={reload} title="Re-read the ledger" className="h-8 w-8 rounded-lg border border-line bg-white text-muted hover:text-ink grid place-items-center"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      <Link href="/users?tab=settings&section=cadences" className="text-[12px] font-semibold text-muted hover:text-ink">Cadences →</Link>
    </LeanHead>
  )

  if (loading && !data) return <>{head}<LeanEmpty><Loader2 size={14} className="animate-spin inline mr-2" /> Reading every unit against every program…</LeanEmpty></>
  if (!data) return <>{head}<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error || 'Nothing loaded.'}</div></>

  return (
    <div className="space-y-4">
      {head}
      {!data.enabled && <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">The cadence engine is switched off in Settings → Cadences, so nothing is being proposed or created automatically. This page still reads the ledger.</p>}
      {data.degraded.length ? <p className="text-[12px] text-amber-800">{data.degraded.join(' · ')}</p> : null}

      {/* ── THE TILES, BY TRADE ── */}
      {GROUPS.map(g => {
        const ps = programs.filter(p => p.group === g.key)
        if (!ps.length) return null
        return (
          <section key={g.key}>
            <p className="text-[10.5px] uppercase tracking-[0.14em] font-bold text-muted mb-1.5 flex items-center gap-1.5"><g.Icon size={12} /> {g.label}</p>
            <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
              {ps.map(p => <ProgramTile key={p.key} p={p} on={open === p.key} onClick={() => { setOpen(open === p.key ? '' : p.key); setState('all'); setQ('') }} />)}
            </div>
          </section>
        )
      })}

      {/* ── THE LIST / GRID UNDER THE OPEN TILE ── */}
      {prog ? (
        <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden">
          <header className="px-3 py-2 border-b border-line flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-ink">{prog.label}</span>
            <span className="text-[11.5px] text-muted">{every(prog.everyDays)} · {prog.units} units{prog.equipment !== 'any' ? ' · ' + prog.equipment.replace('non-central', 'mini-split / wall') + ' A/C' : ''}</span>
            <span className="inline-flex items-center gap-1 flex-wrap ml-1">
              {(['all', ...ORDER] as const).map(k => {
                const n = k === 'all' ? prog.rows.length : prog[k]
                if (k !== 'all' && !n) return null
                return <button key={k} onClick={() => setState(k)} aria-pressed={state === k} className={'text-[11px] font-semibold px-2 h-6 rounded-md border ' + (state === k ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{k === 'all' ? 'Needs attention' : STATE[k].label} {n}</button>
              })}
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <select value={building} onChange={e => setBuilding(e.target.value)} className="h-7 rounded-md border border-line bg-white px-1.5 text-[11.5px] font-semibold text-ink max-w-[11rem]" aria-label="Building">
                <option value="">All buildings</option>
                {Array.from(new Set(prog.rows.map(r => r.building))).sort().map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <label className="h-7 inline-flex items-center gap-1 rounded-md border border-line bg-white px-1.5 text-[11.5px]"><Search size={11} className="text-muted" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="unit" className="w-16 bg-transparent outline-none text-ink" /></label>
              <button onClick={() => setView(v => v === 'list' ? 'grid' : 'list')} title={view === 'list' ? 'Every unit against every program' : 'Back to the list'} className="h-7 px-2 rounded-md border border-line bg-white text-muted hover:text-ink inline-flex items-center gap-1 text-[11.5px] font-semibold">{view === 'list' ? <><LayoutGrid size={12} /> Grid</> : <><List size={12} /> List</>}</button>
            </span>
          </header>
          {err ? <p className="px-3 py-1.5 text-[12px] text-rose-700 bg-rose-50 border-b border-rose-200">{err}</p> : null}
          {view === 'grid' ? (
            <Matrix programs={programs} building={building} market={market} q={q} />
          ) : rows.length === 0 ? (
            <p className="px-3 py-4 text-[12.5px] text-muted">{state === 'all' ? 'Nothing needs attention here — every unit is on track or booked.' : 'Nothing in this state.'}</p>
          ) : (
            <ul className="divide-y divide-line max-h-[60vh] overflow-y-auto">
              {rows.slice(0, 400).map(r => {
                const taskId = filed[r.id] || r.task?.id || ''
                const st = filed[r.id] ? 'booked' : r.state
                return (
                  <li key={r.id} className="px-3 py-2 flex items-center gap-2 flex-wrap">
                    <span className={'w-2 h-2 rounded-full shrink-0 ' + STATE[st].dot} />
                    <span className="text-[13px] font-semibold text-ink min-w-[7rem]">{r.unit}</span>
                    <span className="text-[11.5px] text-muted">{r.building}{r.market && market === 'all' ? ' · ' + r.market : ''}</span>
                    <Tag tone={STATE[st].tone}>{STATE[st].label}</Tag>
                    <span className={'text-[11.5px] tabular-nums ' + (r.state === 'late' ? 'text-rose-700 font-semibold' : 'text-muted')}>{r.state === 'none' ? 'never recorded' : 'last ' + nice(r.lastDone) + ' · due ' + nice(r.dueOn) + ' · ' + whenWord(r)}</span>
                    <span className="ml-auto inline-flex items-center gap-1.5">
                      {taskId ? <a href={bzTask(taskId)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-sky-700 hover:underline"><ExternalLink size={11} /> {r.task?.date ? 'Task ' + nice(r.task.date) : 'Task filed'}</a>
                        : data.canEdit ? <button onClick={() => addTask(r)} disabled={!!busy} className="inline-flex items-center gap-1 text-[11.5px] font-semibold px-2 h-7 rounded-md border border-line bg-white text-ink hover:border-ink/40 disabled:opacity-40">{busy === r.id ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add task</button> : null}
                    </span>
                  </li>
                )
              })}
              {rows.length > 400 ? <li className="px-3 py-2 text-[11.5px] text-muted">{rows.length - 400} more — narrow by building.</li> : null}
            </ul>
          )}
        </section>
      ) : (
        <p className="text-[12px] text-muted">Open a tile to see its units. A program's clock restarts whenever a Breezeway task matching it is completed; what counts as a match, and how often each is due, is in Settings → Cadences.</p>
      )}
    </div>
  )
}

function ProgramTile({ p, on, onClick }: { p: UpkeepProgram; on: boolean; onClick: () => void }) {
  const total = p.late + p.soon + p.ok + p.booked + p.none
  const tone = p.inert ? 'text-muted' : p.late ? 'text-rose-700' : p.soon ? 'text-amber-700' : 'text-emerald-700'
  return (
    <button onClick={onClick} aria-pressed={on} disabled={!!p.inert}
      title={p.inert ? p.label + ' — ' + p.inert : p.label + ' — ' + every(p.everyDays) + ' · ' + p.units + ' units · ' + p.healthPct + '% current' + (on ? ' — click to close' : ' — click to open the list')}
      className={'text-left rounded-2xl border bg-white px-3 py-2.5 min-h-[92px] shadow-soft transition flex flex-col gap-1.5 min-w-0 disabled:opacity-60 ' + (on ? 'border-brand-400 ring-2 ring-brand-100' : 'border-line hover:border-ink/30')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] uppercase tracking-[0.08em] font-semibold text-muted truncate">{p.label}</span>
        <span className="text-[10.5px] font-bold tabular-nums text-muted/70">{total && !p.inert ? p.healthPct + '%' : ''}</span>
      </div>
      {p.inert ? (
        <span className="text-[12px] text-muted">{p.inert}</span>
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span className={'text-[22px] leading-none font-bold tabular-nums ' + tone}>{p.late}</span>
          <span className="text-[11px] text-muted">late</span>
          {p.soon ? <span className="text-[11px] text-amber-700 font-semibold ml-1">{p.soon} due soon</span> : null}
        </div>
      )}
      <div className="w-full h-1.5 rounded-full bg-line overflow-hidden flex" aria-hidden>
        {total > 0 && ORDER.filter(k => p[k] > 0).map(k => <span key={k} className={'block h-full ' + STATE[k].bar} style={{ width: (p[k] / total) * 100 + '%' }} title={p[k] + ' ' + STATE[k].label.toLowerCase()} />)}
      </div>
      <div className="text-[11px] text-muted truncate w-full">{p.inert ? '' : [every(p.everyDays), p.booked ? p.booked + ' booked' : '', p.none ? p.none + ' no record' : ''].filter(Boolean).join(' · ')}</div>
    </button>
  )
}

/** Every unit against every program — the building's whole clock on one screen. */
function Matrix({ programs, building, market, q }: { programs: UpkeepProgram[]; building: string; market: string; q: string }) {
  const ps = programs.filter(p => !p.inert && p.rows.length)
  const units = useMemo(() => {
    const m = new Map<string, { unit: string; building: string; cells: Record<string, UpkeepRow> }>()
    for (const p of ps) for (const r of p.rows) {
      if (building && r.building !== building) continue
      if (q && !(r.unit + ' ' + r.building).toLowerCase().includes(q.trim().toLowerCase())) continue
      const u = m.get(r.listingId) || { unit: r.unit, building: r.building, cells: {} }
      u.cells[p.key] = r; m.set(r.listingId, u)
    }
    return Array.from(m.values()).sort((a, b) => a.building.localeCompare(b.building) || a.unit.localeCompare(b.unit))
  }, [ps, building, q])
  return (
    <div className="overflow-auto max-h-[70vh]">
      <table className="text-[11.5px] border-collapse min-w-full">
        <thead className="sticky top-0 bg-white z-10">
          <tr>
            <th className="text-left px-3 py-1.5 font-semibold text-muted border-b border-line">Unit</th>
            {ps.map(p => <th key={p.key} className="px-1.5 py-1.5 font-semibold text-muted border-b border-line whitespace-nowrap text-center" title={p.label + ' · ' + every(p.everyDays)}>{p.label.replace(' (central A/C)', '').replace('Unit inspection (every 45–60 days)', 'Inspection')}</th>)}
          </tr>
        </thead>
        <tbody>
          {units.map((u, i) => (
            <tr key={i} className="border-b border-line/60 hover:bg-app/50">
              <td className="px-3 py-1 whitespace-nowrap"><span className="font-semibold text-ink">{u.unit}</span>{!building ? <span className="text-muted"> · {u.building}</span> : null}{market === 'all' ? null : null}</td>
              {ps.map(p => {
                const r = u.cells[p.key]
                return <td key={p.key} className="px-1.5 py-1 text-center">
                  {r ? <span className={'inline-block w-3.5 h-3.5 rounded-full ' + STATE[r.state].dot} title={p.label + ': ' + STATE[r.state].label + (r.state !== 'none' ? ' · last ' + nice(r.lastDone) + ' · ' + whenWord(r) : '')} /> : <span className="text-faint" title="Not on this unit">·</span>}
                </td>
              })}
            </tr>
          ))}
          {!units.length ? <tr><td colSpan={ps.length + 1} className="px-3 py-4 text-muted">No units match.</td></tr> : null}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-muted flex items-center gap-3 flex-wrap">{ORDER.map(k => <span key={k} className="inline-flex items-center gap-1"><span className={'w-2.5 h-2.5 rounded-full ' + STATE[k].dot} /> {STATE[k].label}</span>)}</p>
    </div>
  )
}
