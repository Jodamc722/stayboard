'use client'
// VACANT UNITS — a Today in Ops tab (Jon, 2026-09-22: "There should be a vacant unit tab where it can
// show all vacant units so that, if our field coordinator wants to assign particular tasks or jobs,
// they can view it there, and the AI system can make recommendations based on its dataset").
//
// One row per empty unit: how long it is empty, what the data says the window is best used for
// (lib/vacant-work — open maintenance, guest issues, audit/inspection/deep-clean cadence, thin
// photos, ranked and filtered to what fits the window), and what the team has suggested. Every
// recommendation has an Add button that opens the normal Add task sheet pre-filled — the sheet is
// where the coordinator picks the person, so assigning is the same act everywhere on the board.
import { useEffect, useMemo, useState } from 'react'
import { Plus, Loader2, Lightbulb, X, Sparkles, DoorOpen } from 'lucide-react'
import { Tag, IconBtn, Tip, LeanEmpty } from '@/components/lean'
import { UnitSuggestions } from '@/components/SuggestionsBand'
import type { AddTaskSeed } from '@/components/AddTaskSheet'

type V = { listingId: string; unit: string; market: string; market2?: string | null; leftToday: string | null; nextArrival: string | null; openTasks: number; needsClean?: boolean }
type Sug = { key: string; label: string; why: string; priority: 1 | 2 | 3 | 4; needsDays: number }
type Note = { text: string; by: string; at: string }
type Info = { listingId: string; windowDays: number; suggestions: Sug[]; notes: Note[] }

// Which Add-task department a recommendation belongs to, and the title it files under.
const SEED: Record<string, { dept: string; title: string }> = {
  maintenance: { dept: 'maintenance', title: 'Maintenance — clear open requests while vacant' },
  glitch: { dept: 'maintenance', title: 'Fix open guest issue while vacant' },
  audit: { dept: 'inspection', title: 'Property audit' },
  inspection: { dept: 'inspection', title: 'Unit Check' },
  deepclean: { dept: 'housekeeping', title: 'Deep clean' },
  photos: { dept: 'inspection', title: 'Photo reshoot' },
}
const PRIO_TONE: Record<number, 'rose' | 'amber' | 'brand' | 'slate'> = { 1: 'rose', 2: 'amber', 3: 'brand', 4: 'slate' }

function dayLabel(ymd: string | null) {
  if (!ymd) return ''
  try { return new Date(ymd.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) } catch { return ymd }
}

