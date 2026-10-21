'use client'
// components/GeLog.tsx — THE GE LOG. The day's work as one spreadsheet, read as the TEAM.
//
// Jon, 2026-10-21, with the Google Sheet the office has kept by hand for years:
//   "build a tab in the scheduler page that allows team to have this view ... organized is whole
//    team separated by departments a then each market area and vendor as well"
//   "It should allow us to select any cleaner but should show who is scheduled for the day too."
//   "The goal is to see all task assigned, organized by department (We can also have a way to
//    organize it by team member like a full list). We should also have a glitches section as well
//    with pending field activities. From there they can be assigned and managed and will go to the
//    department section based on who the main first assignee is."
//   "Should look like a excel, exactly the way i shared."
//
// THE LAST ONE IS THE BRIEF. The first build of this made cards — a panel per person, each with
// its own little table. That is a nicer *component* and a worse *tool*: the sheet is one
// continuous grid because the office scans DOWN a column (every 17WEST row, every same-day, every
// blank cleaner) and a column does not survive being cut into twenty panels. So this is one table
// with one header, sorted into bands, and the name repeats on every row exactly as it does in the
// sheet. The columns are the sheet's columns in the sheet's order.
//
// WHAT IT IS NOT. The day board answers "what has to be cleaned today" and sorts by building, so a
// person's day is scattered down it, somebody with nothing on their day never appears, and the
// inspections, repairs and pending field activity behind a glitch are not on it at all. This
// answers the other question — what is each of my people doing — which is why the sheet outlived
// the app's own scheduler.
//
// ONE PAYLOAD, NO CLIENT-SIDE JOINS. /api/schedule/ge-log already merged the board's reservation
// detail, every department's tasks and the open glitches into flat rows carrying their person,
// department and market. This file sorts, bands and paints them.
//
// ASSIGNMENT IS LIVE, NOT STAGED. On the day board a cleaner is staged and pushed in a batch,
// because planning a turnover day is a dozen decisions you want to review before the crew's phones
// light up. Here you are looking at one person's day and fixing it, so the pick goes straight to
// Breezeway (and to the glitch, for a glitch row). Two jobs, deliberately two behaviours.
//
// THE NOTE GOES TO BREEZEWAY. The note button opens the shared comment thread pointed at that
// task, which is the comment the crew reads in the field. A row with no task — a moved clean, a
// block, a glitch nobody has pushed — keeps its note in Lighthouse and says so. That is Jon's
// "the GE log is where we can document that": the exception is the thing most worth writing down,
// and it is the one case the sheet handled and the board did not.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageSquare, ExternalLink, AlertTriangle, RefreshCw, Download } from 'lucide-react'
import CleanerPicker, { sameRosterPerson, type Person } from './CleanerPicker'
import CommentThread from './CommentThread'

type Row = {
  key: string; kind: 'clean' | 'task' | 'glitch'; taskId: string | null; listingId: string | null
  person: string; dept: string; market: string; hub: string; activity: string
  listing: string; reservation: string; checkIn: string | null; checkOut: string | null
  sameDay: boolean; nights: number | null; fee: number | null; cleanHours: number | null
  payout: number | null; status: string; vendor: string | null; flag: string | null
  url: string | null; glitchId: string | number | null
}
type RosterRow = { name: string; dept: string; market: string; status: string; clash: string; unrostered: boolean }
type Payload = { ok: boolean; date: string; money: boolean; rows: Row[]; roster: RosterRow[]; partial?: boolean; error?: string }

// Department order and labels mirror lib/crew.ts — housekeeping is the bulk of the day so it
// leads; 'other' is last, being the bucket for anyone nobody has filed yet.
const DEPT_ORDER = ['housekeeping', 'supervision', 'inspection', 'maintenance', 'ccs', 'other']
const DEPT_LABEL: Record<string, string> = {
  housekeeping: 'Housekeeping', supervision: 'Supervisors', inspection: 'Inspections',
  maintenance: 'Maintenance', ccs: 'CCS team', other: 'Other',
}
const deptKey = (d: string) => { const k = String(d || '').toLowerCase(); return DEPT_ORDER.indexOf(k) >= 0 ? k : 'other' }
const deptRank = (d: string) => { const i = DEPT_ORDER.indexOf(deptKey(d)); return i < 0 ? 99 : i }

