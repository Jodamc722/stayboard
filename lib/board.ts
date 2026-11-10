// THE LEADERSHIP BOARD (Jon, 2026-11-06: "its own standalone board — get rid of projects completely
// and just use this board. Simple, clean, everyone's tasks can live here, filter by due date,
// owner, property etc. Smart search too. AI: paste meeting notes and create tasks we approve one
// by one.")
//
// One flat table (board_items, migration 176). A row is one thing someone owes: lane · title ·
// who · when · where. No sub-boards, no sections, no members — if you can see the board you can
// see every row, and the filters do the narrowing. Comments are app_comments (entity_type 'board')
// so they land in Messages like every other comment; photos are board_photos.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSettingFresh, setSetting } from '@/lib/app-settings'
import { notify } from '@/lib/notify'
import { rosterForPicker } from '@/lib/mentions'
import { KNOWN_BUILDINGS } from '@/lib/segments'

export const LANES = ['Projects', 'Tasks', 'Vendor follow-ups', 'Misc'] as const
export type Lane = typeof LANES[number]
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const laneOf = (v: any): Lane => (LANES as readonly string[]).includes(str(v)) ? (str(v) as Lane) : 'Tasks'
const priOf = (v: any): string => (PRIORITIES as readonly string[]).includes(str(v)) ? str(v) : 'normal'
const dateOf = (v: any): string | null => /^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : null
const emailsOf = (v: any): string[] => Array.from(new Set((Array.isArray(v) ? v : []).map((e: any) => str(e).trim().toLowerCase()).filter((e: string) => /@/.test(e))))
export const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())

export type BoardItem = {
  id: string; lane: Lane; title: string; details: string | null; status: 'open' | 'done'; done: boolean
  priority: string; due: string | null; property: string | null; vendor: string | null; assignees: string[]
  comments: { id: string; by: string; body: string; at: string }[]
  photos: { id: string; url: string; caption: string | null; at: string }[]
  createdBy: string | null; createdAt: string; doneAt: string | null; doneBy: string | null; source: string | null
}
export type Proposal = {
  id: string; lane: Lane; title: string; details: string; assignee: string; due: string | null; priority: string; property: string
  status: 'open' | 'approved' | 'skipped'; from: string; at: string; by: string; itemId?: string
}
export class BoardNotReady extends Error { needsMigration = true }
const notReady = (e: any) => /board_items|board_photos|does not exist|schema cache/i.test(str(e?.message || e))

const rowToItem = (r: any, comments: BoardItem['comments'], photos: BoardItem['photos']): BoardItem => ({
  id: String(r.id), lane: laneOf(r.lane), title: str(r.title), details: r.details || null,
  status: str(r.status) === 'done' ? 'done' : 'open', done: str(r.status) === 'done', priority: priOf(r.priority),
  due: r.due_on ? str(r.due_on).slice(0, 10) : null, property: r.property || null, vendor: r.vendor || null,
  assignees: emailsOf(r.assignees), comments, photos,
  createdBy: r.created_by || null, createdAt: str(r.created_at), doneAt: r.done_at || null, doneBy: r.done_by || null, source: r.source || null,
})

// Only what a row shows. source_ref / reminded_on / updated_at never leave the server.
const ITEM_COLS = 'id,lane,title,details,status,priority,due_on,property,vendor,assignees,created_by,created_at,done_at,done_by,source'

/**
 * Everything open, plus what was completed in the last 60 days (for "Done" and search).
 * `countImportable` is for people who can edit: only they are offered the one-time import, so only
 * their read pays for counting it (and that count is remembered for a few minutes — see below).
 * Proposals are read FRESH: the settings reader keeps a 60s copy per server instance, and a
 * proposal approved on one instance kept coming back as "open" from another, inviting a second
 * approval of the same line.
 */
