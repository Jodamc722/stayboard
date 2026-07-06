'use client'
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Check, Loader2 } from 'lucide-react'

type Day = {
  date: string
  dow: number
  day: string
  actual: Record<string, number>
  vendor: Record<string, number>
  isToday?: boolean
  isPast?: boolean
}
type FC = {
  ok: boolean
  today: string
  weekStart: string
  weekEnd: string
  prevWeekStart: string
  nextWeekStart: string
  isCurrentWeek: boolean
  dayLabels?: string[]
  week: Day[]
}
type Unit = { unit: string; listingId?: string; bedrooms?: number | null; hub?: string; sameDay?: boolean; assigned?: string[] }
type HK = { id: string; name: string }

const DEFAULT_RATE: Record<string, number> = { Miami: 5, Broward: 4, North: 4 }
const MARKETS = ['Miami', 'Broward', 'North']
const STATUSES = ['Working', 'On Call', 'OFF', 'REQ OFF']
// Vendor-cleaned buildings (hotel/vendor staff) — not our cleaners. Mirrors the forecast API.
const VENDOR = /botanica|park\s*towers?|\bpt\b|amrit|capri|lucerne/i
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function cellClass(v: string) {
  const s = (v || '').toLowerCase()
  if (/req\s*off/.test(s)) return 'bg-rose-100 text-rose-800'
  if (/on\s*call/.test(s)) return 'bg-yellow-200 text-yellow-900'
  if (/\boff\b/.test(s)) return 'bg-orange-100 text-orange-800'
  if (/work/.test(s)) return 'bg-green-100 text-green-800'
  return 'bg-white text-neutral-700'
}
function fmtRange(a: string, b: string) {
  if (!a || !b) return ''
  const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00')
  return `${MON[da.getMonth()]} ${da.getDate()} – ${MON[db.getMonth()]} ${db.getDate()}`
}
function shortDate(d: string) {
  const dt = new Date(d + 'T12:00:00')
  return `${MON[dt.getMonth()]} ${dt.getDate()}`
}