// A STABLE COLOUR PER VALUE, the way the sheet's fills work: the same person is the same colour
// every day, so the eye finds their band without reading. Hashed rather than assigned, because the
// roster changes and a hand-kept map would be wrong within a month.
const PALETTE = [
  'bg-blue-100 text-blue-800 border-blue-200', 'bg-violet-100 text-violet-800 border-violet-200',
  'bg-amber-100 text-amber-800 border-amber-200', 'bg-emerald-100 text-emerald-800 border-emerald-200',
  'bg-sky-100 text-sky-800 border-sky-200', 'bg-rose-100 text-rose-800 border-rose-200',
  'bg-teal-100 text-teal-800 border-teal-200', 'bg-orange-100 text-orange-800 border-orange-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200', 'bg-lime-100 text-lime-800 border-lime-200',
]
const tintCache = new Map<string, string>()
function tint(v: string): string {
  const k = String(v || '').toLowerCase().trim()
  const hit = tintCache.get(k); if (hit) return hit
  let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0
  const cls = PALETTE[h % PALETTE.length]; tintCache.set(k, cls); return cls
}
const money = (n: number | null) => n == null ? '' : '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const prettyDate = (iso: string) => iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
/** "2026-10-03 16:00" → "10/3/2026 16:00", the sheet's own format. */
function cell(dt: string | null): string {
  if (!dt) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2}))?/.exec(dt)
  if (!m) return dt
  return Number(m[2]) + '/' + Number(m[3]) + '/' + m[1] + (m[4] ? ' ' + m[4] : '')
}
const statusTone = (v: string) => {
  const s = String(v || '').toLowerCase()
  if (/req\s*off/.test(s)) return 'bg-rose-50 text-rose-700 border-rose-200'
  if (/on\s*call/.test(s)) return 'bg-amber-50 text-amber-800 border-amber-200'
  if (/off/.test(s)) return 'bg-neutral-100 text-neutral-500 border-neutral-200'
  if (/work/.test(s)) return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return 'bg-white text-muted border-line'
}
const isOn = (v: string) => /work|on\s*call/i.test(String(v || ''))
const shortName = (n: string) => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || '') }

// The sheet's own columns, in the sheet's order. `w` keeps the grid from reflowing as cells fill.
const COLS: { k: string; label: string; w: string; align?: string }[] = [
  { k: 'person', label: 'HK Team', w: '112px' },
  { k: 'hub', label: 'HUB', w: '104px' },
  { k: 'activity', label: 'Activities', w: '104px' },
  { k: 'listing', label: 'LISTING', w: '150px' },
  { k: 'reservation', label: 'RESERVATION NAME', w: '180px' },
  { k: 'checkIn', label: 'CHECK-IN DATE', w: '130px' },
  { k: 'checkOut', label: 'CHECK-OUT DATE', w: '130px' },
  { k: 'sameDay', label: 'Same Day Checkout', w: '92px' },
  { k: 'nights', label: 'NO. OF NIGHTS', w: '84px', align: 'text-center' },
  { k: 'fee', label: 'Cleaning fee', w: '92px', align: 'text-right' },
  { k: 'cleanHours', label: 'Cleaning time', w: '82px', align: 'text-center' },
  { k: 'payout', label: 'Total Payout', w: '100px', align: 'text-right' },
  { k: 'act', label: '', w: '74px', align: 'text-right' },
]

