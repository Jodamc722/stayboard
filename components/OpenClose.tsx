'use client'
// OPEN & CLOSE — the opening and closing roadmap, on the Checklist tab (Jon, 2026-10-19).
//
// THE PAGE READS LIKE TODAY. Title and one line of facts; the mode (Opening | Closing) and the
// state (To handle · Pending · Active · All) as pill rows, no dropdowns; then two sections — THE
// FIELD and THE GUESTS — each with a tab strip of gates carrying counts, and under the chosen tab the
// rows themselves. A gate's rows are the real thing, drawn the way the rest of the app draws them:
//
//   Cleans            → the Schedule, embedded, filtered to the cleans that need a person
//   Breezeway tasks   → the one shared strip (Assign · Done · Nudge · Comments · Breezeway)
//   Glitches          → the card, with the Breezeway task behind it as its own line
//   Team, arrivals…   → one line each, with the flags Jon asked for as tags
//
// Every row carries Pending / Active / Done. A gate clears itself when nothing is pending or
// active, or somebody signs it. At close, any row can be CARRIED into tomorrow with a note; the
// carried list sits on the next morning's opening until somebody resolves it. "Close the day"
// writes the handover the morning reads first. "Print sheet" opens the same day as paper.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Loader2, Check, Printer, ArrowUpRight, ChevronDown, ChevronUp, RefreshCw, Sunrise, Moon, AlertTriangle } from 'lucide-react'
import { LeanHead, Pill, Tag, Tip } from '@/components/lean'
import { Row, CleanRow, LIST, GHOST, DARK } from '@/components/command/Hub'
import { TaskActions } from '@/components/task/TaskActions'
import { ScheduleBoard } from '@/components/ScheduleBoard'
import { DailyChecklist } from '@/components/DailyChecklist'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { useAccess } from '@/lib/useAccess'
import { clockLabel } from '@/lib/checklist-shared'
import type { Roster } from '@/components/CommandCockpit'
import type { OcDay, OcGate, OcRow, OcMode, OcState, OcCarry } from '@/lib/open-close'

