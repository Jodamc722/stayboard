// PROJECT NOTIFICATIONS — who gets told, when, and through what.
//
// Jon, 2026-09-08: "notifications, reminders, due dates, assignees". The rule set, in one place:
//
//   assigned    → the people put on a task (not the person who did it)
//   mentioned   → whoever an @ in a comment resolves to
//   comment     → on a task: its assignees and everyone who already commented on it;
//                 on the project: every member. Never the author. Never someone already mentioned.
//   added       → the person added to a project
//   due_soon    → assignees of an open task due TOMORROW (owners if nobody is assigned)
//   overdue     → assignees of an open task past due, once a day until it is done
//
// Every one of these becomes a row in project_notifications. The bell in the app shows all of
// them. Email is governed by each member's `notify` prefs on that project — the bell is never
// silenced, only the inbox. Two email cadences: the IMMEDIATE pass (every 15 minutes, batches the
// last quarter-hour per person into one message) for the first four types, and the MORNING DIGEST
// (with the ops brief) which carries reminders plus anything still unread.
//
// Sender: the same Gmail the briefs go out from, so replies land where the team already looks and
// every send is on the email receipt ledger.
import 'server-only'
import { supabaseAdmin } from './supabase-admin'
import { sendGmail } from './gmail-send'
import { getSetting } from './app-settings'
import { parseMentions, prefsOf, todayISO, type Person, type Member, type NotifyType, type NotifyPrefs } from './projects-shared'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://lighthouse-stay.vercel.app').replace(/\/+$/, '')
const DEFAULT_FROM = 'jon@stay-hospitality.com'
const lower = (s: any) => String(s || '').trim().toLowerCase()
const first = (s: string | null | undefined) => String(s || '').split(/[\s@]/)[0]
export const taskUrl = (projectId: string, taskId?: string | null) => `/projects/${projectId}${taskId ? `?task=${taskId}` : ''}`

type Row = {
  project_id: string; task_id?: string | null; note_id?: string | null
  email: string; type: NotifyType; title: string; body?: string | null; url: string; actor?: string | null; dedupe_key?: string | null
}

