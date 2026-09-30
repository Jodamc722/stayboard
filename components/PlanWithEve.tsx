'use client'
// PLAN WITH EVE — say what you want; Eve organizes it, structures it, plans it (Jon, 2026-09-30).
//
// One page, three moments:
//   1. THE BRIEF   a box. Jon types the way he talks — "exterior walkthrough at Pelican: inspect
//                  every unit, quotes for X and Y, redo the exterior, deep-clean the ACs".
//   2. THE PLAN    what came back, laid out to be corrected, not admired: phases as columns of
//                  weeks, every task with its owner (a picker over the real roster) and its week,
//                  the quotes to chase, and — up top, because they matter most — the questions Eve
//                  would ask before starting and what she assumed instead. Everything editable.
//                  "Ask again" re-drafts with the brief plus whatever was typed under it.
//   3. CREATE      one press. The project lands on the board with its sections, tasks, owners and
//                  due dates by week — an ordinary project from then on.
//
// Nothing is saved until Create. A draft is only in this tab.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Loader2, Check, X, Plus, ChevronRight, HelpCircle, CalendarDays, ClipboardList } from 'lucide-react'
import { LeanHead, Tag, type Tone } from '@/components/lean'

type PlanTask = { title: string; detail: string; kind: string; owner: string | null; week: number; priority: string; checklist: string[] }
type PlanPhase = { name: string; week: number; tasks: PlanTask[] }
type Plan = { title: string; summary: string; category: string; building: string | null; market: string | null; priority: string; weeks: number; phases: PlanPhase[]; quotes: { what: string; from: string }[]; questions: string[]; assumptions: string[] }
type Draft = { plan: Plan; roster: string[]; categories: { key: string; label: string }[]; buildings: string[] }

