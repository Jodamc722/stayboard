// THE LEADERSHIP BOARD (Jon, 2026-11-06: "a Leadership board that has Projects, Tasks, Vendor
// follow-ups and Misc — a unified big-picture plan of what's going on. Simple: due dates,
// assignees, notes, comments, notifications, pictures. Think the project board but more clean and
// easy to see. Also AI: paste meeting notes and create tasks we can approve one by one.")
//
// It is ONE dedicated project board (kind 'leadership') read through a clean page. That buys
// everything the project engine already does — assignees, due-date reminders, comments with
// @tags that land in Messages, photos — without a second task system. The four lanes are the
// board's sections. The Projects lane also lists the REAL project boards (the renovations,
// rollouts, onboardings) so the big picture is one screen.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getProject, listProjects } from '@/lib/projects'
import { toPerson, type Viewer } from '@/lib/projects-shared'
import { onAssigned } from '@/lib/project-notify'
import { getSetting, setSetting } from '@/lib/app-settings'
import { notify } from '@/lib/notify'

export const LEADERSHIP_KEY = 'leadership'
export const LANES = ['Projects', 'Tasks', 'Vendor follow-ups', 'Misc'] as const
export type Lane = typeof LANES[number]
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const laneOf = (v: any): Lane => (LANES as readonly string[]).includes(str(v)) ? (str(v) as Lane) : 'Misc'

/** The one board. Created on first open; the viewer is made a member so the engine lets them in. */
export async function ensureLeadershipBoard(email: string, displayName?: string | null): Promise<{ id: string; title: string }> {
  const sb = supabaseAdmin()
  const e = str(email).trim().toLowerCase()
  if (!e) throw new Error('no email')
  let { data: found } = await sb.from('projects').select('id,title').eq('kind', LEADERSHIP_KEY).eq('archived', false).order('created_at').limit(1)
  let id = found && found[0] ? String(found[0].id) : ''
  let title = found && found[0] ? String(found[0].title) : 'Leadership'
  if (!id) {
    const { data: p, error } = await sb.from('projects').insert({
      title: 'Leadership', summary: 'The big picture — projects, tasks, vendor follow-ups and everything else leadership is carrying.',
      category: 'internal', stage: 'in_progress', kind: LEADERSHIP_KEY, private: false, template_key: LEADERSHIP_KEY, created_by: e,
      settings: { icon: '🧭', accent: 'brand', view: 'list', sectionOrder: [...LANES] },
    }).select('id,title').single()
    if (error) throw new Error('leadership board: ' + error.message)
    id = String(p.id); title = String(p.title)
  }
  const { data: m } = await sb.from('project_members').select('id').eq('project_id', id).eq('email', e).limit(1)
  if (!m || !m.length) {
    const who = toPerson(displayName && !/@/.test(displayName) ? displayName : e)
    await sb.from('project_members').insert({ project_id: id, person_key: e, display: who.display, email: e, role: 'owner', added_by: 'system' })
  }
  return { id, title }
}

export type LeadershipItem = {
  id: string; lane: Lane; title: string; details: string | null; status: string; done: boolean
  priority: string; due: string | null; assignees: { display: string; email: string | null }[]
  comments: { id: string; by: string; body: string; at: string }[]
  photos: { id: string; url: string; caption: string | null; at: string }[]
  createdBy: string | null; createdAt: string; doneAt: string | null; doneBy: string | null
  vendorName?: string | null; nextAction?: string | null; lastContact?: string | null
}
export type LeadershipProject = {
  id: string; title: string; stage: string; priority: string; lead: string | null; due: string | null
  building: string | null; market: string | null; tasksOpen: number; tasksDone: number; updatedAt: string
}
export type Proposal = {
  id: string; lane: Lane; title: string; details: string; assignee: string; due: string | null; priority: string
  status: 'open' | 'approved' | 'skipped'; from: string; at: string; by: string; taskId?: string
}