export async function readBoard(opts: { countImportable?: boolean } = {}) {
  const sb = supabaseAdmin()
  const since = new Date(Date.now() - 60 * 86400_000).toISOString()
  const { data: rows, error } = await sb.from('board_items').select(ITEM_COLS).or(`status.eq.open,done_at.gte.${since}`).order('created_at', { ascending: false }).limit(2000)
  if (error) { if (notReady(error)) throw new BoardNotReady(error.message); throw new Error(error.message) }
  const ids = (rows || []).map((r: any) => String(r.id))
  const [{ data: comments }, { data: photos }, proposals, people, importable] = await Promise.all([
    ids.length ? sb.from('app_comments').select('id,entity_id,author_email,body,created_at').eq('entity_type', 'board').in('entity_id', ids).order('created_at').limit(5000) : Promise.resolve({ data: [] as any[] }),
    ids.length ? sb.from('board_photos').select('id,item_id,url,caption,created_at').in('item_id', ids).order('created_at').limit(5000) : Promise.resolve({ data: [] as any[] }),
    openProposals(),
    rosterForPicker(),
    opts.countImportable ? importableCount() : Promise.resolve(0),
  ])
  const cBy: Record<string, BoardItem['comments']> = {}
  for (const c of ((comments || []) as any[])) (cBy[String(c.entity_id)] = cBy[String(c.entity_id)] || []).push({ id: String(c.id), by: str(c.author_email), body: str(c.body), at: str(c.created_at) })
  const pBy: Record<string, BoardItem['photos']> = {}
  for (const p of ((photos || []) as any[])) (pBy[String(p.item_id)] = pBy[String(p.item_id)] || []).push({ id: String(p.id), url: str(p.url), caption: p.caption || null, at: str(p.created_at) })
  const items = (rows || []).map((r: any) => rowToItem(r, cBy[String(r.id)] || [], pBy[String(r.id)] || []))
  // The property picker: every building we know, plus anything someone typed that is not one.
  const properties = Array.from(new Set(KNOWN_BUILDINGS.map(b => b.label).concat(items.map(i => i.property || '').filter(Boolean))))
  return { lanes: [...LANES], items, proposals: proposals.slice(-60), people: people.map(p => ({ email: p.email, name: p.name })), properties, importable }
}

// ── WHERE PROPOSALS LIVE ────────────────────────────────────────────────────────────────────────
// Two homes, chosen at run time (2026-11-09):
//   · the table `board_proposals`, when it exists — one row a proposal, so two leaders deciding two
//     different lines in the same second each change their own row;
//   · otherwise the one settings row 'leadership_proposals' (the original store), where the whole
//     list is read, changed and written back.
// Nothing here needs the table: every table call that fails falls back to the settings row, and the
// "is it there" answer is re-checked every five minutes so creating the table later just works.
// Lines still open in the settings row when the table arrives keep showing and can still be decided.
const PROP_COLS = 'id,lane,title,details,assignee,due_on,priority,property,status,source,created_by,created_at,item_id'
let _propTable: { at: number; ok: boolean } | null = null
async function hasProposalTable(): Promise<boolean> {
  if (_propTable && Date.now() - _propTable.at < 300_000) return _propTable.ok
  let ok = false
  try { const { error } = await supabaseAdmin().from('board_proposals').select('id').limit(1); ok = !error } catch { ok = false }
  _propTable = { at: Date.now(), ok }
  return ok
}
const rowToProposal = (r: any): Proposal => ({
  id: str(r.id), lane: laneOf(r.lane), title: str(r.title), details: str(r.details), assignee: str(r.assignee).toLowerCase(),
  due: r.due_on ? str(r.due_on).slice(0, 10) : null, priority: priOf(r.priority), property: str(r.property),
  status: str(r.status) === 'approved' ? 'approved' : str(r.status) === 'skipped' ? 'skipped' : 'open',
  from: str(r.source) || 'notes', at: str(r.created_at), by: str(r.created_by), ...(r.item_id ? { itemId: String(r.item_id) } : {}),
})
const settingProposals = async (): Promise<Proposal[]> => {
  const cur = await getSettingFresh<Proposal[]>('leadership_proposals', [])
  return Array.isArray(cur) ? cur : []
}

/** Every proposal still waiting for a yes or a no, oldest first. Always read fresh. */
export async function openProposals(): Promise<Proposal[]> {
  const fromSetting = (await settingProposals()).filter(x => x.status === 'open')
  if (!(await hasProposalTable())) return fromSetting
  const { data, error } = await supabaseAdmin().from('board_proposals').select(PROP_COLS).eq('status', 'open').order('created_at').limit(200)
  if (error) { _propTable = null; return fromSetting }
  const rows = ((data || []) as any[]).map(rowToProposal)
  const have = new Set(rows.map(r => r.id))
  return fromSetting.filter(x => !have.has(x.id)).concat(rows)
}

