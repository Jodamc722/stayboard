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
import Link from 'next/link'
import {
  Loader2, Check, Clock, Plus, X, Pencil, Trash2, Sunrise, Sun, Sunset, Moon, ArrowUpRight,
} from 'lucide-react'
import { LeanHead, Pill, Tag, Tip, IconBtn, LeanList, LeanRow, LeanSection, LeanEmpty } from '@/components/lean'

import { clockLabel, signalLabel, SIGNAL_META, type Band } from '@/lib/checklist-shared'
type Row = {
  id: string; title: string; detail: string | null
  band: Band; by_time: string | null; owner_role: string | null; sort: number | null; active: boolean
  link: string | null; signal: string | null
  done: boolean; done_at: string | null; done_by: string | null; note: string | null
  late: boolean; in_minutes: number | null
}
type Data = {
  day: string; clock: string; rows: Row[]
  /** Live counts for the signals this list names, keyed by signal. Missing or null = no chip. */
  signals?: Record<string, number | null>
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

// THE CHIP. The server sends the NUMBER and lib/checklist-shared owns the wording. Zero is good
// news on every signal here, so the tag goes quiet rather than loud.

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
      <LeanHead title="Daily Checklist">
        <Pill title={dayLabel + (data.clock ? ' · it is ' + clockLabel(data.clock) : '')}>{data.clock ? clockLabel(data.clock) : dayLabel}</Pill>
        <Pill tone={p.total > 0 && p.done === p.total ? 'emerald' : 'slate'} title={p.pct + '% of today done'}>{p.done}/{p.total} done</Pill>
        {/* Late is its own number and colour — the only one that asks somebody to move. */}
        {p.late > 0 && <Pill tone="roseSolid" title="Items whose time has passed without a tick">{p.late} late</Pill>}
        {p.next && <Pill tone="brand" title={'Next due: ' + p.next.title + ' by ' + clockLabel(p.next.by_time)}>Next {clockLabel(p.next.by_time)}</Pill>}
        {data.canManage && (
          <button onClick={() => setManage(m => !m)}
            className={'rounded-lg border px-2 py-1 text-[12px] font-semibold inline-flex items-center gap-1 ' + (manage ? 'bg-ink text-white border-ink' : 'border-line bg-white text-muted hover:text-ink')}>
            <Pencil size={11} />{manage ? 'Done' : 'Edit list'}
          </button>
        )}
      </LeanHead>
      {err && <p className="mb-2 text-[12.5px] text-rose-700">{err}</p>}

      {p.total === 0 && !manage && (
        <LeanEmpty>{data.canManage ? 'Nothing on the list yet — Edit list to add the things that must happen every day.' : 'Nothing on the list yet. A manager sets it.'}</LeanEmpty>
      )}

      {/* Fresh every morning, nothing carried; whoever ticks is recorded. */}
      {BANDS.map(band => {
        const rows = byBand[band.key]
        if (!rows.length && !manage) return null
        const bandDone = rows.filter(r => r.done).length
        const bandLate = rows.filter(r => r.late).length
        const I = band.Icon
        return (
          <LeanSection key={band.key}
            title={<span className="inline-flex items-center gap-1.5" title={band.hint}><I size={12} />{band.label}</span>}
            tone={bandLate > 0 ? 'rose' : undefined}
            right={<span className="tabular-nums text-muted">{bandLate > 0 ? <span className="text-rose-700 font-semibold">{bandLate} late · </span> : null}{bandDone}/{rows.length}</span>}>
            <LeanList>
              {rows.map(r => (
                <ItemRow key={r.id} r={r} busy={busy} act={act} canTick={canTick} manage={manage}
                  count={r.signal ? (data.signals?.[r.signal] ?? null) : null} />
              ))}
              {rows.length === 0 && <li className="px-4 py-2 text-[12px] text-muted">Nothing in this part of the day.</li>}
              {manage && <AddItem band={band.key} act={act} busy={busy} nextSort={(rows[rows.length - 1]?.sort || 0) + 10} />}
            </LeanList>
          </LeanSection>
        )
      })}
    </div>
  )
}