export async function readLeadership(viewer: Viewer, displayName?: string | null) {
  const board = await ensureLeadershipBoard(str(viewer.email), displayName)
  const [p, projects, proposals] = await Promise.all([
    getProject(board.id),
    listProjects({ viewer }),
    getSetting<Proposal[]>('leadership_proposals', []),
  ])
  const tasks = (p?.tasks || []) as any[]
  const notes = (p?.notes || []) as any[]
  const photos = (p?.photos || []) as any[]
  const items: LeadershipItem[] = tasks.filter(t => !t.parent_id).map(t => ({
    id: String(t.id), lane: laneOf(t.section), title: str(t.title), details: t.description || null,
    status: str(t.status || 'todo'), done: str(t.status) === 'done' || !!t.done, priority: str(t.priority || 'normal'), due: t.due_on || null,
    assignees: (t.assignees || []).map((a: any) => ({ display: str(a.display), email: a.email || null })),
    comments: notes.filter(n => String(n.task_id || '') === String(t.id) && str(n.kind) === 'comment').map(n => ({ id: String(n.id), by: str(n.author), body: str(n.body), at: str(n.created_at) })),
    photos: photos.filter(f => String(f.task_id || '') === String(t.id) && str(f.kind || 'photo') === 'photo').map(f => ({ id: String(f.id), url: str(f.url), caption: f.caption || null, at: str(f.created_at) })),
    createdBy: t.created_by || null, createdAt: str(t.created_at), doneAt: t.done_at || null, doneBy: t.done_by || null,
    vendorName: t.vendor_name || null, nextAction: t.next_action || null, lastContact: t.last_contact_on || null,
  }))
  // The real project boards — not the leadership board itself, not anyone's personal list.
  const boards: LeadershipProject[] = (projects as any[])
    .filter(x => !['personal', LEADERSHIP_KEY].includes(str(x.kind)) && !['done', 'cancelled'].includes(str(x.stage)))
    .map(x => ({
      id: String(x.id), title: str(x.title), stage: str(x.stage), priority: str(x.priority || 'normal'), lead: x.lead_email || null, due: x.due_on || null,
      building: x.building || null, market: x.market || null,
      tasksOpen: ((x.steps || []) as any[]).filter(s => !s.done).length, tasksDone: ((x.steps || []) as any[]).filter(s => !!s.done).length, updatedAt: str(x.updated_at),
    }))
    .sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : 1)
  return { board, lanes: [...LANES], items, projects: boards, proposals: proposals.filter(x => x.status === 'open').slice(-60) }
}

/** Create one item on the board (the approve path for proposals, and the quick-add). */
export async function addLeadershipItem(boardId: string, by: string, inp: { lane: Lane; title: string; details?: string; assignees?: string[]; due?: string | null; priority?: string }): Promise<{ id: string } | { error: string }> {
  const sb = supabaseAdmin()
  const title = str(inp.title).trim().slice(0, 300)
  if (!title) return { error: 'A title is needed.' }
  const { data, error } = await sb.from('project_steps').insert({
    project_id: boardId, title, description: str(inp.details).trim() || null, status: 'todo', section: laneOf(inp.lane),
    priority: ['low', 'normal', 'high', 'urgent'].includes(str(inp.priority)) ? str(inp.priority) : 'normal',
    due_on: /^\d{4}-\d{2}-\d{2}$/.test(str(inp.due)) ? str(inp.due) : null, created_by: by,
  }).select('id').single()
  if (error || !data) return { error: error?.message || 'could not add' }
  const people = (inp.assignees || []).map(a => toPerson(str(a))).filter(x => x.display)
  if (people.length) {
    const rows = people.map(who => ({ task_id: data.id, project_id: boardId, ...who, role: 'assignee' }))
    let { error: aErr } = await sb.from('project_task_assignees').upsert(rows, { onConflict: 'task_id,person_key' })
    if (aErr && /column|schema/i.test(aErr.message)) ({ error: aErr } = await sb.from('project_task_assignees').upsert(rows.map(({ role: _r, ...rest }) => rest), { onConflict: 'task_id,person_key' }))
    await sb.from('project_steps').update({ assignee: people[0].display }).eq('id', data.id)
    try {
      const { data: members } = await sb.from('project_members').select('*').eq('project_id', boardId)
      await onAssigned(boardId, { id: String(data.id), title }, people, by, (members || []) as any)
      // Also straight into Messages + the pop-up, with a link to the board itself.
      await notify(people.map(p => p.email!).filter(Boolean), { kind: 'assignment', title: `${by.split('@')[0]} assigned you · ${title}`.slice(0, 200), body: str(inp.details).slice(0, 500), link: '/leadership?item=' + data.id, actor: by })
    } catch { /* best effort */ }
  }
  return { id: String(data.id) }
}

