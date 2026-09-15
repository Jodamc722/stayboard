'use client'
// THE STAY HOSPITALITY DAILY CHECKLIST.
//
// Jon, 2026-09-15: "a time-sensitive checklist that we build based on things that have to happen
// every single day."
//
// TIME IS THE ORGANISING IDEA, not a decoration. The day runs top to bottom in four bands, every
// item carries the time it is due by, and the moment that time passes without a tick the item goes
// red and the header counts it. A checklist that cannot tell you at 11:15 that the 10:00 walk has
// not happened is just a list of nouns.
//
// Three decisions that follow from how this is actually used:
//   • FRESH EVERY MORNING, nothing carried. Jon's call. The list is what must happen TODAY; a
//     backlog of yesterdays would turn it into another inbox.
//   • ANYONE MAY TICK, and the tick records who. The whole point of a full-team checklist is that
//     the work still happens when somebody is off.
//   • THE STANDING LIST IS EDITED SEPARATELY, behind full access, so "we do this every day" keeps
//     meaning something.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ClipboardCheck, Loader2, Check, Clock, AlertTriangle, Plus, X, Pencil, Trash2,
  CheckCircle2, Sunrise, Sun, Sunset, Moon,
} from 'lucide-react'

import { clockLabel, type Band } from '@/lib/checklist-shared'
type Row = {
  id: string; title: string; detail: string | null
  band: Band; by_time: string | null; owner_role: string | null; sort: number | null; active: boolean
  done: boolean; done_at: string | null; done_by: string | null; note: string | null
  late: boolean; in_minutes: number | null
}
type Data = {
  day: string; clock: string; rows: Row[]
  progress: { total: number; done: number; late: number; pct: number; next: Row | null }
  canTick?: boolean; canManage?: boolean
}

const BANDS: { key: Band; label: string; Icon: any; hint: string }[] = [
  { key: 'morning',   label: 'Morning',   Icon: Sunrise, hint: 'Before the day gets away from you' },
  { key: 'midday',    label: 'Midday',    Icon: Sun,     hint: 'Turns and cleans' },
  { key: 'afternoon', label: 'Afternoon', Icon: Sunset,  hint: 'Arrivals and readiness' },
  { key: 'evening',   label: 'Evening',   Icon: Moon,    hint: 'Close out and hand over' },
]
const shortTime = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
}
const firstName = (s: string | null) => String(s || '').split(/[\s@]/)[0]

