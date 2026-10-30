'use client'
// PROPERTY PROGRAMS — the Upkeep page's third tab (Jon, 2026-10-30: "programs, should be able to
// create them, manage them, update them … add a template, assign it to a unit or property, and
// should be smart and intuitive"). Engine: lib/site-programs.
//
// A card per program: its template, who always gets it, and one line per place — the schedule as
// tappable day buttons and what today holds ("On the board · 3 people", "Moves from Oct 29 — not
// done", "Creates at 7am"). New / Edit opens the editor in place: pick a template, name it, add
// buildings or single units from one search box, tap the days, pick the people. Buttons, not
// drop-downs.
import { useMemo, useState } from 'react'
import { Loader2, Plus, Play, Pause, Pencil, Trash2, X, Search, Building2, Home, Users, ExternalLink, Check, RefreshCw } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { Tag, LeanEmpty } from '@/components/lean'
import type { Program, Place, PlacePlan, Person } from '@/lib/site-programs'

const URL_MAIN = '/api/upkeep/programs?options=1'
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const bz = (id: string) => 'https://app.breezeway.io/task/' + encodeURIComponent(id)
const nice = (ymd: string) => { const d = new Date(ymd + 'T12:00:00Z'); return isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) }
const rid = () => Math.random().toString(36).slice(2, 9)
const DEPTS = [['maintenance', 'Maintenance'], ['housekeeping', 'Housekeeping'], ['inspection', 'Inspection']] as const

type Data = {
  ok: boolean; programs: Program[]; day: string; plans: PlacePlan[]
  options: { buildings: { key: string; units: number; sample: string; inBreezeway: boolean }[]; units: { id: string; name: string; building: string; inBreezeway: boolean }[] } | null
  error?: string
}
type Tpl = { id: number; name: string; department: string }