/** One open proposal, read fresh (never the 60s in-process copy). */
export async function openProposal(id: string): Promise<Proposal | null> {
  if (!id) return null
  if (await hasProposalTable()) {
    const { data, error } = await supabaseAdmin().from('board_proposals').select(PROP_COLS).eq('id', id).maybeSingle()
    if (error) _propTable = null
    else if (data) return str((data as any).status) === 'open' ? rowToProposal(data) : null
  }
  return (await settingProposals()).find(x => x.id === id && x.status === 'open') || null
}

/** Save freshly proposed lines. The table when it is there; the settings row when it is not (or refuses). */
async function saveProposals(made: Proposal[], by: string): Promise<{ ok: boolean; error?: string }> {
  if (await hasProposalTable()) {
    const { error } = await supabaseAdmin().from('board_proposals').insert(made.map(x => ({
      id: x.id, lane: x.lane, title: x.title, details: x.details || null, assignee: x.assignee || null, due_on: x.due, priority: x.priority,
      property: x.property || null, status: 'open', source: x.from, created_by: by, created_at: x.at,
    })))
    if (!error) return { ok: true }
    _propTable = null   // look again next time; this batch goes to the settings row below
  }
  const cur = await settingProposals()
  return setSetting('leadership_proposals', [...cur.filter(x => x.status === 'open'), ...made].slice(-80), by)
}

type ItemInput = { lane?: any; title?: any; details?: any; assignees?: any; due?: any; priority?: any; property?: any; vendor?: any; source?: string; source_ref?: string }

/** Tell newly assigned people: bell + pop-up + Slack DM, one link straight to the row. */
async function tellAssigned(emails: string[], by: string, byName: string | null | undefined, item: { id: string; title: string; due: string | null }) {
  const to = emails.filter(e => e !== by)
  if (!to.length) return
  try {
    const { tagAndNotify } = await import('@/lib/mentions')
    await tagAndNotify({ text: `You were assigned: ${item.title}${item.due ? ' · due ' + item.due : ''}`, by, byName, title: item.title, link: '/leadership?item=' + item.id, picked: to, toSlack: 'dm', entity: { type: 'board', id: item.id } })
  } catch { try { await notify(to, { kind: 'assignment', title: `${(byName || by.split('@')[0])} assigned you · ${item.title}`.slice(0, 200), link: '/leadership?item=' + item.id, actor: by, entity: { type: 'board', id: item.id } }) } catch { /* best effort */ } }
}

export async function addItem(by: string, byName: string | null | undefined, inp: ItemInput): Promise<{ id: string } | { error: string }> {
  const sb = supabaseAdmin()
  const title = str(inp.title).trim().slice(0, 300)
  if (!title) return { error: 'A title is needed.' }
  const assignees = emailsOf(inp.assignees)
  const row: any = {
    lane: laneOf(inp.lane), title, details: str(inp.details).trim().slice(0, 4000) || null, status: 'open', priority: priOf(inp.priority),
    due_on: dateOf(inp.due), property: str(inp.property).trim().slice(0, 80) || null, vendor: str(inp.vendor).trim().slice(0, 120) || null,
    assignees, created_by: by, source: inp.source || 'manual', source_ref: inp.source_ref || null,
  }
  const { data, error } = await sb.from('board_items').insert(row).select('id').single()
  if (error || !data) return { error: error?.message || 'could not add' }
  await tellAssigned(assignees, by, byName, { id: String(data.id), title, due: row.due_on })
  return { id: String(data.id) }
}