export function VacantTab({ vacants, today, market, onAdd, readOnlyDate }: {
  vacants: V[]; today: string; market: string
  onAdd: (seed: AddTaskSeed) => void
  /** The board is showing a day other than today — recommendations still apply, filed for that day. */
  readOnlyDate?: string
}) {
  const inMkt = (v: V) => market === 'all' || v.market === market || v.market2 === market
  const list = useMemo(() => vacants.filter(inMkt), [vacants, market])
  const [info, setInfo] = useState<Record<string, Info>>({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [sort, setSort] = useState<'window' | 'work'>('work')
  const [only, setOnly] = useState<'all' | 'work' | 'nobooking'>('all')

  const sig = vacants.map(v => v.listingId).join(',') + '|' + today
  useEffect(() => {
    if (!vacants.length) return
    let live = true
    setLoading(true); setErr('')
    fetch('/api/ops-today/vacant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ today, vacants }) })
      .then(r => r.json()).then(j => {
        if (!live) return
        if (!j?.ok) { setErr(j?.error || 'Could not load recommendations.'); return }
        const m: Record<string, Info> = {}
        for (const u of (j.units || [])) m[String(u.listingId)] = u
        setInfo(m)
        if (j.engineError) setErr('Recommendations could not be worked out this time — ' + j.engineError)
      }).catch(e => live && setErr(String(e))).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [sig])

  const rows = useMemo(() => {
    let r = list.map(v => ({ v, i: info[v.listingId] || null }))
    if (only === 'work') r = r.filter(x => (x.i?.suggestions.length || 0) + (x.i?.notes.length || 0) > 0)
    if (only === 'nobooking') r = r.filter(x => !x.v.nextArrival)
    const win = (x: typeof r[number]) => x.v.nextArrival ? Math.max(0, Math.round((Date.parse(x.v.nextArrival.slice(0, 10)) - Date.parse(today)) / 86400000)) : 999
    const top = (x: typeof r[number]) => x.i?.suggestions[0]?.priority ?? 9
    return r.slice().sort((a, b) => sort === 'work'
      ? (top(a) - top(b)) || (win(b) - win(a)) || a.v.unit.localeCompare(b.v.unit)
      : (win(a) - win(b)) || a.v.unit.localeCompare(b.v.unit))
  }, [list, info, only, sort, today])

  const withWork = list.filter(v => (info[v.listingId]?.suggestions.length || 0) > 0).length
  const noBooking = list.filter(v => !v.nextArrival).length
  const leftToday = list.filter(v => !!v.leftToday).length

  async function saveNote(listingId: string, text: string) {
    const r = await fetch('/api/ops-today/vacant', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, text }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j?.error || 'Could not save.')
    setInfo(m => ({ ...m, [listingId]: { ...(m[listingId] || { listingId, windowDays: 999, suggestions: [] }), notes: j.notes || [] } as Info }))
  }
  async function removeNote(listingId: string, at: string) {
    const r = await fetch('/api/ops-today/vacant', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, removeAt: at }) })
    const j = await r.json().catch(() => ({}))
    if (r.ok) setInfo(m => ({ ...m, [listingId]: { ...(m[listingId] as Info), notes: j.notes || [] } }))
  }

  if (!list.length) return <LeanEmpty>No vacant units{market !== 'all' ? ' in ' + market : ''} on this day.</LeanEmpty>

  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <Tag tone="slate" title="Units with nobody in them tonight">{list.length} vacant</Tag>
        <Tag tone={withWork ? 'amber' : 'slate'} title="Units where the data says there is work worth slotting into the empty window">{withWork} with work to slot in</Tag>
        <Tag tone="slate" title="Nothing booked at all — the widest window there is">{noBooking} no booking</Tag>
        {leftToday > 0 && <Tag tone="brand" title="The guest checked out today">{leftToday} left today</Tag>}
        {loading && <span className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> working out recommendations…</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <select value={only} onChange={e => setOnly(e.target.value as any)} aria-label="Which vacant units" className="rounded-lg border border-line bg-white px-2 py-1 text-[12.5px] font-semibold text-ink">
            <option value="all">All vacant</option>
            <option value="work">With work to do</option>
            <option value="nobooking">No booking</option>
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as any)} aria-label="Sort" className="rounded-lg border border-line bg-white px-2 py-1 text-[12.5px] font-semibold text-ink">
            <option value="work">Most important first</option>
            <option value="window">Next arrival first</option>
          </select>
        </span>
      </div>
      {err && <p className="mb-2 text-[12px] text-amber-800">{err}</p>}
      {readOnlyDate && <p className="mb-2 text-[12px] text-muted">Showing the units empty on {dayLabel(readOnlyDate)}. Tasks you add are filed for that day.</p>}

      <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70 [&>li:first-child]:rounded-t-2xl [&>li:last-child]:rounded-b-2xl">
        {rows.map(({ v, i }) => {
          const isOpen = open === v.listingId
          const days = v.nextArrival ? Math.max(0, Math.round((Date.parse(v.nextArrival.slice(0, 10)) - Date.parse(today)) / 86400000)) : null
          const top = i?.suggestions[0] || null
          const addSeed = (s?: Sug): AddTaskSeed => ({
            unit: v.unit, listingId: v.listingId, date: readOnlyDate || undefined,
            ...(s && SEED[s.key] ? { title: SEED[s.key].title, dept: SEED[s.key].dept, desc: s.label + ' — ' + s.why } : {}),
          })
          return (
            <li key={v.listingId} className={top && top.priority === 1 ? 'bg-rose-50/30' : ''}>
              <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5">
                <DoorOpen size={16} className="text-muted shrink-0" />
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setOpen(isOpen ? null : v.listingId)}>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[14px] font-semibold text-ink truncate max-w-[18rem]">{v.unit}</span>
                    <span className="text-[12px] text-muted">{v.market}</span>
                    {v.nextArrival
                      ? <Tag tone={days != null && days <= 1 ? 'amber' : 'slate'} title={'Next guest arrives ' + dayLabel(v.nextArrival)}>{days === 0 ? 'Guest in today' : days === 1 ? 'Guest in tomorrow' : days + 'd empty · in ' + dayLabel(v.nextArrival)}</Tag>
                      : <Tag tone="emerald" title="Nothing booked — the widest window there is">No booking</Tag>}
                    {v.leftToday && <Tag tone="brand" title={'Checked out today — ' + v.leftToday}>Left today</Tag>}
                    {v.needsClean && <Tag tone="amber">Needs clean</Tag>}
                    {v.openTasks > 0 && <Tag tone="slate" title="Tasks already on the board for this unit today">{v.openTasks} task{v.openTasks === 1 ? '' : 's'} today</Tag>}
                    {top && <Tag tone={PRIO_TONE[top.priority]} title={top.why}><span className="inline-flex items-center gap-1"><Sparkles size={10} /> {top.label}</span></Tag>}
                    {i && i.suggestions.length > 1 && <Tag tone="slate">+{i.suggestions.length - 1} more</Tag>}
                    {i && i.notes.length > 0 && <Tag tone="violet" title={i.notes.map(n => n.by + ': ' + n.text).join('\n')}><span className="inline-flex items-center gap-1"><Lightbulb size={10} /> {i.notes.length} team</span></Tag>}
                  </div>
                </div>
                <IconBtn title={top ? 'Add the top recommendation as a task — pick who does it next' : 'Add a task on this unit'} tone="brand" onClick={() => onAdd(addSeed(top || undefined))}><Plus size={15} /></IconBtn>
              </div>
              {isOpen && (
                <div className="px-3 sm:px-4 pb-3 space-y-2">
                  <div className="rounded-xl border border-line bg-app/40 p-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5 inline-flex items-center gap-1"><Sparkles size={11} /> Recommended for this window</div>
                    {!i ? <p className="text-[12.5px] text-muted">{loading ? 'Working it out…' : 'No recommendation available.'}</p>
                      : i.suggestions.length === 0 ? <p className="text-[12.5px] text-muted">Nothing overdue on this unit — no audit, inspection, maintenance or photo work is due that fits this window.</p>
                        : (
                          <ul className="space-y-1">
                            {i.suggestions.map(s => (
                              <li key={s.key} className="flex items-center gap-2 flex-wrap">
                                <Tag tone={PRIO_TONE[s.priority]}>{s.priority === 1 ? 'Do now' : s.priority === 2 ? 'Due' : s.priority === 3 ? 'Worth it' : 'If time'}</Tag>
                                <span className="text-[13px] font-semibold text-ink">{s.label}</span>
                                <span className="text-[12px] text-muted flex-1 min-w-[140px]">{s.why}{s.needsDays > 1 ? ' · needs ' + s.needsDays + ' days' : ''}</span>
                                <button onClick={() => onAdd(addSeed(s))} className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-white px-2 py-1 text-[12px] font-semibold text-brand-700 hover:bg-brand-50"><Plus size={12} /> Add &amp; assign</button>
                              </li>
                            ))}
                          </ul>
                        )}
                  </div>
                  {/* The suggestion engine's own picks for this unit (proximity-aware — who is already nearby today). */}
                  <UnitSuggestions listingId={v.listingId} unit={v.unit} />
                  <TeamNotes notes={i?.notes || []} onSave={t => saveNote(v.listingId, t)} onRemove={at => removeNote(v.listingId, at)} />
                  <button onClick={() => onAdd(addSeed())} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink hover:bg-app"><Plus size={12} /> Add a different task</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function TeamNotes({ notes, onSave, onRemove }: { notes: Note[]; onSave: (t: string) => Promise<void>; onRemove: (at: string) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    if (!text.trim()) return
    setBusy(true); setErr('')
    try { await onSave(text.trim()); setText('') } catch (e: any) { setErr(String(e?.message || e)) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-2.5">
      <div className="text-[11px] font-bold uppercase tracking-wider text-violet-800 mb-1.5 inline-flex items-center gap-1"><Lightbulb size={11} /> Team suggestions</div>
      {notes.length > 0 && (
        <ul className="mb-1.5 space-y-0.5">
          {notes.map(n => (
            <li key={n.at} className="text-[12.5px] text-ink flex items-center gap-1.5">
              <span className="flex-1">{n.text} <span className="text-muted">— {n.by}, {new Date(n.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></span>
              <Tip label="Remove this suggestion"><button onClick={() => onRemove(n.at)} className="text-muted hover:text-rose-700 p-0.5"><X size={12} /></button></Tip>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }}
          placeholder="Suggest something for this unit — e.g. replace the patio chairs"
          className="flex-1 min-w-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-brand-600" />
        <button onClick={go} disabled={busy || !text.trim()} className="rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] font-semibold disabled:opacity-40">{busy ? <Loader2 size={12} className="animate-spin" /> : 'Suggest'}</button>
      </div>
      {err && <p className="mt-1 text-[12px] text-rose-700">{err}</p>}
    </div>
  )
}