function scheduleText(p: Place) {
  const parts: string[] = []
  const d = Array.from(new Set(p.days)).sort()
  if (d.length === 7) parts.push('Every day'); else if (d.length) parts.push(d.map(x => DAY_NAMES[x]).join(', '))
  if (p.alternate) parts.push('every other day')
  if (p.onCleanDays) parts.push('clean days')
  const s = parts.join(' + ') || 'No days set'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function todayLine(pl: PlacePlan | undefined): { text: string; tone: 'emerald' | 'amber' | 'sky' | 'slate' | 'rose'; task?: string } {
  if (!pl) return { text: 'Saved — shows on the next refresh', tone: 'slate' }
  if (pl.action === 'skip') return { text: pl.note, tone: 'rose' }
  if (pl.action === 'add' && pl.today) return { text: 'On the board today', tone: 'emerald', task: pl.today.id }
  if (pl.action === 'move' && pl.carry) return { text: 'Not done ' + nice(pl.carry.date) + ' — moves to today', tone: 'amber', task: pl.carry.id }
  if (pl.action === 'create') return { text: 'Due today — created on the next run', tone: 'sky' }
  return { text: 'Not today', tone: 'slate' }
}

export function UpkeepPrograms() {
  const { data, loading, error, refresh } = useCachedFetch<Data>(URL_MAIN, { ttl: 5 * 60_000 })
  const [editing, setEditing] = useState<Program | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const reload = () => { invalidateCache(URL_MAIN); refresh() }

  const post = async (body: any, key: string) => {
    setBusy(key); setErr(''); setMsg('')
    try {
      const r = await fetch('/api/upkeep/programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) throw new Error(j?.error || 'That did not work')
      return j
    } catch (e: any) { setErr(String(e?.message || e)); return null } finally { setBusy('') }
  }
  const run = async (p: Program) => {
    const j = await post({ op: 'run', id: p.id }, 'run:' + p.id)
    if (j) { setMsg(p.name + ': ' + [j.created && j.created + ' created', j.moved && j.moved + ' moved to today', j.updated && j.updated + ' updated', j.cancelled && j.cancelled + ' duplicates cancelled'].filter(Boolean).join(' · ') || p.name + ': everything was already on the board'); reload() }
  }
  const toggle = async (p: Program) => { if (await post({ op: 'toggle', id: p.id }, 'toggle:' + p.id)) reload() }
  const remove = async (p: Program) => { if (await post({ op: 'delete', id: p.id }, 'del:' + p.id)) { setEditing(null); reload() } }
  const save = async (p: Program) => { const j = await post({ op: 'save', program: p }, 'save'); if (j) { setEditing(null); setMsg('Saved ' + p.name); reload() } }

  if (loading && !data) return <div className="py-10 text-center text-muted"><Loader2 className="inline animate-spin" size={18} /></div>
  if (error || data?.error) return <p className="text-[13px] text-rose-700">{String(error || data?.error)}</p>
  if (!data) return null
  const plans = data.plans || []

  if (editing) return <Editor initial={editing} options={data.options} busy={busy === 'save'} err={err} onCancel={() => { setEditing(null); setErr('') }} onSave={save} onDelete={data.programs.some(p => p.id === editing.id) ? () => remove(editing) : undefined} />

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[12.5px] text-muted flex-1 min-w-[220px]">A Breezeway template on a schedule at a building or unit. One open task per place: one not finished yesterday moves to today, never a second. Runs every morning.</p>
        <button onClick={reload} title="Refresh" className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-line bg-white text-muted hover:text-ink"><RefreshCw size={14} /></button>
        <button onClick={() => setEditing({ id: 'prog-' + rid(), name: '', active: true, templateId: null, templateName: '', department: 'maintenance', description: '', people: [], addCleaners: true, places: [] })}
          className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg bg-ink text-white text-[12.5px] font-semibold"><Plus size={14} /> New program</button>
      </div>
      {msg ? <p className="text-[12.5px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{msg}</p> : null}
      {err ? <p className="text-[12.5px] text-rose-700">{err}</p> : null}
      {!data.programs.length ? <LeanEmpty>No programs yet. Start one with New program.</LeanEmpty> : null}
      {data.programs.map(p => {
        const mine = plans.filter(x => x.programId === p.id)
        return (
          <section key={p.id} className={'rounded-2xl border border-line bg-white overflow-hidden ' + (p.active ? '' : 'opacity-60')}>
            <header className="px-3 py-2.5 border-b border-line flex items-center gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="text-[14px] font-bold text-ink flex items-center gap-2 flex-wrap">{p.name}
                  {!p.active ? <Tag tone="slate">Paused</Tag> : null}
                  <Tag tone="violet">{p.department}</Tag>
                </div>
                <div className="text-[11.5px] text-muted mt-0.5">
                  {p.templateName ? 'Checklist: ' + p.templateName : 'No checklist template'} · {p.people.length ? p.people.map(x => x.name.split(' ')[0]).join(', ') : 'nobody fixed'}{p.addCleaners ? ' + whoever is cleaning there' : ''}
                </div>
              </div>
              <button onClick={() => run(p)} disabled={!!busy || !p.active} title="Run today now — creates what is due, moves what was not done, adds today's cleaners" className="h-8 px-2.5 inline-flex items-center gap-1 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:border-ink/40 disabled:opacity-50">{busy === 'run:' + p.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run today</button>
              <button onClick={() => toggle(p)} disabled={!!busy} title={p.active ? 'Pause — nothing new is created' : 'Resume'} className="h-8 px-2.5 inline-flex items-center gap-1 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:border-ink/40">{p.active ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Resume</>}</button>
              <button onClick={() => setEditing(JSON.parse(JSON.stringify(p)))} className="h-8 px-2.5 inline-flex items-center gap-1 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:border-ink/40"><Pencil size={13} /> Edit</button>
            </header>
            <ul className="divide-y divide-line">
              {p.places.map(pl => {
                const plan = mine.find(x => x.placeId === pl.id)
                const t = p.active ? todayLine(plan) : { text: 'Paused', tone: 'slate' as const }
                return (
                  <li key={pl.id} className="px-3 py-2 flex items-center gap-2 flex-wrap text-[12.5px]">
                    {pl.kind === 'unit' ? <Home size={13} className="text-muted" /> : <Building2 size={13} className="text-muted" />}
                    <span className="font-semibold text-ink min-w-[90px]">{pl.label}</span>
                    <span className="text-muted flex-1 min-w-[140px]">{scheduleText(pl)}{plan?.where ? ' · ' + plan.where : ''}</span>
                    {plan && (plan.people.length + plan.cleaners.length) && p.active ? <span className="text-[11.5px] text-muted inline-flex items-center gap-1" title={plan.people.concat(plan.cleaners).map(x => x.name).join(', ')}><Users size={12} /> {plan.people.length + plan.cleaners.length}</span> : null}
                    <Tag tone={t.tone}>{t.text}</Tag>
                    {t.task ? <a href={bz(t.task)} target="_blank" rel="noreferrer" className="text-muted hover:text-ink" title="Open in Breezeway"><ExternalLink size={13} /></a> : null}
                  </li>
                )
              })}
              {!p.places.length ? <li className="px-3 py-3 text-[12.5px] text-muted">No places yet — Edit to add a building or unit.</li> : null}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function Editor({ initial, options, busy, err, onCancel, onSave, onDelete }: {
  initial: Program; options: Data['options']; busy: boolean; err: string
  onCancel: () => void; onSave: (p: Program) => void; onDelete?: () => void
}) {
  const [p, setP] = useState<Program>(initial)
  const set = (patch: Partial<Program>) => setP(x => ({ ...x, ...patch }))
  const tpls = useCachedFetch<{ templates: Tpl[] }>('/api/breezeway/templates', { ttl: 30 * 60_000 })
  const roster = useCachedFetch<any>('/api/breezeway/people', { ttl: 10 * 60_000 })
  const [tq, setTq] = useState('')
  const [pq, setPq] = useState('')
  const [wq, setWq] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  const templates = useMemo(() => {
    const all: Tpl[] = (tpls.data?.templates || []) as Tpl[]
    const n = tq.trim().toLowerCase()
    return all.filter(t => !n || t.name.toLowerCase().includes(n)).filter(t => !n ? (!t.department || t.department === p.department) : true).slice(0, 24)
  }, [tpls.data, tq, p.department])
  const people: Person[] = useMemo(() => {
    const raw: any[] = Array.isArray(roster.data) ? roster.data : roster.data?.people || []
    return raw.map(x => ({ id: Number(x.id), name: String(x.name || [x.first_name, x.last_name].filter(Boolean).join(' ')) })).filter(x => x.id > 0 && x.name)
  }, [roster.data])
  const peopleHits = pq.trim() ? people.filter(x => x.name.toLowerCase().includes(pq.trim().toLowerCase()) && !p.people.some(y => y.id === x.id)).slice(0, 8) : []
  const placeHits = useMemo(() => {
    const n = wq.trim().toLowerCase()
    if (!n || !options) return [] as { kind: Place['kind']; ref: string; label: string; sub: string; ok: boolean }[]
    const taken = new Set(p.places.map(x => x.kind + ':' + x.ref.toLowerCase()))
    const b = options.buildings.filter(x => (x.key + ' ' + x.sample).toLowerCase().includes(n) && !taken.has('building:' + x.key.toLowerCase()))
      .map(x => ({ kind: 'building' as const, ref: x.key, label: x.key, sub: 'Building · ' + x.units + ' unit' + (x.units === 1 ? '' : 's') + (x.inBreezeway ? '' : ' · not in Breezeway yet'), ok: x.inBreezeway }))
    const u = options.units.filter(x => x.name.toLowerCase().includes(n) && !taken.has('unit:' + x.id.toLowerCase()))
      .map(x => ({ kind: 'unit' as const, ref: x.id, label: x.name, sub: 'Unit · ' + x.building + (x.inBreezeway ? '' : ' · not in Breezeway yet'), ok: x.inBreezeway }))
    type Hit = { kind: Place['kind']; ref: string; label: string; sub: string; ok: boolean }
    return (b.slice(0, 6) as Hit[]).concat(u.slice(0, 8) as Hit[])
  }, [wq, options, p.places])

  const setPlace = (id: string, patch: Partial<Place>) => set({ places: p.places.map(x => (x.id === id ? { ...x, ...patch } : x)) })
  const addPlace = (h: { kind: Place['kind']; ref: string; label: string }) => {
    const last = p.places[p.places.length - 1]
    set({ places: p.places.concat([{ id: 'pl-' + rid(), kind: h.kind, ref: h.ref, label: h.label, days: last ? last.days.slice() : [0, 1, 2, 3, 4, 5, 6], alternate: last ? last.alternate : false, onCleanDays: last ? last.onCleanDays : false }]) })
    setWq('')
  }
  const canSave = p.name.trim().length > 1 && p.places.length > 0 && p.places.every(x => x.days.length || x.alternate || x.onCleanDays)

  const chip = (on: boolean) => 'h-7 px-2.5 rounded-full border text-[11.5px] font-semibold ' + (on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink/40')
  return (
    <section className="rounded-2xl border border-line bg-white">
      <header className="px-3 py-2.5 border-b border-line flex items-center gap-2">
        <div className="flex-1 text-[14px] font-bold text-ink">{initial.name ? 'Edit ' + initial.name : 'New program'}</div>
        <button onClick={onCancel} className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted hover:text-ink" title="Close without saving"><X size={16} /></button>
      </header>
      <div className="p-3 space-y-5">
        {/* 1 — the checklist */}
        <div className="space-y-2">
          <div className="text-[12px] font-bold uppercase tracking-wide text-muted">1 · Checklist template</div>
          <div className="flex gap-1 flex-wrap">{DEPTS.map(([k, l]) => <button key={k} onClick={() => set({ department: k })} className={chip(p.department === k)}>{l}</button>)}</div>
          {p.templateId ? (
            <div className="flex items-center gap-2 text-[12.5px]"><Check size={14} className="text-emerald-600" /><span className="font-semibold text-ink">{p.templateName || 'Template ' + p.templateId}</span>
              <button onClick={() => set({ templateId: null, templateName: '' })} className="text-muted hover:text-ink text-[11.5px] underline">change</button></div>
          ) : (
            <>
              <label className="flex items-center gap-2 h-9 rounded-lg border border-line px-2.5"><Search size={14} className="text-muted" />
                <input value={tq} onChange={e => setTq(e.target.value)} placeholder={'Search ' + p.department + ' templates'} className="flex-1 bg-transparent text-[13px] outline-none" /></label>
              {tpls.loading && !tpls.data ? <Loader2 size={14} className="animate-spin text-muted" /> : (
                <div className="flex gap-1.5 flex-wrap">
                  {templates.map(t => <button key={t.id} onClick={() => set({ templateId: t.id, templateName: t.name, department: (['maintenance', 'housekeeping', 'inspection'].indexOf(t.department) >= 0 ? t.department : p.department) as Program['department'], name: p.name || t.name.replace(/\s+\d+(\.\d+)*$/, '') })} className="h-8 px-2.5 rounded-lg border border-line bg-white text-[12px] font-semibold text-ink hover:border-ink/40 text-left">{t.name}</button>)}
                  {!templates.length ? <span className="text-[12px] text-muted">No templates match. New checklists are built in Breezeway (Settings → Tasks → Templates); they show here a few minutes later.</span> : null}
                </div>
              )}
            </>
          )}
        </div>

        {/* 2 — the name */}
        <div className="space-y-1.5">
          <div className="text-[12px] font-bold uppercase tracking-wide text-muted">2 · Task name</div>
          <input value={p.name} onChange={e => set({ name: e.target.value })} placeholder="Property Exterior Clean" className="w-full h-9 rounded-lg border border-line px-2.5 text-[13px]" />
          <div className="text-[11.5px] text-muted">The crew sees “{(p.name || 'Name')}: {p.places[0]?.label || 'Eden'}”. Changing it later starts a fresh line — open tasks under the old name are not carried.</div>
        </div>

        {/* 3 — where and when */}
        <div className="space-y-2">
          <div className="text-[12px] font-bold uppercase tracking-wide text-muted">3 · Where and when</div>
          <label className="flex items-center gap-2 h-9 rounded-lg border border-line px-2.5"><Search size={14} className="text-muted" />
            <input value={wq} onChange={e => setWq(e.target.value)} placeholder="Add a building or a unit — type Eden, Capri 109, Boynton…" className="flex-1 bg-transparent text-[13px] outline-none" /></label>
          {placeHits.length ? (
            <div className="rounded-xl border border-line divide-y divide-line">
              {placeHits.map(h => (
                <button key={h.kind + h.ref} onClick={() => addPlace(h)} className="w-full px-3 py-1.5 flex items-center gap-2 text-left hover:bg-slate-50">
                  {h.kind === 'unit' ? <Home size={13} className="text-muted" /> : <Building2 size={13} className="text-muted" />}
                  <span className="text-[12.5px] font-semibold text-ink">{h.label}</span>
                  <span className={'text-[11.5px] ' + (h.ok ? 'text-muted' : 'text-amber-700')}>{h.sub}</span>
                  <Plus size={13} className="ml-auto text-muted" />
                </button>
              ))}
            </div>
          ) : null}
          <ul className="space-y-2">
            {p.places.map(pl => (
              <li key={pl.id} className="rounded-xl border border-line p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  {pl.kind === 'unit' ? <Home size={13} className="text-muted" /> : <Building2 size={13} className="text-muted" />}
                  <input value={pl.label} onChange={e => setPlace(pl.id, { label: e.target.value })} title="What the crew reads in the task name" className="h-8 rounded-lg border border-line px-2 text-[12.5px] font-semibold w-[160px]" />
                  <span className="text-[11.5px] text-muted flex-1 truncate">{pl.kind === 'building' ? 'whole building (' + pl.ref + ')' : 'one unit'}</span>
                  <button onClick={() => set({ places: p.places.filter(x => x.id !== pl.id) })} className="text-muted hover:text-rose-700" title="Remove"><Trash2 size={14} /></button>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <button onClick={() => setPlace(pl.id, { days: [0, 1, 2, 3, 4, 5, 6], alternate: false })} className={chip(pl.days.length === 7)}>Every day</button>
                  <button onClick={() => setPlace(pl.id, { days: [1, 3, 5], alternate: false })} className={chip(pl.days.join() === '1,3,5' && !pl.alternate)}>Mon · Wed · Fri</button>
                  <button onClick={() => setPlace(pl.id, { days: [], alternate: true })} className={chip(pl.alternate && !pl.days.length)}>Every other day</button>
                  <button onClick={() => setPlace(pl.id, { days: [1], alternate: false })} className={chip(pl.days.join() === '1' && !pl.alternate)}>Weekly</button>
                  <span className="mx-1 h-5 w-px bg-line" />
                  {DAYS.map((d, i) => {
                    const on = pl.days.indexOf(i) >= 0
                    return <button key={i} title={DAY_NAMES[i]} onClick={() => setPlace(pl.id, { days: on ? pl.days.filter(x => x !== i) : pl.days.concat([i]).sort() })} className={'h-7 w-7 rounded-full border text-[11.5px] font-bold ' + (on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:border-ink/40')}>{d}</button>
                  })}
                  <span className="mx-1 h-5 w-px bg-line" />
                  <button onClick={() => setPlace(pl.id, { onCleanDays: !pl.onCleanDays })} className={chip(pl.onCleanDays)} title="Also any day a clean is scheduled there">+ clean days</button>
                </div>
                <div className="text-[11.5px] text-muted">{scheduleText(pl)}</div>
              </li>
            ))}
            {!p.places.length ? <li className="text-[12px] text-muted">Search above to add the first building or unit. A building’s task goes on its Exterior property in Breezeway, else its first unit.</li> : null}
          </ul>
        </div>

        {/* 4 — who */}
        <div className="space-y-2">
          <div className="text-[12px] font-bold uppercase tracking-wide text-muted">4 · Who gets it</div>
          <div className="flex gap-1.5 flex-wrap items-center">
            {p.people.map(x => <span key={x.id} className="h-7 pl-2.5 pr-1 rounded-full bg-ink text-white text-[11.5px] font-semibold inline-flex items-center gap-1">{x.name}<button onClick={() => set({ people: p.people.filter(y => y.id !== x.id) })} className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-white/20"><X size={11} /></button></span>)}
            <label className="flex items-center gap-1.5 h-7 rounded-full border border-line px-2.5"><Plus size={12} className="text-muted" />
              <input value={pq} onChange={e => setPq(e.target.value)} placeholder="Add a person" className="w-[130px] bg-transparent text-[12px] outline-none" /></label>
          </div>
          {peopleHits.length ? <div className="flex gap-1.5 flex-wrap">{peopleHits.map(x => <button key={x.id} onClick={() => { set({ people: p.people.concat([x]) }); setPq('') }} className={chip(false)}>{x.name}</button>)}</div> : null}
          <button onClick={() => set({ addCleaners: !p.addCleaners })} className={chip(p.addCleaners)}>{p.addCleaners ? '✓ ' : ''}Also whoever is cleaning there that day</button>
        </div>

        {/* 5 — the note */}
        <div className="space-y-1.5">
          <div className="text-[12px] font-bold uppercase tracking-wide text-muted">5 · Note on the task <span className="normal-case font-normal">(optional)</span></div>
          <textarea value={p.description} onChange={e => set({ description: e.target.value })} rows={3} placeholder="What to do, in English and Spanish" className="w-full rounded-lg border border-line px-2.5 py-2 text-[12.5px]" />
        </div>

        {err ? <p className="text-[12.5px] text-rose-700">{err}</p> : null}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button onClick={() => onSave(p)} disabled={!canSave || busy} className="h-9 px-4 rounded-lg bg-ink text-white text-[13px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save program</button>
          <button onClick={onCancel} className="h-9 px-3 rounded-lg border border-line bg-white text-[13px] font-semibold text-ink">Cancel</button>
          {!canSave ? <span className="text-[11.5px] text-muted">Needs a name, at least one place, and days on each.</span> : null}
          {onDelete ? (confirmDel
            ? <span className="ml-auto inline-flex items-center gap-2 text-[12px]">Delete the program? Tasks already in Breezeway stay.<button onClick={onDelete} className="h-8 px-3 rounded-lg bg-rose-600 text-white font-semibold">Delete</button><button onClick={() => setConfirmDel(false)} className="h-8 px-3 rounded-lg border border-line">Keep</button></span>
            : <button onClick={() => setConfirmDel(true)} className="ml-auto h-9 px-3 rounded-lg text-rose-700 text-[12.5px] font-semibold inline-flex items-center gap-1"><Trash2 size={14} /> Delete</button>) : null}
        </div>
      </div>
    </section>
  )
}
