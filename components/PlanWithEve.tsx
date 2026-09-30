'use client'
// PLAN WITH EVE — say what you want; Eve organizes it, structures it, plans it (Jon, 2026-09-30).
//
// One page, three moments:
//   1. THE BRIEF   a box, and files. Jon types the way he talks — "exterior walkthrough at Pelican:
//                  inspect every unit, quotes for X and Y, redo the exterior, deep-clean the ACs" —
//                  and drops in what he has: a vendor quote, photos, the owner's email, a checklist.
//                  Eve reads every file in full before she plans.
//   2. THE PLAN    what came back, laid out to be corrected, not admired: phases, every task with
//                  what DONE means, the units it touches (real names), its owner (a picker over the
//                  real roster), its week, and WHERE it lives — Breezeway for field work (with the
//                  department), the board for office work. The questions Eve would ask first sit on
//                  top, because the cheapest place to fix a plan is before it exists; answer them and
//                  "Ask again" re-drafts with the brief, the answers and the files.
//   3. CREATE      one press. The project lands on the board with sections, tasks, owners and due
//                  dates by week; every Breezeway task is created in Breezeway (one per unit),
//                  assigned to the same person, dated to its week; the files are attached to the
//                  project. Nothing is saved until Create.
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, Check, X, Plus, ChevronRight, HelpCircle, CalendarDays, ClipboardList, Paperclip, FileText, Wrench, LayoutList } from 'lucide-react'
import { LeanHead, Tag, type Tone } from '@/components/lean'

type PlanTask = { title: string; done: string; detail: string; kind: string; where: 'board' | 'breezeway'; dept: 'housekeeping' | 'inspection' | 'maintenance'; units: string[]; owner: string | null; week: number; priority: string; checklist: string[] }
type PlanPhase = { name: string; week: number; tasks: PlanTask[] }
type Plan = { title: string; summary: string; category: string; building: string | null; market: string | null; priority: string; weeks: number; phases: PlanPhase[]; quotes: { what: string; from: string }[]; questions: string[]; assumptions: string[] }
type Attachment = { name: string; words: number; method: string; text: string }
type Draft = { plan: Plan; roster: { name: string; field: boolean }[]; categories: { key: string; label: string }[]; buildings: string[]; units: string[]; attachments: Attachment[]; refused: string[] }

const KIND_TONE: Record<string, Tone> = { inspect: 'sky', quote: 'amber', approve: 'rose', order: 'violet', work: 'slate', admin: 'slate', clean: 'emerald' }
const EXAMPLE = `Exterior walkthrough at Pelican:
- inspect every single unit
- get a quote for pressure washing and the railings
- redo the exterior paint
- deep clean the ACs there`
const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp'
const nextMonday = () => { const d = new Date(); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 1 ? 0 : (8 - dow) % 7)); return d.toISOString().slice(0, 10) }
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const niceDay = (ymd: string) => { try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd } }
const fmtBytes = (n: number) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'

const IN = 'rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-ink/40'
const BTN = 'text-[12px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 min-h-[34px] disabled:opacity-50'
const DARK = BTN + ' bg-ink text-white'
const GHOST = BTN + ' border border-line bg-white text-ink hover:border-ink/40'