export async function setItem(by: string, byName: string | null | undefined, id: string, patch: ItemInput & { status?: any }): Promise<{ ok: true } | { error: string }> {
  const sb = supabaseAdmin()
  const { data: cur, error: rErr } = await sb.from('board_items').select('id,title,assignees,due_on,status').eq('id', id).maybeSingle()
  if (rErr || !cur) return { error: 'That item is gone — reload.' }
  const upd: any = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) { const t = str(patch.title).trim().slice(0, 300); if (!t) return { error: 'A title is needed.' }; upd.title = t }
  if (patch.details !== undefined) upd.details = str(patch.details).trim().slice(0, 4000) || null
  if (patch.lane !== undefined) upd.lane = laneOf(patch.lane)
  if (patch.priority !== undefined) upd.priority = priOf(patch.priority)
  if (patch.due !== undefined) upd.due_on = dateOf(patch.due)
  if (patch.property !== undefined) upd.property = str(patch.property).trim().slice(0, 80) || null
  if (patch.vendor !== undefined) upd.vendor = str(patch.vendor).trim().slice(0, 120) || null
  if (patch.assignees !== undefined) upd.assignees = emailsOf(patch.assignees)
  if (patch.status !== undefined) {
    // Only a real change stamps it: a second "done" (two people, a double tap, the Command Center
    // and the board at once) used to overwrite who finished it and when.
    const done = str(patch.status) === 'done'
    if (done !== (str(cur.status) === 'done')) { upd.status = done ? 'done' : 'open'; upd.done_at = done ? new Date().toISOString() : null; upd.done_by = done ? by : null }
  }
  const { error } = await sb.from('board_items').update(upd).eq('id', id)
  if (error) return { error: error.message }
  if (upd.assignees) {
    const before = emailsOf(cur.assignees)
    const fresh = (upd.assignees as string[]).filter(e => !before.includes(e))
    await tellAssigned(fresh, by, byName, { id, title: upd.title || str(cur.title), due: upd.due_on !== undefined ? upd.due_on : (cur.due_on ? str(cur.due_on).slice(0, 10) : null) })
  }
  return { ok: true }
}

export async function deleteItem(id: string): Promise<{ ok: true } | { error: string }> {
  const { error } = await supabaseAdmin().from('board_items').delete().eq('id', id)
  return error ? { error: error.message } : { ok: true }
}

// ── Import from the old Projects engine, once ───────────────────────────────────────────────────
// Every OPEN task on every real project board (not personal lists, not the old leadership board's
// own rows — those come over too but under their lanes) becomes one row here, tagged with the
// project's building as its property and "From <project>" at the top of its notes. source_ref
// makes it idempotent: run it twice and the second run finds nothing to do.
const STEP_REF = 'project_step:'
const chunk = <T,>(arr: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

/** The projects whose open tasks could still come over: not archived, not finished. */
async function liveProjects(): Promise<Record<string, any>> {
  const { data: projs } = await supabaseAdmin().from('projects').select('id,title,kind,building,stage').eq('archived', false).limit(2000)
  const pmap: Record<string, any> = {}
  for (const p of ((projs || []) as any[])) if (!['done', 'cancelled'].includes(str(p.stage))) pmap[String(p.id)] = p
  return pmap
}
/** Every step already on the board, by its source_ref. One indexed read instead of a giant IN list. */
async function importedRefs(): Promise<Set<string>> {
  // Paged: the database hands back at most 1000 rows a request whatever limit is asked for.
  const seen = new Set<string>()
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await supabaseAdmin().from('board_items').select('source_ref').like('source_ref', STEP_REF + '%').order('source_ref').range(from, from + 999)
    const rows = (data || []) as any[]
    rows.forEach(h => seen.add(str(h.source_ref)))
    if (rows.length < 1000) break
  }
  return seen
}
async function openProjectSteps() {
  const sb = supabaseAdmin()
  const pmap = await liveProjects()
  const pids = Object.keys(pmap)
  if (!pids.length) return { steps: [] as any[], pmap, assignees: {} as Record<string, string[]> }
  // IN lists go out in the URL; a few hundred ids at a time keeps every request under the limit
  // (one list of every project, then one of every step, was failing silently on a big account).
  const stepParts = await Promise.all(chunk(pids, 150).map(part => sb.from('project_steps').select('id,project_id,title,description,status,section,priority,due_on,vendor_name,created_by,created_at').in('project_id', part).neq('status', 'done').is('parent_id', null).limit(5000)))
  const steps = stepParts.flatMap(r => (r.data || []) as any[])
  const asgParts = await Promise.all(chunk(steps.map(s => String(s.id)), 150).map(part => sb.from('project_task_assignees').select('task_id,email').in('task_id', part)))
  const assignees: Record<string, string[]> = {}
  for (const a of asgParts.flatMap(r => (r.data || []) as any[])) if (a.email) (assignees[String(a.task_id)] = assignees[String(a.task_id)] || []).push(str(a.email).toLowerCase())
  return { steps, pmap, assignees }
}

