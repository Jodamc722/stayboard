'use client'
// ONE TASK, ONE WAY (Jon, 2026-10-01: "the formatting, the font, the style, the functionality of
// Breezeway tasks … congruent and function exactly the same across all boards … editable tasks, how
// you leave notes or comments … one cohesive app").
//
// Every board that shows a Breezeway task draws THIS strip for it, in this order, with these words:
//   Assign / Reassign · Done · Nudge · Comments (count) · Breezeway
// and the same two panels under the row: the assign picker (InlineAssign — the roster filtered to the
// task's department) and the 3-way comment thread (CommentThread — one box that writes to the app,
// to the Breezeway task and, when the task has a booking, to Guesty). A note left on Today is the
// same note somebody reads on the Schedule, on the Maintenance desk and inside Breezeway.
//
// The verbs are the app's existing routes, never a second implementation: /api/breezeway/assign
// (assign), /api/ops-today/task-action complete (done), /api/command/nudge (Slack), /api/comments.
// What a person may do is decided by the same gates those routes check (lib/useAccess): assign needs
// schedule edit, done needs plan edit, comments need a login. A button the route would refuse is not drawn.
import { useState, type ReactNode } from 'react'
import { UserPlus, Check, Loader2, MessageSquare, ExternalLink } from 'lucide-react'
import CommentThread from '@/components/CommentThread'
import { InlineAssign, type Roster } from '@/components/CommandCockpit'
import { NudgeBtn } from '@/components/command/Nudge'
import { useAccess } from '@/lib/useAccess'
import { Tag, type Tone } from '@/components/lean'

// ── the shared look ─────────────────────────────────────────────────────────────────────────────
export const TASK_BTN = 'inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-1.5 rounded-lg min-h-[34px] whitespace-nowrap disabled:opacity-50 transition'
export const TASK_GHOST = TASK_BTN + ' border border-line bg-white text-ink hover:border-ink/40'
export const TASK_DARK = TASK_BTN + ' bg-ink text-white'
export const bzUrl = (id: string) => 'https://app.breezeway.io/task/' + encodeURIComponent(id)

/** The one status vocabulary for a task, everywhere: the word and the tone. */
export type TaskState = 'done' | 'running' | 'open' | 'late' | 'atRisk' | 'unassigned'
export const TASK_STATE: Record<TaskState, { label: string; tone: Tone; title: string }> = {
  done: { label: 'done', tone: 'emerald', title: 'Finished and closed in Breezeway' },
  running: { label: 'in progress', tone: 'sky', title: 'Started, not finished' },
  open: { label: 'not started', tone: 'slate', title: 'Nobody has started it' },
  late: { label: 'late', tone: 'rose', title: 'Past its time, or will not land by the deadline at this pace' },
  atRisk: { label: 'at risk', tone: 'amber', title: 'Tight against the next arrival or the deadline' },
  unassigned: { label: 'nobody on it', tone: 'amber', title: 'No one is assigned in Breezeway' },
}
// STARTED WINS (Jon, 2026-10-05: "make sure it shows in progress if task is started … do that for
// all tasks"). A task somebody has started always reads "in progress"; whether it is running long
// is said beside it by BehindTag, never instead of it.
export function taskStateOf(t: { done?: boolean; running?: boolean; late?: boolean; atRisk?: boolean; who?: string | null | string[] }): TaskState {
  if (t.done) return 'done'
  if (t.running) return 'running'
  if (t.late) return 'late'
  if (t.atRisk) return 'atRisk'
  return 'open'
}
/** Beside "in progress" only: the task is past its time ('late') or close to it ('atRisk'). */
export function BehindTag({ late, atRisk }: { late?: boolean; atRisk?: boolean }) {
  if (!late && !atRisk) return null
  return <Tag tone={late ? 'rose' : 'amber'} title={late ? 'In progress, but past its time' : 'In progress, close to its deadline'}>{late ? 'running late' : 'tight'}</Tag>
}
export function TaskStateTag({ state }: { state: TaskState }) {
  const s = TASK_STATE[state]
  return <Tag tone={s.tone} title={s.title}>{s.label}</Tag>
}