export function PlanWithEve() {
  const router = useRouter()
  const [brief, setBrief] = useState('')
  const [answers, setAnswers] = useState('')
  const [files, setFiles] = useState<File[]>([])          // waiting to be read on the next draft
  const [busy, setBusy] = useState<'' | 'draft' | 'create'>('')
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [start, setStart] = useState(nextMonday())
  const fileIn = useRef<HTMLInputElement | null>(null)
  const sent = useRef<File[]>([])                          // every file handed to Eve, for the upload after Create

  const fullBrief = () => brief + (answers.trim() ? '\n\nAnswers and changes from Jon:\n' + answers.trim() : '')

  const run = async () => {
    setBusy('draft'); setErr(''); setProgress(files.length ? 'Reading ' + files.length + ' file' + (files.length === 1 ? '' : 's') + '…' : 'Eve is planning…')
    try {
      const fd = new FormData()
      fd.set('action', 'draft'); fd.set('brief', fullBrief())
      fd.set('attachments', JSON.stringify(draft?.attachments || []))
      for (const f of files) fd.append('files', f)
      const r = await fetch('/api/projects/plan', { method: 'POST', body: fd })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.error || 'Request failed')
      sent.current = [...sent.current, ...files]
      setFiles([]); if (fileIn.current) fileIn.current.value = ''
      setDraft(j); setPlan(j.plan)
      if (j.refused?.length) setErr('Not read: ' + j.refused.join(' · '))
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(''); setProgress('')
  }
  const create = async () => {
    if (!plan) return
    setBusy('create'); setErr(''); setProgress('Creating the project…')
    try {
      const r = await fetch('/api/projects/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', plan, brief: fullBrief(), starts_on: start, attachments: draft?.attachments || [] }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.error || 'Request failed')
      const all = [...sent.current, ...files]
      if (all.length) {
        setProgress('Attaching ' + all.length + ' file' + (all.length === 1 ? '' : 's') + '…')
        const fd = new FormData(); for (const f of all.slice(0, 10)) fd.append('file', f); fd.set('caption', 'Attached to the brief for Eve')
        await fetch('/api/projects/' + j.id + '/upload', { method: 'POST', body: fd }).catch(() => {})
      }
      router.push('/projects/' + j.id)
    } catch (e: any) { setErr(String(e?.message || e)); setBusy(''); setProgress('') }
  }

  // ── edits on the plan, in place ──
  const setTask = (pi: number, ti: number, patch: Partial<PlanTask>) => setPlan(p => { if (!p) return p; const phases = p.phases.map((ph, i) => i !== pi ? ph : { ...ph, tasks: ph.tasks.map((t, j) => j !== ti ? t : { ...t, ...patch }) }); return { ...p, phases } })
  const dropTask = (pi: number, ti: number) => setPlan(p => { if (!p) return p; const phases = p.phases.map((ph, i) => i !== pi ? ph : { ...ph, tasks: ph.tasks.filter((_, j) => j !== ti) }).filter(ph => ph.tasks.length); return { ...p, phases } })
  const addTask = (pi: number) => setPlan(p => { if (!p) return p; const phases = p.phases.map((ph, i) => i !== pi ? ph : { ...ph, tasks: [...ph.tasks, { title: '', done: '', detail: '', kind: 'work', where: 'board' as const, dept: 'maintenance' as const, units: [], owner: null, week: ph.week, priority: 'normal', checklist: [] }] }); return { ...p, phases } })
  const setPhaseName = (pi: number, name: string) => setPlan(p => { if (!p) return p; const phases = p.phases.map((ph, i) => i !== pi ? ph : { ...ph, name }); return { ...p, phases } })
  const toggleUnit = (pi: number, ti: number, u: string) => setPlan(p => { if (!p) return p; const t = p.phases[pi].tasks[ti]; const units = t.units.includes(u) ? t.units.filter(x => x !== u) : [...t.units, u]; return setIn(p, pi, ti, { units }) })
  const setIn = (p: Plan, pi: number, ti: number, patch: Partial<PlanTask>): Plan => ({ ...p, phases: p.phases.map((ph, i) => i !== pi ? ph : { ...ph, tasks: ph.tasks.map((t, j) => j !== ti ? t : { ...t, ...patch }) }) })

  const weeks = useMemo(() => plan ? Array.from({ length: Math.max(plan.weeks, ...plan.phases.flatMap(ph => ph.tasks.map(t => t.week))) }, (_, i) => i + 1) : [], [plan])
  const byWeek = useMemo(() => { const m: Record<number, number> = {}; for (const ph of plan?.phases || []) for (const t of ph.tasks) m[t.week] = (m[t.week] || 0) + 1; return m }, [plan])
  const owners = useMemo(() => { const m: Record<string, number> = {}; for (const ph of plan?.phases || []) for (const t of ph.tasks) if (t.owner) m[t.owner] = (m[t.owner] || 0) + 1; return m }, [plan])
  const unowned = useMemo(() => (plan?.phases || []).reduce((a, ph) => a + ph.tasks.filter(t => !t.owner).length, 0), [plan])
  const total = (plan?.phases || []).reduce((a, ph) => a + ph.tasks.length, 0)
  const bzCount = useMemo(() => (plan?.phases || []).reduce((a, ph) => a + ph.tasks.filter(t => t.where === 'breezeway').reduce((b, t) => b + Math.max(1, t.units.length), 0), 0), [plan])
  const bzNoUnit = useMemo(() => (plan?.phases || []).reduce((a, ph) => a + ph.tasks.filter(t => t.where === 'breezeway' && !t.units.length).length, 0), [plan])
  const fieldOnly = (draft?.roster || []).filter(r => r.field).map(r => r.name)

  return (
    <div className="max-w-[1100px] mx-auto pb-16">
      <LeanHead title="Plan with Eve" icon={<Sparkles size={18} className="text-brand-600" />}>
        {plan && <span className="text-[12px] text-muted">{total} tasks · {plan.weeks} weeks · {bzCount} in Breezeway{unowned ? <> · <b className="text-amber-700">{unowned} without an owner</b></> : ''}</span>}
      </LeanHead>

      {/* ── 1. THE BRIEF ── */}
      <section className="rounded-2xl border border-line bg-white p-3 sm:p-4">
        <label className="block text-[12px] font-bold text-ink mb-1">What do you want done?</label>
        <p className="text-[12px] text-muted mb-2">Say it the way you would say it out loud. Name the building and the units if you know them, what you want looked at, quoted, fixed or changed, any dates or budget. Attach what you have — a quote, photos, the owner's email, a checklist — and Eve reads it before she plans. You correct everything before anything is created.</p>
        <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={6} placeholder={EXAMPLE} className={IN + ' w-full font-mono text-[12.5px]'} />
        {/* Files: the ones waiting to be read, then the ones Eve already read. */}
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <input ref={fileIn} type="file" multiple accept={ACCEPT} className="hidden" onChange={e => setFiles(f => [...f, ...Array.from(e.target.files || [])].slice(0, 8))} />
          <button onClick={() => fileIn.current?.click()} className={GHOST} title="PDF, Word, text, CSV, or a photo of a page — up to 25 MB each"><Paperclip size={12} /> Attach files</button>
          {files.map((f, i) => <span key={i} className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 pl-2 pr-1 py-0.5 text-[11.5px] text-amber-900" title={fmtBytes(f.size) + ' · will be read on the next draft'}><FileText size={11} /> {f.name} <button onClick={() => setFiles(x => x.filter((_, j) => j !== i))} className="text-amber-700 hover:text-rose-700" aria-label="Remove"><X size={11} /></button></span>)}
          {(draft?.attachments || []).map((a, i) => <span key={'a' + i} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11.5px] text-emerald-800" title={a.method + ' · ' + a.words + ' words — Eve read this'}><Check size={11} /> {a.name}</span>)}
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button onClick={run} disabled={busy !== '' || brief.trim().length < 8} className={DARK}>{busy === 'draft' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {plan ? 'Draft again' : 'Draft the plan'}</button>
          {!brief && <button onClick={() => setBrief(EXAMPLE)} className={GHOST}>Use the example</button>}
          {progress && <span className="text-[12px] text-muted inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> {progress}</span>}
          {err && <span className="text-[12px] font-semibold text-rose-700">{err}</span>}
        </div>
      </section>

      {/* ── 2. THE PLAN ── */}
      {plan && draft && (
        <div className="mt-4 space-y-4">
          {(plan.questions.length > 0 || plan.assumptions.length > 0) && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 sm:p-4 grid gap-3 md:grid-cols-2">
              {plan.questions.length > 0 && (
                <div>
                  <h3 className="text-[12px] font-bold text-ink inline-flex items-center gap-1.5 mb-1"><HelpCircle size={13} className="text-amber-700" /> Eve would ask you first</h3>
                  <ul className="space-y-1">{plan.questions.map((q, i) => <li key={i} className="text-[12.5px] text-ink/85 flex gap-1.5"><ChevronRight size={12} className="mt-1 shrink-0 text-amber-700" /> {q}</li>)}</ul>
                </div>
              )}
              {plan.assumptions.length > 0 && (
                <div>
                  <h3 className="text-[12px] font-bold text-ink mb-1">What she assumed meanwhile</h3>
                  <ul className="space-y-1">{plan.assumptions.map((q, i) => <li key={i} className="text-[12.5px] text-ink/75 flex gap-1.5"><ChevronRight size={12} className="mt-1 shrink-0 text-muted" /> {q}</li>)}</ul>
                </div>
              )}
              <div className="md:col-span-2">
                <textarea value={answers} onChange={e => setAnswers(e.target.value)} rows={2} placeholder="Answer here, or tell her what to change — then Ask again. (Or just edit the plan below by hand.)" className={IN + ' w-full'} />
                <div className="mt-1.5 flex items-center gap-2">
                  <button onClick={run} disabled={busy !== '' || (!answers.trim() && !files.length)} className={GHOST}>{busy === 'draft' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Ask again with these answers{files.length ? ' and ' + files.length + ' new file' + (files.length === 1 ? '' : 's') : ''}</button>
                </div>
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-line bg-white p-3 sm:p-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <input value={plan.title} onChange={e => setPlan({ ...plan, title: e.target.value })} className={IN + ' font-bold text-[14px]'} placeholder="Project title" />
            <select value={plan.category} onChange={e => setPlan({ ...plan, category: e.target.value })} className={IN} title="Category">{draft.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            <select value={plan.building || ''} onChange={e => setPlan({ ...plan, building: e.target.value || null })} className={IN} title="Building"><option value="">No single building</option>{draft.buildings.map(b => <option key={b} value={b}>{b}</option>)}</select>
            <select value={plan.priority} onChange={e => setPlan({ ...plan, priority: e.target.value })} className={IN} title="Priority">{['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}</select>
            <textarea value={plan.summary} onChange={e => setPlan({ ...plan, summary: e.target.value })} rows={3} className={IN + ' sm:col-span-4'} placeholder="What we are doing, why, the scope, and what finished looks like" />
            <div className="sm:col-span-4 flex items-center gap-3 flex-wrap text-[12px] text-muted">
              <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> Starts <input type="date" value={start} onChange={e => setStart(e.target.value)} className={IN + ' py-0.5'} /></span>
              <span>runs {plan.weeks} week{plan.weeks === 1 ? '' : 's'} → due {niceDay(addDays(start, plan.weeks * 7 - 3))}</span>
              <span className="ml-auto flex items-center gap-1 flex-wrap">{Object.keys(owners).sort().map(o => <Tag key={o} tone="slate" title={owners[o] + ' tasks'}>{o.split(' ')[0]} {owners[o]}</Tag>)}{unowned > 0 && <Tag tone="amber" title="Pick an owner on each, or leave them for later">{unowned} unowned</Tag>}</span>
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-white p-3 sm:p-4">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink mb-2">By week</h3>
            <div className="flex gap-1.5 flex-wrap">
              {weeks.map(w => (
                <div key={w} className={'rounded-lg border px-2.5 py-1.5 min-w-[92px] ' + (byWeek[w] ? 'border-line bg-white' : 'border-dashed border-line bg-app/40')}>
                  <div className="text-[10.5px] uppercase tracking-wider font-bold text-muted">Week {w}</div>
                  <div className="text-[11.5px] text-muted">{niceDay(addDays(start, (w - 1) * 7))}</div>
                  <div className="text-[15px] font-bold tabular-nums text-ink">{byWeek[w] || 0} <span className="text-[11px] font-semibold text-muted">task{byWeek[w] === 1 ? '' : 's'}</span></div>
                </div>
              ))}
            </div>
          </section>

          {plan.phases.map((ph, pi) => (
            <section key={pi} className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-app/50">
                <ClipboardList size={13} className="text-muted" />
                <input value={ph.name} onChange={e => setPhaseName(pi, e.target.value)} className="bg-transparent text-[13px] font-bold text-ink focus:outline-none flex-1 min-w-0" />
                <span className="text-[11.5px] text-muted">from week {ph.week} · {ph.tasks.length} task{ph.tasks.length === 1 ? '' : 's'}</span>
              </div>
              <div className="divide-y divide-line">
                {ph.tasks.map((t, ti) => <TaskEditor key={ti} t={t} units={draft.units} roster={draft.roster} fieldOnly={fieldOnly} weeks={Math.max(plan.weeks, 12)}
                  set={patch => setTask(pi, ti, patch)} drop={() => dropTask(pi, ti)} toggleUnit={u => toggleUnit(pi, ti, u)} />)}
                <button onClick={() => addTask(pi)} className="w-full text-left px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-ink hover:bg-app inline-flex items-center gap-1"><Plus size={12} /> Add a task to {ph.name}</button>
              </div>
            </section>
          ))}

          {plan.quotes.length > 0 && (
            <section className="rounded-2xl border border-line bg-white p-3 sm:p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-ink mb-1.5">Quotes to get</h3>
              <ul className="space-y-1">{plan.quotes.map((q, i) => <li key={i} className="text-[12.5px] text-ink/85"><b>{q.what}</b> <span className="text-muted">— from {q.from}</span></li>)}</ul>
            </section>
          )}

          {/* ── 3. CREATE ── */}
          <div className="sticky bottom-3 z-10 flex items-center gap-2 justify-end">
            <div className="rounded-full bg-ink text-white pl-4 pr-1.5 py-1.5 text-[12.5px] shadow-lg flex items-center gap-3 flex-wrap">
              <span>{total} tasks · {bzCount} to Breezeway{bzNoUnit ? <span className="text-amber-300"> · {bzNoUnit} field task{bzNoUnit === 1 ? '' : 's'} with no unit</span> : ''}{unowned ? ' · ' + unowned + ' unowned' : ''}</span>
              <button onClick={create} disabled={busy !== '' || !plan.title.trim() || !total} className="rounded-full bg-white text-ink px-3.5 py-1.5 font-bold inline-flex items-center gap-1 disabled:opacity-50">{busy === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Create the project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** One task, every field editable in place: where it lives, its units, owner, week, priority; what done means and the how underneath. */
function TaskEditor({ t, units, roster, fieldOnly, weeks, set, drop, toggleUnit }: {
  t: PlanTask; units: string[]; roster: { name: string; field: boolean }[]; fieldOnly: string[]; weeks: number
  set: (patch: Partial<PlanTask>) => void; drop: () => void; toggleUnit: (u: string) => void
}) {
  const [more, setMore] = useState(false)
  const bz = t.where === 'breezeway'
  const ownerNotField = bz && t.owner && !fieldOnly.includes(t.owner)
  return (
    <div className="px-3 py-2">
      <div className="grid gap-1.5 sm:grid-cols-[auto_1fr_auto_auto_auto_auto_auto] sm:items-center">
        <button onClick={() => set({ where: bz ? 'board' : 'breezeway' })} title={bz ? 'A Breezeway field task (' + t.dept + ') — click to make it a board task' : 'A board task — click to make it a Breezeway field task'}
          className={'inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[10.5px] font-semibold ' + (bz ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600')}>
          {bz ? <Wrench size={10} /> : <LayoutList size={10} />} {bz ? 'Breezeway' : 'board'}
        </button>
        <div className="min-w-0">
          <input value={t.title} onChange={e => set({ title: e.target.value })} placeholder="One action, starts with a verb, names the thing" className="w-full bg-transparent text-[13px] font-semibold text-ink focus:outline-none" />
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <Tag tone={KIND_TONE[t.kind] || 'slate'} title="What kind of task this is">{t.kind}</Tag>
            {bz && <select value={t.dept} onChange={e => set({ dept: e.target.value as PlanTask['dept'] })} className="text-[10.5px] font-semibold rounded-md border border-line bg-white px-1 py-[2px]" title="Breezeway department">{['inspection', 'housekeeping', 'maintenance'].map(d => <option key={d} value={d}>{d}</option>)}</select>}
            {t.units.length > 0 && <button onClick={() => setMore(m => !m)} className="text-[10.5px] font-semibold rounded-md bg-violet-100 text-violet-800 px-1.5 py-[3px]" title={t.units.join(', ')}>{t.units.length} unit{t.units.length === 1 ? '' : 's'}{t.units.length <= 3 ? ': ' + t.units.join(', ') : ''}</button>}
            {bz && !t.units.length && <button onClick={() => setMore(m => !m)} className="text-[10.5px] font-semibold rounded-md bg-amber-100 text-amber-800 px-1.5 py-[3px]" title="A Breezeway task needs a unit — pick one, or it stays on the board until you send it from there">no unit — pick</button>}
            {t.done ? <span className="text-[11.5px] text-muted truncate max-w-full" title={t.done}>Done means: {t.done}</span> : <button onClick={() => setMore(true)} className="text-[11.5px] text-amber-700 font-semibold">what does done mean?</button>}
            <button onClick={() => setMore(m => !m)} className="text-[11px] font-semibold text-brand-700 hover:underline">{more ? 'less' : 'details'}</button>
          </div>
        </div>
        <select value={t.owner || ''} onChange={e => set({ owner: e.target.value || null })} className={IN + ' py-1 text-[12px] ' + (t.owner && !ownerNotField ? '' : 'border-amber-300 text-amber-800')} title={ownerNotField ? t.owner + ' is not a Breezeway person — the field task will be created unassigned' : 'Who owns it'}>
          <option value="">— owner —</option>
          {roster.map(r => <option key={r.name} value={r.name}>{r.name}{r.field ? ' · field' : ''}</option>)}
        </select>
        <select value={t.week} onChange={e => set({ week: Number(e.target.value) })} className={IN + ' py-1 text-[12px]'} title="Which week it is due">
          {Array.from({ length: weeks }, (_, i) => i + 1).map(w => <option key={w} value={w}>wk {w}</option>)}
        </select>
        <select value={t.priority} onChange={e => set({ priority: e.target.value })} className={IN + ' py-1 text-[12px]'} title="Priority">{['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}</select>
        <span />
        <button onClick={drop} className="text-muted hover:text-rose-700 justify-self-end" title="Drop this task" aria-label="Drop this task"><X size={14} /></button>
      </div>
      {more && (
        <div className="mt-2 ml-0 sm:ml-[84px] grid gap-2 rounded-xl border border-line bg-app/40 p-2.5">
          <label className="text-[11px] font-bold text-muted">Done means <input value={t.done} onChange={e => set({ done: e.target.value })} placeholder="Checkable in a sentence — e.g. photos of all 6 railings, each marked rust yes/no" className={IN + ' w-full font-normal mt-0.5'} /></label>
          <label className="text-[11px] font-bold text-muted">How / specifics <textarea value={t.detail} onChange={e => set({ detail: e.target.value })} rows={2} placeholder="Measurements, materials, who to call, what to bring, what to avoid" className={IN + ' w-full font-normal mt-0.5'} /></label>
          {t.checklist.length > 0 && <div className="text-[11.5px] text-ink/80"><b className="text-muted">Checklist:</b> {t.checklist.join(' · ')}</div>}
          {units.length > 0 && (
            <div>
              <div className="text-[11px] font-bold text-muted mb-1">Units {bz ? '(one Breezeway task per unit)' : ''}</div>
              <div className="flex gap-1 flex-wrap max-h-[132px] overflow-y-auto">
                {units.map(u => <button key={u} onClick={() => toggleUnit(u)} aria-pressed={t.units.includes(u)} className={'text-[11px] font-semibold px-2 py-0.5 rounded-full border ' + (t.units.includes(u) ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{u}</button>)}
              </div>
            </div>
          )}
          {ownerNotField && <p className="text-[11.5px] text-amber-800 font-semibold">{t.owner} is not in Breezeway, so the field task will be created without an assignee. Pick a field person, or keep {String(t.owner).split(' ')[0]} on the board task and assign the field task in Breezeway.</p>}
        </div>
      )}
    </div>
  )
}
