'use client'
// ASSIGN CLEANERS — the Assign view on Rooms & cleans (Jon, 2026-11-11: "be able to assign cleaners,
// show board, stayovers vs checkouts"). Today's work, one column per housekeeper plus Unassigned.
// Each column splits checkouts from stayovers and adds up the time (checkout 45 min, stayover 20).
// Tap rooms to pick them, then hand them to someone; Auto-assign splits what is left across the
// people working, floor by floor. Assignments write to Cloudbeds when it knows the person.
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, UserPlus, Wand2, X } from 'lucide-react'

const post = async (url: string, body: any) => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` })) }
const MIN = { clean: 45, stayover: 20 } as Record<string, number>
const hrs = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`

type Room = { id: string; name: string; housekeeper?: string | null; condition: string | null; arriving: string | null; departing: boolean; dnd: boolean; tasks: { id: string; kind: string; status: string; assigned_to: string | null }[] }
type Work = { id: string; name: string; kind: 'clean' | 'stayover'; status: string; who: string | null; arriving: string | null; dnd: boolean; condition: string | null }

export function GardenAssign({ rooms, date, canEdit, onChanged }: { rooms: Room[]; date: string; canEdit: boolean; onChanged: () => void }) {
  const [sched, setSched] = useState<{ working: string[]; all: string[] } | null>(null)
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch(`/api/garden/schedule?from=${date}`, { cache: 'no-store' }).then(r => r.json()).then(j => {
      const staff = (j?.staff || []).filter((s: any) => s.role === 'housekeeping')
      const day = (j?.days || []).find((d: any) => d.date === date)
      const on = new Set((day?.shifts || []).filter((x: any) => x.role === 'housekeeping').map((x: any) => x.staff_id))
      setSched({ working: staff.filter((s: any) => on.has(s.id)).map((s: any) => s.name), all: staff.map((s: any) => s.name) })
    }).catch(() => setSched({ working: [], all: [] }))
  }, [date])

  // One row of work per room: a checkout beats a stayover in the same room.
  const work: Work[] = useMemo(() => rooms.flatMap(r => {
    const t = r.tasks.filter(x => (x.kind === 'clean' || x.kind === 'stayover') && x.status !== 'cancelled')
    if (!t.length) return []
    const main = t.find(x => x.kind === 'clean') || t[0]
    return [{ id: r.id, name: r.name, kind: main.kind as Work['kind'], status: t.every(x => x.status === 'done') ? 'done' : t.some(x => x.status === 'in_progress') ? 'in_progress' : 'open', who: t.find(x => x.assigned_to)?.assigned_to || r.housekeeper || null, arriving: r.arriving, dnd: r.dnd, condition: r.condition }]
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [rooms])

  const people = useMemo(() => {
    const names = new Set<string>([...(sched?.working || []), ...work.map(w => w.who).filter(Boolean) as string[]])
    return Array.from(names)
  }, [sched, work])
  const cols = [{ name: null as string | null }, ...people.map(p => ({ name: p as string | null }))]

  const toggle = (id: string) => setPick(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const run = async (key: string, body: any, ok: (r: any) => string) => {
    setBusy(key); setMsg('')
    const r = await post('/api/garden/assign', { date, ...body })
    setBusy('')
    if (!r?.ok) { setMsg(r?.error || 'Could not assign.'); return }
    const warn = r.warnings?.length ? ' ' + r.warnings.join(' · ') : r.cloudbeds && r.cloudbeds !== 'sent' && r.cloudbeds !== 'skipped' ? ` (${r.cloudbeds})` : ''
    setMsg(ok(r) + warn); setPick(new Set()); onChanged()
  }
  const assign = (who: string | null) => run('assign', { op: 'assign', roomIds: Array.from(pick), to: who }, r => `${pick.size} room${pick.size === 1 ? '' : 's'} ${who ? 'to ' + who : 'unassigned'}${r.cloudbeds === 'sent' ? ' · sent to Cloudbeds' : ''}.`)
  const auto = () => run('auto', { op: 'auto', people: sched?.working.length ? sched.working : people }, r => `${r.assigned} rooms split: ${Object.entries(r.perPerson).map(([n, v]: any) => `${n.split(' ')[0]} ${v.rooms.length} (${hrs(v.minutes)})`).join(', ')}.`)

  const totals = { co: work.filter(w => w.kind === 'clean').length, so: work.filter(w => w.kind === 'stayover').length, un: work.filter(w => !w.who).length }
  const totalMin = totals.co * MIN.clean + totals.so * MIN.stayover

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3 text-[12.5px]">
        <span className="rounded-full bg-amber-100 text-amber-800 font-semibold px-2.5 py-0.5">{totals.co} checkouts</span>
        <span className="rounded-full bg-sky-100 text-sky-800 font-semibold px-2.5 py-0.5">{totals.so} stayovers</span>
        <span className="text-muted">≈ {hrs(totalMin)} of cleaning · {totals.un} unassigned · {sched ? (sched.working.length ? `${sched.working.length} housekeeper${sched.working.length === 1 ? '' : 's'} scheduled` : 'nobody on the schedule today') : '…'}</span>
        <span className="flex-1" />
        {canEdit ? <button disabled={!!busy || !totals.un || !(sched?.working.length || people.length)} onClick={auto} className="h-8 px-3 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-40" title={sched?.working.length ? 'Split the unassigned rooms across today\'s scheduled housekeepers' : 'Put housekeepers on today\'s schedule first, or assign by hand'}>{busy === 'auto' ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}Auto-assign</button> : null}
      </div>
      {msg ? <p className="text-[12px] text-muted mb-2">{msg}</p> : null}

      {canEdit && pick.size ? (
        <div className="sticky top-2 z-10 flex items-center gap-2 flex-wrap rounded-xl border border-ink bg-white shadow-sm px-3 py-2 mb-3">
          <b className="text-[12.5px] text-ink">{pick.size} selected</b>
          <select value={to} onChange={e => setTo(e.target.value)} className="h-8 rounded-lg border border-line px-2 text-[12.5px]">
            <option value="">Assign to…</option>
            {Array.from(new Set([...(sched?.working || []), ...(sched?.all || []), ...people])).map(n => <option key={n} value={n}>{n}{sched?.working.includes(n) ? ' · on today' : ''}</option>)}
          </select>
          <button disabled={!to || !!busy} onClick={() => assign(to)} className="h-8 px-3 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold inline-flex items-center gap-1 disabled:opacity-40">{busy === 'assign' ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}Assign</button>
          <button disabled={!!busy} onClick={() => assign(null)} className="h-8 px-3 rounded-lg border border-line text-[12px] font-semibold">Unassign</button>
          <button onClick={() => setPick(new Set())} className="ml-auto text-muted" aria-label="Clear selection"><X size={15} /></button>
        </div>
      ) : null}

      {!work.length ? <div className="rounded-xl border border-line bg-white p-6 text-center text-[13px] text-muted">No cleans or stayovers today.</div> : (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(cols.length, 6)}, minmax(200px, 1fr))` }}>
          {cols.map(c => {
            const mine = work.filter(w => (w.who || null) === c.name)
            const co = mine.filter(w => w.kind === 'clean'), so = mine.filter(w => w.kind === 'stayover')
            const done = mine.filter(w => w.status === 'done').length
            const min = co.length * MIN.clean + so.length * MIN.stayover
            return (
              <div key={c.name || '_'} className={`rounded-xl border bg-white p-2.5 min-h-[120px] ${c.name ? 'border-line' : 'border-dashed border-amber-300 bg-amber-50/30'}`}>
                <div className="flex items-baseline gap-1.5">
                  <b className="text-[13px] text-ink truncate">{c.name || 'Unassigned'}</b>
                  {c.name && sched?.working.includes(c.name) ? <span className="text-[10px] text-emerald-700 font-semibold">on today</span> : c.name ? <span className="text-[10px] text-amber-700 font-semibold">not scheduled</span> : null}
                </div>
                <div className="text-[11px] text-muted tabular-nums">{co.length} C/O · {so.length} S/O · {hrs(min)}{c.name ? ` · ${done}/${mine.length} done` : ''}</div>
                {c.name && mine.length ? <div className="h-1 rounded-full bg-neutral-100 mt-1"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(done / mine.length * 100)}%` }} /></div> : null}
                {[['Checkouts', co], ['Stayovers', so]].map(([label, list]: any) => list.length ? (
                  <div key={label} className="mt-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">{label}</div>
                    <div className="flex flex-wrap gap-1">
                      {list.map((w: Work) => {
                        const on = pick.has(w.id)
                        const tone = w.status === 'done' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : w.status === 'in_progress' ? 'bg-sky-100 text-sky-800 border-sky-200' : w.kind === 'clean' ? 'bg-amber-50 text-amber-900 border-amber-200' : 'bg-white text-ink border-line'
                        return (
                          <button key={w.id} disabled={!canEdit} onClick={() => toggle(w.id)} title={[w.kind === 'clean' ? 'Checkout clean' : 'Stayover', w.arriving ? 'arrival: ' + w.arriving : '', w.dnd ? 'DND' : '', w.status.replace('_', ' ')].filter(Boolean).join(' · ')}
                            className={`relative h-7 min-w-[44px] px-1.5 rounded-md border text-[12px] font-bold tabular-nums ${tone} ${on ? 'ring-2 ring-ink' : ''} ${w.arriving && w.status !== 'done' ? 'outline outline-1 outline-rose-400' : ''}`}>
                            {w.name}{w.status === 'done' ? <Check size={10} className="inline ml-0.5" /> : null}{w.dnd ? <span className="ml-0.5 text-violet-600">z</span> : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null)}
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-muted mt-2">Red outline = a guest arrives today, clean it first. z = do not disturb. Time: checkout 45 min, stayover 20.</p>
    </div>
  )
}