export function ForecastBoard() {
  const [data, setData] = useState<FC | null>(null)
  const [err, setErr] = useState('')
  const [weekStart, setWeekStart] = useState('')
  const [market, setMarket] = useState('Miami')
  const [rate, setRate] = useState<Record<string, number>>({ ...DEFAULT_RATE })
  const [hk, setHk] = useState<string[]>([])
  const [members, setMembers] = useState<string[]>([])
  const [cells, setCells] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [open, setOpen] = useState('') // `${date}__${market}__${kind}` for the drill-down panel
  const [units, setUnits] = useState<Record<string, Unit[]>>({}) // `${date}__${market}` -> our cleans
  const [vendorUnits, setVendorUnits] = useState<Record<string, Unit[]>>({})
  const [hkPeople, setHkPeople] = useState<HK[]>([])
  const [assignState, setAssignState] = useState<Record<string, 'idle' | 'saving' | 'done' | 'err'>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const dirty = useRef(false)
  const loadKey = useRef('')

  // ---- forecast (counts) ----
  useEffect(() => {
    const url = '/api/schedule/forecast' + (weekStart ? '?weekStart=' + weekStart : '')
    fetch(url)
      .then(r => r.json())
      .then((j: FC) => {
        if (!j || !j.ok) { setErr('Could not load forecast'); return }
        setData(j); setErr('')
        if (!weekStart) setWeekStart(j.weekStart)
      })
      .catch(() => setErr('Could not load forecast'))
  }, [weekStart])

  // ---- actual cleans (drill-down) + housekeeper picklist, from the same week data ----
  useEffect(() => {
    const u = '/api/schedule?view=week' + (weekStart ? '&date=' + weekStart : '')
    fetch(u)
      .then(r => r.json())
      .then((j: any) => {
        const days: any[] = Array.isArray(j?.days) ? j.days : []
        const ours: Record<string, Unit[]> = {}
        const vend: Record<string, Unit[]> = {}
        const names = new Set<string>()
        for (const day of days) {
          const dt: string = day?.date
          if (!dt) continue
          const mk = day?.markets || {}
          const entries: [string, any][] = Array.isArray(mk)
            ? mk.map((x: any) => [x.market || x.name, x.cleans || x.items || x])
            : Object.entries(mk).map(([k, v]: any) => [k, (v && (v.cleans || v.items)) || v])
          for (const [mkt, raw] of entries) {
            if (!MARKETS.includes(mkt)) continue
            const arr: any[] = Array.isArray(raw) ? raw : []
            const key = `${dt}__${mkt}`
            for (const c of arr) {
              const unit = c?.unit || c?.name || c?.listingName || c?.title || 'Unit'
              const an0 = Array.isArray(c?.assignedNames) ? c.assignedNames : []
              const rec: Unit = { unit, listingId: c?.listingId || c?.listing_id || c?._id, bedrooms: c?.bedrooms, hub: c?.hub, sameDay: c?.sameDayTurn || c?.sameDay, assigned: an0 }
              if (VENDOR.test(String(unit)) || c?.vendor) (vend[key] ||= []).push(rec)
              else (ours[key] ||= []).push(rec)
              an0.forEach((n: string) => { if (n) names.add(n) })
            }
          }
        }
        setUnits(ours); setVendorUnits(vend)
        if (names.size) setHk(Array.from(names).sort())
        const hp: HK[] = Array.isArray(j?.housekeepers)
          ? j.housekeepers
              .map((h: any) => ({ id: String(h?.id ?? h?._id ?? h?.userId ?? ''), name: h?.name ?? h?.fullName ?? '' }))
              .filter((h: HK) => h.id && h.name)
          : []
        if (hp.length) setHkPeople(hp)
      })
      .catch(() => {})
  }, [weekStart])

  // ---- load saved schedule for this week + market ----
  useEffect(() => {
    if (!weekStart) return
    const key = `${weekStart}__${market}`
    loadKey.current = key
    fetch(`/api/schedule/team?weekStart=${encodeURIComponent(weekStart)}&market=${encodeURIComponent(market)}`)
      .then(r => r.json())
      .then((j: any) => {
        if (loadKey.current !== key) return
        const doc = j?.doc || {}
        setMembers(Array.isArray(doc.members) ? doc.members : [])
        setCells(doc.cells && typeof doc.cells === 'object' ? doc.cells : {})
        if (typeof doc.rate === 'number' && doc.rate > 0) setRate(r => ({ ...r, [market]: doc.rate }))
        dirty.current = false
        setSaveState('idle')
      })
      .catch(() => { setMembers([]); setCells({}); dirty.current = false })
  }, [weekStart, market])

  // ---- auto-save (debounced) when the user edits ----
  useEffect(() => {
    if (!weekStart || !dirty.current) return
    setSaveState('saving')
    const t = setTimeout(() => {
      fetch('/api/schedule/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, market, doc: { members, cells, rate: rate[market] } }),
      })
        .then(r => r.json())
        .then((j: any) => { setSaveState(j?.ok ? 'saved' : 'error'); dirty.current = false })
        .catch(() => setSaveState('error'))
    }, 700)
    return () => clearTimeout(t)
  }, [members, cells, rate, weekStart, market])

  function mutate(fn: () => void) { dirty.current = true; fn() }
  function setCell(member: string, date: string, val: string) {
    mutate(() => setCells(c => ({ ...c, [`${member}__${date}`]: val })))
  }
  function addMember(name: string) {
    const n = name.trim()
    if (!n || members.includes(n)) return
    mutate(() => setMembers(m => [...m, n]))
    setNewName('')
  }
  function removeMember(name: string) {
    mutate(() => {
      setMembers(m => m.filter(x => x !== name))
      setCells(c => {
        const next: Record<string, string> = {}
        for (const k in c) if (!k.startsWith(name + '__')) next[k] = c[k]
        return next
      })
    })
  }

  // Assign a cleaner to a clean and push it to Breezeway (reuses the schedule board's endpoint).
  async function assignUnit(u: Unit, date: string, personId: string) {
    if (!u.listingId || !personId) return
    const k = `${u.listingId}__${date}`
    setAssignState(a => ({ ...a, [k]: 'saving' }))
    try {
      const r = await fetch('/api/schedule/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: u.listingId, date, assigneeIds: [personId] }),
      })
      const j = await r.json().catch(() => ({}))
      setAssignState(a => ({ ...a, [k]: j && j.ok === false ? 'err' : 'done' }))
    } catch {
      setAssignState(a => ({ ...a, [k]: 'err' }))
    }
  }

  const days = data?.week || []
  const rateM = rate[market] || 0
  const hasVendor = days.some(d => ((d.vendor && d.vendor[market]) || 0) > 0)
  const openUnits = open
    ? (open.endsWith('__vendor') ? vendorUnits[open.replace('__vendor', '')] : units[open.replace('__actual', '')]) || []
    : []

  return (
    <div className="space-y-3">
      {/* market tabs + save status */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden">
          {MARKETS.map(m => (
            <button
              key={m}
              onClick={() => { setOpen(''); setMarket(m) }}
              className={`px-4 py-1.5 text-sm font-medium ${market === m ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-50'}`}
            >{m}</button>
          ))}
        </div>
        <div className="text-xs text-neutral-500 flex items-center gap-1.5">
          {saveState === 'saving' && (<><Loader2 size={13} className="animate-spin" /> Saving…</>)}
          {saveState === 'saved' && (<><Check size={13} className="text-green-600" /> Saved</>)}
          {saveState === 'error' && (<span className="text-rose-600">Save failed</span>)}
        </div>
      </div>

      {/* week nav */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => { setOpen(''); data && setWeekStart(data.prevWeekStart) }} className="p-1.5 rounded border border-neutral-200 hover:bg-neutral-50"><ChevronLeft size={16} /></button>
        <div className="text-sm font-semibold text-neutral-800 min-w-[150px] text-center">{data ? fmtRange(data.weekStart, data.weekEnd) : '…'}</div>
        <button onClick={() => { setOpen(''); data && setWeekStart(data.nextWeekStart) }} className="p-1.5 rounded border border-neutral-200 hover:bg-neutral-50"><ChevronRight size={16} /></button>
        {data && !data.isCurrentWeek && (
          <button onClick={() => { setOpen(''); setWeekStart('') }} className="text-xs px-2 py-1 rounded border border-neutral-200 hover:bg-neutral-50">This week</button>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
          <span>{market} cleans / cleaner</span>
          <input
            type="number" min={1} value={rateM}
            onChange={e => mutate(() => setRate(r => ({ ...r, [market]: Math.max(1, Number(e.target.value) || 1) })))}
            className="w-14 px-1.5 py-1 rounded border border-neutral-200 text-center"
          />
        </div>
      </div>

      {err && <div className="text-sm text-rose-600">{err}</div>}

      {/* grid */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-neutral-500">
              <th className="text-left font-medium px-3 py-2 sticky left-0 bg-neutral-50 min-w-[150px]">Team member</th>
              {days.map(d => (
                <th key={d.date} className={`px-2 py-2 text-center font-medium ${d.isToday ? 'text-neutral-900' : ''}`}>
                  <div>{d.day}</div>
                  <div className="text-[11px] font-normal text-neutral-400">{shortDate(d.date)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Cleans (booked) — click to see the actual units */}
            <tr className="border-t border-neutral-200 bg-white">
              <td className="px-3 py-2 text-left text-neutral-500 sticky left-0 bg-white">Cleans (booked)</td>
              {days.map(d => {
                const n = (d.actual && d.actual[market]) || 0
                const k = `${d.date}__${market}__actual`
                return (
                  <td key={d.date} className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => setOpen(open === k ? '' : k)}
                      disabled={n === 0}
                      className={`min-w-[34px] px-2 py-1 rounded font-semibold ${n === 0 ? 'text-neutral-300' : open === k ? 'bg-neutral-900 text-white' : 'text-neutral-900 hover:bg-neutral-100'}`}
                      title={n ? 'Click to see the units' : ''}
                    >{n}</button>
                  </td>
                )
              })}
            </tr>

            {/* Vendor (not staffed) */}
            {hasVendor && (
              <tr className="border-t border-neutral-100 bg-white">
                <td className="px-3 py-2 text-left text-neutral-400 sticky left-0 bg-white">Vendor <span className="text-neutral-300">(not staffed)</span></td>
                {days.map(d => {
                  const n = (d.vendor && d.vendor[market]) || 0
                  const k = `${d.date}__${market}__vendor`
                  return (
                    <td key={d.date} className="px-2 py-1.5 text-center">
                      <button
                        onClick={() => setOpen(open === k ? '' : k)}
                        disabled={n === 0}
                        className={`min-w-[34px] px-2 py-1 rounded text-amber-700 ${n === 0 ? 'text-neutral-300' : open === k ? 'bg-amber-500 text-white' : 'hover:bg-amber-50'}`}
                      >{n}</button>
                    </td>
                  )
                })}
              </tr>
            )}

            {/* Cleaners needed */}
            <tr className="border-t border-neutral-100 bg-neutral-50/60">
              <td className="px-3 py-2 text-left font-medium text-neutral-700 sticky left-0 bg-neutral-50/60">Cleaners needed</td>
              {days.map(d => {
                const n = (d.actual && d.actual[market]) || 0
                const need = rateM > 0 ? Math.ceil(n / rateM) : 0
                return <td key={d.date} className="px-2 py-2 text-center font-semibold text-neutral-900">{need || '—'}</td>
              })}
            </tr>

            {/* spacer */}
            <tr><td colSpan={days.length + 1} className="py-1 bg-white"></td></tr>

            {/* team members */}
            {members.map(mem => (
              <tr key={mem} className="border-t border-neutral-100 group">
                <td className="px-3 py-1.5 text-left sticky left-0 bg-white">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => removeMember(mem)} className="opacity-0 group-hover:opacity-100 text-neutral-300 hover:text-rose-500"><X size={13} /></button>
                    <span className="font-medium text-neutral-800">{mem}</span>
                  </div>
                </td>
                {days.map(d => {
                  const v = cells[`${mem}__${d.date}`] || ''
                  return (
                    <td key={d.date} className="px-1 py-1 text-center">
                      <select
                        value={v}
                        onChange={e => setCell(mem, d.date, e.target.value)}
                        className={`w-full text-xs rounded px-1 py-1 border-0 cursor-pointer ${cellClass(v)}`}
                      >
                        <option value="">—</option>
                        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}

            {/* add member */}
            <tr className="border-t border-neutral-100 bg-white">
              <td className="px-3 py-2 sticky left-0 bg-white" colSpan={days.length + 1}>
                <div className="flex items-center gap-2">
                  <input
                    list="hk-list" value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addMember(newName) }}
                    placeholder="Add team member…"
                    className="text-sm px-2 py-1 rounded border border-neutral-200 w-52"
                  />
                  <datalist id="hk-list">{hk.map(n => <option key={n} value={n} />)}</datalist>
                  <button onClick={() => addMember(newName)} className="inline-flex items-center gap-1 text-sm px-2 py-1 rounded bg-neutral-900 text-white hover:bg-neutral-700"><Plus size={14} /> Add</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* drill-down panel */}
      {open && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold text-neutral-800">
              {open.endsWith('__vendor') ? 'Vendor cleans' : 'Cleans'} · {market} · {shortDate(open.split('__')[0])}
              <span className="text-neutral-400 font-normal"> · {openUnits.length} unit{openUnits.length === 1 ? '' : 's'}</span>
            </div>
            <button onClick={() => setOpen('')} className="text-neutral-400 hover:text-neutral-700"><X size={15} /></button>
          </div>
          {openUnits.length === 0 ? (
            <div className="text-sm text-neutral-400">No unit detail available for this day.</div>
          ) : (
            <div className="space-y-1">
              {openUnits.map((u, i) => {
                const isVendor = open.endsWith('__vendor')
                const od = open.split('__')[0]
                const st = u.listingId ? assignState[`${u.listingId}__${od}`] : undefined
                return (
                  <div key={i} className="text-xs px-2 py-1.5 rounded border border-neutral-100 bg-neutral-50 flex items-center gap-2">
                    <span className="text-neutral-800 truncate flex-1">{u.unit}</span>
                    <span className="text-neutral-400 shrink-0">
                      {u.bedrooms != null ? `${u.bedrooms}BR` : ''}{u.sameDay ? ' · SDT' : ''}
                    </span>
                    {!isVendor && u.assigned && u.assigned.length > 0 && (
                      <span className="text-green-700 shrink-0 truncate max-w-[130px]" title={u.assigned.join(', ')}>{u.assigned.join(', ')}</span>
                    )}
                    {!isVendor && u.listingId && hkPeople.length > 0 && (
                      <div className="flex items-center gap-1 shrink-0">
                        <select
                          defaultValue=""
                          onChange={e => { const v = e.target.value; if (v) assignUnit(u, od, v) }}
                          className="text-xs rounded border border-neutral-200 px-1 py-0.5 bg-white cursor-pointer"
                          title="Assign a cleaner — pushes to Breezeway"
                        >
                          <option value="">Assign…</option>
                          {hkPeople.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                        </select>
                        {st === 'saving' && <Loader2 size={12} className="animate-spin text-neutral-400" />}
                        {st === 'done' && <Check size={12} className="text-green-600" />}
                        {st === 'err' && <span className="text-rose-600 font-semibold">!</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-neutral-400 leading-relaxed">
        Cleaners needed = the day’s booked cleans ÷ cleans-per-cleaner (adjust the rate per market). Click a cleans number to see the exact units — bigger or spread-out units may need a lower rate. Set each person’s status for the week; shift times stay in Homebase. Changes save automatically. Vendor buildings (Botanica, Park Towers, Amrit, Capri, Lucerne) are shown separately and not counted in cleaners needed.
      </p>
    </div>
  )
}
