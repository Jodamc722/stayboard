// THE HANDS (2026-09-21). One executor per kind of action Eve can take, in one registry, so every
// path that carries out an action — a proposal a person said yes to, a quiet-hours hold flushed in
// the morning, a rung-3 act from chat or from a watch — runs the SAME code and leaves the SAME
// receipt.
//
// Jon: "Continue to improve Eve's agentic abilities… long-term goal is for her to be a real team
// member." Until today the agent switch existed but only Slack posts, Telegram asks and memory
// writes could actually run; every other action type said "not wired". These are the wires.
//
// THE CONTRACT. An executor does the thing and nothing else. It does not ask whether it is allowed:
// the CALLER decides that with agentAllowed → stepDown, and by the time an executor runs the
// decision has been made (a rung-3 act, or a human's yes). It never throws — it returns
// { ok:false, error } — and when it can, it returns an `undo` so the action can be reversed within
// 24 hours from the panel or with "undo" on Telegram.
//
// WELDED SHUT. guest_reply_send, guesty_write, calendar_block and email_send are capped at rung 2
// in lib/eve/agent-mode.ts, so agentAllowed can never produce `act` for them. As a second lock
// this file refuses to run them unless the context says a human approved (`human: true`, set by
// executeProposal and the Send button). A code path that forgets the first fence hits the second.
//
// PAYLOAD SHAPES (what a proposal's `exec` must carry — proposeAction stores it verbatim):
//   task_create        { listingId? | unit?, title, department?, priority?, date?, description?, assignees?: string[] }
//   task_assign        { taskId, person? | personIds?: number[] }
//   task_note          { taskId, text, as?: string (a person's name) }
//   task_cancel        { taskId, reason? }
//   guest_reply_draft  { conversationId, draft, guest?, unit?, why? }
//   guest_reply_send   { conversationId, body, module? }
//   email_draft        { to: string[], subject, html? | text?, fromEmail? }
//   email_send         — not enabled
//   guesty_write       { reservationId, note } | { reservationId, fieldId, value }
//   calendar_block     { listingId, date, action?: 'block'|'unblock' }
//   slack_post         { channel, text, thread_ts?, channel_name? }
//   telegram_ask       { chat_id, text, bind? }
//   memory_rule        { text, kind?, why?, scope?, weight? }
//   recommendation     { title, metric, detail?, scope?, expect_direction?, expect_pct?, measure_in_days? }
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ACTIONS, type ActionType } from './agent-mode'

export type Undo = { kind: string; [k: string]: any }
export type ExecOut = { ok: boolean; ref?: string | null; summary: string; undo?: Undo | null; error?: string; done?: string }
export type ExecCtx = {
  /** 'chat' | 'cron:<name>' | 'watch:<key>' | 'panel' — who ran it. */
  by: string
  /** The person, when a person was involved. */
  actor?: string | null
  /** True only when a human said yes to THIS action (executeProposal, the Send button). */
  human?: boolean
}
export type Executor = (payload: any, ctx: ExecCtx) => Promise<ExecOut>

const str = (v: any) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const DEPTS = ['housekeeping', 'inspection', 'maintenance', 'safety']
const PRIOS = ['urgent', 'high', 'normal', 'low']
// Same rule as /api/ops-today/task-action: departure cleans are the scheduler's, never Eve's to cancel.
const DEPARTURE_CLEAN = /departure clean|strip & walkthrough/i
const NEEDS_HUMAN: ActionType[] = ['guest_reply_send', 'guesty_write', 'calendar_block', 'email_send', 'door_code_release']

// ---- Listing resolution (the same shape auto-inspections and add-task use) ------------------------

type Home = { listingId: string; unit: string; homeId: number | null; market: string | null }

async function resolveHome(input: { listingId?: string; unit?: string; name?: string }): Promise<Home | null> {
  const db = supabaseAdmin()
  const id = str(input.listingId).trim()
  const name = str(input.unit || input.name).trim()
  let row: any = null
  if (id) {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,building,address_city,status').eq('id', id).maybeSingle()
    row = data
  }
  if (!row && name) {
    const { data } = await db.from('guesty_listings').select('id,nickname,title,building,address_city,status').or(`nickname.ilike.%${name.replace(/[%,]/g, '')}%,title.ilike.%${name.replace(/[%,]/g, '')}%`).order('id').limit(5)
    const rows = ((data as any[]) || [])
    // An exact nickname/title wins; a partial match ("Pelican" → Pelican 9 / Pelican 12) only when
    // it is the ONLY live one, so a task never lands on a neighbour's unit by prefix.
    const live = rows.filter(r => !/inactive|disabled|archived|deleted|pending/i.test(str(r.status)))
    const exact = (live.length ? live : rows).find(r => [r.nickname, r.title].some(v => str(v).trim().toLowerCase() === name.toLowerCase()))
    row = exact || (live.length === 1 ? live[0] : (!live.length && rows.length === 1 ? rows[0] : null))
    if (!row && rows.length > 1) return null
  }
  if (!row) return null
  let homeId: number | null = null
  try {
    const { data: p } = await db.from('breezeway_properties').select('home_id').eq('reference_property_id', str(row.id)).limit(1)
    const n = Number(((p as any[]) || [])[0]?.home_id)
    homeId = Number.isFinite(n) ? n : null
  } catch { homeId = null }
  let market: string | null = null
  try { const { marketOf } = await import('@/lib/segments'); market = marketOf(row.building, row.address_city, row.nickname || row.title) } catch { market = null }
  return { listingId: str(row.id), unit: str(row.nickname || row.title), homeId, market }
}

