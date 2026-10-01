'use client'
// THE STAY HOSPITALITY DAILY CHECKLIST — forward-facing, built of steps (Jon, 2026-10-01: "make the
// checklist more forward facing … built with actionable steps … robust and team friendly").
//
// Jon, 2026-09-15: "a time-sensitive checklist that we build based on things that have to happen
// every single day." TIME IS THE ORGANISING IDEA. What changed on 2026-10-01 is the ORDER the page
// reads in: the thing you should be doing NOW is at the top, big, with its steps open; what is late
// is right under it in red; the rest of the day follows in its bands; what is done folds away at the
// bottom. The old page put the morning's crossed-out ticks first and the next job three scrolls down.
//
// EVERY ITEM IS A SHORT PROCEDURE. The detail field holds the steps, one per line (lib/checklist-
// shared parseDetail); items without their own get a default set matched on the title (STEP_GUIDE).
// Steps are ticked locally as you work — they are a guide, not a record; the record is the item tick.
//
// TEAM FRIENDLY: a role filter ("Front desk", "Housekeeping", …) remembered on this device, the live
// count next to each item ("3 not started"), an Open button to the tab where the work happens, Done
// with your name on it, and "Can't" with a note so an item that is honestly not doable today says so
// instead of sitting red or being ticked blind.
//
// Three decisions kept from the first version: fresh every morning, nothing carried; anyone may
// tick and the tick records who; the standing list is edited separately, behind full access.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Loader2, Check, Clock, Plus, X, Pencil, Trash2, Sunrise, Sun, Sunset, Moon, ArrowUpRight, AlertTriangle, ChevronDown, ChevronRight, MessageSquareWarning,
} from 'lucide-react'
import { LeanHead, Pill, Tag, Tip, IconBtn, LeanList, LeanRow, LeanSection, LeanEmpty } from '@/components/lean'
import { clockLabel, signalLabel, SIGNAL_META, stepsFor, parseDetail, joinDetail, ROLES, type Band } from '@/lib/checklist-shared'