// ── the strip ───────────────────────────────────────────────────────────────────────────────────
export type TaskActionsProps = {
  taskId: string
  /** housekeeping · inspection · maintenance — filters the assign roster. */
  dept: string
  /** What the row is about, for the comment thread's label and link ("17WEST 409 — clean Oct 1"). */
  label: string
  link?: string
  reservationId?: string | null
  state: TaskState
  who?: string | string[] | null
  roster: Roster[]
  onChanged: () => void
  /** Hide verbs a board does not want (the scheduler keeps its own assign). */
  hide?: Partial<Record<'assign' | 'done' | 'nudge' | 'comments' | 'breezeway', boolean>>
  /** Extra board-specific buttons, drawn after the shared ones. */
  extra?: ReactNode
  /** The panels render under the row; the row passes a slot for them. */
  renderPanels?: (panels: ReactNode) => ReactNode
}

export function useTaskActions(p: TaskActionsProps) {
  const acc = useAccess()
  const canAssign = acc.atLeast('schedule', 'edit')
  const canDone = acc.atLeast('plan', 'edit')
  const [panel, setPanel] = useState<'assign' | 'comments' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [doneLocal, setDoneLocal] = useState(false)
  const done = p.state === 'done' || doneLocal
  const nobody = !p.who || (Array.isArray(p.who) && !p.who.length)
  const whoTxt = Array.isArray(p.who) ? p.who.join(', ') : (p.who || '')

  const complete = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/ops-today/task-action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: p.taskId, action: 'complete' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not mark it done')
      setDoneLocal(true); p.onChanged()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  const actions = (
    <>
      {!p.hide?.assign && canAssign && !done && (
        <button onClick={() => setPanel(x => (x === 'assign' ? null : 'assign'))} aria-pressed={panel === 'assign'} className={nobody ? TASK_DARK : TASK_GHOST} title={nobody ? 'Pick who does it' : 'Hand it to someone else'}><UserPlus size={12} /> {nobody ? 'Assign' : 'Reassign'}</button>
      )}
      {!p.hide?.done && canDone && !done && (
        <button onClick={complete} disabled={busy} className={TASK_GHOST} title="Mark it done in Breezeway">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Done</button>
      )}
      {!p.hide?.nudge && canAssign && !nobody && !done && <NudgeBtn taskIds={[p.taskId]} compact title={'Message ' + whoTxt + ' on Slack about this'} />}
      {!p.hide?.comments && (
        <button onClick={() => setPanel(x => (x === 'comments' ? null : 'comments'))} aria-pressed={panel === 'comments'} className={TASK_GHOST + (count ? ' !border-amber-300 !bg-amber-50 !text-amber-900' : '')} title="Comments — one thread for the app, Breezeway and the guest's booking"><MessageSquare size={12} />{count ? <span className="tabular-nums">{count}</span> : null}</button>
      )}
      {!p.hide?.breezeway && <a href={bzUrl(p.taskId)} target="_blank" rel="noreferrer" className={TASK_GHOST} title="Open in Breezeway"><ExternalLink size={12} /></a>}
      {p.extra}
    </>
  )
  const panels = (
    <>
      {err && <p className="text-[11.5px] font-semibold mt-1 pl-3.5 text-rose-600">{err}</p>}
      {panel === 'assign' && <InlineAssign taskId={p.taskId} dept={p.dept} roster={p.roster} onDone={() => { setPanel(null); p.onChanged() }} />}
      {panel === 'comments' && (
        <div className="mt-1.5 pl-3.5">
          <CommentThread type="task" id={p.taskId} taskId={p.taskId} reservationId={p.reservationId || undefined} label={p.label} link={p.link || '/command'} onCount={setCount} />
        </div>
      )}
    </>
  )
  return { actions, panels, done, canAssign, canDone, panel }
}

/** Convenience for boards that only want the strip and its panels, laid out by the board. */
export function TaskActions(p: TaskActionsProps) {
  const { actions, panels } = useTaskActions(p)
  return <>{actions}{p.renderPanels ? p.renderPanels(panels) : panels}</>
}
