'use client'
// THE INSPECTION LOG. Roberto walks units all day; most of what he sees is a note for the next
// conversation with a cleaner, not a work order. Typing it into Breezeway as a task was the friction
// that meant it never got written down at all — so this is a box, a unit, a name, and what he found.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Search, Star } from 'lucide-react'

type Row = any
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const pretty = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// DIRECT THE TEAM. A note nobody acts on is a diary entry. Every inspection gets an explicit next
// step, decided by the score and whether it was flagged — so the coordinator does not have to.
function nextStep(r: any): { text: string; tone: 'bad' | 'warn' | 'ok'; task?: { title: string; department: string; priority: string } } {
  const rating = r.rating == null ? null : Number(r.rating)
  if (rating != null && rating <= 2) return {
    text: 'Re-clean this unit before the next guest arrives.', tone: 'bad',
    task: { title: 'Re-clean — failed inspection', department: 'housekeeping', priority: 'high' },
  }
  if (r.follow_up) return {
    text: 'Raise a task and put a name on it.', tone: 'warn',
    task: { title: 'Follow-up from inspection', department: 'maintenance', priority: 'normal' },
  }
  if (rating === 3) return {
    text: 'Spot-check ' + (r.cleaner ? r.cleaner + "'s" : 'the') + ' next turn in this unit and talk it through.', tone: 'warn',
    task: { title: 'Quality spot-check', department: 'inspection', priority: 'normal' },
  }
  return { text: 'Nothing to do — logged for training.', tone: 'ok' }
}