type Row = {
  id: string; title: string; detail: string | null
  band: Band; by_time: string | null; owner_role: string | null; sort: number | null; active: boolean
  link: string | null; signal: string | null
  done: boolean; done_at: string | null; done_by: string | null; note: string | null
  late: boolean; in_minutes: number | null
}
type Data = {
  day: string; clock: string; rows: Row[]
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
const NOT_DONE = 'Not done: '
const shortTime = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
}
const firstName = (s: string | null) => String(s || '').split(/[\s@]/)[0]
const mins = (n: number) => n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ' ' + (n % 60) + 'm' : ''}` : `${n}m`
/** "late by 25m" / "due in 40m" / "due 2:00 PM" — the one phrase that tells you what to do with the time. */
function whenLabel(r: Row): { text: string; tone: 'rose' | 'amber' | 'slate' } {
  const due = clockLabel(r.by_time)
  if (!due) return { text: 'anytime today', tone: 'slate' }
  if (r.late) return { text: `late by ${mins(Math.abs(r.in_minutes || 0))} · was due ${due}`, tone: 'rose' }
  if (r.in_minutes != null && r.in_minutes <= 45) return { text: `due in ${mins(r.in_minutes)} · ${due}`, tone: 'amber' }
  return { text: `due ${due}`, tone: 'slate' }
}
const ls = {
  get(k: string): string | null { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}

export function DailyChecklist({ embedded }: { embedded?: boolean } = {}) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [manage, setManage] = useState(false)
  const [role, setRole] = useState<string>('')
  const [showDone, setShowDone] = useState(false)
  useEffect(() => { setRole(ls.get('checklist.role') || '') }, [])
  const pickRole = (r: string) => { setRole(r); ls.set('checklist.role', r) }

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/daily-checklist', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j?.error) throw new Error(j?.error || 'Could not load the checklist.')
      setData(j)
    } catch (e: any) { setErr(String(e?.message || e)); setData(d => d || ({ day: '', clock: '', rows: [], progress: { total: 0, done: 0, late: 0, pct: 0, next: null } } as Data)) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(load, 60_000); return () => clearInterval(t) }, [load])

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

  const rows = useMemo(() => (data?.rows || []).filter(r => !role || !r.owner_role || r.owner_role.toLowerCase() === role.toLowerCase()), [data?.rows, role])
  const open = rows.filter(r => !r.done)
  const late = open.filter(r => r.late)
  // UP NEXT: the late ones first (oldest first), then whatever is due soonest. Three at most, so the
  // top of the page is a job, not another list.
  const upNext = useMemo(() => {
    const soon = open.filter(r => !r.late).sort((a, b) => (a.in_minutes ?? 9e9) - (b.in_minutes ?? 9e9))
    return [...late.sort((a, b) => (a.in_minutes ?? 0) - (b.in_minutes ?? 0)), ...soon].slice(0, 3)
  }, [open, late])
  const upNextIds = new Set(upNext.map(r => r.id))
  const byBand = useMemo(() => {
    const m: Record<Band, Row[]> = { morning: [], midday: [], afternoon: [], evening: [] }
    for (const r of rows) if (!r.done && !upNextIds.has(r.id)) m[r.band]?.push(r)
    return m
  }, [rows, upNext]) // eslint-disable-line react-hooks/exhaustive-deps
  const doneRows = rows.filter(r => r.done)

  if (!data) {
    return <div className="py-16 text-center text-[13px] text-muted inline-flex items-center gap-2 w-full justify-center">
      <Loader2 size={14} className="animate-spin" /> Loading today…
    </div>
  }

  const p = data.progress
  const dayLabel = data.day ? new Date(data.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : ''
  const canTick = data.canTick !== false
  const count = (r: Row) => (r.signal ? (data.signals?.[r.signal] ?? null) : null)
  const allDone = p.total > 0 && open.length === 0

  return (
    <div className={embedded ? '' : 'pb-16'}>
      {!embedded && (
        <LeanHead title="Daily Checklist">
          <Pill title={dayLabel + (data.clock ? ' · it is ' + clockLabel(data.clock) : '')}>{data.clock ? clockLabel(data.clock) : dayLabel}</Pill>
          <Pill tone={allDone ? 'emerald' : 'slate'} title={p.pct + '% of today done'}>{p.done}/{p.total} done</Pill>
          {p.late > 0 && <Pill tone="roseSolid" title="Items whose time has passed without a tick">{p.late} late</Pill>}
          {data.canManage && (
            <button onClick={() => setManage(m => !m)}
              className={'rounded-lg border px-2 py-1 text-[12px] font-semibold inline-flex items-center gap-1 ' + (manage ? 'bg-ink text-white border-ink' : 'border-line bg-white text-muted hover:text-ink')}>
              <Pencil size={11} />{manage ? 'Done editing' : 'Edit list'}
            </button>
          )}
        </LeanHead>
      )}

      {/* WHOSE LIST: one tap, remembered on this phone or laptop. Items with no role show for everyone. */}
      <div className="mb-3 flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted mr-1">Show</span>
        {['', ...ROLES].map(r => (
          <button key={r || 'all'} onClick={() => pickRole(r)} aria-pressed={role === r}
            className={'text-[11.5px] font-semibold px-2.5 py-1 rounded-full border ' + (role === r ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>
            {r || 'Everyone'}
          </button>
        ))}
        {!embedded && <span className="ml-auto text-[11.5px] text-muted hidden sm:inline">{dayLabel}</span>}
      </div>
      {err && <p className="mb-2 text-[12.5px] text-rose-700">{err}</p>}

      {p.total === 0 && !manage && (
        <LeanEmpty>{data.canManage ? 'Nothing on the list yet — Edit list to add the things that must happen every day.' : 'Nothing on the list yet. A manager sets it.'}</LeanEmpty>
      )}
      {allDone && !manage && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-900 inline-flex items-center gap-2 w-full"><Check size={15} /> Everything on today's list is done{role ? ' for ' + role : ''}.</div>
      )}

      {/* UP NEXT — the job, big, steps open. */}
      {upNext.length > 0 && !manage && (
        <section className="mb-5">
          <h2 className="px-1 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-ink flex items-center gap-2">
            {late.length ? <><AlertTriangle size={12} className="text-rose-600" /> Late, then next</> : 'Up next'}
            <span className="normal-case tracking-normal font-medium text-muted">— {late.length ? `${late.length} past ${late.length === 1 ? 'its' : 'their'} time` : 'in order of when it is due'}</span>
          </h2>
          <div className="grid gap-2 lg:grid-cols-3">
            {upNext.map((r, i) => <NextCard key={r.id} r={r} first={i === 0} count={count(r)} busy={busy} act={act} canTick={canTick} day={data.day} />)}
          </div>
        </section>
      )}

      {/* THE REST OF TODAY, in its bands. Done rows are not here — they fold away below. */}
      {BANDS.map(band => {
        const list = manage ? rows.filter(r => r.band === band.key) : byBand[band.key]
        if (!list.length && !manage) return null
        const I = band.Icon
        const bandLate = list.filter(r => r.late).length
        return (
          <LeanSection key={band.key}
            title={<span className="inline-flex items-center gap-1.5" title={band.hint}><I size={12} />{band.label}</span>}
            tone={bandLate > 0 ? 'rose' : undefined}
            right={<span className="tabular-nums text-muted">{bandLate > 0 ? <span className="text-rose-700 font-semibold">{bandLate} late · </span> : null}{list.length} to do</span>}>
            <LeanList>
              {list.map(r => <ItemRow key={r.id} r={r} busy={busy} act={act} canTick={canTick} manage={manage} count={count(r)} day={data.day} />)}
              {list.length === 0 && <li className="px-4 py-2 text-[12px] text-muted">Nothing in this part of the day.</li>}
              {manage && <AddItem band={band.key} act={act} busy={busy} nextSort={(list[list.length - 1]?.sort || 0) + 10} />}
            </LeanList>
          </LeanSection>
        )
      })}

      {/* DONE, folded. Who and when, and the note when it was a "can't". */}
      {doneRows.length > 0 && !manage && (
        <section className="mt-2">
          <button onClick={() => setShowDone(s => !s)} className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted hover:text-ink inline-flex items-center gap-1">
            {showDone ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Done today · {doneRows.length}
          </button>
          {showDone && (
            <LeanList>
              {doneRows.map(r => <ItemRow key={r.id} r={r} busy={busy} act={act} canTick={canTick} manage={false} count={null} day={data.day} />)}
            </LeanList>
          )}
        </section>
      )}
    </div>
  )
}

// ── STEPS, ticked locally while you work ─────────────────────────────────────────────────────────
function useSteps(itemId: string, day: string, n: number) {
  const key = `checklist.steps.${day}.${itemId}`
  const [done, setDone] = useState<boolean[]>(() => Array(n).fill(false))
  useEffect(() => { try { const v = ls.get(key); if (v) setDone(JSON.parse(v)) } catch { /* fresh */ } }, [key])
  const toggle = (i: number) => setDone(d => { const next = d.slice(); next[i] = !next[i]; ls.set(key, JSON.stringify(next)); return next })
  return { done, toggle }
}
function Steps({ r, day, steps, fromGuide }: { r: Row; day: string; steps: string[]; fromGuide: boolean }) {
  const { done, toggle } = useSteps(r.id, day, steps.length)
  if (!steps.length) return null
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2 text-[12.5px] leading-snug">
          <button onClick={() => toggle(i)} aria-label={done[i] ? 'Step done' : 'Step to do'} disabled={r.done}
            className={'mt-[2px] w-4 h-4 rounded border grid place-items-center shrink-0 ' + (done[i] || r.done ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-line text-transparent hover:border-ink/40')}>
            <Check size={10} strokeWidth={3} />
          </button>
          <span className={done[i] || r.done ? 'text-muted line-through' : 'text-ink'}>{s}</span>
        </li>
      ))}
      {fromGuide && <li className="text-[10.5px] text-muted pl-6">Standard steps — a manager can write this item's own in Edit list.</li>}
    </ol>
  )
}

/** "Can't do it" — a tick with a note, shown amber so nobody reads it as done. */
function CantButton({ r, act, busy }: { r: Row; act: (b: any, k: string) => Promise<boolean>; busy: string | null }) {
  const [on, setOn] = useState(false)
  const [note, setNote] = useState('')
  if (!on) return <button onClick={() => setOn(true)} className="text-[11.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1" title="Not doable today — say why, so the next person knows"><MessageSquareWarning size={12} /> Can't</button>
  return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="Why not today?" className="rounded-lg border border-line bg-white px-2 py-1 text-[12px] w-44"
        onKeyDown={async e => { if (e.key === 'Enter' && note.trim()) { if (await act({ action: 'tick', itemId: r.id, done: true, note: NOT_DONE + note.trim() }, r.id)) setOn(false) } if (e.key === 'Escape') setOn(false) }} />
      <button onClick={async () => { if (note.trim() && await act({ action: 'tick', itemId: r.id, done: true, note: NOT_DONE + note.trim() }, r.id)) setOn(false) }} disabled={!note.trim() || busy === r.id} className="text-[11.5px] font-bold px-2 py-1 rounded-lg bg-amber-600 text-white disabled:opacity-40">Save</button>
      <button onClick={() => setOn(false)} className="text-muted"><X size={13} /></button>
    </span>
  )
}

function NextCard({ r, first, count, busy, act, canTick, day }: { r: Row; first: boolean; count: number | null; busy: string | null; act: (b: any, k: string) => Promise<boolean>; canTick: boolean; day: string }) {
  const w = whenLabel(r)
  const { summary, steps, fromGuide } = stepsFor(r.title, r.detail)
  const chip = signalLabel(r.signal, count)
  const link = r.link || (r.signal && SIGNAL_META[r.signal]?.link) || null
  const border = w.tone === 'rose' ? 'border-rose-300 bg-rose-50/50' : w.tone === 'amber' ? 'border-amber-300 bg-amber-50/40' : 'border-line bg-white'
  return (
    <div className={'rounded-xl border p-3 flex flex-col gap-2 ' + border + (first ? ' lg:col-span-1 ring-1 ring-ink/5' : '')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={'text-[11px] font-bold uppercase tracking-wider ' + (w.tone === 'rose' ? 'text-rose-700' : w.tone === 'amber' ? 'text-amber-800' : 'text-muted')}>{w.text}</p>
          <p className="text-[14px] font-bold text-ink leading-snug">{r.title}</p>
          <p className="text-[11.5px] text-muted flex items-center gap-1.5 flex-wrap mt-0.5">
            {r.owner_role && <span>{r.owner_role}</span>}
            {chip && <Tag tone={(count || 0) > 0 ? 'amber' : 'emerald'} title="Live count from the app">{chip}</Tag>}
          </p>
        </div>
      </div>
      {summary && <p className="text-[12px] text-muted leading-snug">{summary}</p>}
      <Steps r={r} day={day} steps={steps} fromGuide={fromGuide} />
      <div className="mt-auto pt-1 flex items-center gap-2 flex-wrap">
        {link && <Link href={link} prefetch={false} className="text-[12px] font-bold px-2.5 py-1.5 rounded-lg border border-line bg-white text-ink hover:bg-app inline-flex items-center gap-1">Open <ArrowUpRight size={12} /></Link>}
        {canTick && (
          <button onClick={() => act({ action: 'tick', itemId: r.id, done: true }, r.id)} disabled={busy === r.id}
            className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-ink text-white disabled:opacity-50 inline-flex items-center gap-1">
            {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done
          </button>
        )}
        {canTick && <span className="ml-auto"><CantButton r={r} act={act} busy={busy} /></span>}
      </div>
    </div>
  )
}

function ItemRow({ r, busy, act, canTick, manage, count, day }: {
  r: Row; busy: string | null; act: (b: any, k: string) => Promise<boolean>; canTick: boolean; manage: boolean
  count: number | null; day: string
}) {
  const [open, setOpen] = useState(false)
  const w = whenLabel(r)
  const chip = signalLabel(r.signal, count)
  const { summary, steps, fromGuide } = stepsFor(r.title, r.detail)
  const link = r.link || (r.signal && SIGNAL_META[r.signal]?.link) || null
  const cant = !!(r.note && r.note.startsWith(NOT_DONE))
  const tick = (
    <Tip label={canTick ? (r.done ? 'Mark not done' : 'Mark done') : 'You can see the list but not tick it'}>
      <button
        onClick={() => canTick && act({ action: 'tick', itemId: r.id, done: !r.done }, r.id)}
        disabled={!canTick || busy === r.id}
        aria-label={r.done ? 'Mark not done' : 'Mark done'}
        className={'w-5 h-5 rounded-md border-2 grid place-items-center shrink-0 disabled:opacity-50 ' +
          (r.done ? (cant ? 'bg-amber-500 border-amber-500 text-white' : 'bg-emerald-600 border-emerald-600 text-white')
            : r.late ? 'border-rose-400 text-rose-500 hover:bg-rose-100'
            : 'border-line text-transparent hover:border-ink/40')}>
        {busy === r.id ? <Loader2 size={11} className="animate-spin text-muted" /> : cant ? <X size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
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
        {!r.done && <Tag tone={w.tone} title={w.text}><span className="inline-flex items-center gap-0.5"><Clock size={9} />{w.text.split(' · ')[0]}</span></Tag>}
        {chip && !r.done && <Tag tone={(count || 0) > 0 ? 'amber' : 'slate'} title="Live count from the app">{chip}</Tag>}
        {r.owner_role && <Tag title="Who does it">{r.owner_role}</Tag>}
        {steps.length > 0 && !r.done && <Tag title="Steps inside">{steps.length} steps</Tag>}
        {r.done && <Tag tone={cant ? 'amber' : 'emerald'} title={(cant ? 'Marked not doable by ' : 'Ticked by ') + (r.done_by || 'someone') + ' at ' + shortTime(r.done_at)}>{cant ? 'not done' : 'done'} · {firstName(r.done_by) || 'someone'} · {shortTime(r.done_at)}</Tag>}
      </>}
      actions={<>
        {link && !r.done && <Link href={link} prefetch={false} aria-label="Open where this gets done"><Tip label="Open where this gets done"><span className="shrink-0 inline-flex items-center justify-center rounded-lg border border-line bg-white w-8 h-8 text-muted hover:text-ink hover:bg-app"><ArrowUpRight size={14} /></span></Tip></Link>}
        {manage && <IconBtn title="Edit this item" onClick={() => setOpen(o => !o)}><Pencil size={13} /></IconBtn>}
        {manage && (
          <IconBtn title="Take this off the daily list" tone="bad" disabled={busy === 'retire' + r.id}
            onClick={() => act({ action: 'itemRetire', itemId: r.id }, 'retire' + r.id)}><Trash2 size={13} /></IconBtn>
        )}
      </>}>
      <div className="space-y-2">
        {cant && r.note && <p className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">{r.note.slice(NOT_DONE.length)} — {firstName(r.done_by)}</p>}
        {summary && <p className="text-[12.5px] text-muted">{summary}</p>}
        <Steps r={r} day={day} steps={steps} fromGuide={fromGuide} />
        {!r.done && canTick && !manage && <div className="flex items-center gap-2"><CantButton r={r} act={act} busy={busy} /></div>}
        {manage && <EditItem r={r} act={act} busy={busy} onClose={() => setOpen(false)} />}
      </div>
    </LeanRow>
  )
}

function EditItem({ r, act, busy, onClose }: { r: Row; act: (b: any, k: string) => Promise<boolean>; busy: string | null; onClose: () => void }) {
  const parsed = parseDetail(r.detail)
  const [title, setTitle] = useState(r.title)
  const [summary, setSummary] = useState(parsed.summary)
  const [steps, setSteps] = useState(parsed.steps.join('\n'))
  const [byTime, setByTime] = useState((r.by_time || '').slice(0, 5))
  const [role, setRole] = useState(r.owner_role || '')
  const [band, setBand] = useState<Band>(r.band)
  const [link, setLink] = useState(r.link || '')
  const [signal, setSignal] = useState(r.signal || '')
  const guide = stepsFor(r.title, null)
  return (
    <div className="rounded-lg border border-line bg-app/40 p-2.5 space-y-2">
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What has to happen (start with a verb)"
        className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] font-semibold" />
      <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="What done looks like, in one line"
        className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px]" />
      <label className="block">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted mb-0.5">Steps — one per line</span>
        <textarea value={steps} onChange={e => setSteps(e.target.value)} rows={4} placeholder={guide.steps.length ? guide.steps.join('\n') : 'Open the Today board\nCheck every clean has a person\nCall anyone who has not started'}
          className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] leading-snug" />
        {guide.steps.length > 0 && !steps.trim() && <button onClick={() => setSteps(guide.steps.join('\n'))} className="mt-1 text-[11.5px] font-semibold text-brand-700 hover:underline">Use the standard steps</button>}
      </label>
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
          <input value={role} onChange={e => setRole(e.target.value)} list="checklist-roles" placeholder="Front desk" className="w-full rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
          <datalist id="checklist-roles">{ROLES.map(x => <option key={x} value={x} />)}</datalist>
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
          onClick={async () => { if (await act({ action: 'itemSet', itemId: r.id, title, detail: joinDetail(summary, steps.split('\n')), by_time: byTime, band, owner_role: role, link, signal }, 'edit' + r.id)) onClose() }}
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
  const [steps, setSteps] = useState('')
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
      <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="What has to happen every day? Start with a verb."
        className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px]" />
      <textarea value={steps} onChange={e => setSteps(e.target.value)} rows={3} placeholder={'Steps, one per line (optional)'} className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] leading-snug" />
      <div className="flex items-center gap-2 flex-wrap">
        <input type="time" value={byTime} onChange={e => setByTime(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
        <input value={role} onChange={e => setRole(e.target.value)} list="checklist-roles" placeholder="Who (optional)" className="flex-1 min-w-[120px] rounded-lg border border-line bg-white px-2 py-1 text-[12.5px]" />
        <IconBtn title="Cancel" onClick={() => { setOn(false); setTitle('') }}><X size={14} /></IconBtn>
        <button
          onClick={async () => { if (await act({ action: 'itemAdd', title, detail: joinDetail('', steps.split('\n')), band, by_time: byTime, owner_role: role, sort: nextSort }, key)) { setTitle(''); setByTime(''); setRole(''); setSteps(''); setOn(false) } }}
          disabled={busy === key || !title.trim()}
          className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-bold disabled:opacity-40">Add</button>
      </div>
    </li>
  )
}
