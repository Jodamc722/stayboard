'use client'
// DUE — the preventative ledger, by building (Jon, 2026-09-09: "build it, add tasks, suggestions,
// PMs"). The fourth view on Today in Ops, beside Units · People · Focus.
//
// Focus answers "what is worth doing today". This answers the question a supervisor asks on a quiet
// Thursday: what is coming, where has a building drifted, and can I put a run together. It is the
// ledger — no proximity, no caps, no model — grouped the way the work is done: one building, one
// trip, one afternoon.
//
// ADD ALL is the point of the screen. Nine filters at 17WEST is one decision, not nine; each row
// still files its own Breezeway task through the same route the Add sheet uses, with a per-row
// receipt, because a bulk action that reports "3 failed" without saying which three is worse than
// doing them one at a time.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, ChevronRight, ChevronDown, AlertTriangle, Check, Plus, CalendarClock, Building2, Wrench, Sparkles, ClipboardList } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'

type DueItem = {
  id: string; cadenceKey: string; label: string; dept: string; minutes: number
  listingId: string; unit: string; building: string | null; market: string; vendor: boolean
  lastDone: string | null; dueOn: string; daysOver: number
  scheduled: { taskId: string; date: string } | null
  band: 'late' | 'week' | 'later'
}
type DueBuilding = { key: string; building: string; market: string; vendor: boolean; units: number; late: number; week: number; later: number; minutes: number; items: DueItem[] }
type Due = {
  ok: boolean; today: string; horizonDays: number; enabled: boolean
  inert: { key: string; label: string; why: string }[]
  totals: { late: number; week: number; later: number; scheduled: number; minutes: number }
  buildings: DueBuilding[]; degraded: string[]; error?: string
}