type Data = OcDay & { canSign?: boolean; canManage?: boolean }
type Status = 'todo' | 'pending' | 'active' | 'all'
type Market = 'all' | 'Miami' | 'Broward' | 'North'
const MARKETS: Market[] = ['all', 'Miami', 'Broward', 'North']
const STATE_TAG: Record<OcState, { label: string; tone: 'amber' | 'sky' | 'emerald'; title: string }> = {
  pending: { label: 'pending', tone: 'amber', title: 'Nobody has dealt with this yet' },
  active: { label: 'active', tone: 'sky', title: 'Somebody is on it' },
  done: { label: 'done', tone: 'emerald', title: 'Nothing left to do' },
}
const first = (s: string | null | undefined) => String(s || '').split(/[\s@]/)[0]
const timeOf = (iso: string | null | undefined) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) }
const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ' ' + (n % 60) + 'm' : ''}` : `${n}m`)
const dayLabel = (ymd: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) => ymd ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' }) : ''
const PILL = 'lh-tab text-[12px] font-semibold px-3 py-1.5 rounded-full border '
const pill = (on: boolean) => PILL + (on ? 'lh-tab-on bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')

async function post(body: any): Promise<any> {
  const r = await fetch('/api/open-close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'That did not save.')
  return j
}

export function OpenClose() {
  const acc = useAccess()
  // The mode is decided before the first read (null until then): a read started for one mode must
  // never paint under the other, and the shared fetch hook lets an older key's answer land.
  const [mode, setMode] = useState<OcMode | null>(null)
  const [status, setStatus] = useState<Status>('todo')
  const [market, setMarket] = useState<Market>('all')
  const [tab, setTab] = useState<Record<'field' | 'guests', string | null>>({ field: null, guests: null })
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const m = sp.get('mode')
    if (m === 'open' || m === 'close') { setMode(m); return }
    // Before 3pm the page opens on the opening; after, on the closing.
    const h = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }))
    setMode(h >= 15 ? 'close' : 'open')
  }, [])
  const url = mode ? '/api/open-close?mode=' + mode : null
  const q = useCachedFetch<Data>(url, { ttl: 60_000 })
  const data = q.data && mode && q.data.mode === mode ? q.data : undefined
  const loading = q.loading || (!!q.data && !data)
  const { error, refresh } = q
  const rosterQ = useCachedFetch<{ people: Roster[] }>(data ? '/api/breezeway/people' : null, { ttl: 10 * 60_000 })
  const roster = useMemo(() => (Array.isArray(rosterQ.data?.people) ? rosterQ.data!.people : []), [rosterQ.data])
  const reload = () => { if (url) invalidateCache(url); refresh() }
  const canSign = data?.canSign !== false && acc.atLeast('checklist', 'edit')

  const field = useMemo(() => (data?.gates || []).filter(g => g.section === 'field'), [data])
  const guests = useMemo(() => (data?.gates || []).filter(g => g.section === 'guests'), [data])

  if (!data && (loading || !mode)) return <div className="py-16 text-center text-[13px] text-muted inline-flex items-center gap-2 w-full justify-center"><Loader2 size={14} className="animate-spin" /> Reading the day…</div>
  if (!data) return <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error || 'Could not read the day.'} <button onClick={reload} className={GHOST + ' ml-auto'}>Retry</button></div>

  const s = data.summary
  const opening = data.mode === 'open'
  const rec = data.today
  const facts = [
    dayLabel(data.day),
    s.cleans ? `${s.cleansDone} of ${s.cleans} cleans done` : '',
    s.arrivals ? `${s.arrivals} arrivals` : '',
    s.onShift ? `${s.onShift} on shift` : '',
    opening ? (rec?.openedAt ? `opening finished ${timeOf(rec.openedAt)} by ${first(rec.openedBy)}` : `opening ${s.gatesClear} of ${s.gatesTotal} clear`) : (rec?.closedAt ? `closed ${timeOf(rec.closedAt)} by ${first(rec.closedBy)}` : `closing ${s.gatesClear} of ${s.gatesTotal} clear`),
  ].filter(Boolean).join(' · ')

  return (
    <div className="pb-24 space-y-4">
      <LeanHead title="Open & Close" sub={facts}>
        <Pill title="It is now">{clockLabel(data.clock) || data.clock}</Pill>
        <Pill tone={s.gatesClear === s.gatesTotal ? 'emerald' : 'slate'} title="Gates cleared or signed">{s.gatesClear}/{s.gatesTotal} clear</Pill>
        {s.gatesLate > 0 && <Pill tone="roseSolid" title="Gates past their time with work still open">{s.gatesLate} late</Pill>}
        <a href={`/checklist/print?mode=${mode}&date=${data.day}`} target="_blank" rel="noreferrer" className={GHOST} title="A one-page sheet of this screen for the ops manager"><Printer size={13} /> Print sheet</a>
        <Tip label="Re-read every source now"><button onClick={reload} aria-label="Refresh" className={GHOST}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button></Tip>
        {opening ? (
          <FinishOpening data={data} canSign={canSign} onDone={reload} />
        ) : (
          <a href="#close-the-day" className={DARK}><Moon size={13} /> Close the day</a>
        )}
      </LeanHead>

      {/* ONE control row: mode · state · market. Pills, like the Checklist's SHOW row. */}
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
        <div className="flex items-center gap-1.5" role="group" aria-label="Mode">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-0.5">Show</span>
          <button onClick={() => setMode('open')} aria-pressed={opening} className={pill(opening)}><Sunrise size={12} className="inline mr-1 -mt-0.5" />Opening</button>
          <button onClick={() => setMode('close')} aria-pressed={!opening} className={pill(!opening)}><Moon size={12} className="inline mr-1 -mt-0.5" />Closing</button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="State">
          {([['todo', 'To handle'], ['pending', 'Pending'], ['active', 'Active'], ['all', 'All']] as [Status, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} aria-pressed={status === k} className={pill(status === k)} title={k === 'todo' ? 'Pending and active — everything still open' : k === 'pending' ? 'Nobody has dealt with it yet' : k === 'active' ? 'Somebody is on it' : 'Everything, done included'}>{l}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Market">
          {MARKETS.map(m => <button key={m} onClick={() => setMarket(m)} aria-pressed={market === m} className={pill(market === m)}>{m === 'all' ? 'All markets' : m}</button>)}
        </div>
        <span className="ml-auto text-[12px] text-muted">{data.degraded.length ? <span title={data.degraded.join('\n')} className="text-amber-700 font-semibold inline-flex items-center gap-1"><AlertTriangle size={12} /> {data.degraded.length} source{data.degraded.length === 1 ? '' : 's'} unavailable</span> : 'as of ' + timeOf(data.generatedAt)}</span>
      </div>

      {!data.tables && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800">Sign-offs, carried items and the day record are not being saved yet — migration 157 has to run in Supabase. Everything else on this page is live.</div>}

      {opening && <Handover data={data} />}

      <Section key={'field-' + mode} title="The field" blurb="Who is in, every clean, inspections and vendors" gates={field} tab={tab.field} setTab={k => setTab(t => ({ ...t, field: k }))} status={status} market={market} data={data} roster={roster} canSign={canSign} onChanged={reload} />
      <Section key={'guests-' + mode} title="The guests" blurb="Who may not leave, who is arriving, glitches, messages and money" gates={guests} tab={tab.guests} setTab={k => setTab(t => ({ ...t, guests: k }))} status={status} market={market} data={data} roster={roster} canSign={canSign} onChanged={reload} />

      <Carried data={data} canSign={canSign} onChanged={reload} />

      {!opening && <CloseDay data={data} canSign={canSign} onChanged={reload} />}

      {data.eve && (
        <div className="flex items-center gap-2 px-1 text-[13px] flex-wrap"><Tag tone="violet">Eve</Tag><span className="text-ink">{data.eve}</span></div>
      )}

      <Reminders />
    </div>
  )
}

// ── the sections ───────────────────────────────────────────────────────────────────────────────
function Section({ title, blurb, gates, tab, setTab, status, market, data, roster, canSign, onChanged }: {
  title: string; blurb: string; gates: OcGate[]; tab: string | null; setTab: (k: string) => void
  status: Status; market: Market; data: Data; roster: Roster[]; canSign: boolean; onChanged: () => void
}) {
  // The first gate with work, late first; otherwise the first gate.
  const pick = (tab && gates.some(g => g.key === tab)) ? tab : (gates.find(g => g.late && g.counts.pending) || gates.find(g => g.counts.pending) || gates.find(g => g.counts.active) || gates[0])?.key || null
  const gate = gates.find(g => g.key === pick) || null
  const open = (g: OcGate) => g.counts.pending + g.counts.active
  const pendingAll = gates.reduce((n, g) => n + g.counts.pending, 0)
  const activeAll = gates.reduce((n, g) => n + g.counts.active, 0)
  const lateAll = gates.filter(g => g.late).length
  return (
    <section className="min-w-0">
      <div className="px-1 mb-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink" title={blurb}>{title}</span>
        <span className="text-[12px] text-muted">
          {lateAll ? <b className="text-rose-700">{lateAll} late</b> : null}{lateAll ? ' · ' : ''}{pendingAll} pending · {activeAll} active · {gates.filter(g => g.auto || g.signed).length} of {gates.length} clear
        </span>
      </div>
      <div className="px-1 mb-2 flex items-center gap-1 flex-wrap overflow-x-auto" role="tablist" aria-label={title + ' gates'}>
        {gates.map(g => {
          const clear = g.auto || !!g.signed
          const on = g.key === pick
          return (
            <button key={g.key} role="tab" aria-selected={on} onClick={() => setTab(g.key)} title={g.hint}
              className={PILL + 'tabular-nums whitespace-nowrap ' + (on ? 'lh-tab-on bg-ink text-white border-ink' : g.late ? 'bg-white text-rose-700 border-rose-200 hover:border-rose-300' : 'bg-white text-muted border-line hover:text-ink')}>
              {g.tab}{clear ? <Check size={12} className={'inline ml-1 -mt-0.5 ' + (on ? 'text-white' : 'text-emerald-600')} /> : open(g) ? <span className={'ml-1 ' + (on ? 'opacity-80' : g.late ? 'text-rose-700' : '')}>{open(g)}</span> : null}
            </button>
          )
        })}
      </div>
      {gate ? <Gate gate={gate} status={status} market={market} data={data} roster={roster} canSign={canSign} onChanged={onChanged} /> : <div className={LIST + ' px-4 py-6 text-center text-[13px] text-muted'}>Nothing here.</div>}
    </section>
  )
}

function Gate({ gate, status, market, data, roster, canSign, onChanged }: { gate: OcGate; status: Status; market: Market; data: Data; roster: Roster[]; canSign: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const sign = async (on: boolean) => {
    setBusy(true); setErr('')
    try { await post({ action: on ? 'sign' : 'unsign', gate: gate.key, mode: data.mode, day: data.day }); onChanged() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  const rows = gate.rows.filter(r => (status === 'all' ? true : status === 'todo' ? r.state !== 'done' : r.state === status) && (market === 'all' || !r.market || r.market === market))
  const when = gate.late ? { text: `late by ${mins(Math.abs(gate.inMinutes || 0))} · was due ${clockLabel(gate.due)}`, tone: 'rose' as const }
    : gate.inMinutes != null && gate.inMinutes <= 45 && !(gate.auto || gate.signed) ? { text: `due in ${mins(gate.inMinutes)}`, tone: 'amber' as const }
      : { text: `by ${clockLabel(gate.due)}`, tone: 'slate' as const }
  const isSchedule = gate.key === 'cleans' || gate.key === 'tomorrow_cleans'
  const date = gate.key === 'tomorrow_cleans' ? data.tomorrow : data.day
  return (
    <div className={LIST}>
      {/* THE GATE BAR: the question, when it is due, what is open, and the signature. */}
      <div className="px-3.5 py-2.5 flex items-center gap-2 flex-wrap">
        <span className={'w-5 h-5 rounded-full border-2 inline-flex items-center justify-center shrink-0 ' + (gate.auto || gate.signed ? 'border-emerald-600 bg-emerald-600 text-white' : gate.late ? 'border-rose-500 text-rose-500' : 'border-line text-transparent')}><Check size={12} /></span>
        <span className="text-[14px] font-semibold text-ink">{gate.label}</span>
        <Tag tone={when.tone} title={gate.hint}>{when.text}</Tag>
        {gate.counts.pending > 0 && <Tag tone="amber">{gate.counts.pending} pending</Tag>}
        {gate.counts.active > 0 && <Tag tone="sky">{gate.counts.active} active</Tag>}
        {gate.counts.done > 0 && status === 'all' && <Tag tone="emerald">{gate.counts.done} done</Tag>}
        {gate.degraded && <Tag tone="rose" title={gate.degraded}>source unavailable</Tag>}
        {gate.note && <span className="text-[12px] text-muted">{gate.note}</span>}
        <span className="ml-auto inline-flex items-center gap-1.5 flex-wrap">
          {gate.signed ? (
            <>
              <span className="text-[12px] text-muted" title={'Signed ' + timeOf(gate.signed.at)}>Signed · {first(gate.signed.by)} {timeOf(gate.signed.at)}</span>
              {canSign && <button onClick={() => sign(false)} disabled={busy} className={GHOST} title="Take the signature back">Undo</button>}
            </>
          ) : gate.auto ? (
            <span className="text-[12px] text-emerald-700 font-semibold" title="Nothing pending or active — it cleared itself">Cleared itself</span>
          ) : canSign ? (
            <button onClick={() => sign(true)} disabled={busy} className={DARK} title="Signs this gate with your name and time — the rows stay live">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Sign off</button>
          ) : null}
          <Link href={gate.link} prefetch={false} className={GHOST} title={'Open ' + gate.link}>Open <ArrowUpRight size={12} /></Link>
        </span>
        {err && <p className="w-full text-[11.5px] font-semibold text-rose-600">{err}</p>}
      </div>
      {isSchedule ? (
        <div className="px-2 pb-2 border-t border-line/70">
          <ScheduleBoard embedded={{ date, only: status === 'pending' ? 'nobody' : status === 'active' ? 'active' : status === 'all' ? 'all' : 'needs-person', market: market === 'all' ? 'all' : market }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-5 text-center text-[13px] text-muted border-t border-line/70">{gate.counts.pending + gate.counts.active === 0 ? 'Nothing left to do here.' : status === 'all' ? 'Nothing here.' : 'Nothing ' + (status === 'todo' ? 'open' : status) + ' here.'}</div>
      ) : (
        <div className="border-t border-line/70 divide-y divide-line/70">
          {rows.map(r => <OcRowView key={r.key} row={r} data={data} roster={roster} canSign={canSign} onChanged={onChanged} />)}
        </div>
      )}
    </div>
  )
}

// ── one row, by kind ───────────────────────────────────────────────────────────────────────────
function OcRowView({ row, data, roster, canSign, onChanged }: { row: OcRow; data: Data; roster: Roster[]; canSign: boolean; onChanged: () => void }) {
  const st = STATE_TAG[row.state]
  const tags = <>
    <Tag tone={st.tone} title={st.title}>{st.label}</Tag>
    {row.tags.map((t, i) => <Tag key={i} tone={t.tone} title={t.title}>{t.label}</Tag>)}
  </>
  const dot = row.state === 'pending' ? (row.tags.some(t => t.tone === 'rose' || t.tone === 'roseSolid') ? 'rose' : 'amber') : null
  const carry = data.mode === 'close' && canSign ? <CarryBtn row={row} data={data} onChanged={onChanged} /> : null
  const open = row.href ? <Link href={row.href} prefetch={false} className={GHOST} title={'Open ' + row.href}>Open <ArrowUpRight size={12} /></Link> : null

  // Closing: a departure clean still open is the Today row — the shared task strip, nothing new.
  if (row.kind === 'clean' && row.clean) {
    return (
      <div className="flex flex-col">
        <CleanRow c={row.clean} value={0} roster={roster} canAssign={canSign} onChanged={onChanged} />
        {carry && <div className="px-3.5 pb-2 -mt-1 flex items-center gap-1.5">{carry}</div>}
      </div>
    )
  }
  // A glitch is the card, then the Breezeway task behind it as its own line.
  if (row.kind === 'glitch') {
    return (
      <Row dot={dot} title={row.unit} meta={row.meta} tags={tags} noteKey={'gl:' + row.glitchId} actions={<>{open}{carry}</>}>
        {row.task ? (
          <div className="mt-1.5 ml-3.5 rounded-lg border border-line bg-app/60 px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
            <span className={'w-2 h-2 rounded-full shrink-0 ' + (row.task.status === 'done' ? 'bg-emerald-500' : row.task.status === 'running' ? 'bg-sky-500' : 'bg-slate-300')} />
            <span className="text-[12.5px] font-semibold text-ink truncate max-w-[22rem]" title={row.task.name}>{row.task.name}</span>
            <span className="text-[11.5px] text-muted">Breezeway · {row.task.who || 'unassigned'}{row.task.date ? ' · ' + row.task.date.slice(5) : ''}{row.task.priority ? ' · ' + row.task.priority : ''}</span>
            <span className="ml-auto inline-flex items-center gap-1.5 flex-wrap">
              <TaskActions taskId={row.task.id} dept="maintenance" label={row.unit + ' — ' + row.task.name} link="/glitches" state={row.task.status === 'done' ? 'done' : row.task.status === 'running' ? 'running' : row.task.who ? 'open' : 'unassigned'} who={row.task.who || null} roster={roster} onChanged={onChanged} renderPanels={p => <div className="w-full">{p}</div>} />
            </span>
          </div>
        ) : (
          <div className="mt-1.5 ml-3.5 text-[12px] text-amber-800 flex items-center gap-2 flex-wrap"><AlertTriangle size={12} /> No Breezeway task yet — nobody in the field can see this. <Link href={row.href || '/glitches'} prefetch={false} className={GHOST}>Push a task</Link></div>
        )}
      </Row>
    )
  }
  // Any Breezeway task (inspections, a clean behind an extension): the shared strip.
  if (row.taskId && (row.kind === 'inspection' || row.kind === 'extension')) {
    return (
      <Row dot={dot} title={row.unit} meta={row.meta} tags={tags}
        actions={<><TaskActions taskId={row.taskId} dept={row.dept || 'housekeeping'} label={row.unit + ' — ' + (row.kind === 'inspection' ? 'inspection' : 'clean')} link={row.href || '/plan'} reservationId={row.reservationId || null}
          state={row.done ? 'done' : row.late ? 'late' : row.running ? 'running' : row.who ? 'open' : 'unassigned'} who={row.who || null} roster={roster} onChanged={onChanged} hide={{ nudge: row.kind === 'extension' }}
          renderPanels={p => <div className="w-full">{p}</div>} />{open}{carry}</>} />
    )
  }
  return <Row dot={dot} title={row.unit} meta={row.meta} tags={tags} actions={<>{open}{carry}</>} />
}

function CarryBtn({ row, data, onChanged }: { row: OcRow; data: Data; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const already = data.carried.some(c => c.key === row.key)
  if (already || done) return <Tag tone="violet" title="On tomorrow's opening until somebody resolves it">carried</Tag>
  const save = async () => {
    setBusy(true); setErr('')
    try { await post({ action: 'carry', day: data.day, key: row.key, kind: row.kind, unit: row.unit, title: row.unit + (row.meta ? ' — ' + row.meta.slice(0, 90) : ''), note }); setDone(true); onChanged() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  if (!open) return <button onClick={() => setOpen(true)} className={GHOST} title="Not finished today — put it on tomorrow's opening with a note">Carry to {dayLabel(data.tomorrow, { weekday: 'short' })}</button>
  return (
    <form className="inline-flex items-center gap-1 flex-wrap" onSubmit={e => { e.preventDefault(); save() }}>
      <input autoFocus value={note} onChange={e => setNote(e.target.value)} placeholder="What the morning needs to know" maxLength={300} className="h-8 w-56 rounded-md border border-line px-2 text-[12px]" />
      <button type="submit" disabled={busy} className={DARK}>{busy ? <Loader2 size={12} className="animate-spin" /> : null} Carry</button>
      <button type="button" onClick={() => setOpen(false)} className={GHOST}>Cancel</button>
      {err && <span className="text-[11.5px] font-semibold text-rose-600">{err}</span>}
    </form>
  )
}

// ── the remembered parts ───────────────────────────────────────────────────────────────────────
function Handover({ data }: { data: Data }) {
  const h = data.handover
  const [read, setRead] = useState(false)
  if (!h || (!h.note && !h.closedAt)) return null
  if (read) return null
  return (
    <section className={LIST}>
      <div className="px-3.5 py-2 flex items-center gap-2 flex-wrap border-b border-line/70">
        <span className="font-serif text-[18px] text-ink">Handover</span>
        <span className="text-[12.5px] text-muted">from {first(h.closedBy) || 'last night'} · {dayLabel(h.day, { weekday: 'long' })} {timeOf(h.closedAt)}</span>
        <button onClick={() => setRead(true)} className={GHOST + ' ml-auto'} title="Hide for this visit; it stays in the record">Read</button>
      </div>
      <div className="px-3.5 py-3 space-y-2">
        {h.note ? <p className="text-[14px] text-ink whitespace-pre-line">{h.note}</p> : <p className="text-[13px] text-muted">No note was left.</p>}
        {data.carried.length > 0 && <p className="text-[12px] text-muted"><Tag tone="amber">{data.carried.length} carried</Tag> <span className="ml-1">— listed under Carried, below, until somebody closes them.</span></p>}
      </div>
    </section>
  )
}

function Carried({ data, canSign, onChanged }: { data: Data; canSign: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const act = async (c: OcCarry, how: 'done' | 'dropped') => {
    setBusy(c.id + how); setErr('')
    try { await post({ action: 'resolve', id: c.id, how }); onChanged() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  if (!data.carried.length) return null
  return (
    <section className="min-w-0">
      <div className="px-1 mb-1.5 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-bold uppercase tracking-wider text-ink">Carried</span>
        <span className="text-[12px] text-muted">{data.carried.length} from earlier days — here until somebody closes them</span>
      </div>
      <div className={LIST}>
        {data.carried.map(c => (
          <Row key={c.id} dot="amber" title={c.unit || c.title} meta={[c.unit ? c.title.replace(c.unit, '').replace(/^\s*—\s*/, '') : '', c.note ? '“' + c.note + '”' : '', 'carried ' + dayLabel(c.fromDay, { weekday: 'short', month: 'short', day: 'numeric' }) + (c.by ? ' by ' + first(c.by) : '')].filter(Boolean).join(' · ')}
            tags={<>{c.kind && <Tag tone="slate">{c.kind}</Tag>}<Tag tone="violet">carried</Tag></>}
            actions={canSign ? <>
              <button onClick={() => act(c, 'done')} disabled={!!busy} className={DARK} title="Resolved — off the list with your name on it">{busy === c.id + 'done' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done</button>
              <button onClick={() => act(c, 'dropped')} disabled={!!busy} className={GHOST} title="Not needed any more">Drop</button>
            </> : null} />
        ))}
        {err && <p className="px-3.5 py-2 text-[11.5px] font-semibold text-rose-600">{err}</p>}
      </div>
    </section>
  )
}

function FinishOpening({ data, canSign, onDone }: { data: Data; canSign: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const rec = data.today
  if (rec?.openedAt) return <span className="text-[12px] text-emerald-700 font-semibold inline-flex items-center gap-1" title={'Opening finished ' + timeOf(rec.openedAt)}><Check size={13} /> Opened {timeOf(rec.openedAt)} · {first(rec.openedBy)}</span>
  if (!canSign) return null
  const left = data.gates.filter(g => !(g.auto || g.signed)).length
  return (
    <button onClick={async () => { setBusy(true); try { await post({ action: 'open', day: data.day }); onDone() } catch { /* shown on reload */ } setBusy(false) }} disabled={busy}
      className={DARK} title={left ? left + ' gate' + (left === 1 ? '' : 's') + ' not signed yet — you can still finish; the rows stay live' : 'Every gate is clear'}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Sunrise size={13} />} Finish opening{left ? ` · ${left} open` : ''}
    </button>
  )
}

function CloseDay({ data, canSign, onChanged }: { data: Data; canSign: boolean; onChanged: () => void }) {
  const rec = data.today
  const [note, setNote] = useState(rec?.note || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (rec?.note && !note) setNote(rec.note) }, [rec?.note]) // eslint-disable-line react-hooks/exhaustive-deps
  const stillOpen = data.gates.flatMap(g => g.rows.filter(r => r.state !== 'done').map(r => ({ g, r })))
  const close = async () => {
    setBusy(true); setErr('')
    try {
      const snapshot = { gates: data.gates.map(g => ({ key: g.key, label: g.label, ...g.counts, auto: g.auto, signed: g.signed })), carried: data.carried.length, stillOpen: stillOpen.length }
      await post({ action: 'close', day: data.day, note, snapshot }); setSaved(true); onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <section id="close-the-day" className={LIST + ' scroll-mt-4'}>
      <div className="px-3.5 py-2 flex items-center gap-2 flex-wrap border-b border-line/70">
        <span className="font-serif text-[18px] text-ink">Close the day</span>
        <span className="text-[12.5px] text-muted">what {dayLabel(data.tomorrow, { weekday: 'long' })}&rsquo;s opening needs to know</span>
        {rec?.closedAt && <Tag tone="emerald" title={'Closed ' + timeOf(rec.closedAt)}>closed {timeOf(rec.closedAt)} · {first(rec.closedBy)}</Tag>}
      </div>
      <div className="px-3.5 py-3 space-y-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Carrying into {dayLabel(data.tomorrow, { weekday: 'long' })}</span>
          {data.carried.length ? <Tag tone="violet">{data.carried.length} carried</Tag> : null}
          {stillOpen.length ? <Tag tone="amber" title={stillOpen.slice(0, 12).map(x => x.r.unit).join(', ')}>{stillOpen.length} still open on the gates</Tag> : <Tag tone="emerald">every gate clear</Tag>}
          <span className="text-[12px] text-muted">— rows you carry above land on tomorrow&rsquo;s opening with a Done button</span>
        </div>
        <label className="block text-[12.5px] font-semibold text-ink" htmlFor="oc-note">Note for the morning</label>
        <textarea id="oc-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={2000} placeholder="Who extended, who was a no-show, what a vendor said, what to do first…" className="w-full rounded-xl border border-line px-3 py-2 text-[13.5px] text-ink bg-white" disabled={!canSign} />
        <div className="flex items-center gap-2 flex-wrap">
          {canSign && <button onClick={close} disabled={busy} className={DARK}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Moon size={13} />} {rec?.closedAt ? 'Save again' : 'Close the day'}</button>}
          <span className="text-[12px] text-muted">Signs the closing with your name and time, keeps tonight&rsquo;s numbers, and puts this note at the top of tomorrow&rsquo;s opening.</span>
          {saved && <Tag tone="emerald">saved</Tag>}
          {err && <span className="text-[11.5px] font-semibold text-rose-600">{err}</span>}
        </div>
      </div>
    </section>
  )
}

function Reminders() {
  const [open, setOpen] = useState(false)
  return (
    <section className="min-w-0">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="px-1 mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink hover:text-brand-700">
        Reminders {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        <span className="text-[12px] font-medium normal-case tracking-normal text-muted">the standing daily list — editable, ticked by whoever does it</span>
      </button>
      {open && <div className={LIST + ' p-3'}><DailyChecklist embedded /></div>}
    </section>
  )
}
