'use client'
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'

type Day = { date: string; dow: number; day: string; actual: Record<string, number>; vendor: Record<string, number>; isToday: boolean; isPast: boolean }
type FC = { ok: boolean; today: string; histDays: number; markets: string[]; weekStart: string; weekEnd: string; prevWeekStart: string; nextWeekStart: string; isCurrentWeek: boolean; avgByMarketDow: Record<string, number[]>; week: Day[] }

const DEFAULT_RATE: Record<string, number> = { Miami: 5, Broward: 4, North: 4 }
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtRange(a: string, b: string) { const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00'); return MON[da.getMonth()] + ' ' + da.getDate() + ' – ' + MON[db.getMonth()] + ' ' + db.getDate() }

function cellClass(v: string) {
  const s = (v || '').toLowerCase()
  if (/req\s*off/.test(s)) return 'bg-rose-100 text-rose-800'
  if (/\boff\b/.test(s)) return 'bg-orange-100 text-orange-800'
  if (/on\s*call/.test(s)) return 'bg-yellow-200 text-yellow-900'
  if (s.trim()) return 'bg-white text-ink'
  return 'bg-white'
}

export function ForecastBoard() {
  const [data, setData] = useState<FC | null>(null)
  const [err, setErr] = useState('')
  const [weekStart, setWeekStart] = useState('')
  const [market, setMarket] = useState('Miami')
  const [rate, setRate] = useState<Record<string, number>>(DEFAULT_RATE)
  const [hk, setHk] = useState<string[]>([])
  const [members, setMembers] = useState<Record<string, string[]>>({ Miami: [], Broward: [], North: [] })
  const [cells, setCells] = useState<Record<string, Record<string, Record<string, string>>>>({ Miami: {}, Broward: {}, North: {} })
  const [newName, setNewName] = useState('')

  useEffect(() => {
    const url = '/api/schedule/forecast' + (weekStart ? ('?weekStart=' + weekStart) : '')
    fetch(url).then(r => r.json()).then((j: FC) => { if (!j.ok) { setErr((j as any).error || 'Failed'); return } setData(j) }).catch(e => setErr(String(e)))
  }, [weekStart])

  useEffect(() => {
    fetch('/api/schedule?view=week').then(r => r.json()).then(j => {
      const names = (j.housekeepers || []).map((h: any) => (h && h.name) ? h.name : h).filter(Boolean)
      setHk(Array.from(new Set(names)).sort() as string[])
    }).catch(() => {})
  }, [])

  if (err) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Error: {err}</div>
  if (!data) return <div className="p-4 text-sm text-muted">Loading…</div>

  const days = data.week
  const rateM = rate[market] || 4
  const setCell = (name: string, date: string, val: string) => setCells(prev => ({ ...prev, [market]: { ...prev[market], [name]: { ...(prev[market]?.[name] || {}), [date]: val } } }))
  const addMember = (name: string) => { const n = name.trim(); if (!n) return; setMembers(prev => (prev[market].includes(n) ? prev : { ...prev, [market]: [...prev[market], n] })); setNewName('') }
  const removeMember = (name: string) => setMembers(prev => ({ ...prev, [market]: prev[market].filter(x => x !== name) }))
  const roster = members[market] || []

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
          {data.markets.map(m => (
            <button key={m} onClick={() => setMarket(m)} className={'rounded-md px-3 py-1.5 text-sm font-semibold ' + (market === m ? 'bg-white text-ink shadow-sm' : 'text-neutral-500 hover:text-ink')}>{m}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(data.prevWeekStart)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50"><ChevronLeft size={16} /></button>
          <div className="min-w-[150px] text-center"><div className="text-sm font-semibold text-ink">{fmtRange(data.weekStart, data.weekEnd)}</div><div className="text-[11px] text-muted">{data.isCurrentWeek ? 'This week · Sun–Sat' : 'Sun–Sat'}</div></div>
          <button onClick={() => setWeekStart(data.nextWeekStart)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50"><ChevronRight size={16} /></button>
          {!data.isCurrentWeek && <button onClick={() => setWeekStart('')} className="ml-1 text-xs text-neutral-500 underline hover:text-black">This week</button>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-neutral-50 p-2 text-left text-xs font-semibold text-muted">{market} team</th>
              {days.map(d => (
                <th key={d.date} className={'border-l border-neutral-100 p-2 text-center ' + (d.isToday ? 'bg-sky-50' : 'bg-neutral-50')}><div className="text-xs font-semibold text-ink">{d.day}</div><div className="text-[11px] text-muted">{d.date.slice(5)}</div></th>
              ))}
            </tr>
            <tr className="text-center">
              <td className="sticky left-0 z-10 bg-white p-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">Cleans (proj / booked)</td>
              {days.map(d => (<td key={d.date} className="border-l border-t border-neutral-100 p-1.5 text-[13px]"><span className="text-neutral-500">{data.avgByMarketDow[market][d.dow]}</span> / <b className="text-ink">{d.actual[market]}</b></td>))}
            </tr>
            <tr className="text-center">
              <td className="sticky left-0 z-10 bg-white p-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">Cleaners needed</td>
              {days.map(d => { const needed = rateM > 0 ? Math.ceil(data.avgByMarketDow[market][d.dow] / rateM) : 0; return (<td key={d.date} className="border-l border-t border-neutral-100 p-1"><span className="inline-flex items-center rounded-full bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white">{needed}</span></td>) })}
            </tr>
          </thead>
          <tbody>
            {roster.map(name => (
              <tr key={name} className="border-t border-neutral-100">
                <td className="group sticky left-0 z-10 bg-white p-2 text-left font-medium text-ink"><span className="flex items-center justify-between gap-2">{name}<button onClick={() => removeMember(name)} className="text-neutral-300 hover:text-red-500"><X size={13} /></button></span></td>
                {days.map(d => (
                  <td key={d.date} className="border-l border-neutral-100 p-0"><input value={cells[market]?.[name]?.[d.date] || ''} onChange={e => setCell(name, d.date, e.target.value)} placeholder="—" className={'w-full min-w-[92px] border-0 px-2 py-2 text-center text-[13px] outline-none focus:ring-1 focus:ring-sky-300 ' + cellClass(cells[market]?.[name]?.[d.date] || '')} /></td>
                ))}
              </tr>
            ))}
            {roster.length === 0 && (<tr><td colSpan={8} className="p-4 text-center text-sm text-muted">No team members yet — add people below.</td></tr>)}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <input list="hk-list" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addMember(newName) }} placeholder={'Add to ' + market + '…'} className="w-56 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
          <datalist id="hk-list">{hk.map(n => <option key={n} value={n} />)}</datalist>
          <button onClick={() => addMember(newName)} className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white"><Plus size={14} /> Add</button>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-muted">Cleans/cleaner ({market})<input type="number" min={1} max={12} value={rateM} onChange={e => setRate({ ...rate, [market]: Math.max(1, Number(e.target.value) || 1) })} className="w-14 rounded-lg border border-neutral-300 px-2 py-1 text-sm" /></label>
        <span className="text-xs text-muted">Type a shift (e.g. “9:30am–6pm (17 West)”) or OFF / ON CALL / REQ OFF. Saving &amp; sharing come next.</span>
      </div>
    </div>
  )
}