// The import banner's number. It was recomputed on EVERY read of the board — every project, every
// open step with its full text, every assignee — which made each tap on the board wait on tables
// the board no longer uses. Now: ids only, and the answer is kept for five minutes per instance.
// Once everything is over (0) it is kept for an hour; an import resets it.
let _importable: { at: number; n: number } | null = null
async function importableCount(): Promise<number> {
  if (_importable && Date.now() - _importable.at < (_importable.n === 0 ? 3600_000 : 300_000)) return _importable.n
  try {
    const sb = supabaseAdmin()
    const pids = Object.keys(await liveProjects())
    let n = 0
    if (pids.length) {
      const [parts, seen] = await Promise.all([
        Promise.all(chunk(pids, 150).map(part => sb.from('project_steps').select('id').in('project_id', part).neq('status', 'done').is('parent_id', null).limit(5000))),
        importedRefs(),
      ])
      for (const r of parts) for (const st of ((r.data || []) as any[])) if (!seen.has(STEP_REF + st.id)) n++
    }
    _importable = { at: Date.now(), n }
    return n
  } catch { return 0 }
}
export async function importFromProjects(by: string): Promise<{ imported: number; skipped: number }> {
  const sb = supabaseAdmin()
  const [{ steps, pmap, assignees }, seen] = await Promise.all([openProjectSteps(), importedRefs()])
  let imported = 0, skipped = 0
  const fresh: any[] = []
  for (const s of steps) {
    const ref = STEP_REF + s.id
    if (seen.has(ref)) { skipped++; continue }
    const p = pmap[String(s.project_id)] || {}
    const isLead = str(p.kind) === 'leadership'
    const lane: Lane = isLead ? laneOf(s.section) : (str(p.kind) === 'personal' ? 'Tasks' : 'Projects')
    const head = isLead || str(p.kind) === 'personal' ? '' : `From project: ${str(p.title)}`
    const details = [head, str(s.description).trim()].filter(Boolean).join('\n\n').slice(0, 4000) || null
    fresh.push({
      lane, title: str(s.title).slice(0, 300) || 'Untitled', details, status: 'open', priority: priOf(s.priority), due_on: dateOf(s.due_on),
      property: p.building || null, vendor: s.vendor_name || null, assignees: emailsOf(assignees[String(s.id)] || []),
      created_by: s.created_by || by, created_at: s.created_at || new Date().toISOString(), source: 'project', source_ref: ref,
    })
  }
  // A hundred rows a request instead of one request a row (a 400-task import was 400 round trips
  // and could run out the clock half way). If a batch is refused, its rows go one at a time so a
  // single bad row costs only itself.
  for (const part of chunk(fresh, 100)) {
    const { error } = await sb.from('board_items').insert(part)
    if (!error) { imported += part.length; continue }
    for (const row of part) { const { error: e1 } = await sb.from('board_items').insert(row); if (e1) skipped++; else imported++ }
  }
  _importable = null
  return { imported, skipped }
}

// ── Morning reminders: late or due today → the people on it, once a day ─────────────────────────
export async function boardReminders(): Promise<{ reminded: number }> {
  const sb = supabaseAdmin()
  const today = todayET()
  const { data: rows, error } = await sb.from('board_items').select('id,title,due_on,assignees,reminded_on').eq('status', 'open').lte('due_on', today).limit(500)
  if (error || !rows) return { reminded: 0 }
  let reminded = 0
  for (const r of rows as any[]) {
    if (str(r.reminded_on) === today) continue
    const to = emailsOf(r.assignees); if (!to.length) continue
    const due = str(r.due_on).slice(0, 10)
    const late = due < today ? Math.round((Date.parse(today) - Date.parse(due)) / 86400_000) : 0
    try {
      await notify(to, { kind: 'reminder', title: (late ? `${late}d late · ` : 'Due today · ') + str(r.title).slice(0, 160), link: '/leadership?item=' + r.id, entity: { type: 'board', id: String(r.id) } })
      await sb.from('board_items').update({ reminded_on: today }).eq('id', r.id)
      reminded++
    } catch { /* next */ }
  }
  return { reminded }
}