export function DailyChecklist() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [manage, setManage] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/daily-checklist', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j?.error) throw new Error(j?.error || 'Could not load the checklist.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)); setData(d => d || ({ day: '', clock: '', rows: [], progress: { total: 0, done: 0, late: 0, pct: 0, next: null } } as Data)) }
  }, [])
  useEffect(() => { load() }, [load])

  // The clock is the whole point, so the page must not be reading a stale one. A minute is fine:
  // nothing here turns on seconds, and a tighter loop would just burn the battery in a pocket.
  useEffect(() => {
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  const act = useCallback(async (body: any, key: string) => {
    setBusy(key); setErr(null)
    try {
      const r = await fetch('/api/daily-checklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) throw new Error(j?.error || 'That did not save.')
      if (j.rows) setData(d => ({ ...(d as Data), ...j }))
      return true
    } catch (e: any) { setErr(String(e?.message || e)); return false } finally { setBusy(null) }
  }, [])

  const byBand = useMemo(() => {
    const m: Record<Band, Row[]> = { morning: [], midday: [], afternoon: [], evening: [] }
    for (const r of (data?.rows || [])) m[r.band]?.push(r)
    return m
  }, [data?.rows])

  if (!data) {
    return <div className="py-16 text-center text-[13px] text-muted inline-flex items-center gap-2 w-full justify-center">
      <Loader2 size={14} className="animate-spin" /> Loading today…
    </div>
  }

  const p = data.progress
  const dayLabel = data.day
    ? new Date(data.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
    : ''
  const canTick = data.canTick !== false

  return (
    <div className="pb-16">
      <header className="mb-4">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-muted inline-flex items-center gap-1.5">
          <ClipboardCheck size={12} /> Operations
        </p>
        <div className="flex items-start gap-3 flex-wrap mt-1">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-ink tracking-tight">Daily Checklist</h1>
            <p className="text-[13px] text-muted mt-0.5">{dayLabel}{data.clock ? ` · it is ${clockLabel(data.clock)}` : ''}</p>
          </div>
          {data.canManage && (
            <button onClick={() => setManage(m => !m)}
              className={'rounded-xl border px-2.5 py-1.5 text-[12px] font-bold ' + (manage ? 'bg-ink text-white border-ink' : 'border-line bg-white text-muted hover:text-ink')}>
              <Pencil size={12} className="inline mr-1" />{manage ? 'Done editing' : 'Edit the list'}
            </button>
          )}
        </div>

        {/* HOW THE DAY IS GOING. Late is its own number and its own colour, because it is the only
            one that asks somebody to move. */}
        <div className="mt-3 rounded-2xl border border-line bg-white px-4 py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[19px] font-bold text-ink tabular-nums">{p.done}<span className="text-muted font-semibold text-[15px]">/{p.total}</span></span>
            <span className="text-[12.5px] text-muted">done</span>
            {p.late > 0 && (
              <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-rose-700">
                <AlertTriangle size={13} /> {p.late} past due
              </span>
            )}
            {p.late === 0 && p.done === p.total && p.total > 0 && (
              <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-emerald-700">
                <CheckCircle2 size={13} /> Everything done
              </span>
            )}
            {p.next && (
              <span className="ml-auto text-[12.5px] text-muted">
                Next: <span className="font-semibold text-ink">{p.next.title}</span> by {clockLabel(p.next.by_time)}
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-app overflow-hidden">
            <div className={'h-full ' + (p.late ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: p.pct + '%' }} />
          </div>
        </div>
        {err && <p className="mt-2 text-[12.5px] text-rose-700">{err}</p>}
      </header>

      {p.total === 0 && (
        <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center">
          <p className="text-[14px] font-semibold text-ink">Nothing on the list yet.</p>
          <p className="text-[12.5px] text-muted mt-1 max-w-md mx-auto">
            {data.canManage
              ? 'Add the things that have to happen every single day — the ones you would notice if nobody did them.'
              : 'A manager sets the daily list. It will appear here.'}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {BANDS.map(band => {
          const rows = byBand[band.key]
          if (!rows.length && !manage) return null
          const bandDone = rows.filter(r => r.done).length
          const bandLate = rows.filter(r => r.late).length
          const I = band.Icon
          return (
            <section key={band.key} className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="px-3 py-2 bg-app/60 border-b border-line flex items-center gap-2">
                <I size={14} className="text-muted" />
                <span className="text-[12.5px] font-bold text-ink">{band.label}</span>
                <span className="text-[11.5px] text-muted hidden sm:inline">{band.hint}</span>
                {bandLate > 0 && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-600 text-white">{bandLate} late</span>}
                <span className="ml-auto text-[11.5px] text-muted tabular-nums">{bandDone}/{rows.length}</span>
              </div>

              <div className="divide-y divide-line">
                {rows.map(r => (
                  <ItemRow key={r.id} r={r} busy={busy} act={act} canTick={canTick} manage={manage} />
                ))}
                {rows.length === 0 && <p className="px-3 py-3 text-[12px] text-muted">Nothing in this part of the day.</p>}
                {manage && <AddItem band={band.key} act={act} busy={busy} nextSort={(rows[rows.length - 1]?.sort || 0) + 10} />}
              </div>
            </section>
          )
        })}
      </div>

      <p className="text-[11.5px] text-muted mt-4 px-1">
        The list starts clean every morning — nothing carries over. Whoever does a thing ticks it, and their name goes next to it.
      </p>
    </div>
  )
}

function ItemRow({ r, busy, act, canTick, manage }: {
  r: Row; busy: string | null; act: (b: any, k: string) => Promise<boolean>; canTick: boolean; manage: boolean
}) {
  const [open, setOpen] = useState(false)
  const due = clockLabel(r.by_time)
  const soon = !r.done && r.in_minutes != null && r.in_minutes >= 0 && r.in_minutes <= 30
  return (
    <div className={'px-3 py-2.5 ' + (r.late ? 'bg-rose-50/60' : '')}>
      <div className="flex items-start gap-2.5">
        <button
          onClick={() => canTick && act({ action: 'tick', itemId: r.id, done: !r.done }, r.id)}
          disabled={!canTick || busy === r.id}
          title={canTick ? (r.done ? 'Mark not done' : 'Mark done') : 'You can see the list but not tick it'}
          className={'mt-0.5 w-5 h-5 rounded-md border-2 grid place-items-center shrink-0 disabled:opacity-50 ' +
            (r.done ? 'bg-emerald-600 border-emerald-600 text-white'
              : r.late ? 'border-rose-400 text-rose-500 hover:bg-rose-100'
              : 'border-line text-transparent hover:border-ink/40')}>
          {busy === r.id ? <Loader2 size={11} className="animate-spin text-muted" /> : <Check size={12} strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={'text-[13.5px] leading-snug ' + (r.done ? 'text-muted line-through' : 'text-ink font-medium')}>{r.title}</span>
            {due && (
              <span className={'text-[11px] font-bold tabular-nums inline-flex items-center gap-0.5 ' +
                (r.done ? 'text-muted' : r.late ? 'text-rose-700' : soon ? 'text-amber-700' : 'text-muted')}>
                <Clock size={10} />{r.late ? 'was due ' : 'by '}{due}
              </span>
            )}
            {r.owner_role && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-app text-muted ring-1 ring-line">{r.owner_role}</span>}
          </div>

          {r.detail && !r.done && <p className="text-[12px] text-muted mt-0.5 leading-snug">{r.detail}</p>}

          {r.done && (
            <p className="text-[11.5px] text-emerald-700 font-semibold mt-0.5">
              {firstName(r.done_by) || 'Someone'} · {shortTime(r.done_at)}
            </p>
          )}
        </div>

        {manage && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => setOpen(o => !o)} className="text-muted hover:text-ink" title="Edit"><Pencil size={12} /></button>
            <button
              onClick={() => act({ action: 'itemRetire', itemId: r.id }, 'retire' + r.id)}
              disabled={busy === 'retire' + r.id}
              className="text-muted hover:text-rose-600" title="Take this off the daily list"><Trash2 size={12} /></button>
          </div>
        )}
      </div>

      {manage && open && <EditItem r={r} act={act} busy={busy} onClose={() => setOpen(false)} />}
    </div>
  )
}

function EditItem({ r, act, busy, onClose }: { r: Row; act: (b: any, k: string) => Promise<boolean>; busy: string | null; onClose: () => void }) {
  const [title, setTitle] = useState(r.title)
  const [detail, setDetail] = useState(r.detail || '')
  const [byTime, setByTime] = useState((r.by_time || '').slice(0, 5))
  const [role, setRole] = useState(r.owner_role || '')
  const [band, setBand] = useState<Band>(r.band)
  return (
    <div className="mt-2 ml-7 rounded-lg border border-line bg-app/40 p-2.5 space-y-2">
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What has to happen"
        className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] font-semibold" />
      <input value={detail} onChange={e => setDetail(e.target.value)} placeholder="What done looks like"
        className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px]" />
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-0.5">By</span>
          <input type="time" value={byTime} onChange={e => setByTime(e.target.value)} className="w-full rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-0.5">Part of day</span>
          <select value={band} onChange={e => setBand(e.target.value as Band)} className="w-full rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]">
            {BANDS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-0.5">Who</span>
          <input value={role} onChange={e => setRole(e.target.value)} placeholder="Front desk" className="w-full rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onClose} className="text-[12px] font-semibold text-muted hover:text-ink">Cancel</button>
        <button
          onClick={async () => { if (await act({ action: 'itemSet', itemId: r.id, title, detail, by_time: byTime, band, owner_role: role }, 'edit' + r.id)) onClose() }}
          disabled={busy === 'edit' + r.id || !title.trim()}
          className="ml-auto rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-bold disabled:opacity-40">Save</button>
      </div>
    </div>
  )
}

function AddItem({ band, act, busy, nextSort }: { band: Band; act: (b: any, k: string) => Promise<boolean>; busy: string | null; nextSort: number }) {
  const [on, setOn] = useState(false)
  const [title, setTitle] = useState('')
  const [byTime, setByTime] = useState('')
  const [role, setRole] = useState('')
  const key = 'add' + band

  if (!on) {
    return (
      <button onClick={() => setOn(true)} className="w-full px-3 py-2 text-left text-[12.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1.5">
        <Plus size={12} /> Add to {BANDS.find(b => b.key === band)?.label.toLowerCase()}
      </button>
    )
  }
  return (
    <div className="px-3 py-2.5 bg-app/40 space-y-2">
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="What has to happen every day?"
        className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px]" />
      <div className="flex items-center gap-2 flex-wrap">
        <input type="time" value={byTime} onChange={e => setByTime(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
        <input value={role} onChange={e => setRole(e.target.value)} placeholder="Who (optional)" className="flex-1 min-w-[120px] rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
        <button onClick={() => { setOn(false); setTitle('') }} className="text-muted hover:text-ink"><X size={14} /></button>
        <button
          onClick={async () => { if (await act({ action: 'itemAdd', title, band, by_time: byTime, owner_role: role, sort: nextSort }, key)) { setTitle(''); setByTime(''); setRole(''); setOn(false) } }}
          disabled={busy === key || !title.trim()}
          className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-bold disabled:opacity-40">Add</button>
      </div>
    </div>
  )
}
