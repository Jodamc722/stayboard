'use client'
// THE GARDEN SCHEDULER (Jon, 2026-11-10: "create a scheduler that works"). One week, people down the
// side (grouped by role), days across. Each cell is that person's shift: tap + to put them on (the
// role's usual hours), tap a shift to change the hours or take it off. Above the grid, what each day
// holds (arrivals, checkouts, stayovers) and what it needs (housekeepers from the cleans, a front
// desk); below each day, covered or short. Clock-ins from Homebase sit on the shift when there are any.
// Copy last week fills empty cells from the week before. Staff: add, change role, remove.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, ChevronLeft, ChevronRight, Copy, Loader2, Plus, Trash2, Wand2, X } from 'lucide-react'
import { Tag, LeanEmpty, type Tone } from '@/components/lean'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) }
const post = (url: string, body: any) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const ROLES = ['housekeeping', 'frontdesk', 'maintenance', 'manager'] as const
const ROLE_LABEL: Record<string, string> = { housekeeping: 'Housekeeping', frontdesk: 'Front desk', maintenance: 'Maintenance', manager: 'Management' }
const ROLE_TONE: Record<string, Tone> = { housekeeping: 'emerald', frontdesk: 'brand', maintenance: 'amber', manager: 'violet' }
const DEFAULT_HOURS: Record<string, [string, string]> = { housekeeping: ['09:00', '17:00'], frontdesk: ['07:00', '15:00'], maintenance: ['08:00', '16:00'], manager: ['09:00', '17:00'] }
const hhmm = (t?: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'a' : 'p'}` }
const clock = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).replace(' AM', 'a').replace(' PM', 'p') : ''
const dayHead = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); return { dow: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), md: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) } }
const add = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const todayNY = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export function GardenScheduleGrid({ canEdit }: { canEdit: boolean }) {
  const [from, setFrom] = useState<string | null>(null)
  const [d, setD] = useState<any | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [edit, setEdit] = useState<{ shift?: any; staff: any; date: string } | null>(null)
  const [times, setTimes] = useState<[string, string]>(['09:00', '17:00'])
  const [staffOpen, setStaffOpen] = useState(false)
  const [ns, setNs] = useState({ name: '', role: 'housekeeping', phone: '' })

  const load = useCallback(async () => setD(await j(`/api/garden/schedule${from ? `?from=${from}` : ''}`)), [from])
  useEffect(() => { load() }, [load])

  const staff: any[] = useMemo(() => d?.staff || [], [d])
  const byRole = useMemo(() => ROLES.map(r => ({ role: r, people: staff.filter(s => s.role === r) })).filter(g => g.people.length), [staff])
  const shiftOf = (sid: string, date: string) => d?.days.find((x: any) => x.date === date)?.shifts.filter((s: any) => s.staff_id === sid) || []
  const punchOf = (s: any, date: string) => { const day = d?.days.find((x: any) => x.date === date); return (day?.punches || []).filter((p: any) => p.staff_id === s.id || (p.name && p.name.toLowerCase() === String(s.name).toLowerCase())) }

  const act = async (key: string, body: any, after?: (r: any) => void) => {
    setBusy(key); setMsg('')
    const r = await post('/api/garden/schedule', body)
    setBusy(''); if (r?.error || r?.ok === false) setMsg(r.error || 'Could not save.'); else after?.(r)
    load()
  }
  const putOn = (s: any, date: string) => { const [a, b] = DEFAULT_HOURS[s.role] || ['09:00', '17:00']; act(s.id + date, { op: 'shift', date, staffId: s.id, role: s.role, start: a, end: b }) }
  const openEdit = (s: any, date: string, shift?: any) => { setEdit({ shift, staff: s, date }); setTimes(shift ? [shift.start_time?.slice(0, 5), shift.end_time?.slice(0, 5)] : DEFAULT_HOURS[s.role] || ['09:00', '17:00']) }
  const saveEdit = () => { if (!edit) return; act('edit', { op: 'shift', id: edit.shift?.id, date: edit.date, staffId: edit.staff.id, role: edit.staff.role, start: times[0], end: times[1] }, () => setEdit(null)) }

  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading the week…</p>
  if (!d.ok) return <LeanEmpty>{d.error}</LeanEmpty>
  const days: any[] = d.days, t0 = todayNY()
  const shortTotal = days.reduce((a: number, day: any) => a + day.suggest.gaps.reduce((b: number, g: any) => b + g.short, 0), 0)

  return (
    <div className="pb-10">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <CalendarRange size={18} className="text-ink" /><h1 className="text-[20px] font-semibold text-ink">Scheduler</h1>
        <span className="text-[12px] text-muted">{staff.length} staff · {shortTotal ? <span className="text-amber-700 font-semibold">{shortTotal} shifts short this week</span> : <span className="text-emerald-700 font-semibold">week covered</span>}</span>
        <span className="flex-1" />
        <button onClick={() => setFrom(add(d.from, -7))} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-line bg-white" aria-label="Previous week"><ChevronLeft size={15} /></button>
        <button onClick={() => setFrom(null)} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold">This week</button>
        <button onClick={() => setFrom(add(d.from, 7))} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-line bg-white" aria-label="Next week"><ChevronRight size={15} /></button>
        {canEdit ? <button disabled={!!busy} onClick={() => act('build', { op: 'build_week', from: d.from }, r => setMsg(r.added ? `${r.added} shifts added to fill the week.${r.short?.length ? ' Still short: ' + r.short.length + ' — add more people with + Staff.' : ''}` : r.short?.length ? `Nobody left to schedule — ${r.short.length} gaps need more people (+ Staff).` : 'The week is already covered.'))} className="h-8 px-2.5 rounded-lg bg-brand-600 text-white text-[12px] font-semibold inline-flex items-center gap-1" title="Fill every day's gaps from the roster: fewest shifts first, max 5 days a person"><Wand2 size={13} />Build week</button> : null}
        {canEdit ? <button disabled={!!busy} onClick={() => act('copy', { op: 'copy_week', from: d.from }, r => setMsg(r.copied ? `${r.copied} shifts copied from last week.` : 'Nothing to copy — last week is empty or this week is already filled.'))} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold inline-flex items-center gap-1"><Copy size={13} />Copy last week</button> : null}
        {canEdit ? <button onClick={() => setStaffOpen(o => !o)} className="h-8 px-2.5 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1"><Plus size={13} />Staff</button> : null}
      </div>
      {msg ? <p className="text-[12px] text-muted mb-2">{msg}</p> : null}

      {staffOpen ? (
        <div className="rounded-xl border border-line bg-white p-3 mb-3">
          <div className="flex gap-2 flex-wrap items-center">
            <input value={ns.name} onChange={e => setNs({ ...ns, name: e.target.value })} placeholder="Name" className="h-8 rounded-lg border border-line px-2 text-[12.5px]" />
            <select value={ns.role} onChange={e => setNs({ ...ns, role: e.target.value })} className="h-8 rounded-lg border border-line px-2 text-[12.5px]">{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            <input value={ns.phone} onChange={e => setNs({ ...ns, phone: e.target.value })} placeholder="Phone (optional)" className="h-8 rounded-lg border border-line px-2 text-[12.5px]" />
            <button disabled={!ns.name.trim() || !!busy} onClick={() => act('staff', { op: 'staff', ...ns }, () => setNs({ name: '', role: ns.role, phone: '' }))} className="h-8 px-3 rounded-lg bg-ink text-white text-[12px] font-semibold disabled:opacity-50">Add</button>
          </div>
          {staff.length ? <div className="flex flex-wrap gap-1.5 mt-2">{staff.map(s => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px]">
              <b className="text-ink">{s.name}</b>
              <select value={s.role} onChange={e => act('role' + s.id, { op: 'staff', id: s.id, name: s.name, role: e.target.value, phone: s.phone, email: s.email })} className="text-[11.5px] bg-transparent">{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              <button onClick={() => { if (window.confirm(`Remove ${s.name} from the roster? Past shifts stay.`)) act('del' + s.id, { op: 'delete_staff', id: s.id }) }} className="text-muted hover:text-rose-700" aria-label={`Remove ${s.name}`}><Trash2 size={12} /></button>
            </span>
          ))}</div> : null}
          <p className="text-[11px] text-muted mt-2">Housekeepers Cloudbeds assigns rooms to are added here automatically on each sync.</p>
        </div>
      ) : null}

      <div className="rounded-xl border border-line bg-white overflow-x-auto">
        <table className="w-full text-[12px] border-collapse min-w-[900px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white text-left px-3 py-2 w-44 border-b border-line" />
              {days.map(day => { const h = dayHead(day.date); return (
                <th key={day.date} className={`px-2 py-2 text-left border-b border-l border-line font-normal ${day.date === t0 ? 'bg-brand-50' : ''}`}>
                  <div className="text-[12.5px] font-semibold text-ink">{h.dow} <span className="text-muted font-normal">{h.md}</span></div>
                  <div className="text-[10.5px] text-muted leading-tight">{day.load.arrivals} in · {day.load.departures} out · {day.load.inHouse} in house</div>
                  <div className="text-[10.5px] text-muted leading-tight">{day.load.cleans} checkouts · {day.load.stayovers} stayovers</div>
                </th>
              ) })}
            </tr>
          </thead>
          <tbody>
            {byRole.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-muted">No staff yet — add the hotel’s people with <b>+ Staff</b>.</td></tr>
            ) : byRole.map(g => (
              <Fragment key={g.role}>
                <tr key={g.role + 'h'}><td colSpan={8} className="px-3 pt-3 pb-1 text-[10.5px] uppercase tracking-wider font-semibold text-muted bg-app/60">{ROLE_LABEL[g.role]}</td></tr>
                {g.people.map(s => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="sticky left-0 bg-white px-3 py-1.5 font-semibold text-ink whitespace-nowrap">{s.name}</td>
                    {days.map(day => {
                      const sh = shiftOf(s.id, day.date), pu = punchOf(s, day.date)
                      return (
                        <td key={day.date} className={`px-1.5 py-1 border-l border-line align-top ${day.date === t0 ? 'bg-brand-50/40' : ''}`}>
                          {sh.map((x: any) => (
                            <button key={x.id} disabled={!canEdit} onClick={() => openEdit(s, day.date, x)} className={`w-full text-left rounded-md px-1.5 py-1 mb-0.5 text-[11.5px] font-semibold ${g.role === 'housekeeping' ? 'bg-emerald-50 text-emerald-800' : g.role === 'frontdesk' ? 'bg-brand-50 text-brand-800' : g.role === 'maintenance' ? 'bg-amber-50 text-amber-800' : 'bg-violet-50 text-violet-800'}`}>
                              {hhmm(x.start_time)}–{hhmm(x.end_time)}{x.rooms?.length ? <span className="font-normal"> · {x.rooms.length} rms</span> : null}
                            </button>
                          ))}
                          {pu.map((p: any, i: number) => <div key={i} className={`text-[10.5px] tabular-nums ${p.open ? 'text-emerald-700 font-semibold' : 'text-muted'}`}>{p.open ? '● in ' + clock(p.in) : clock(p.in) + '–' + clock(p.out)}</div>)}
                          {!sh.length && canEdit ? <button disabled={busy === s.id + day.date} onClick={() => putOn(s, day.date)} className="w-full h-7 rounded-md border border-dashed border-line text-muted hover:text-ink hover:border-ink/40 text-[11px]" title={`Put ${s.name} on ${hhmm(DEFAULT_HOURS[s.role]?.[0])}–${hhmm(DEFAULT_HOURS[s.role]?.[1])}`}>{busy === s.id + day.date ? <Loader2 size={11} className="animate-spin inline" /> : '+'}</button> : null}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="border-t-2 border-line">
              <td className="sticky left-0 bg-white px-3 py-2 text-[11px] font-semibold text-muted uppercase tracking-wider">Covered?</td>
              {days.map(day => (
                <td key={day.date} className="px-1.5 py-1.5 border-l border-line align-top">
                  <div className="flex flex-col gap-0.5">
                    {day.suggest.gaps.map((gp: any) => <Tag key={gp.role} tone={gp.short ? 'amber' : 'emerald'} title={`needs ${gp.need}, ${gp.on} on`}>{ROLE_LABEL[gp.role] || gp.role} {gp.on}/{gp.need}</Tag>)}
                    {canEdit && day.shifts.some((x: any) => x.role === 'housekeeping') && (day.load.cleans + day.load.stayovers) > 0 ? <button disabled={!!busy} onClick={() => act('split' + day.date, { op: 'split', date: day.date }, r => setMsg(`${r.assigned ?? 0} rooms split across housekeeping on ${dayHead(day.date).dow}.`))} className="text-[11px] font-semibold text-brand-700 inline-flex items-center gap-1 mt-0.5"><Wand2 size={11} />Split rooms</button> : null}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted mt-2">Housekeepers needed = checkouts + half the stayovers, 12 rooms a shift. One front desk a day. Clock-ins appear once Homebase is connected for the hotel.</p>

      {edit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setEdit(null)}>
          <div className="w-full max-w-xs rounded-2xl bg-white shadow-xl p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2"><b className="text-[14px] text-ink">{edit.staff.name}</b><span className="text-[12px] text-muted">{dayHead(edit.date).dow} {dayHead(edit.date).md}</span><span className="flex-1" /><button onClick={() => setEdit(null)} aria-label="Close"><X size={15} /></button></div>
            <div className="flex items-center gap-2 mt-3">
              <input type="time" value={times[0]} onChange={e => setTimes([e.target.value, times[1]])} className="h-9 rounded-lg border border-line px-2 text-[13px]" />
              <span className="text-muted">to</span>
              <input type="time" value={times[1]} onChange={e => setTimes([times[0], e.target.value])} className="h-9 rounded-lg border border-line px-2 text-[13px]" />
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button disabled={busy === 'edit'} onClick={saveEdit} className="h-9 px-4 rounded-lg bg-ink text-white text-[12.5px] font-semibold">Save</button>
              {edit.shift ? <button disabled={!!busy} onClick={() => act('del', { op: 'delete_shift', id: edit.shift.id }, () => setEdit(null))} className="h-9 px-3 rounded-lg border border-rose-200 text-rose-700 text-[12.5px] font-semibold">Take off</button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