// ── AI: meeting notes → proposed items, approved one by one ────────────────────────────────────
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
  const today = todayET()
  const roster = people.slice(0, 60).map(p => `${p.name} <${p.email}>`).join('\n')
  const props = KNOWN_BUILDINGS.map(b => b.label).join(', ')
  const system = `You turn meeting notes from a short-term-rental property management company (Stay Hospitality, South Florida) into a short list of ACTION ITEMS for the leadership board. Today is ${today}.
Return ONLY a JSON array. Each element: {"lane":"Projects"|"Tasks"|"Vendor follow-ups"|"Misc","title":"imperative, under 90 chars","details":"one or two sentences of context from the notes, or empty","assignee":"email from the roster or empty","due":"YYYY-MM-DD or empty","priority":"low"|"normal"|"high"|"urgent","property":"one of the properties below, or empty"}.
Rules: one item per real commitment or decision that needs a person to act; no duplicates; no items for things already done; "Vendor follow-ups" is for chasing an outside company or an owner; "Projects" only for multi-week initiatives; dates only when the notes say or clearly imply one (e.g. "by Friday" → that date); assign only when the notes name who owns it and that person is on the roster; property only when the notes name the building. 3–15 items. If there are no actions, return [].
Properties: ${props}
Roster:\n${roster}`
  const r = await anthropicMessages(key, { model: pair.model, max_tokens: 4000, temperature: 0, system, messages: [{ role: 'user', content: body }] }, pair.fallback, 'leadership_notes')
  if (!r.ok) return { ok: false, error: 'AI call failed (' + r.status + '): ' + str(r.data?.error?.message || '').slice(0, 160) }
  const raw = textOf(r.data)
  let arr: any[] = []
  try { const m = raw.match(/\[[\s\S]*\]/); arr = JSON.parse(m ? m[0] : raw) } catch { return { ok: false, error: 'The AI answer was not a list — try again with cleaner notes.' } }
  if (!Array.isArray(arr)) return { ok: false, error: 'The AI answer was not a list.' }
  const emails = new Set(people.map(p => p.email.toLowerCase()))
  const known = new Map(KNOWN_BUILDINGS.map(b => [b.label.toLowerCase(), b.label]))
  const now = new Date().toISOString()
  const made: Proposal[] = arr.slice(0, 20).map((x: any, i: number) => ({
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + i, lane: laneOf(x?.lane), title: str(x?.title).trim().slice(0, 200), details: str(x?.details).trim().slice(0, 1000),
    assignee: emails.has(str(x?.assignee).toLowerCase()) ? str(x?.assignee).toLowerCase() : '',
    due: dateOf(x?.due), priority: priOf(x?.priority), property: known.get(str(x?.property).trim().toLowerCase()) || '',
    status: 'open' as const, from: source, at: now, by,
  })).filter(x => x.title)
  if (!made.length) return { ok: true, proposals: [] }
  const saved = await saveProposals(made, by)
  // The list on screen comes from what was saved; saying "done" over a failed save showed nothing.
  if (!saved.ok) return { ok: false, error: 'The tasks were read but could not be saved — try again. ' + str(saved.error).slice(0, 120) }
  return { ok: true, proposals: made }
}

export async function settleProposal(id: string, status: 'approved' | 'skipped', by: string, itemId?: string): Promise<void> {
  if (!id) return
  if (await hasProposalTable()) {
    // Only an open row is settled, so the first decision stands.
    const { data, error } = await supabaseAdmin().from('board_proposals')
      .update({ status, settled_by: by, settled_at: new Date().toISOString(), item_id: itemId || null }).eq('id', id).eq('status', 'open').select('id')
    if (error) _propTable = null
    else if (((data || []) as any[]).length) return
    // Not in the table (or the table refused): it may be one of the older lines in the settings row.
  }
  const cur = await settingProposals()
  if (!cur.some(x => x.id === id && x.status === 'open')) return
  const next = cur.map(x => x.id === id ? { ...x, status, itemId } : x).filter(x => x.status === 'open' || Date.parse(x.at) > Date.now() - 7 * 86400_000)
  await setSetting('leadership_proposals', next, by)
}

/** Is this person one of the row's owners? (View-only people may tick off their own work.) */
export async function isAssignee(id: string, email: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !email) return false
  const { data } = await supabaseAdmin().from('board_items').select('assignees').eq('id', id).maybeSingle()
  return emailsOf((data as any)?.assignees).includes(email.toLowerCase())
}