const DEPT_ICON: Record<string, any> = { maintenance: Wrench, housekeeping: Sparkles, inspection: ClipboardList }
const CARD = 'rounded-2xl border border-line bg-white overflow-hidden'
const fmtH = (mins: number) => { const h = Math.floor(mins / 60), m = mins % 60; return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm' }
const niceDate = (ymd: string) => {
  try { return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd }
}
/** How late, in the words a person would use. */
const lateWord = (d: number) => d > 0 ? (d === 1 ? '1 day late' : d + ' days late') : d === 0 ? 'due today' : 'due ' + (-d === 1 ? 'tomorrow' : 'in ' + -d + ' days')

const dueUrl = (market: string, days: number, date?: string) => `/api/ops-today/due?market=${encodeURIComponent(market)}&days=${days}` + (date ? `&date=${date}` : '')

export function DueCalendar({ market, date, onRefresh }: { market: string; date?: string; onRefresh: () => void }) {
  const [days, setDays] = useState(30)
  const { data, loading, error, refresh } = useCachedFetch<Due>(dueUrl(market, days, date), { ttl: 10 * 60_000 })
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [filed, setFiled] = useState<Record<string, string>>({})   // item id -> taskId
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [band, setBand] = useState<'late' | 'week' | 'all'>('all')

  const reload = useCallback(() => { invalidateCache(dueUrl(market, days, date)); refresh() }, [market, days, date, refresh])
  useEffect(() => { setOpen({}) }, [market])

  // One row → one Breezeway task, through the route the Add sheet already uses. The description
  // says why it exists, so whoever opens it in the field app is not guessing.
  const fileOne = async (it: DueItem): Promise<string> => {
    const r = await fetch('/api/ops-today/add-task', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listingId: it.listingId, title: it.label + ' — ' + it.unit,
        department: it.dept, priority: it.daysOver > 60 ? 'high' : 'normal',
        date: it.dueOn > (data?.today || '') ? it.dueOn : (data?.today || undefined),
        description: 'Preventative maintenance, on the cadence.\n'
          + (it.lastDone ? 'Last done ' + niceDate(it.lastDone) + ' — ' : 'No record of this being done in our task history — ')
          + lateWord(it.daysOver) + '.\nAbout ' + it.minutes + ' minutes.\n\nProposed by Lighthouse (PM calendar).',
      }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.ok) throw new Error(j?.error || 'Breezeway would not take it')
    return String(j.taskId)
  }

  const addOne = async (it: DueItem) => {
    if (busy) return
    setBusy(it.id); setErr('')
    try { const id = await fileOne(it); setFiled(f => ({ ...f, [it.id]: id })); invalidateCache(dueUrl(market, days, date)); onRefresh() }
    catch (e: any) { setErr(it.unit + ' — ' + String(e?.message || e)) } finally { setBusy(null) }
  }

  // ADD ALL for one building: sequential, with a per-row receipt. Rows that land turn green and
  // stay on screen; rows that do not keep their place and are named in the line underneath.
  const addBuilding = async (b: DueBuilding) => {
    if (busy) return
    const rows = shownItems(b).filter(i => !i.scheduled && !filed[i.id])
    if (!rows.length) return
    if (!window.confirm(`File ${rows.length} preventative ${rows.length === 1 ? 'task' : 'tasks'} for ${b.building} in Breezeway?`)) return
    setBusy('b:' + b.key); setErr(''); setNote('')
    let ok = 0
    const failures: string[] = []
    for (const it of rows) {
      try { const id = await fileOne(it); ok++; setFiled(f => ({ ...f, [it.id]: id })) }
      catch (e: any) { failures.push(it.unit + ' (' + String(e?.message || e).slice(0, 40) + ')') }
    }
    setBusy(null)
    setNote(failures.length
      ? `${ok} filed. ${failures.length} did not: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`
      : `${ok} filed in Breezeway.`)
    // The ledger has changed: those rows are booked now. Without this the 10-minute cache would
    // re-offer them the next time the market chip flipped back.
    invalidateCache(dueUrl(market, days, date))
    onRefresh()
  }

  const shownItems = (b: DueBuilding) => band === 'all' ? b.items : b.items.filter(i => i.band === band)
  const buildings = useMemo(() => (data?.buildings || []).filter(b => shownItems(b).length), [data, band, filed])
  const t = data?.totals

  if (loading && !data) return <div className="px-4 py-10 text-center text-[13px] text-muted"><span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Reading the cadence ledger&hellip;</span></div>
  if (error && !data) return <div className="px-4 py-10 text-center text-[13px]"><p className="text-rose-700">{error}</p><button onClick={reload} className="mt-2 text-[12.5px] font-semibold text-brand-600 hover:underline">Try again</button></div>

  return (
    <div className="p-3 sm:p-4 space-y-3">
      {/* ── THE LEDGER IN ONE LINE ── */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-ink leading-snug">
            {t && (t.late + t.week + t.later) === 0
              ? 'Nothing preventative comes due in the next ' + (data?.horizonDays || 30) + ' days.'
              : <>
                  <b className="text-rose-700">{t?.late || 0}</b> late
                  {' · '}<b>{t?.week || 0}</b> due this week
                  {' · '}<b>{t?.later || 0}</b> later
                  {t?.scheduled ? <span className="text-muted font-normal"> · {t.scheduled} already booked</span> : null}
                  <span className="text-muted font-normal"> · about {fmtH(t?.minutes || 0)} of work</span>
                </>}
          </p>
          <p className="text-[11.5px] text-muted mt-0.5">
            Every active unit against the cadences in Settings &rarr; Preventative. This is what is owed, not what fits today — Focus decides that.
          </p>
        </div>
        <span className="shrink-0 inline-flex items-center gap-1.5">
          <select value={days} onChange={e => setDays(Number(e.target.value))} aria-label="How far ahead"
            className="rounded-xl border border-line bg-white px-2 py-1.5 text-[12px] font-semibold text-ink min-h-[34px]">
            <option value={7}>Next 7 days</option>
            <option value={30}>Next 30 days</option>
            <option value={90}>Next 90 days</option>
          </select>
          <button onClick={reload} disabled={loading} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-2.5 py-1.5 text-[12px] font-bold text-muted hover:text-ink disabled:opacity-40 min-h-[34px]">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
          </button>
        </span>
      </div>

      {data?.enabled === false && (
        <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          The preventative engine is switched off in Settings, so nothing is being suggested on the day board. This ledger still shows what is owed.
        </p>
      )}
      {(data?.inert || []).length > 0 && (
        <p className="text-[11.5px] text-muted">Not counted: {data!.inert.map(i => i.label + ' (' + i.why + ')').join(' · ')}.</p>
      )}
      {(data?.degraded || []).length > 0 && (
        <p className="text-[11.5px] text-amber-800 inline-flex items-center gap-1.5"><AlertTriangle size={11} /> Incomplete read — could not fully read {data!.degraded.join(', ')}. These numbers are a floor.</p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {([['all', 'Everything'], ['late', 'Late only'], ['week', 'This week']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setBand(k as any)}
            className={'px-2.5 py-1.5 rounded-full border text-[12px] font-bold min-h-[32px] ' + (band === k ? 'bg-ink border-ink text-white' : 'bg-white border-line text-muted hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>

      {err && <p className="text-[12px] text-rose-700">{err}</p>}
      {note && <p className="text-[12px] text-muted">{note}</p>}

      {buildings.length === 0 ? (
        <div className={CARD + ' px-4 py-8 text-center text-[13px] text-muted'}>Nothing in this slice. Every unit is inside its cadence.</div>
      ) : buildings.map(b => {
        const isOpen = !!open[b.key]
        const rows = shownItems(b)
        const addable = rows.filter(i => !i.scheduled && !filed[i.id])
        return (
          <div key={b.key} className={CARD}>
            <div className="px-3 py-2 flex items-center gap-2 flex-wrap">
              <button onClick={() => setOpen(o => ({ ...o, [b.key]: !isOpen }))} aria-expanded={isOpen}
                className="flex items-center gap-2 text-left min-w-0 flex-1 hover:opacity-80">
                {isOpen ? <ChevronDown size={14} className="text-muted shrink-0" /> : <ChevronRight size={14} className="text-muted shrink-0" />}
                <Building2 size={13} className="text-muted shrink-0" />
                <span className="text-[13.5px] font-bold text-ink truncate">{b.building}</span>
                <span className="text-[11.5px] text-muted shrink-0">{b.units} unit{b.units === 1 ? '' : 's'} · {b.market}</span>
              </button>
              <span className="flex items-center gap-1.5 shrink-0">
                {b.late > 0 && <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 tabular-nums">{b.late} late</span>}
                {b.week > 0 && <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 tabular-nums">{b.week} this week</span>}
                {b.later > 0 && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded bg-app text-muted tabular-nums">{b.later} later</span>}
                <span className="text-[11px] text-muted tabular-nums hidden sm:inline">≈ {fmtH(b.minutes)}</span>
                {addable.length > 0 && (
                  <button onClick={() => addBuilding(b)} disabled={!!busy}
                    className="rounded-lg bg-ink text-white px-2.5 py-1.5 text-[11.5px] font-bold disabled:opacity-40 inline-flex items-center gap-1 min-h-[32px]">
                    {busy === 'b:' + b.key ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add all {addable.length}
                  </button>
                )}
              </span>
            </div>
            {isOpen && (
              <div className="border-t border-line divide-y divide-line">
                {rows.map(it => {
                  const I = DEPT_ICON[it.dept] || Wrench
                  const done = filed[it.id]
                  return (
                    <div key={it.id} className="px-3 py-2 flex items-center gap-2.5 flex-wrap">
                      <span className="w-5 h-5 rounded-md bg-slate-100 text-slate-500 inline-flex items-center justify-center shrink-0"><I size={11} strokeWidth={2.6} /></span>
                      <span className="text-[12.5px] text-ink min-w-0 flex-1">
                        <b>{it.unit}</b> <span className="text-ink/75">· {it.label}</span>
                        <span className="block text-[11px] text-muted">
                          {it.lastDone ? 'last done ' + niceDate(it.lastDone) : 'no record of it being done'} · {it.minutes} min
                        </span>
                      </span>
                      <span className={'text-[11px] font-semibold tabular-nums shrink-0 ' + (it.daysOver > 0 ? 'text-rose-700' : it.daysOver === 0 ? 'text-amber-700' : 'text-muted')}>
                        {lateWord(it.daysOver)}
                      </span>
                      {it.scheduled ? (
                        <a href={'https://app.breezeway.io/task/' + it.scheduled.taskId} target="_blank" rel="noreferrer"
                          className="text-[11px] font-semibold text-emerald-700 shrink-0 inline-flex items-center gap-1">
                          <CalendarClock size={11} /> booked {niceDate(it.scheduled.date)}
                        </a>
                      ) : done ? (
                        <a href={'https://app.breezeway.io/task/' + done} target="_blank" rel="noreferrer"
                          className="text-[11px] font-bold text-emerald-700 shrink-0 inline-flex items-center gap-1"><Check size={11} /> filed</a>
                      ) : (
                        <button onClick={() => addOne(it)} disabled={!!busy}
                          className="rounded-lg border border-line bg-white px-2.5 py-1 text-[11.5px] font-bold text-ink hover:border-ink/40 disabled:opacity-40 shrink-0 min-h-[30px] inline-flex items-center gap-1">
                          {busy === it.id ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Add
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The count on the tab: how much is late right now. */
export function DueCount({ market, date }: { market: string | null; date?: string }) {
  // Same url as the tab's default view, so the badge does not trigger a second full ledger build.
  const { data } = useCachedFetch<Due>(market ? dueUrl(market, 30, date) : null, { ttl: 10 * 60_000 })
  const n = data?.totals?.late || 0
  if (!n) return null
  return <span className="ml-1 text-[10px] font-bold px-1 rounded bg-rose-500 text-white tabular-nums">{n}</span>
}