export function InspectionsBoard() {
  const [rows, setRows] = useState<Row[]>([])
  const [cleaners, setCleaners] = useState<any[]>([])
  const [units, setUnits] = useState<{ id: string; name: string }[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [days, setDays] = useState(30)
  const [q, setQ] = useState('')
  const [filterCleaner, setFilterCleaner] = useState('')
  const [needsMigration, setNeedsMigration] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState('')

  // the form
  const [unit, setUnit] = useState('')
  const [cleaner, setCleaner] = useState('')
  const [rating, setRating] = useState<number | ''>('')
  const [notes, setNotes] = useState('')
  const [followUp, setFollowUp] = useState(false)
  const [date, setDate] = useState(todayET())

  const load = useCallback(async () => {
    setErr('')
    try {
      const r = await fetch('/api/inspections?days=' + days + (filterCleaner ? '&cleaner=' + encodeURIComponent(filterCleaner) : '') + (q ? '&q=' + encodeURIComponent(q) : ''), { cache: 'no-store' })
      const j = await r.json()
      if (j.needsMigration) { setNeedsMigration(true); return }
      if (!j.ok) throw new Error(j.error || 'Could not load inspections')
      setRows(j.rows || []); setCleaners(j.cleaners || []); setNeedsMigration(false)
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [days, q, filterCleaner])
  useEffect(() => { load() }, [load])

  // unit + cleaner pickers come from the real lists so names match what the rest of the app uses
  useEffect(() => {
    fetch('/api/ops-today', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const seen: Record<string, string> = {}
      for (const u of (j.units || [])) if (u.listingId && u.unit) seen[String(u.listingId)] = u.unit
      setUnits(Object.keys(seen).map(id => ({ id, name: seen[id] })).sort((a, b) => a.name.localeCompare(b.name)))
    }).catch(() => {})
    fetch('/api/breezeway/people', { cache: 'no-store' }).then(r => r.json()).then(j => {
      setPeople(((j.people || j) as any[]).map((p: any) => String(p.name || '')).filter(Boolean).sort())
    }).catch(() => {})
  }, [])

  const save = async () => {
    if (!unit.trim() || !notes.trim()) { setErr('Unit and notes are both needed.'); return }
    setBusy(true); setErr('')
    try {
      const match = units.find(u => u.name === unit.trim())
      const r = await fetch('/api/inspections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit: unit.trim(), listingId: match?.id, cleaner, rating, notes, followUp, date }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Could not save')
      setSaved('Logged'); setTimeout(() => setSaved(''), 1800)
      setUnit(''); setCleaner(''); setRating(''); setNotes(''); setFollowUp(false)
      load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const byDate = useMemo(() => {
    const g: Record<string, Row[]> = {}
    for (const r of rows) (g[String(r.inspected_on)] = g[String(r.inspected_on)] || []).push(r)
    return Object.keys(g).sort().reverse().map(d => ({ date: d, items: g[d] }))
  }, [rows])

  if (needsMigration) return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900">
      <div className="font-semibold mb-1">One database step first</div>
      Run <code className="bg-white px-1 rounded border border-amber-200">supabase/migrations/014_unit_inspections.sql</code> in the Supabase SQL editor, then reload this page.
    </div>
  )

  return (
    <div className="space-y-5">
      {/* WRITE IT DOWN */}
      <section className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardCheck size={15} className="text-ink" />
          <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">Log an inspection</span>
          {saved && <span className="text-[11px] font-semibold text-emerald-700">{saved}</span>}
          {err && <span className="text-[11px] text-rose-700">{err}</span>}
        </div>
        <div className="grid md:grid-cols-4 gap-2 mb-2">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted font-semibold">Unit</label>
            <input list="insp-units" value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. Eden 2203" className="w-full text-[13px] border border-line rounded-md px-2 py-1.5" />
            <datalist id="insp-units">{units.map(u => <option key={u.id} value={u.name} />)}</datalist>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted font-semibold">Who cleaned it</label>
            <input list="insp-people" value={cleaner} onChange={e => setCleaner(e.target.value)} placeholder="cleaner's name" className="w-full text-[13px] border border-line rounded-md px-2 py-1.5" />
            <datalist id="insp-people">{people.map(p => <option key={p} value={p} />)}</datalist>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted font-semibold">How was it</label>
            <div className="flex gap-1 mt-0.5">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRating(rating === n ? '' : n)} title={n + ' out of 5'}
                  className={'w-8 h-8 rounded-md border text-[12px] font-bold ' + (Number(rating) >= n ? 'bg-amber-400 border-amber-500 text-white' : 'bg-white border-line text-muted hover:bg-slate-50')}>{n}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted font-semibold">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value || todayET())} className="w-full text-[13px] border border-line rounded-md px-2 py-1.5" />
          </div>
        </div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="What did you find? Anything you would tell the cleaner next time."
          className="w-full text-[13px] border border-line rounded-md px-2 py-1.5" />
        <div className="flex items-center gap-3 mt-2">
          <label className="flex items-center gap-1.5 text-[12px] text-ink">
            <input type="checkbox" checked={followUp} onChange={e => setFollowUp(e.target.checked)} /> Needs a follow-up
          </label>
          <button onClick={save} disabled={busy} className="ml-auto text-[13px] font-semibold px-3 py-1.5 rounded-md bg-ink text-white disabled:opacity-50">{busy ? 'Saving…' : 'Log it'}</button>
        </div>
      </section>

      {/* TRAINING VIEW */}
      {!!cleaners.length && (
        <section className="rounded-xl border border-line bg-white p-4">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-2">By cleaner {'·'} last {days} days</div>
          <div className="flex flex-wrap gap-1.5">
            {cleaners.map(c => (
              <button key={c.name} onClick={() => setFilterCleaner(filterCleaner === c.name ? '' : c.name)}
                className={'text-[12px] px-2.5 py-1.5 rounded-lg border ' + (filterCleaner === c.name ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:bg-slate-50')}>
                <span className="font-semibold">{c.name}</span>
                <span className={filterCleaner === c.name ? 'opacity-80' : 'text-muted'}> {'·'} {c.inspections} {c.avg != null ? '· ' + c.avg + '/5' : ''}{c.followUps ? ' · ' + c.followUps + ' follow-up' : ''}</span>
              </button>
            ))}
          </div>
          {filterCleaner && <div className="text-[11px] text-muted mt-2">Showing {filterCleaner} only — click again to clear.</div>}
        </section>
      )}

      {/* HISTORY */}
      <section className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">History</span>
          <div className="relative">
            <Search size={13} className="absolute left-2 top-2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="unit, cleaner, or what was found" className="text-[12.5px] border border-line rounded-md pl-7 pr-2 py-1.5 w-64" />
          </div>
          <select value={days} onChange={e => setDays(Number(e.target.value))} className="text-[12px] border border-line rounded-md px-2 py-1.5">
            {[7, 30, 90, 365].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <span className="text-[11px] text-muted">{rows.length} inspection{rows.length === 1 ? '' : 's'}</span>
        </div>
        {!rows.length && <div className="text-[13px] text-muted">Nothing logged yet in this window.</div>}
        {byDate.map(g => (
          <div key={g.date} className="mb-3">
            <div className="text-[11px] font-semibold text-muted mb-1">{pretty(g.date)}</div>
            <div className="space-y-1.5">
              {g.items.map((r: any) => (
                <div key={r.id} className={'border rounded-lg px-3 py-2 ' + (r.follow_up ? 'border-amber-300 bg-amber-50/40' : 'border-line')}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink text-[13px]">{r.unit}</span>
                    {r.cleaner && <span className="text-[11.5px] text-muted">cleaned by <span className="text-ink font-medium">{r.cleaner}</span></span>}
                    {r.rating != null && (
                      <span className="inline-flex items-center gap-0.5 text-[11.5px] font-semibold text-amber-700"><Star size={11} className="fill-amber-400 text-amber-500" />{r.rating}/5</span>
                    )}
                    {r.follow_up && <span className="text-[9.5px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-500 text-white">follow-up</span>}
                    {r.inspector && <span className="ml-auto text-[11px] text-muted">{r.inspector}</span>}
                  </div>
                  <div className="text-[12.5px] text-ink mt-1 whitespace-pre-wrap">{r.notes}</div>
                  <ActRow r={r} people={people} onDone={load} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}


// The bridge between "I saw something" and "someone is doing something about it". Creating the task
// here writes the same Breezeway task Today in Ops would, carrying the inspection notes across, and
// the row then shows the link so nobody raises it twice.
function ActRow({ r, people, onDone }: { r: any; people: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(todayET())
  const [who, setWho] = useState(r.cleaner || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const step = nextStep(r)
  const tone = step.tone === 'bad' ? 'text-rose-700' : step.tone === 'warn' ? 'text-amber-700' : 'text-muted'

  const create = async () => {
    if (!step.task) return
    setBusy(true); setErr('')
    try {
      const description = 'Raised from an inspection on ' + r.inspected_on + (r.cleaner ? ' (cleaned by ' + r.cleaner + ')' : '')
        + (r.rating != null ? ' — scored ' + r.rating + '/5' : '') + '.\n\nWhat was found:\n' + r.notes
      const pr = await fetch('/api/breezeway/people', { cache: 'no-store' }).then(x => x.json()).catch(() => null)
      const match = ((pr?.people || pr || []) as any[]).find((p: any) => String(p.name || '').toLowerCase() === who.trim().toLowerCase())
      const res = await fetch('/api/ops-today/add-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: r.listing_id, title: step.task.title + ' — ' + r.unit,
          department: step.task.department, priority: step.task.priority,
          description, date, assigneeIds: match ? [match.id] : [],
        }),
      })
      const j = await res.json()
      if (!j.ok && !j.task) throw new Error(j.error || 'Could not create the task')
      const taskId = String(j.taskId || j.task?.id || j.id || '')
      if (taskId) await fetch('/api/inspections', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, taskId }) })
      setOpen(false); onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  return (
    <div className="mt-1.5 pt-1.5 border-t border-line/60">
      <div className="flex flex-wrap items-center gap-2">
        <span className={'text-[11.5px] font-semibold ' + tone}>{'\u2192'} {step.text}</span>
        {r.taskId ? (
          <a href={'https://app.breezeway.io/task/' + r.taskId} target="_blank" rel="noreferrer"
            className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-300">Task raised {'\u2197'}</a>
        ) : step.task ? (
          <button onClick={() => setOpen(!open)} className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-white border border-line hover:bg-slate-50">{open ? 'Cancel' : 'Create the task'}</button>
        ) : null}
        {err && <span className="text-[11px] text-rose-700">{err}</span>}
      </div>
      {open && step.task && (
        <div className="mt-1.5 flex flex-wrap items-end gap-2 bg-slate-50 border border-line rounded-md p-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-muted font-semibold">When</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value || todayET())} className="text-[12.5px] border border-line rounded-md px-2 py-1" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-muted font-semibold">Who</label>
            <input list="insp-people" value={who} onChange={e => setWho(e.target.value)} placeholder="leave blank to assign later" className="text-[12.5px] border border-line rounded-md px-2 py-1 w-56" />
          </div>
          <div className="text-[11px] text-muted pb-1">{step.task.title} {'\u00b7'} {step.task.department}</div>
          <button onClick={create} disabled={busy} className="ml-auto text-[12px] font-semibold px-3 py-1.5 rounded-md bg-ink text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create in Breezeway'}</button>
        </div>
      )}
    </div>
  )
}