export default function GeLog({ date }: { date: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [crew, setCrew] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<'dept' | 'person'>('dept')
  const [noteFor, setNoteFor] = useState('')
  const [showEmpty, setShowEmpty] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!date) return
    let dead = false
    setLoading(true); setErr('')
    Promise.all([
      fetch('/api/schedule/ge-log?date=' + date, { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      // The FULL Breezeway roster, not just housekeepers — a repair has to be assignable to a tech.
      fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ]).then(([d, p]) => {
      if (dead) return
      if (d && d.ok) setData(d as Payload); else setErr((d && d.error) || 'Could not load the day.')
      const ppl = (p && Array.isArray(p.people) ? p.people : []) as any[]
      setCrew(ppl.map(x => ({ id: Number(x.id), name: String(x.name || ''), region: x.region ? String(x.region) : null })).filter(x => x.id && x.name))
    }).finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [date, tick])

  const rows = data?.rows || []
  const roster = data?.roster || []
  const scheduledToday = useMemo(() => { const s = new Set<string>(); for (const p of roster) if (isOn(p.status)) s.add(p.name); return s }, [roster])
  const rosterOf = useCallback((name: string) => roster.find(r => sameRosterPerson(r.name, name)) || null, [roster])

  /** One band per person, in the order the sheet reads: department, then market, then name. The
   *  people with nothing on them still get a band, because "Mirian has an empty day" is half of
   *  what this view is for and it is invisible on every other screen. */
  const bands = useMemo(() => {
    const byPerson = new Map<string, Row[]>()
    for (const r of rows) { const k = r.person || ''; const a = byPerson.get(k) || []; a.push(r); byPerson.set(k, a) }
    for (const p of roster) if (!byPerson.has(p.name)) byPerson.set(p.name, [])
    const out: { person: string; dept: string; market: string; status: string; clash: string; unrostered: boolean; rows: Row[] }[] = []
    for (const person of Array.from(byPerson.keys())) {
      const rs = byPerson.get(person) as Row[]
      const ros = person ? rosterOf(person) : null
      const first = rs[0]
      out.push({
        person,
        dept: deptKey(ros?.dept || first?.dept || 'housekeeping'),
        market: ros?.market || first?.market || '',
        status: ros ? ros.status : '', clash: ros ? ros.clash : '', unrostered: ros ? ros.unrostered : !!person,
        // Inside a band the sheet reads by building, then unit.
        rows: rs.sort((a: Row, b: Row) => a.hub.localeCompare(b.hub) || a.listing.localeCompare(b.listing)),
      })
    }
    // NOBODY-ASSIGNED FIRST. It is the only part of the day that still needs a decision, and in
    // the sheet it is the run of blank HK Team cells people scroll to find.
    return out.sort((a, b) => {
      if (!a.person !== !b.person) return a.person ? 1 : -1
      if (view === 'person') return a.person.localeCompare(b.person)
      return deptRank(a.dept) - deptRank(b.dept) || a.market.localeCompare(b.market) || a.person.localeCompare(b.person)
    })
  }, [rows, roster, rosterOf, view])

  const shown = useMemo(() => showEmpty ? bands : bands.filter(b => b.rows.length), [bands, showEmpty])

  const totals = useMemo(() => {
    let fee = 0, hrs = 0, pay = 0, done = 0, nobody = 0, gl = 0
    for (const r of rows) {
      fee += r.fee || 0; hrs += r.cleanHours || 0; pay += r.payout || 0
      if (r.status === 'done') done++
      if (!r.person) nobody++
      if (r.kind === 'glitch') gl++
    }
    return { fee, hrs, pay, done, nobody, gl, n: rows.length }
  }, [rows])

  async function assign(r: Row, p: Person | null) {
    const k = r.key
    setBusy(b => ({ ...b, [k]: true })); setErr('')
    try {
      if (r.kind === 'glitch') {
        const res = await fetch('/api/glitches/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', id: r.glitchId, assignee: p ? p.name : '', assigneePersonId: p ? p.id : null }),
        })
        if (!res.ok) throw new Error('Could not assign that glitch.')
      } else if (r.taskId) {
        const res = await fetch('/api/breezeway/assign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: r.taskId, assigneeIds: p ? [p.id] : [] }),
        })
        const jj = await res.json().catch(() => null)
        if (!res.ok) throw new Error((jj && (jj.error || jj.refusal)) || 'Breezeway would not take that assignment.')
      } else {
        throw new Error('No Breezeway task on this row yet — nothing to assign.')
      }
      // Move the row under its new owner on this render; the refetch confirms it.
      setData(d => d ? { ...d, rows: d.rows.map(x => (x.key === r.key ? { ...x, person: p ? p.name : '' } : x)) } : d)
      setTick(t => t + 1)
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(b => ({ ...b, [k]: false })) }
  }

  /** The grid as the office would paste it into the sheet it is replacing. */
  function exportCsv() {
    const head = COLS.filter(c => c.k !== 'act').map(c => c.label)
    const lines = [head.join(',')]
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    for (const b of shown) for (const r of b.rows) {
      lines.push([b.person, r.hub, r.activity, r.listing, r.reservation, cell(r.checkIn), cell(r.checkOut),
        r.sameDay ? 'TRUE' : 'FALSE', r.nights ?? '', r.fee == null ? '' : r.fee.toFixed(2),
        r.cleanHours ?? '', r.payout == null ? '' : r.payout.toFixed(2)].map(esc).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'ge-log-' + date + '.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  const TD = 'border border-[color:var(--ge-line)] px-2 py-[5px] align-middle'
  const pill = (v: string, extra = '') =>
    <span className={'inline-block w-full text-center text-[10.5px] font-semibold rounded-full border px-2 py-[2px] truncate ' + tint(v) + ' ' + extra} title={v}>{v}</span>

  function Cells({ r, person }: { r: Row; person: string }) {
    const b = !!busy[r.key]
    const vacant = !r.reservation && r.kind === 'clean'
    const open = noteFor === r.key
    return (
      <>
        <td className={TD + ' p-[3px]'}>
          {/* The assignee IS the first column, and it is also the control — the sheet's HK Team
              cell is what people retype all morning, so here it is the thing you click. */}
          <div className={b ? 'opacity-50 pointer-events-none' : ''}>
            <CleanerPicker people={crew} scheduled={scheduledToday} value={null} existing={person ? shortName(person) : ''}
              onChange={p => assign(r, p)} placeholder="—" disabled={r.kind === 'clean' && !r.taskId && !r.glitchId} />
          </div>
        </td>
        <td className={TD + ' p-[3px]'}>{pill(r.hub)}</td>
        <td className={TD + ' p-[3px]'}>{pill(r.activity)}</td>
        <td className={TD + ' text-center font-semibold text-ink truncate'} title={r.listing}>{r.listing}</td>
        <td className={TD + ' text-center font-semibold truncate ' + (vacant ? 'bg-yellow-200 text-ink' : 'text-ink')} title={r.reservation || (vacant ? 'Vacant' : '')}>
          {r.reservation || (vacant ? 'Vacant' : '')}
        </td>
        <td className={TD + ' text-center tabular-nums text-ink/85'}>{cell(r.checkIn)}</td>
        <td className={TD + ' text-center tabular-nums text-ink/85'}>{cell(r.checkOut)}</td>
        <td className={TD + ' text-center tabular-nums text-[10.5px] ' + (r.sameDay ? 'font-bold text-rose-700' : 'text-muted')}>
          {r.kind === 'clean' ? (r.sameDay ? 'TRUE' : 'FALSE') : ''}
        </td>
        <td className={TD + ' text-center tabular-nums text-ink'}>{r.nights ?? ''}</td>
        <td className={TD + ' text-right tabular-nums text-ink'}>{money(r.fee)}</td>
        <td className={TD + ' text-center tabular-nums text-ink'}>{r.cleanHours ?? ''}</td>
        <td className={TD + ' text-right tabular-nums text-ink'}>{money(r.payout)}</td>
        <td className={TD + ' text-right whitespace-nowrap'}>
          <span className="inline-flex items-center gap-1">
            {r.flag ? <span title={r.flag} className="text-[9px] font-bold px-1 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">!</span> : null}
            <button onClick={() => setNoteFor(open ? '' : r.key)}
              title={r.taskId ? 'Note — posts as a comment on the Breezeway task the crew reads' : 'Note — kept in Lighthouse; there is no Breezeway task on this row'}
              className={'text-[11px] px-1 py-0.5 rounded border inline-flex items-center ' + (open ? 'bg-ink text-white border-ink' : r.taskId ? 'border-line bg-white text-muted hover:text-ink' : 'border-dashed border-line bg-white text-muted hover:text-ink')}>
              <MessageSquare size={10} />
            </button>
            {r.url || r.glitchId ? (
              <a href={r.glitchId ? '/glitches?id=' + r.glitchId : String(r.url)} target={r.glitchId ? undefined : '_blank'} rel="noreferrer"
                title={r.glitchId ? 'Open the glitch' : 'Open in Breezeway'}
                className="text-[11px] px-1 py-0.5 rounded border border-line bg-white text-muted hover:text-ink inline-flex items-center"><ExternalLink size={10} /></a>
            ) : null}
          </span>
        </td>
      </>
    )
  }

  let lastDept = '', lastMarket = ''
  const body: JSX.Element[] = []
  for (const band of shown) {
    // BAND HEADINGS, not panels. A full-width row inside the same table, so every column below it
    // still lines up with the one header at the top — which is the whole point of a grid.
    if (view === 'dept') {
      if (band.dept !== lastDept) {
        lastDept = band.dept; lastMarket = ''
        body.push(
          <tr key={'d' + band.dept}><td colSpan={COLS.length} className="bg-ink/[0.06] border border-[color:var(--ge-line)] px-2 py-[5px] text-[10px] uppercase tracking-wider font-bold text-ink">
            {DEPT_LABEL[band.dept] || band.dept}
          </td></tr>
        )
      }
      if (band.market && band.market !== lastMarket) {
        lastMarket = band.market
        body.push(
          <tr key={'m' + band.dept + band.market}><td colSpan={COLS.length} className="bg-app border border-[color:var(--ge-line)] px-2 py-[3px] text-[9.5px] uppercase tracking-wide font-bold text-muted">
            {band.market}
          </td></tr>
        )
      }
    }
    if (!band.rows.length) {
      body.push(
        <tr key={'e' + (band.person || 'none')} className="bg-white">
          <td className="border border-[color:var(--ge-line)] p-[3px]">{pill(shortName(band.person) || '—', 'opacity-60')}</td>
          <td colSpan={COLS.length - 1} className="border border-[color:var(--ge-line)] px-2 py-[5px] text-[11px] text-muted italic">
            nothing on their day
            {band.status ? <span className={'ml-2 not-italic text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full border ' + statusTone(band.status)}>{band.status}</span> : null}
          </td>
        </tr>
      )
      continue
    }
    band.rows.forEach((r, i) => {
      body.push(
        <tr key={r.key} className={(i % 2 ? 'bg-[color:var(--ge-zebra)]' : 'bg-white') + (r.status === 'done' ? ' opacity-70' : '')}>
          <Cells r={r} person={band.person} />
        </tr>
      )
      if (noteFor === r.key) {
        body.push(
          <tr key={r.key + ':n'} className="bg-app/60">
            <td colSpan={COLS.length} className="border border-[color:var(--ge-line)] px-2 py-2">
              {!r.taskId && <p className="text-[10.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">No Breezeway task on this row{r.flag ? ' — ' + r.flag : ''}. The note is kept in Lighthouse against {r.listing}.</p>}
              <CommentThread type={r.taskId ? 'task' : r.glitchId ? 'glitch' : 'clean'}
                id={r.taskId || String(r.glitchId || r.key)} taskId={r.taskId || undefined}
                label={r.listing + ' — ' + r.activity} link="/schedule"
                dept={/maint|inspect/.test(deptKey(r.dept)) ? 'maintenance' : 'housekeeping'} />
            </td>
          </tr>
        )
      }
    })
  }

  return (
    <section className="space-y-2" style={{ ['--ge-line' as any]: 'rgba(15,23,42,0.14)', ['--ge-zebra' as any]: 'rgba(219,234,254,0.35)' }}>
      {/* THE DAY IN ONE LINE. Deliberately not six big tiles: whoever opens this already knows what
          day it is and wants to find their people. */}
      <div className="rounded-xl border border-line bg-white px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
        <span className="font-bold text-ink text-[12.5px]">{prettyDate(date)}</span>
        <span className="text-muted tabular-nums">{totals.n} row{totals.n === 1 ? '' : 's'}</span>
        {totals.done ? <span className="text-emerald-700 tabular-nums">{totals.done} done</span> : null}
        {totals.nobody ? <span className="text-rose-700 font-semibold tabular-nums">{totals.nobody} with nobody on them</span> : null}
        {totals.gl ? <span className="text-rose-700 tabular-nums">{totals.gl} glitch{totals.gl === 1 ? '' : 'es'}</span> : null}
        <span className="text-muted tabular-nums">{scheduledToday.size} of {roster.length} on today</span>
        {totals.fee ? <span className="text-emerald-700 font-semibold tabular-nums">{money(totals.fee)} fees</span> : null}
        {totals.hrs ? <span className="text-muted tabular-nums">{totals.hrs.toFixed(2).replace(/\.?0+$/, '')} h</span> : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex items-center gap-0.5 border border-line rounded-lg p-0.5 bg-white">
            {([['dept', 'By department'], ['person', 'By team member']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} className={'text-[11px] font-semibold px-2 py-1 rounded-md ' + (view === v ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100')}>{l}</button>
            ))}
          </div>
          <button onClick={() => setShowEmpty(s => !s)} className="text-[11px] font-semibold text-brand-700 hover:underline">{showEmpty ? 'Hide empty days' : 'Show everyone'}</button>
          <button onClick={exportCsv} title="Download the grid as a CSV" className="text-muted hover:text-ink"><Download size={13} /></button>
          <button onClick={() => setTick(t => t + 1)} title="Reload the day" className="text-muted hover:text-ink"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {err && <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{err}</p>}
      {data && !data.money && <p className="text-[11px] text-muted px-1">Total payout is hidden — your access does not include money.</p>}
      {data?.partial && <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-1.5"><AlertTriangle size={12} />The read stopped early — some work may be missing from this day.</p>}

      {loading && !data ? <p className="text-[12px] text-muted px-1">Loading the day…</p> : null}
      {!loading && shown.length === 0 && (
        <p className="rounded-xl border border-line bg-white px-3 py-6 text-center text-[12px] text-muted">
          Nothing on this day, and nobody on the roster for this week. Add people on the Day board&rsquo;s Working rail, or let Homebase fill it in.
        </p>
      )}

      {shown.length > 0 && (
        <div className="overflow-auto rounded-xl border border-line bg-white max-h-[76vh]">
          <table className="text-[11px] border-collapse" style={{ minWidth: 1180 }}>
            <colgroup>{COLS.map(c => <col key={c.k} style={{ width: c.w }} />)}</colgroup>
            {/* The sheet's blue header, and it STAYS — twelve columns are unreadable the moment
                the labels scroll off. */}
            <thead className="sticky top-0 z-10">
              <tr>
                {COLS.map(c => (
                  <th key={c.k} className="bg-[#4472c4] text-white border border-[#2f528f] px-2 py-1.5 text-[10.5px] font-bold text-center leading-tight">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{body}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