async function liveTaskName(taskId: string): Promise<string> {
  try {
    const { retrieveBreezewayTask } = await import('@/lib/breezeway')
    const cur = await retrieveBreezewayTask(taskId)
    const t: any = cur.ok && cur.data ? (cur.data.task || cur.data) : null
    if (t && t.name) return str(t.name)
  } catch { /* mirror below */ }
  try {
    const { data } = await supabaseAdmin().from('breezeway_tasks_sync').select('name').eq('id', taskId).maybeSingle()
    return str((data as any)?.name)
  } catch { return '' }
}

async function personIds(names: string[]): Promise<{ ids: number[]; matched: string[]; missed: string[] }> {
  const { matchBreezewayPerson } = await import('@/lib/breezeway')
  const ids: number[] = [], matched: string[] = [], missed: string[] = []
  for (const n of names) {
    const nm = str(n).trim(); if (!nm) continue
    let id: number | null = null
    try { id = await matchBreezewayPerson(nm) } catch { id = null }
    if (Number.isFinite(id as any)) { ids.push(Number(id)); matched.push(nm) } else missed.push(nm)
  }
  return { ids, matched, missed }
}

// ---- The executors -------------------------------------------------------------------------------

const task_create: Executor = async (p) => {
  const { createBreezewayTask, updateBreezewayTask, breezewayConfigured } = await import('@/lib/breezeway')
  if (!breezewayConfigured()) return { ok: false, summary: 'Breezeway is not configured', error: 'Breezeway not configured' }
  const title = str(p?.title || p?.name).trim().slice(0, 120)
  if (!title) return { ok: false, summary: 'no task title', error: 'title required' }
  const home = await resolveHome({ listingId: p?.listingId || p?.listing_id, unit: p?.unit, name: p?.name_of_unit })
  if (!home) return { ok: false, summary: `no listing matches "${str(p?.unit || p?.listingId)}"`, error: 'listing not found' }
  const department = DEPTS.indexOf(str(p?.department)) >= 0 ? str(p.department) : 'maintenance'
  const priority = PRIOS.indexOf(str(p?.priority)) >= 0 ? str(p.priority) : 'normal'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(p?.date || p?.scheduled_date)) ? str(p.date || p.scheduled_date) : todayET()
  const description = (str(p?.description).trim().slice(0, 1200) + '\n\nCreated by Eve (Lighthouse agent mode).').trim()
  const body: Record<string, any> = { name: title, type_department: department, type_priority: priority, scheduled_date: date, description }
  if (home.homeId != null) body.home_id = home.homeId; else body.reference_property_id = home.listingId
  const r = await createBreezewayTask(body)
  if (!r.ok || !r.data?.id) return { ok: false, summary: `Breezeway refused the task (${r.status})`, error: `Breezeway ${r.status}: ${str(r.text).slice(0, 160)}` }
  const taskId = str(r.data.id)
  const wanted = Array.isArray(p?.assignees) ? p.assignees.map(str) : (p?.assignee ? [str(p.assignee)] : [])
  let assignedNames: string[] = []
  if (wanted.length) {
    const ppl = await personIds(wanted)
    if (ppl.ids.length) { try { const a = await updateBreezewayTask(taskId, { assignments: ppl.ids }); if (a.ok) assignedNames = ppl.matched } catch { /* visible unassigned */ } }
  }
  try {
    await supabaseAdmin().from('breezeway_tasks_sync').upsert({
      id: taskId, reference_property_id: home.listingId, name: title, status: 'created', scheduled_date: date, type_department: department,
      assignees: assignedNames.map(n => ({ id: null, name: n })), report_url: r.data.report_url || null,
      raw: r.data && typeof r.data === 'object' ? r.data : {}, synced_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  } catch { /* the sync catches up */ }
  // A task made for a glitch closes the loop on the glitch board too.
  if (p?.glitchId) { try { await supabaseAdmin().from('glitches').update({ breezeway_task_id: taskId }).eq('id', str(p.glitchId)) } catch { /* the board shows it next sync */ } }
  // An inspection the automation would otherwise file too (big arrival: the reservation id; low
  // review: 'rev:<id>') is written to its exactly-once table, so the cron sees it as done. This is
  // what stops the Pelican 9 double.
  if (p?.autoInspectionKey) {
    try {
      await supabaseAdmin().from('auto_inspections').upsert({
        reservation_id: str(p.autoInspectionKey), listing_id: home.listingId, unit_name: home.unit, guest_name: str(p?.guest) || null,
        check_in: date, reason: str(p?.autoInspectionReason) || 'Eve', market: home.market, task_id: taskId, assignees: assignedNames,
      }, { onConflict: 'reservation_id' })
    } catch { /* the watch's own cooldown still holds */ }
  }
  try { const { bustOpsDay } = await import('@/lib/ops-day'); bustOpsDay() } catch { /* fine */ }
  return {
    ok: true, ref: taskId,
    summary: `created ${department} task #${taskId} "${title}" on ${home.unit} for ${date}${assignedNames.length ? ` → ${assignedNames.join(', ')}` : ''}`,
    undo: { kind: 'task_cancel', taskId, title },
  }
}

const task_assign: Executor = async (p) => {
  const { updateBreezewayTask, retrieveBreezewayTask } = await import('@/lib/breezeway')
  const taskId = str(p?.taskId || p?.task_id).trim()
  if (!taskId) return { ok: false, summary: 'no task id', error: 'taskId required' }
  let ids: number[] = Array.isArray(p?.personIds) ? p.personIds.map(Number).filter((n: number) => Number.isFinite(n)) : []
  let names: string[] = []
  if (!ids.length) {
    const wanted = Array.isArray(p?.people) ? p.people.map(str) : [str(p?.person || p?.assignee)]
    const ppl = await personIds(wanted.filter(Boolean))
    if (!ppl.ids.length) return { ok: false, summary: `no Breezeway person matches "${wanted.join(', ')}"`, error: 'person not found' }
    ids = ppl.ids; names = ppl.matched
  }
  // Remember who had it, so undo can put it back exactly.
  let before: number[] = []
  try {
    const cur = await retrieveBreezewayTask(taskId)
    const t: any = cur.ok && cur.data ? (cur.data.task || cur.data) : null
    before = (Array.isArray(t?.assignments) ? t.assignments : []).map((a: any) => Number(a?.assignee_id ?? a?.id)).filter((n: number) => Number.isFinite(n))
  } catch { before = [] }
  const r = await updateBreezewayTask(taskId, { assignments: ids })
  if (!r.ok) return { ok: false, summary: `Breezeway refused the assignment (${r.status})`, error: `Breezeway ${r.status}: ${str(r.text).slice(0, 160)}` }
  try {
    await supabaseAdmin().from('breezeway_tasks_sync').update({ assignees: names.map(n => ({ id: null, name: n })), synced_at: new Date().toISOString() }).eq('id', taskId)
  } catch { /* sync catches up */ }
  try { const { bustOpsDay } = await import('@/lib/ops-day'); bustOpsDay() } catch { /* fine */ }
  return { ok: true, ref: taskId, summary: `assigned task #${taskId} to ${names.length ? names.join(', ') : ids.join(', ')}`, undo: { kind: 'task_assign', taskId, assignments: before } }
}

const task_note: Executor = async (p, ctx) => {
  const { createBreezewayComment, matchBreezewayPerson } = await import('@/lib/breezeway')
  const taskId = str(p?.taskId || p?.task_id).trim()
  const text = str(p?.text || p?.note).trim()
  if (!taskId || !text) return { ok: false, summary: 'need a task id and a note', error: 'taskId and text required' }
  // Breezeway requires a person on a comment. The person named, else the actor, else the pinned
  // comment person (the same fallback /api/comments uses).
  let personId: number | null = null
  const asName = str(p?.as || ctx.actor).trim()
  if (asName) { try { personId = await matchBreezewayPerson(asName) } catch { personId = null } }
  if (!personId) {
    try {
      const { data: st } = await supabaseAdmin().from('app_settings').select('value').eq('key', 'breezeway_comment_person_id').maybeSingle()
      const pinned = Number(str((st as any)?.value).replace(/"/g, ''))
      if (Number.isFinite(pinned) && pinned > 0) personId = pinned
    } catch { /* none pinned */ }
  }
  const body = `${text}\n— Eve (Lighthouse)`
  const r = await createBreezewayComment(taskId, body, personId)
  if (!r.ok) return { ok: false, summary: `Breezeway refused the note (${r.status})`, error: `Breezeway ${r.status}: ${str(r.text).slice(0, 160)}${!personId ? ' — no Breezeway person to post as; pin breezeway_comment_person_id in app_settings' : ''}` }
  let commentId: string | null = null
  try { const j = JSON.parse(r.text); commentId = j?.id != null ? str(j.id) : null } catch { commentId = null }
  return { ok: true, ref: taskId, summary: `noted on task #${taskId}: "${text.slice(0, 80)}"`, undo: commentId ? { kind: 'comment_delete', taskId, commentId } : null }
}

const task_cancel: Executor = async (p) => {
  const { cancelBreezewayTask } = await import('@/lib/breezeway')
  const taskId = str(p?.taskId || p?.task_id).trim()
  if (!taskId) return { ok: false, summary: 'no task id', error: 'taskId required' }
  const name = await liveTaskName(taskId)
  if (!name) return { ok: false, summary: `could not read task #${taskId}`, error: 'not acting on a task we cannot see' }
  if (DEPARTURE_CLEAN.test(name)) return { ok: false, summary: `#${taskId} is a departure clean`, error: 'Departure cleans can only be deleted from the scheduler.' }
  const r = await cancelBreezewayTask(taskId)
  if (!r.ok) return { ok: false, summary: `Breezeway would not cancel #${taskId}`, error: str(r.text).slice(0, 160) }
  try { await supabaseAdmin().from('breezeway_tasks_sync').update({ status: 'cancelled', synced_at: new Date().toISOString() }).eq('id', taskId) } catch { /* fine */ }
  try { const { bustOpsDay } = await import('@/lib/ops-day'); bustOpsDay() } catch { /* fine */ }
  return { ok: true, ref: taskId, summary: `cancelled task #${taskId} "${name.slice(0, 60)}"${p?.reason ? ` — ${str(p.reason).slice(0, 80)}` : ''}`, undo: { kind: 'task_reopen', taskId, name } }
}

/**
 * A draft reply is a row in eve_actions (kind 'guest_draft', status 'proposed'). It shows on the
 * thread page and in the Command Center's Decide band with Send / Discard; Send runs
 * guest_reply_send with human:true. Nothing reaches the guest here.
 */
const guest_reply_draft: Executor = async (p, ctx) => {
  const conversationId = str(p?.conversationId || p?.conversation_id).trim()
  const reviewId = str(p?.reviewId || p?.review_id).trim()
  const draft = str(p?.draft || p?.body || p?.text).trim()
  if ((!conversationId && !reviewId) || !draft) return { ok: false, summary: 'need a conversation (or a review) and a draft', error: 'conversationId or reviewId, and draft, required' }
  const db = supabaseAdmin()
  // One live draft per thread (or review): a newer one supersedes the older.
  try {
    const q = db.from('eve_actions').update({ status: 'expired', result: { note: 'replaced by a newer draft' } }).eq('kind', 'guest_draft').eq('status', 'proposed')
    await (conversationId ? q.filter('payload->>conversationId', 'eq', conversationId) : q.filter('payload->>reviewId', 'eq', reviewId))
  } catch { /* fine */ }
  const { data, error } = await db.from('eve_actions').insert({
    created_by: ctx.actor || ctx.by, kind: 'guest_draft',
    payload: { conversationId: conversationId || null, reviewId: reviewId || null, draft, guest: str(p?.guest) || null, unit: str(p?.unit) || null, channel: str(p?.channel) || null, by: ctx.by, watchKey: str(p?.watchKey) || null, subject: str(p?.subject) || null },
    why: str(p?.why).slice(0, 400) || 'Eve drafted a reply', status: 'proposed',
    expires_at: new Date(Date.now() + 3 * 86400_000).toISOString(),
  }).select('id').maybeSingle()
  if (error || !(data as any)?.id) return { ok: false, summary: 'could not save the draft', error: str(error?.message || 'insert failed').slice(0, 160) }
  const id = str((data as any).id)
  const where = conversationId ? `waiting for Send on /messages/${conversationId}` : 'waiting on /reviews (copy it into the reply box)'
  return { ok: true, ref: id, summary: `drafted a ${conversationId ? 'reply' : 'review reply'} to ${str(p?.guest) || 'the guest'}${p?.unit ? ` (${str(p.unit)})` : ''} — ${where}`, undo: { kind: 'draft_discard', id } }
}

const guest_reply_send: Executor = async (p) => {
  const { sendGuestMessage } = await import('@/lib/guesty')
  const conversationId = str(p?.conversationId || p?.conversation_id).trim()
  const body = str(p?.body || p?.draft || p?.text).trim()
  if (!conversationId || !body) return { ok: false, summary: 'need a conversation and a message', error: 'conversationId and body required' }
  const r = await sendGuestMessage(conversationId, body, { module: p?.module ? str(p.module) : undefined })
  if (!r.ok) return { ok: false, summary: `Guesty did not send the message`, error: str(r.error).slice(0, 300) }
  try {
    await supabaseAdmin().from('guesty_messages').upsert({
      id: r.id || `eve-${Date.now()}`, conversation_id: conversationId, sender: 'host', sender_name: 'Eve', body, sent_at: new Date().toISOString(), raw: { module: r.module, sentByEve: true },
    }, { onConflict: 'id' })
  } catch { /* the next messages sync brings it back */ }
  // A sent message cannot be unsent — the receipt is the undo.
  return { ok: true, ref: r.id || conversationId, summary: `sent to the guest via ${r.module}: "${body.slice(0, 80)}"`, undo: null }
}

const email_draft: Executor = async (p) => {
  const { draftGmail } = await import('@/lib/gmail-send')
  const to = (Array.isArray(p?.to) ? p.to : [p?.to]).map(str).map((s: string) => s.trim()).filter(Boolean)
  const subject = str(p?.subject).trim().slice(0, 200)
  if (!to.length || !subject) return { ok: false, summary: 'need recipients and a subject', error: 'to and subject required' }
  let fromEmail = str(p?.fromEmail).trim().toLowerCase()
  if (!fromEmail) { try { const { getTaskAutomation } = await import('@/lib/auto-inspections'); fromEmail = (await getTaskAutomation()).noticeDrafts.fromEmail } catch { fromEmail = '' } }
  if (!fromEmail) return { ok: false, summary: 'no mailbox to draft in', error: 'no fromEmail and no notice-drafts mailbox configured' }
  const html = str(p?.html) || `<div style="font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#111">${str(p?.text).split('\n').map((l: string) => l.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])).join('<br/>')}<p style="color:#888;font-size:12px">Drafted by Eve (Lighthouse). Nothing was sent.</p></div>`
  const r = await draftGmail({ fromEmail, to, subject, html })
  if (!r.ok) return { ok: false, summary: 'Gmail would not create the draft', error: str(r.error).slice(0, 200) }
  return { ok: true, ref: r.draftId || null, summary: `Gmail draft in ${fromEmail}: "${subject}" to ${to.join(', ')}`, undo: r.draftId ? { kind: 'gmail_draft_delete', fromEmail, draftId: r.draftId } : null }
}

const email_send: Executor = async () => ({ ok: false, summary: 'not enabled', error: 'Sending email is not enabled — a person sends the draft.' })

const guesty_write: Executor = async (p) => {
  const reservationId = str(p?.reservationId || p?.reservation_id).trim()
  if (!reservationId) return { ok: false, summary: 'no reservation', error: 'reservationId required' }
  const db = supabaseAdmin()
  if (p?.note) {
    const { appendReservationNote } = await import('@/lib/claim-note')
    const stamp = new Date().toISOString().slice(0, 10)
    const line = `[${stamp} Eve] ${str(p.note).trim().slice(0, 500)}`
    const r = await appendReservationNote(db, reservationId, line)
    if (!r.ok) return { ok: false, summary: 'Guesty refused the note', error: str(r.error).slice(0, 200) }
    return { ok: true, ref: reservationId, summary: `added to reservation ${reservationId} notes: "${str(p.note).slice(0, 80)}"`, undo: { kind: 'guesty_note_strip', reservationId, line } }
  }
  const fieldId = str(p?.fieldId).trim()
  if (!fieldId) return { ok: false, summary: 'nothing to write', error: 'note or fieldId+value required' }
  const { getToken } = await import('@/lib/guesty')
  const { readCustomFields, writeCustomFields, fieldIdOf } = await import('@/lib/guesty-custom-fields')
  let token = ''
  try { token = await getToken() } catch { token = '' }
  if (!token) return { ok: false, summary: 'no Guesty token', error: 'no Guesty token' }
  const live = await readCustomFields(reservationId, token)
  const prior = live ? live.find((c: any) => str(fieldIdOf(c)) === fieldId) : null
  const w = await writeCustomFields(reservationId, token, [{ fieldId, value: p?.value }])
  if (!w.ok) return { ok: false, summary: 'Guesty refused the write', error: str(w.note).slice(0, 200) }
  return { ok: true, ref: reservationId, summary: `wrote custom field ${fieldId} on reservation ${reservationId}`, undo: { kind: 'guesty_field_restore', reservationId, fieldId, value: prior ? prior.value : null } }
}

// CALENDAR BLOCKS ARE NOT EVE'S (Jon, 2026-09-23: "make sure calendar blocks are not possible"). This
// used to call applyScheduleBlock after a person's yes. It now refuses outright, so nothing reaches it:
// not a proposal approved in Slack or Telegram, not one queued before this change, not a deferred one.
// A person blocks a day on the Schedule page (app/api/schedule/block), which is unchanged.
const calendar_block: Executor = async () => {
  return { ok: false, summary: 'Eve does not block calendars', error: 'Calendar blocks are switched off for Eve. Block the day on the Schedule page.' }
}

const slack_post: Executor = async (p) => {
  if (!p?.channel || !p?.text) return { ok: false, summary: 'need a channel and text', error: 'channel and text required' }
  const { postToChannel, postThreadReply } = await import('@/lib/slack')
  const r = p.thread_ts ? await postThreadReply(str(p.channel), str(p.thread_ts), str(p.text)) : await postToChannel(str(p.channel), str(p.text))
  if (!r.ok) return { ok: false, summary: 'Slack refused it', error: str(r.error || 'Slack refused it') }
  return { ok: true, ref: r.ts || null, summary: `posted in ${p.channel_name || p.channel}`, done: `posted in ${p.channel_name || p.channel}`, undo: r.ts ? { kind: 'slack_delete', channel: str(r.channel || p.channel), ts: str(r.ts) } : null }
}

const telegram_ask: Executor = async (p, ctx) => {
  if (!p?.chat_id || !p?.text) return { ok: false, summary: 'need a chat and text', error: 'chat_id and text required' }
  const { sendMessage } = await import('@/lib/telegram')
  const r = await sendMessage(str(p.chat_id), str(p.text))
  if (!r.ok) return { ok: false, summary: 'Telegram refused it', error: str((r as any).error || 'Telegram refused it') }
  // A deferred morning ask carries its binding so the reply still lands on the right question.
  if (p.bind && typeof p.bind === 'object') {
    try {
      await supabaseAdmin().from('eve_actions').insert({
        created_by: p.bind.created_by || ctx.by, kind: 'ask',
        payload: { type: p.bind.type, ref: p.bind.ref, chat_id: str(p.chat_id), message_id: Number((r as any)?.result?.message_id) || null, delivery_count: 1, sent_at: new Date().toISOString() },
        why: str(p.bind.title).slice(0, 400), status: 'proposed',
      })
    } catch { /* sent; only the reply binding is lost */ }
  }
  return { ok: true, ref: str((r as any)?.result?.message_id || ''), summary: 'sent on Telegram', done: 'sent on Telegram', undo: null }
}

const memory_rule: Executor = async (p, ctx) => {
  if (!p?.text) return { ok: false, summary: 'nothing to remember', error: 'text required' }
  const { saveMemory } = await import('./memory')
  const r = await saveMemory({ text: str(p.text), kind: p.kind, why: p.why, scope: p.scope, weight: p.weight, source: 'eve', created_by: ctx.actor || ctx.by })
  if (!r.ok) return { ok: false, summary: 'could not save', error: r.error || 'could not save' }
  return { ok: true, ref: r.id || null, summary: 'remembered', done: 'remembered', undo: r.id ? { kind: 'memory_delete', id: r.id } : null }
}

const recommendation: Executor = async (p, ctx) => {
  const { createRecommendation } = await import('./recommendations')
  const r = await createRecommendation({ ...p, created_by: ctx.actor || ctx.by, source: p?.source || 'chat' })
  if (!r.ok) return { ok: false, summary: 'could not log it', error: r.error }
  return { ok: true, ref: r.id || null, summary: `logged recommendation "${str(p?.title).slice(0, 80)}"`, undo: null }
}

const door_code_release: Executor = async () => ({ ok: false, summary: 'door codes are released only through door_code_check', error: 'Door codes have their own approval path (Settings → Eve → Approvals).' })

export const EXECUTORS: Record<ActionType, Executor> = {
  slack_post, telegram_ask, email_draft, email_send,
  guest_reply_draft, guest_reply_send,
  task_create, task_assign, task_note, task_cancel,
  door_code_release, guesty_write, calendar_block,
  recommendation, memory_rule,
}

/** Run one executor. Never throws. Enforces the second lock on the welded actions. */
export async function runExecutor(action: ActionType, payload: any, ctx: ExecCtx): Promise<ExecOut> {
  const fn = EXECUTORS[action]
  if (!fn) return { ok: false, summary: `no executor for ${action}`, error: `no executor for ${action}` }
  if (NEEDS_HUMAN.indexOf(action) >= 0 && !ctx.human) {
    return { ok: false, summary: `${action} only runs after a person says yes`, error: 'This action is welded to propose: a person has to approve it.' }
  }
  try { return await fn(payload || {}, ctx) }
  catch (e: any) { return { ok: false, summary: `${action} failed`, error: str(e?.message || e).slice(0, 300) } }
}

/** Is this an action that has an executor which actually does something? For the prompt and the panel. */
export function executorWired(action: ActionType): boolean {
  return action !== 'email_send' && action !== 'door_code_release'
}
export function actionLabel(action: ActionType): string {
  return ACTIONS.find(a => a.key === action)?.label || action
}

// ---- UNDO ----------------------------------------------------------------------------------------

/** Reverse one logged action, by its eve_agent_log id, within 24 hours. */
export async function undoAction(logId: string | number, by: string): Promise<{ ok: boolean; summary: string; error?: string }> {
  const db = supabaseAdmin()
  let row: any = null
  try { const { data } = await db.from('eve_agent_log').select('id,at,action,summary,undo,undone_at').eq('id', Number(logId)).maybeSingle(); row = data } catch (e: any) { return { ok: false, summary: 'could not read the log', error: /column/i.test(str(e?.message)) ? 'Run migration 102 first.' : str(e?.message).slice(0, 160) } }
  if (!row) return { ok: false, summary: 'no such action on the log', error: 'not found' }
  if (row.undone_at) return { ok: false, summary: 'already undone', error: `undone at ${row.undone_at}` }
  if (!row.undo) return { ok: false, summary: `"${str(row.summary).slice(0, 80)}" cannot be undone`, error: 'no undo recorded for that action' }
  if (Date.now() - Date.parse(row.at) > 24 * 3600_000) return { ok: false, summary: 'too late — undo works for 24 hours', error: 'older than 24h' }
  // CLAIM FIRST. Two "undo"s a second apart (Telegram and the panel) must not both cancel, reassign
  // or strip: the row is stamped with a conditional update and only the caller whose stamp lands
  // goes on. A failed undo clears the stamp so it can be tried again.
  let claimed = false
  try {
    const { data: c } = await db.from('eve_agent_log').update({ undone_at: new Date().toISOString(), undone_by: by }).eq('id', row.id).is('undone_at', null).select('id')
    claimed = !!((c as any[]) || []).length
  } catch { claimed = false }
  if (!claimed) return { ok: false, summary: 'already undone', error: 'another undo got there first' }
  const u: Undo = row.undo
  let r: { ok: boolean; summary: string; error?: string }
  try { r = await applyUndo(u, by) } catch (e: any) { r = { ok: false, summary: 'undo failed', error: str(e?.message || e).slice(0, 200) } }
  const { logAgent } = await import('./agent-mode')
  await logAgent({ action: row.action, rung: 0, allowed: r.ok, mode: 'act', reason: r.ok ? `undone by ${by}` : `undo failed: ${r.error}`, summary: `UNDO: ${r.summary}`, ref: str(row.id), by: 'chat', actor: by })
  if (!r.ok) { try { await db.from('eve_agent_log').update({ undone_at: null, undone_by: null }).eq('id', row.id) } catch { /* fine */ } }
  return r
}

async function applyUndo(u: Undo, by: string): Promise<{ ok: boolean; summary: string; error?: string }> {
  const db = supabaseAdmin()
  switch (u.kind) {
    case 'task_cancel': {
      const { cancelBreezewayTask } = await import('@/lib/breezeway')
      const r = await cancelBreezewayTask(u.taskId)
      if (r.ok) { try { await db.from('breezeway_tasks_sync').update({ status: 'cancelled' }).eq('id', str(u.taskId)) } catch { /* fine */ } }
      return r.ok ? { ok: true, summary: `cancelled task #${u.taskId}` } : { ok: false, summary: `could not cancel #${u.taskId}`, error: str(r.text).slice(0, 160) }
    }
    case 'task_reopen': {
      const { bzApi } = await import('@/lib/breezeway')
      for (const code of ['created', 'new', 'open']) {
        const r = await bzApi(`/task/${encodeURIComponent(str(u.taskId))}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type_task_status: { code } }) })
        if (r.ok) { try { await db.from('breezeway_tasks_sync').update({ status: code }).eq('id', str(u.taskId)) } catch { /* fine */ } return { ok: true, summary: `reopened task #${u.taskId}` } }
      }
      return { ok: false, summary: `Breezeway would not reopen #${u.taskId}`, error: 'no reopen status accepted — open it in Breezeway' }
    }
    case 'task_assign': {
      const { updateBreezewayTask } = await import('@/lib/breezeway')
      const r = await updateBreezewayTask(u.taskId, { assignments: Array.isArray(u.assignments) ? u.assignments : [] })
      return r.ok ? { ok: true, summary: `put task #${u.taskId} back to ${Array.isArray(u.assignments) && u.assignments.length ? 'its previous assignees' : 'unassigned'}` } : { ok: false, summary: `could not reassign #${u.taskId}`, error: str(r.text).slice(0, 160) }
    }
    case 'comment_delete': {
      const { bzApi } = await import('@/lib/breezeway')
      const r = await bzApi(`/task/${encodeURIComponent(str(u.taskId))}/comments/${encodeURIComponent(str(u.commentId))}`, { method: 'DELETE' })
      return r.ok ? { ok: true, summary: `deleted the note on task #${u.taskId}` } : { ok: false, summary: 'Breezeway would not delete the note', error: `Breezeway ${r.status}` }
    }
    case 'draft_discard': {
      await db.from('eve_actions').update({ status: 'rejected', decided_by: by, decided_at: new Date().toISOString(), result: { note: 'undone' } }).eq('id', str(u.id)).eq('status', 'proposed')
      return { ok: true, summary: 'discarded the draft' }
    }
    case 'gmail_draft_delete': {
      const { deleteDraft } = await import('@/lib/gmail-send')
      const ok = await deleteDraft(str(u.fromEmail), str(u.draftId))
      return ok ? { ok: true, summary: 'deleted the Gmail draft' } : { ok: false, summary: 'could not delete the Gmail draft', error: 'Gmail refused' }
    }
    case 'guesty_note_strip': {
      const { getToken } = await import('@/lib/guesty')
      const { readCustomFields, writeCustomFields, fieldIdOf } = await import('@/lib/guesty-custom-fields')
      const token = await getToken()
      const live = await readCustomFields(str(u.reservationId), token)
      const notes = live ? live.find((c: any) => str(fieldIdOf(c)) === '695f16830cb54c001400b3ff' || /reservation[_ ]?notes/i.test(str(c?.fieldName))) : null
      if (!notes) return { ok: false, summary: 'no notes field to edit', error: 'notes field missing' }
      const next = str(notes.value).split('\n').filter((l: string) => l.trim() !== str(u.line).trim()).join('\n')
      const w = await writeCustomFields(str(u.reservationId), token, [{ fieldId: str(fieldIdOf(notes)), value: next }])
      return w.ok ? { ok: true, summary: 'removed the note line from the reservation' } : { ok: false, summary: 'Guesty refused the write', error: str(w.note) }
    }
    case 'guesty_field_restore': {
      const { getToken } = await import('@/lib/guesty')
      const { writeCustomFields } = await import('@/lib/guesty-custom-fields')
      const token = await getToken()
      const w = await writeCustomFields(str(u.reservationId), token, [{ fieldId: str(u.fieldId), value: u.value }])
      return w.ok ? { ok: true, summary: `restored field ${u.fieldId}` } : { ok: false, summary: 'Guesty refused the write', error: str(w.note) }
    }
    case 'calendar_block': {
      // Undoing an old Eve block may only UNBLOCK; re-blocking a day is the thing she no longer does.
      if (u.action !== 'unblock') return { ok: false, summary: 'Eve does not block calendars', error: 'Re-blocking is switched off for Eve. Use the Schedule page.' }
      const { applyScheduleBlock } = await import('@/lib/schedule-block')
      const r = await applyScheduleBlock({ listingId: str(u.listingId), date: str(u.date), action: u.action === 'unblock' ? 'unblock' : 'block', by })
      return r.ok ? { ok: true, summary: `${u.action === 'unblock' ? 'unblocked' : 'blocked'} ${u.date} on ${u.listingId}` } : { ok: false, summary: 'could not reverse the block', error: str(r.error) }
    }
    case 'slack_delete': {
      const { slackApi } = await import('@/lib/slack')
      const r = await slackApi('chat.delete', { channel: str(u.channel), ts: str(u.ts) })
      return r?.ok ? { ok: true, summary: 'deleted the Slack post' } : { ok: false, summary: 'Slack would not delete it', error: str(r?.error) }
    }
    case 'memory_delete': {
      await db.from('eve_memory').delete().eq('id', str(u.id))
      return { ok: true, summary: 'forgot it' }
    }
    default:
      return { ok: false, summary: `no undo for ${u.kind}`, error: 'unknown undo kind' }
  }
}

/** The most recent action that can still be undone — what "undo" on Telegram means. */
export async function lastUndoable(hours = 24): Promise<{ id: number; action: string; summary: string; at: string } | null> {
  try {
    const since = new Date(Date.now() - hours * 3600_000).toISOString()
    const { data } = await supabaseAdmin().from('eve_agent_log').select('id,action,summary,at').not('undo', 'is', null).is('undone_at', null).eq('mode', 'act').eq('allowed', true).gte('at', since).order('at', { ascending: false }).limit(1)
    const r: any = ((data as any[]) || [])[0]
    return r ? { id: Number(r.id), action: str(r.action), summary: str(r.summary), at: str(r.at) } : null
  } catch { return null }
}