const KIND_TONE: Record<string, Tone> = { inspect: 'sky', quote: 'amber', approve: 'rose', order: 'violet', work: 'slate', admin: 'slate', clean: 'emerald' }
const EXAMPLE = `Exterior walkthrough at Pelican:
- inspect every single unit
- get a quote for pressure washing and the railings
- redo the exterior paint
- deep clean the ACs there`
const nextMonday = () => { const d = new Date(); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 1 ? 0 : (8 - dow) % 7)); return d.toISOString().slice(0, 10) }
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const niceDay = (ymd: string) => { try { return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')) } catch { return ymd } }

async function post(body: any) {
  const r = await fetch('/api/projects/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Request failed')
  return j
}

const IN = 'rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] focus:outline-none focus:border-ink/40'
const BTN = 'text-[12px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 min-h-[34px] disabled:opacity-50'
const DARK = BTN + ' bg-ink text-white'
const GHOST = BTN + ' border border-line bg-white text-ink hover:border-ink/40'

export function PlanWithEve() {
  const router = useRouter()
  const [brief, setBrief] = useState('')
  const [answers, setAnswers] = useState('')
  const [busy, setBusy] = useState<'' | 'draft' | 'create'>('')
  const [err, setErr] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [start, setStart] = useState(nextMonday())

  const run = async (again?: boolean) => {
    setBusy('draft'); setErr('')
    try {
      const text = again && answers.trim() ? brief + '\n\nAnswers and changes from Jon:\n' + answers.trim() : brief
      const j: Draft = await post({ action: 'draft', brief: text })
      setDraft(j); setPlan(j.plan)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const create = async () => {
    if (!plan) return
    setBusy('create'); setErr('')
    try {
      const j = await post({ action: 'create', plan, brief: brief + (answers.trim() ? '\n\nAnswers and changes from Jon:\n' + answers.trim() : ''), starts_on: start })
      router.push('/projects/' + j.id)
    } catch (e: any) { setErr(String(e?.message || e)); setBusy('') }
  }

  // ── edits on the plan, in place ──
  const setTask = (pi: number, ti: number, patch: Partial<PlanTask>) => setPlan(p => { if (!p) return p; const phases = p.phases.map((ph, i) => i !== pi ? ph : { ...ph, tasks: ph.tasks.map((t, j) => j !== ti ? t : { ...t, ...patch }) }); return { ...p, phases } })
  const dropTask = (pi: number, ti: number) => setPlan(p => { if (!p) return p; const phases = p.phases.map((ph, i) => i !== pi ? ph : { ...ph, tasks: ph.tasks.filter((_, j) => j !== ti) }).filter(ph => ph.tasks.length); return { ...p, phases } })
  const addTask = (pi: number) => setPlan(p => { if (!p) return p; const phases = p.phases.map((ph, i) => i !== pi ? ph : { ...ph, tasks: [...ph.tasks, { title: '', detail: '', kind: 'work', owner: null, week: ph.week, priority: 'normal', checklist: [] }] }); return { ...p, phases } })
  const setPhaseName = (pi: number, name: string) => setPlan(p => { if (!p) return p; const phases = p.phases.map((ph, i) => i !== pi ? ph : { ...ph, name }); return { ...p, phases } })

  const weeks = useMemo(() => plan ? Array.from({ length: Math.max(plan.weeks, ...plan.phases.flatMap(ph => ph.tasks.map(t => t.week))) }, (_, i) => i + 1) : [], [plan])
  const byWeek = useMemo(() => { const m: Record<number, number> = {}; for (const ph of plan?.phases || []) for (const t of ph.tasks) m[t.week] = (m[t.week] || 0) + 1; return m }, [plan])
  const owners = useMemo(() => { const m: Record<string, number> = {}; for (const ph of plan?.phases || []) for (const t of ph.tasks) if (t.owner) m[t.owner] = (m[t.owner] || 0) + 1; return m }, [plan])
  const unowned = useMemo(() => (plan?.phases || []).reduce((a, ph) => a + ph.tasks.filter(t => !t.owner).length, 0), [plan])
  const total = (plan?.phases || []).reduce((a, ph) => a + ph.tasks.length, 0)

  return (
    <div className="max-w-[1100px] mx-auto pb-16">
      <LeanHead title="Plan with Eve" icon={<Sparkles size={18} className="text-brand-600" />}>
        {plan && <span className="text-[12px] text-muted">{total} tasks · {plan.weeks} weeks{unowned ? <> · <b className="text-amber-700">{unowned} without an owner</b></> : ''}</span>}
      </LeanHead>

      {/* ── 1. THE BRIEF ── */}
      <section className="rounded-2xl border border-line bg-white p-3 sm:p-4">
        <label className="block text-[12px] font-bold text-ink mb-1">What do you want done?</label>
        <p className="text-[12px] text-muted mb-2">Say it the way you would say it out loud. Name the building. List what you want looked at, quoted, fixed or changed. Eve turns it into phases, tasks, owners and weeks; you correct it before anything is created.</p>
        <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={6} placeholder={EXAMPLE} className={IN + ' w-full font-mono text-[12.5px]'} />
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <button onClick={() => run(false)} disabled={busy !== '' || brief.trim().length < 8} className={DARK}>{busy === 'draft' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {plan ? 'Draft again from scratch' : 'Draft the plan'}</button>
          {!brief && <button onClick={() => setBrief(EXAMPLE)} className={GHOST}>Use the example</button>}
          {err && <span className="text-[12px] font-semibold text-rose-700">{err}</span>}
        </div>
      </section>

      {/* ── 2. THE PLAN ── */}
      {plan && draft && (
        <div className="mt-4 space-y-4">
          {/* Eve's questions and assumptions first: the cheapest place to fix a plan is before it exists. */}
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
                  <button onClick={() => run(true)} disabled={busy !== '' || !answers.trim()} className={GHOST}>{busy === 'draft' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Ask again with these answers</button>
                </div>
              </div>
            </section>
          )}

          {/* The project's own line. */}
          <section className="rounded-2xl border border-line bg-white p-3 sm:p-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
            <input value={plan.title} onChange={e => setPlan({ ...plan, title: e.target.value })} className={IN + ' font-bold text-[14px]'} placeholder="Project title" />
            <select value={plan.category} onChange={e => setPlan({ ...plan, category: e.target.value })} className={IN} title="Category">{draft.categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            <select value={plan.building || ''} onChange={e => setPlan({ ...plan, building: e.target.value || null })} className={IN} title="Building"><option value="">No single building</option>{draft.buildings.map(b => <option key={b} value={b}>{b}</option>)}</select>
            <select value={plan.priority} onChange={e => setPlan({ ...plan, priority: e.target.value })} className={IN} title="Priority">{['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}</select>
            <textarea value={plan.summary} onChange={e => setPlan({ ...plan, summary: e.target.value })} rows={2} className={IN + ' sm:col-span-4'} placeholder="What we are doing, why, and what done looks like" />
            <div className="sm:col-span-4 flex items-center gap-3 flex-wrap text-[12px] text-muted">
              <span className="inline-flex items-center gap-1.5"><CalendarDays size={13} /> Starts <input type="date" value={start} onChange={e => setStart(e.target.value)} className={IN + ' py-0.5'} /></span>
              <span>runs {plan.weeks} week{plan.weeks === 1 ? '' : 's'} → due {niceDay(addDays(start, plan.weeks * 7 - 3))}</span>
              <span className="ml-auto flex items-center gap-1 flex-wrap">{Object.keys(owners).sort().map(o => <Tag key={o} tone="slate" title={owners[o] + ' tasks'}>{o.split(' ')[0]} {owners[o]}</Tag>)}{unowned > 0 && <Tag tone="amber" title="Pick an owner on each, or leave them for later">{unowned} unowned</Tag>}</span>
            </div>
          </section>

          {/* The weeks: how much lands when. */}
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

          {/* The phases and their tasks, editable. */}
          {plan.phases.map((ph, pi) => (
            <section key={pi} className="rounded-2xl border border-line bg-white overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-app/50">
                <ClipboardList size={13} className="text-muted" />
                <input value={ph.name} onChange={e => setPhaseName(pi, e.target.value)} className="bg-transparent text-[13px] font-bold text-ink focus:outline-none flex-1 min-w-0" />
                <span className="text-[11.5px] text-muted">from week {ph.week} · {ph.tasks.length} task{ph.tasks.length === 1 ? '' : 's'}</span>
              </div>
              <div className="divide-y divide-line">
                {ph.tasks.map((t, ti) => (
                  <div key={ti} className="px-3 py-2 grid gap-1.5 sm:grid-cols-[auto_1fr_auto_auto_auto_auto] sm:items-center">
                    <Tag tone={KIND_TONE[t.kind] || 'slate'} title="What kind of task this is">{t.kind}</Tag>
                    <div className="min-w-0">
                      <input value={t.title} onChange={e => setTask(pi, ti, { title: e.target.value })} placeholder="One action, starts with a verb" className="w-full bg-transparent text-[13px] font-semibold text-ink focus:outline-none" />
                      {(t.detail || t.checklist.length > 0) && <div className="text-[11.5px] text-muted truncate" title={[t.detail, t.checklist.join(' · ')].filter(Boolean).join(' — ')}>{t.detail}{t.checklist.length ? (t.detail ? ' · ' : '') + t.checklist.length + ' sub-steps' : ''}</div>}
                    </div>
                    <select value={t.owner || ''} onChange={e => setTask(pi, ti, { owner: e.target.value || null })} className={IN + ' py-1 text-[12px] ' + (t.owner ? '' : 'border-amber-300 text-amber-800')} title="Who owns it">
                      <option value="">— owner —</option>
                      {draft.roster.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <select value={t.week} onChange={e => setTask(pi, ti, { week: Number(e.target.value) })} className={IN + ' py-1 text-[12px]'} title="Which week it is due">
                      {Array.from({ length: Math.max(plan.weeks, 12) }, (_, i) => i + 1).map(w => <option key={w} value={w}>wk {w}</option>)}
                    </select>
                    <select value={t.priority} onChange={e => setTask(pi, ti, { priority: e.target.value })} className={IN + ' py-1 text-[12px]'} title="Priority">{['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p}</option>)}</select>
                    <button onClick={() => dropTask(pi, ti)} className="text-muted hover:text-rose-700 justify-self-end" title="Drop this task" aria-label="Drop this task"><X size={14} /></button>
                  </div>
                ))}
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
            <div className="rounded-full bg-ink text-white pl-4 pr-1.5 py-1.5 text-[12.5px] shadow-lg flex items-center gap-3">
              <span>{total} tasks across {plan.phases.length} phase{plan.phases.length === 1 ? '' : 's'}{unowned ? ' · ' + unowned + ' unowned' : ''}</span>
              <button onClick={create} disabled={busy !== '' || !plan.title.trim() || !total} className="rounded-full bg-white text-ink px-3.5 py-1.5 font-bold inline-flex items-center gap-1 disabled:opacity-50">{busy === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Create the project</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