// ---------------------------------------------------------------- write
async function put(rows: Row[]) {
  const clean = rows.map(r => ({ ...r, email: lower(r.email), body: r.body ? String(r.body).slice(0, 1200) : null }))
    .filter(r => r.email.includes('@') && r.email !== lower(r.actor))
  if (!clean.length) return 0
  // Reminders carry a dedupe_key and must not repeat inside a day; everything else has none and
  // always inserts. ignoreDuplicates makes the reminder pass idempotent.
  const { error } = await supabaseAdmin().from('project_notifications').upsert(clean, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  if (error) throw new Error('notify: ' + error.message)
  return clean.length
}

/** Display name for an actor: the project's spelling if they are a member, else the mailbox. */
export const nameFor = (email: string | null | undefined, members: { email?: string | null; display: string }[]) => {
  const e = lower(email)
  const m = members.find(x => lower(x.email) === e)
  return m ? m.display : (e ? e.split('@')[0] : 'Someone')
}

export async function onAssigned(projectId: string, task: { id: string; title: string }, people: Person[], actor: string, members: Member[]) {
  const who = nameFor(actor, members)
  return put(people.filter(p => p.email).map(p => ({
    project_id: projectId, task_id: task.id, email: p.email!, type: 'assigned', actor,
    title: `${who} assigned you “${task.title}”`, url: taskUrl(projectId, task.id),
  })))
}

export async function onAdded(projectId: string, projectTitle: string, person: Person, role: string, actor: string, members: Member[]) {
  if (!person.email) return 0
  return put([{
    project_id: projectId, email: person.email, type: 'added', actor,
    title: `${nameFor(actor, members)} added you to “${projectTitle}” as ${role}`, url: taskUrl(projectId),
  }])
}

/**
 * A comment landed. Mentions first (they get the stronger "mentioned you"), then the people the
 * conversation belongs to. Returns the mentioned members so the caller can record them.
 */
export async function onComment(opts: {
  projectId: string; projectTitle: string; note: { id: string; body: string; task_id: string | null }
  task: { id: string; title: string } | null; actor: string; members: Member[]; taskAssignees: Person[]
}) {
  const { projectId, note, task, actor, members } = opts
  const sb = supabaseAdmin()
  const who = nameFor(actor, members)
  const where = task ? `“${task.title}”` : `“${opts.projectTitle}”`
  const url = taskUrl(projectId, task?.id)
  const rows: Row[] = []
  const done = new Set<string>([lower(actor)])

  const mentioned = parseMentions(note.body, members)
  for (const m of mentioned) {
    if (!m.email || done.has(lower(m.email))) continue
    done.add(lower(m.email))
    rows.push({ project_id: projectId, task_id: task?.id || null, note_id: note.id, email: m.email, type: 'mentioned', actor,
      title: `${who} mentioned you on ${where}`, body: note.body, url })
  }

  let audience: { email: string | null }[] = []
  if (task) {
    const { data: prior } = await sb.from('project_notes').select('author').eq('task_id', task.id).eq('kind', 'comment').limit(500)
    audience = [...opts.taskAssignees, ...((prior || []) as any[]).map(p => ({ email: p.author }))]
  } else {
    audience = members
  }
  for (const a of audience) {
    const e = lower(a.email)
    if (!e || done.has(e)) continue
    // Only members can be told — a former assignee who was removed from the project is out.
    if (!members.some(m => lower(m.email) === e)) continue
    done.add(e)
    rows.push({ project_id: projectId, task_id: task?.id || null, note_id: note.id, email: e, type: 'comment', actor,
      title: `${who} commented on ${where}`, body: note.body, url })
  }
  await put(rows)
  return mentioned
}

// ---------------------------------------------------------------- reminders (daily)
/** Due tomorrow / overdue, for every open task on every open project. Idempotent per day. */
export async function generateReminders(today = todayISO()): Promise<{ dueSoon: number; overdue: number }> {
  const sb = supabaseAdmin()
  const tomorrow = new Date(today + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tmr = tomorrow.toISOString().slice(0, 10)
  const { data: tasks, error } = await sb.from('project_steps')
    .select('id,project_id,title,due_on,status').neq('status', 'done').not('due_on', 'is', null).lte('due_on', tmr).limit(2000)
  if (error) throw new Error('reminders: ' + error.message)
  const T = (tasks || []) as any[]
  if (!T.length) return { dueSoon: 0, overdue: 0 }
  const pids = Array.from(new Set(T.map(t => String(t.project_id))))
  const [{ data: projects }, { data: asg }, { data: mems }] = await Promise.all([
    sb.from('projects').select('id,title,archived,stage').in('id', pids),
    sb.from('project_task_assignees').select('task_id,email').in('task_id', T.map(t => t.id)),
    sb.from('project_members').select('project_id,email,role').in('project_id', pids),
  ])
  const live = new Set(((projects || []) as any[]).filter(p => !p.archived && p.stage !== 'done' && p.stage !== 'cancelled').map(p => String(p.id)))
  const titleOf: Record<string, string> = {}; for (const p of (projects || []) as any[]) titleOf[p.id] = p.title
  const byTask: Record<string, string[]> = {}
  for (const a of (asg || []) as any[]) if (a.email) (byTask[a.task_id] = byTask[a.task_id] || []).push(lower(a.email))
  const owners: Record<string, string[]> = {}
  for (const m of (mems || []) as any[]) if (m.email && m.role === 'owner') (owners[m.project_id] = owners[m.project_id] || []).push(lower(m.email))

  const rows: Row[] = []
  let dueSoon = 0, overdue = 0
  for (const t of T) {
    if (!live.has(String(t.project_id))) continue
    const people = byTask[t.id]?.length ? byTask[t.id] : (owners[t.project_id] || [])
    if (!people.length) continue
    const isSoon = t.due_on === tmr
    const isLate = t.due_on < today
    if (!isSoon && !isLate) continue   // due today: yesterday's "due tomorrow" covered it; tomorrow it is overdue
    const days = isLate ? Math.round((new Date(today + 'T12:00:00Z').getTime() - new Date(t.due_on + 'T12:00:00Z').getTime()) / 86400000) : 0
    for (const e of Array.from(new Set(people))) {
      rows.push({
        project_id: t.project_id, task_id: t.id, email: e, type: isSoon ? 'due_soon' : 'overdue',
        title: isSoon ? `“${t.title}” is due tomorrow` : `“${t.title}” is ${days} day${days === 1 ? '' : 's'} overdue`,
        body: titleOf[t.project_id] || null, url: taskUrl(t.project_id, t.id),
        dedupe_key: `${isSoon ? 'due_soon' : 'overdue'}:${t.id}:${today}`,
      })
      if (isSoon) dueSoon++; else overdue++
    }
  }
  await put(rows)
  return { dueSoon, overdue }
}

// ---------------------------------------------------------------- email
type N = { id: string; project_id: string; task_id: string | null; email: string; type: NotifyType; title: string; body: string | null; url: string; actor: string | null; created_at: string; read_at: string | null }

async function prefsFor(pairs: { project_id: string; email: string }[]): Promise<Record<string, NotifyPrefs>> {
  const out: Record<string, NotifyPrefs> = {}
  if (!pairs.length) return out
  const pids = Array.from(new Set(pairs.map(p => p.project_id)))
  const { data } = await supabaseAdmin().from('project_members').select('project_id,email,notify').in('project_id', pids)
  for (const m of (data || []) as any[]) if (m.email) out[m.project_id + '|' + lower(m.email)] = prefsOf(m.notify)
  return out
}
const wants = (p: NotifyPrefs | undefined, t: NotifyType) =>
  t === 'assigned' ? (p?.assigned ?? true) : t === 'mentioned' ? (p?.mentions ?? true) : t === 'comment' ? (p?.comments ?? true) : true

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
const TYPE_LABEL: Record<NotifyType, string> = { assigned: 'Assigned to you', mentioned: 'Mentioned you', comment: 'New comment', added: 'Added to a project', due_soon: 'Due tomorrow', overdue: 'Overdue' }

function renderEmail(heading: string, intro: string, items: N[], projectTitles: Record<string, string>): string {
  const byProject: Record<string, N[]> = {}
  for (const n of items) (byProject[n.project_id] = byProject[n.project_id] || []).push(n)
  const sections = Object.entries(byProject).map(([pid, list]) => `
    <div style="margin:18px 0 6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">${esc(projectTitles[pid] || 'Project')}</div>
    ${list.map(n => `
      <a href="${APP_URL}${esc(n.url)}" style="display:block;text-decoration:none;color:#111827;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;margin:6px 0;background:#fff">
        <div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${n.type === 'overdue' ? '#be123c' : n.type === 'due_soon' ? '#b45309' : '#6b7280'}">${TYPE_LABEL[n.type]}</div>
        <div style="font-size:14px;font-weight:600;margin-top:2px">${esc(n.title)}</div>
        ${n.body && (n.type === 'comment' || n.type === 'mentioned') ? `<div style="font-size:13px;color:#374151;margin-top:4px;white-space:pre-wrap">${esc(n.body.slice(0, 400))}${n.body.length > 400 ? '…' : ''}</div>` : ''}
      </a>`).join('')}`).join('')
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280">Lighthouse · Projects</div>
    <h1 style="font-size:20px;margin:6px 0 4px;color:#111827">${esc(heading)}</h1>
    <p style="font-size:13.5px;color:#4b5563;margin:0 0 8px">${esc(intro)}</p>
    ${sections}
    <a href="${APP_URL}/projects/mine" style="display:block;background:#111827;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;text-align:center;font-size:13.5px;font-weight:700;margin-top:18px">Open My Tasks →</a>
    <p style="font-size:11px;color:#9ca3af;margin-top:18px">You get these because you are on the project. Change what is emailed under People on the project page.</p>
  </div></body></html>`
}

async function fromEmail(): Promise<string> {
  const cfg = await getSetting<{ fromEmail?: string }>('ops_brief', {})
  return String(cfg?.fromEmail || DEFAULT_FROM)
}

async function titlesFor(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!ids.length) return out
  const { data } = await supabaseAdmin().from('projects').select('id,title').in('id', Array.from(new Set(ids)))
  for (const p of (data || []) as any[]) out[p.id] = p.title
  return out
}

/**
 * IMMEDIATE PASS — every 15 minutes. Anything from the last quarter-hour that has not gone out,
 * one email per person. Rows older than two minutes only, so a burst of edits arrives as one
 * message rather than six.
 */
export async function sendImmediate(opts: { dryRun?: boolean } = {}): Promise<{ people: number; items: number; sent: number; errors: string[] }> {
  const sb = supabaseAdmin()
  const cutoff = new Date(Date.now() - 2 * 60000).toISOString()
  const { data, error } = await sb.from('project_notifications').select('*')
    .is('emailed_at', null).is('digested_at', null).in('type', ['assigned', 'mentioned', 'comment', 'added'])
    .lte('created_at', cutoff).order('created_at').limit(500)
  if (error) throw new Error('notify send: ' + error.message)
  const rows = (data || []) as N[]
  const byPerson: Record<string, N[]> = {}
  for (const n of rows) (byPerson[n.email] = byPerson[n.email] || []).push(n)
  const prefs = await prefsFor(rows.map(r => ({ project_id: r.project_id, email: r.email })))
  const titles = await titlesFor(rows.map(r => r.project_id))
  const from = await fromEmail()
  let sent = 0, items = 0
  const errors: string[] = []
  for (const [email, list] of Object.entries(byPerson)) {
    const wanted = list.filter(n => wants(prefs[n.project_id + '|' + n.email], n.type))
    const stamp = new Date().toISOString()
    // Rows the person opted out of are marked as handled so they never pile up; they still show
    // in the bell.
    if (wanted.length && !opts.dryRun) {
      const lead = wanted[0]
      const subject = wanted.length === 1 ? lead.title : `${lead.title} +${wanted.length - 1} more`
      const r = await sendGmail({ fromEmail: from, to: [email], subject: 'Projects: ' + subject.slice(0, 120),
        html: renderEmail(wanted.length === 1 ? lead.title : `${wanted.length} updates on your projects`, 'From the last few minutes.', wanted, titles) })
      if (!r.ok) { errors.push(`${email}: ${r.error}`); continue }
      sent++
    }
    items += list.length
    if (!opts.dryRun) await sb.from('project_notifications').update({ emailed_at: stamp }).in('id', list.map(n => n.id))
  }
  return { people: Object.keys(byPerson).length, items, sent, errors }
}

/**
 * MORNING DIGEST — after generateReminders. Per person: today's reminders plus anything still
 * unread since yesterday's digest. Nothing to say → no email.
 */
export async function sendDigest(opts: { dryRun?: boolean; only?: string } = {}): Promise<{ people: number; sent: number; errors: string[] }> {
  const sb = supabaseAdmin()
  const since = new Date(Date.now() - 36 * 3600000).toISOString()
  let q = sb.from('project_notifications').select('*').is('digested_at', null).gte('created_at', since).order('created_at').limit(2000)
  if (opts.only) q = q.eq('email', lower(opts.only))
  const { data, error } = await q
  if (error) throw new Error('digest: ' + error.message)
  // Unread reminders always; other types only if still unread (a comment you already opened is not news).
  const rows = ((data || []) as N[]).filter(n => n.type === 'due_soon' || n.type === 'overdue' || !n.read_at)
  const byPerson: Record<string, N[]> = {}
  for (const n of rows) (byPerson[n.email] = byPerson[n.email] || []).push(n)
  const prefs = await prefsFor(rows.map(r => ({ project_id: r.project_id, email: r.email })))
  const titles = await titlesFor(rows.map(r => r.project_id))
  const from = await fromEmail()
  let sent = 0
  const errors: string[] = []
  for (const [email, list] of Object.entries(byPerson)) {
    // Digest pref is per project; a person who turned it off on every project they appear in gets nothing.
    const wanted = list.filter(n => prefs[n.project_id + '|' + n.email]?.digest !== false)
    if (wanted.length && !opts.dryRun) {
      const late = wanted.filter(n => n.type === 'overdue').length, soon = wanted.filter(n => n.type === 'due_soon').length
      const bits = [late ? `${late} overdue` : '', soon ? `${soon} due tomorrow` : '', wanted.length - late - soon ? `${wanted.length - late - soon} unread` : ''].filter(Boolean)
      const r = await sendGmail({ fromEmail: from, to: [email], subject: `Projects today: ${bits.join(' · ')}`,
        html: renderEmail('Your projects this morning', bits.join(' · ') + '.', wanted, titles) })
      if (!r.ok) { errors.push(`${email}: ${r.error}`); continue }
      sent++
    }
    if (!opts.dryRun) await sb.from('project_notifications').update({ digested_at: new Date().toISOString() }).in('id', list.map(n => n.id))
  }
  return { people: Object.keys(byPerson).length, sent, errors }
}