function ItemRow({ r, busy, act, canTick, manage, count }: {
  r: Row; busy: string | null; act: (b: any, k: string) => Promise<boolean>; canTick: boolean; manage: boolean
  count: number | null
}) {
  const [open, setOpen] = useState(false)
  const due = clockLabel(r.by_time)
  const soon = !r.done && r.in_minutes != null && r.in_minutes >= 0 && r.in_minutes <= 30
  const chip = signalLabel(r.signal, count)
  const hasDetail = !!r.detail || manage
  const tick = (
    <Tip label={canTick ? (r.done ? 'Mark not done' : 'Mark done') : 'You can see the list but not tick it'}>
      <button
        onClick={() => canTick && act({ action: 'tick', itemId: r.id, done: !r.done }, r.id)}
        disabled={!canTick || busy === r.id}
        aria-label={r.done ? 'Mark not done' : 'Mark done'}
        className={'w-5 h-5 rounded-md border-2 grid place-items-center shrink-0 disabled:opacity-50 ' +
          (r.done ? 'bg-emerald-600 border-emerald-600 text-white'
            : r.late ? 'border-rose-400 text-rose-500 hover:bg-rose-100'
            : 'border-line text-transparent hover:border-ink/40')}>
        {busy === r.id ? <Loader2 size={11} className="animate-spin text-muted" /> : <Check size={12} strokeWidth={3} />}
      </button>
    </Tip>
  )
  return (
    <LeanRow
      lead={tick}
      tint={r.late ? 'rose' : undefined}
      open={open} onToggle={() => setOpen(o => !o)}
      name={<span className={r.done ? 'text-muted line-through font-medium' : ''}>{r.title}</span>}
      tags={<>
        {due && (
          <Tag tone={r.done ? 'slate' : r.late ? 'rose' : soon ? 'amber' : 'slate'} title={r.late ? 'Was due by ' + due : 'Due by ' + due}>
            <span className="inline-flex items-center gap-0.5"><Clock size={9} />{due}</span>
          </Tag>
        )}
        {chip && !r.done && <Tag tone={(count || 0) > 0 ? 'amber' : 'slate'} title="Live count">{chip}</Tag>}
        {r.owner_role && <Tag title="Who does it">{r.owner_role}</Tag>}
        {r.done && <Tag tone="emerald" title={'Ticked by ' + (r.done_by || 'someone') + ' at ' + shortTime(r.done_at)}>{firstName(r.done_by) || 'Someone'} · {shortTime(r.done_at)}</Tag>}
      </>}
      actions={<>
        {/* The link is where the instruction is carried out. It does NOT tick the item — going to
            look at something is not having done it. */}
        {r.link && <Link href={r.link} aria-label="Open where this gets done"><Tip label="Open where this gets done"><span className="shrink-0 inline-flex items-center justify-center rounded-lg border border-line bg-white w-8 h-8 text-muted hover:text-ink hover:bg-app"><ArrowUpRight size={14} /></span></Tip></Link>}
        {manage && <IconBtn title="Edit this item" onClick={() => setOpen(o => !o)}><Pencil size={13} /></IconBtn>}
        {manage && (
          <IconBtn title="Take this off the daily list" tone="bad" disabled={busy === 'retire' + r.id}
            onClick={() => act({ action: 'itemRetire', itemId: r.id }, 'retire' + r.id)}><Trash2 size={13} /></IconBtn>
        )}
      </>}>
      {hasDetail ? <>
        {r.detail && <p className="text-[12.5px] text-muted">{r.detail}</p>}
        {manage && <EditItem r={r} act={act} busy={busy} onClose={() => setOpen(false)} />}
      </> : null}
    </LeanRow>
  )
}

function EditItem({ r, act, busy, onClose }: { r: Row; act: (b: any, k: string) => Promise<boolean>; busy: string | null; onClose: () => void }) {
  const [title, setTitle] = useState(r.title)
  const [detail, setDetail] = useState(r.detail || '')
  const [byTime, setByTime] = useState((r.by_time || '').slice(0, 5))
  const [role, setRole] = useState(r.owner_role || '')
  const [band, setBand] = useState<Band>(r.band)
  const [link, setLink] = useState(r.link || '')
  const [signal, setSignal] = useState(r.signal || '')
  return (
    <div className="rounded-lg border border-line bg-app/40 p-2.5 space-y-2">
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
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-0.5">Opens</span>
          <input value={link} onChange={e => setLink(e.target.value)} placeholder="/glitches"
            className="w-full rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-0.5">Live count</span>
          <select value={signal} onChange={e => setSignal(e.target.value)} className="w-full rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]">
            <option value="">None</option>
            {Object.entries(SIGNAL_META).map(([k, m]) => <option key={k} value={k}>{m.title}</option>)}
            {signal && !SIGNAL_META[signal] && <option value={signal}>{signal} (unknown)</option>}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onClose} className="text-[12px] font-semibold text-muted hover:text-ink">Cancel</button>
        <button
          onClick={async () => { if (await act({ action: 'itemSet', itemId: r.id, title, detail, by_time: byTime, band, owner_role: role, link, signal }, 'edit' + r.id)) onClose() }}
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
      <li><button onClick={() => setOn(true)} className="w-full px-4 py-2 text-left text-[12.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1.5">
        <Plus size={12} /> Add to {BANDS.find(b => b.key === band)?.label.toLowerCase()}
      </button></li>
    )
  }
  return (
    <li className="px-4 py-2.5 bg-app/40 space-y-2">
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="What has to happen every day?"
        className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px]" />
      <div className="flex items-center gap-2 flex-wrap">
        <input type="time" value={byTime} onChange={e => setByTime(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
        <input value={role} onChange={e => setRole(e.target.value)} placeholder="Who (optional)" className="flex-1 min-w-[120px] rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
        <IconBtn title="Cancel" onClick={() => { setOn(false); setTitle('') }}><X size={14} /></IconBtn>
        <button
          onClick={async () => { if (await act({ action: 'itemAdd', title, band, by_time: byTime, owner_role: role, sort: nextSort }, key)) { setTitle(''); setByTime(''); setRole(''); setOn(false) } }}
          disabled={busy === key || !title.trim()}
          className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-bold disabled:opacity-40">Add</button>
      </div>
    </li>
  )
}