// ── AI: meeting notes → proposed items ──────────────────────────────────────────────────────────
export async function proposeFromNotes(text: string, by: string, people: { name: string; email: string }[], source = 'notes'): Promise<{ ok: true; proposals: Proposal[] } | { ok: false; error: string }> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' }
  const body = str(text).trim().slice(0, 60_000)
  if (body.length < 20) return { ok: false, error: 'Paste the notes first — there is nothing to read.' }
  const { anthropicMessages, textOf } = await import('@/lib/anthropic-call')
  const { modelPairFor } = await import('@/lib/ai-models')
  const { budgetBlock } = await import('@/lib/ai-budget')
  const blocked = await budgetBlock('leadership_notes')
  if (blocked) return { ok: false, error: blocked }
  const pair = await modelPairFor('leadership_notes')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const roster = people.slice(0, 60).map(p => `${p.name} <${p.email}>`).join('\n')
  const system = `You turn meeting notes from a short-term-rental property management company (Stay Hospitality, South Florida) into a short list of ACTION ITEMS for the leadership board. Today is ${today}.
Return ONLY a JSON array. Each element: {"lane":"Projects"|"Tasks"|"Vendor follow-ups"|"Misc","title":"imperative, under 90 chars","details":"one or two sentences of context from the notes, or empty","assignee":"email from the roster or empty","due":"YYYY-MM-DD or empty","priority":"low"|"normal"|"high"|"urgent"}.
Rules: one item per real commitment or decision that needs a person to act; no duplicates; no items for things already done; "Vendor follow-ups" is for chasing an outside company or an owner; "Projects" only for multi-week initiatives; dates only when the notes say or clearly imply one (e.g. "by Friday" → that date); assign only when the notes name who owns it and that person is on the roster. 3–15 items. If there are no actions, return [].
Roster:\n${roster}`
  const r = await anthropicMessages(key, { model: pair.model, max_tokens: 4000, temperature: 0, system, messages: [{ role: 'user', content: body }] }, pair.fallback, 'leadership_notes')
  if (!r.ok) return { ok: false, error: 'AI call failed (' + r.status + '): ' + str(r.data?.error?.message || '').slice(0, 160) }
  const raw = textOf(r.data)
  let arr: any[] = []
  try { const m = raw.match(/\[[\s\S]*\]/); arr = JSON.parse(m ? m[0] : raw) } catch { return { ok: false, error: 'The AI answer was not a list — try again with cleaner notes.' } }
  if (!Array.isArray(arr)) return { ok: false, error: 'The AI answer was not a list.' }
  const emails = new Set(people.map(p => p.email.toLowerCase()))
  const now = new Date().toISOString()
  const made: Proposal[] = arr.slice(0, 20).map((x: any, i: number) => ({
    id: 'p' + Date.now().toString(36) + i, lane: laneOf(x?.lane), title: str(x?.title).trim().slice(0, 200), details: str(x?.details).trim().slice(0, 1000),
    assignee: emails.has(str(x?.assignee).toLowerCase()) ? str(x?.assignee).toLowerCase() : '',
    due: /^\d{4}-\d{2}-\d{2}$/.test(str(x?.due)) ? str(x?.due) : null,
    priority: ['low', 'normal', 'high', 'urgent'].includes(str(x?.priority)) ? str(x?.priority) : 'normal',
    status: 'open' as const, from: source, at: now, by,
  })).filter(x => x.title)
  const cur = await getSetting<Proposal[]>('leadership_proposals', [])
  const next = [...cur.filter(x => x.status === 'open'), ...made].slice(-80)
  await setSetting('leadership_proposals', next, by)
  return { ok: true, proposals: made }
}

export async function settleProposal(id: string, status: 'approved' | 'skipped', by: string, taskId?: string): Promise<void> {
  const cur = await getSetting<Proposal[]>('leadership_proposals', [])
  const next = cur.map(x => x.id === id ? { ...x, status, taskId } : x).filter(x => x.status === 'open' || Date.parse(x.at) > Date.now() - 7 * 86400_000)
  await setSetting('leadership_proposals', next, by)
}
