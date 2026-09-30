// WHAT NEEDS A PERSON FROM EVE — WITH THE CONTEXT TO DECIDE (Jon, 2026-09-30).
//
// "some of it is like a one-liner thing with no context, so it's hard for us to make approval" …
// "it should link to everything … the reservation … the Breezeway task once created … the claim, or
// the glitch, or the Slack message thread. We should be able to jump in and see what's going on."
//
// A proposal row used to be her one-line summary. Everything needed to decide was already on the
// row's payload — the exact reply she drafted, the task's title / date / assignees / description,
// the conversation and listing ids — it just was not shown. This module turns each waiting proposal
// and each hot Slack loop into a Need:
//   title     what it is, in a few words ("Reply to Teisha Gladden")
//   what      the exact thing she will do if you say yes (the draft, the task, the email)
//   why       her reason, plus evidence lines
//   links     every place to go look: the booking, the guest thread, Guesty, the Breezeway task, the
//             glitch, the claim, the Slack thread, the unit page, the review
//   urgency   now / today / week / later, with the reason — the list is sorted by it
//   group     proposals that are the same kind of routine thing (25 "PM audit" tasks from the
//             recurrence desk) share a group so the page can offer them as one batch
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { pageRows } from '@/lib/db-page'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export type NeedLink = { label: string; href: string; kind: 'booking' | 'thread' | 'guesty' | 'task' | 'glitch' | 'claim' | 'slack' | 'unit' | 'review' | 'email' | 'page' }
export type Urgency = 'now' | 'today' | 'week' | 'later'
export type Need = {
  id: string
  source: 'proposal' | 'loop'
  action: string
  title: string
  subtitle: string
  what: { label: string; text: string }[]
  why: string
  evidence: string[]
  links: NeedLink[]
  reservationId: string | null
  listingId: string | null
  unit: string | null
  urgency: Urgency
  urgencyWhy: string
  filedAt: string
  group: { key: string; label: string } | null
  by: string
  status: string
  /** loops only */
  loopKind?: string
  owner?: string | null
  /** Older copies of the same proposal — declined along with this one when it is decided. */
  dupes?: string[]
}

const ACTION_VERB: Record<string, string> = {
  guest_reply_draft: 'Draft a guest reply', guest_reply_send: 'Send a guest reply', task_create: 'Create a Breezeway task',
  task_assign: 'Assign a task', task_note: 'Add a note to a task', task_cancel: 'Cancel a task', email_draft: 'Draft an email',
  slack_post: 'Post in Slack', guesty_write: 'Write to Guesty', calendar_block: 'Block the calendar',
}
const RANK: Record<Urgency, number> = { now: 0, today: 1, week: 2, later: 3 }

function hoursIn(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*h\b/i.exec(text) || /(\d+)\s*hours?/i.exec(text)
  return m ? Number(m[1]) : null
}
function clip(s: string, n: number) { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

/** Everything a person should decide, newest context attached, most urgent first. */
export async function loadNeeds(): Promise<{ needs: Need[]; partial: boolean }> {
  const db = supabaseAdmin()
  const now = Date.now()
  let partial = false

  // 1. Waiting proposals (the same rule as my_actions_today: proposed, not expired, not a deferred shell).
  let props: any[] = []
  try {
    const { data } = await db.from('eve_actions').select('id,kind,status,payload,why,created_at,expires_at,result')
      .eq('status', 'proposed').in('kind', ['ask', 'draft']).order('created_at', { ascending: false }).limit(300)
    props = ((data as any[]) || []).filter(r => {
      if (r.expires_at && Date.parse(r.expires_at) < now) return false
      if (r?.payload?.type === 'deferred') return false
      if (r.kind === 'ask' && r?.payload?.type !== 'action') return false // morning-ask questions live on Questions
      return true
    })
  } catch { partial = true }

  // 2. Hot Slack loops — urgent, guest asks, or past their limit.
  let loops: any[] = []
  try {
    const { rows, truncated } = await pageRows((a, b) => db.from('eve_slack_items')
      .select('id,kind,summary,unit,building,owner_name,urgent,first_seen,channel,channel_name,msg_ts,thread_ts,evidence,tracked_in')
      .eq('status', 'open').order('id').range(a, b))
    if (truncated) partial = true
    loops = (rows || []).filter((r: any) => {
      const h = (now - Date.parse(r.first_seen)) / 3600000
      const late = r.kind === 'guest_ask' ? h >= 4 : h >= 48
      return (r.urgent || r.kind === 'guest_ask' || late) && r?.evidence?.weight !== 'small'
    })
  } catch { partial = true }

  // Look-ups shared by both: conversations → bookings, listings → names, tasks → status.
  const convIds = new Set<string>(), listingIds = new Set<string>(), taskIds = new Set<string>(), glitchIds = new Set<string>(), resIds = new Set<string>()
  for (const r of props) {
    const e = r?.payload?.exec || {}
    const conv = str(e.conversationId || e.conversation_id); if (conv) convIds.add(conv)
    const subj = str(r?.payload?.subject || e.subject)
    if (subj.startsWith('thread:')) convIds.add(subj.slice(7))
    const lid = str(e.listingId || e.listing_id); if (lid) listingIds.add(lid)
    const tid = str(e.taskId || e.task_id); if (tid) taskIds.add(tid)
    if (subj.startsWith('task:')) taskIds.add(subj.slice(5))
    const rid = str(e.reservationId || e.reservation_id); if (rid) resIds.add(rid)
  }
  for (const l of loops) {
    const ev = l.evidence || {}
    if (ev.taskId) taskIds.add(str(ev.taskId))
    if (ev.glitchId) glitchIds.add(str(ev.glitchId))
    if (ev.conversationId) convIds.add(str(ev.conversationId))
    if (ev.reservationId) resIds.add(str(ev.reservationId))
  }
  const convToRes: Record<string, string> = {}
  const listingName: Record<string, string> = {}
  const taskInfo: Record<string, { status: string; name: string; assignees: string[]; listingId: string }> = {}
  const glitchInfo: Record<string, { status: string; listingId: string; reservationId: string | null; overview: string }> = {}
  await Promise.all([
    convIds.size ? db.from('guesty_conversations').select('id,reservation_id,listing_id').in('id', Array.from(convIds).slice(0, 200))
      .then(({ data }: any) => { for (const c of data || []) { if (c.reservation_id) convToRes[str(c.id)] = str(c.reservation_id); if (c.listing_id) listingIds.add(str(c.listing_id)) } }, () => { partial = true }) : null,
    taskIds.size ? db.from('breezeway_tasks_sync').select('id,name,status,assignees,reference_property_id,finished_at').in('id', Array.from(taskIds).slice(0, 200))
      .then(({ data }: any) => { for (const t of data || []) taskInfo[str(t.id)] = { status: t.finished_at ? 'finished' : str(t.status), name: str(t.name), assignees: Array.isArray(t.assignees) ? t.assignees.map((a: any) => str(a?.name || a)).filter(Boolean) : [], listingId: str(t.reference_property_id) } }, () => { partial = true }) : null,
    glitchIds.size ? db.from('glitches').select('id,status,listing_id,reservation_id,overview').in('id', Array.from(glitchIds).slice(0, 200))
      .then(({ data }: any) => { for (const g of data || []) glitchInfo[str(g.id)] = { status: str(g.status), listingId: str(g.listing_id), reservationId: g.reservation_id ? str(g.reservation_id) : null, overview: str(g.overview) } }, () => { partial = true }) : null,
  ])
  // The last real host message per thread — a draft reply is out of date once someone answered.
  const lastHost: Record<string, string> = {}
  if (convIds.size) {
    try {
      const { data } = await db.from('guesty_messages').select('conversation_id,sent_at,module,is_automated').in('conversation_id', Array.from(convIds).slice(0, 200))
        .eq('sender', 'host').gte('sent_at', new Date(now - 14 * 86400000).toISOString()).limit(3000)
      for (const m of (data as any[]) || []) {
        if (['log', 'note', 'notes', 'internal', 'internal_note', 'activity', 'system'].indexOf(str(m.module).toLowerCase()) >= 0 || m.is_automated === true) continue
        const c = str(m.conversation_id); if (!lastHost[c] || str(m.sent_at) > lastHost[c]) lastHost[c] = str(m.sent_at)
      }
    } catch { partial = true }
  }
  const etDay = (iso: string) => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso)) } catch { return iso.slice(0, 10) } }
  const todayEt = etDay(new Date(now).toISOString())
  if (listingIds.size) {
    try {
      const { data } = await db.from('guesty_listings').select('id,nickname,title').in('id', Array.from(listingIds).slice(0, 300))
      for (const l of (data as any[]) || []) listingName[str(l.id)] = str(l.nickname || l.title)
    } catch { partial = true }
  }

  const needs: Need[] = []

  for (const r of props) {
    const p = r.payload || {}
    const e = p.exec || {}
    const action = str(p.action || r.kind)
    const summary = str(p.summary || r.why)
    const why = str(p.why || r.why)
    const by = str(p.by || '')
    const subj = str(p.subject || e.subject)
    const conv = str(e.conversationId || e.conversation_id) || (subj.startsWith('thread:') ? subj.slice(7) : '')
    const listingId = str(e.listingId || e.listing_id) || null
    const unit = str(e.unit) || (listingId ? listingName[listingId] || '' : '') || null
    const reservationId = str(e.reservationId || e.reservation_id) || (conv ? convToRes[conv] || '' : '') || null
    const taskId = str(e.taskId || e.task_id) || (subj.startsWith('task:') ? subj.slice(5) : '')
    const links: NeedLink[] = []
    const what: { label: string; text: string }[] = []
    let title = ACTION_VERB[action] || action.replace(/_/g, ' ')
    let urgency: Urgency = 'week'
    let urgencyWhy = ''
    let group: Need['group'] = null

    if (action === 'guest_reply_draft' || action === 'guest_reply_send') {
      const guest = str(e.guest) || 'the guest'
      title = (e.reviewId || e.review_id ? 'Answer ' + guest + '’s review' : 'Reply to ' + guest)
      if (e.draft || e.body || e.text) what.push({ label: e.reviewId ? 'Public reply she wrote' : 'Reply she wrote', text: str(e.draft || e.body || e.text) })
      what.push({ label: 'On approve', text: action === 'guest_reply_send' ? 'It is sent to the guest.' : (e.reviewId ? 'It waits on the Reviews page for a person to post it.' : 'It waits in the guest thread for a person to press Send — nothing reaches the guest yet.') })
      const h = hoursIn(why) ?? hoursIn(summary)
      urgency = e.reviewId ? 'today' : (h != null && h >= 1 ? 'now' : 'today')
      urgencyWhy = e.reviewId ? 'a public review is waiting for an answer' : (h != null ? `guest has waited ${h}h` : 'a guest is waiting')
      if (conv) links.push({ label: 'Guest thread', href: '/messages/' + conv, kind: 'thread' })
      if (e.reviewId || e.review_id) links.push({ label: 'Review', href: '/reviews', kind: 'review' })
    } else if (action === 'task_create') {
      title = str(e.title || e.name) || title
      what.push({ label: 'The task', text: [str(e.title || e.name), e.date ? 'on ' + str(e.date) : '', Array.isArray(e.assignees) && e.assignees.length ? 'for ' + e.assignees.join(', ') : 'unassigned', e.department ? '· ' + str(e.department) : '', e.priority ? '· ' + str(e.priority) + ' priority' : ''].filter(Boolean).join(' ') })
      if (e.description) what.push({ label: 'Description', text: str(e.description) })
      what.push({ label: 'On approve', text: 'The task is created in Breezeway.' })
      if (/pm-recurrence|cadence/i.test(by)) {
        const kind = str(e.title || '').split(/\s[—-]\s/)[0] || 'Preventative task'
        group = { key: 'pm:' + kind.toLowerCase(), label: kind }
        const overdue = /(\d+) days? over/i.exec(why)
        urgency = 'later'; urgencyWhy = overdue ? `preventative, ${overdue[1]} days over its cadence` : 'preventative, on its cadence'
      } else if (/bad_review/i.test(by)) { urgency = 'today'; urgencyWhy = 'after a bad review' }
      else { urgency = str(e.priority) === 'urgent' || str(e.priority) === 'high' ? 'today' : 'week'; urgencyWhy = str(e.priority) ? str(e.priority) + ' priority' : '' }
    } else if (action === 'task_note' || action === 'task_assign' || action === 'task_cancel') {
      const t = taskId ? taskInfo[taskId] : null
      title = (action === 'task_note' ? 'Note on ' : action === 'task_assign' ? 'Assign ' : 'Cancel ') + (t ? t.name : 'a task') + (unit ? ' · ' + unit : '')
      if (e.note || e.text) what.push({ label: 'Note', text: str(e.note || e.text) })
      if (e.assigneeIds || e.assignees) what.push({ label: 'Assign to', text: str(Array.isArray(e.assignees) ? e.assignees.join(', ') : e.assigneeIds) })
      if (t) what.push({ label: 'Task now', text: `${t.name} — ${t.status || 'open'}${t.assignees.length ? ' · ' + t.assignees.join(', ') : ' · nobody on it'}` })
      urgency = /arrives today|today/i.test(summary) ? 'now' : 'today'; urgencyWhy = /arrives today/i.test(summary) ? 'guest arrives today' : ''
    } else if (action === 'email_draft') {
      title = 'Email ' + (Array.isArray(e.to) ? e.to.join(', ') : str(e.to) || 'the team') + (e.subject ? ': ' + str(e.subject) : '')
      if (e.text || e.body) what.push({ label: 'Email', text: str(e.text || e.body) })
      what.push({ label: 'On approve', text: 'A draft is put in the mailbox — nothing is sent.' })
      urgency = 'week'
      links.push({ label: 'Channels page', href: '/channels', kind: 'page' })
    } else if (action === 'slack_post') {
      title = 'Post in ' + (e.channel ? '#' + str(e.channel_name || e.channel) : 'Slack')
      if (e.text) what.push({ label: 'Message', text: str(e.text) })
      urgency = 'today'
    } else {
      // Anything else: show what it will do as plain key: value lines so there is always context.
      for (const [k, v] of Object.entries(e)) {
        if (/id$|Id$|subject|watchKey|proposal/.test(k) || v == null || v === '') continue
        what.push({ label: k.replace(/_/g, ' '), text: typeof v === 'string' ? v : JSON.stringify(v) })
      }
    }
    if (!urgencyWhy && /arrives (today|tomorrow)/i.test(summary)) { urgency = /today/i.test(summary) ? 'now' : 'today'; urgencyWhy = 'guest arrives ' + (/today/i.test(summary) ? 'today' : 'tomorrow') }

    // THE NO-CALL FLAGS come in dozens (a note and a Slack post per arriving guest): one batch each.
    if (!group && /no welcome call/i.test(summary) && (action === 'task_note' || action === 'slack_post')) {
      group = { key: 'nocall:' + action, label: action === 'task_note' ? 'Task notes — guests arriving with no welcome call' : 'Slack flags — guests arriving with no welcome call' }
    }
    // OUT OF DATE (2026-09-30): a proposal whose moment has passed is not urgent, it is clutter —
    // "arrives today" filed on an earlier day, or a draft reply to a guest someone has since answered.
    const filedDay = etDay(str(r.created_at))
    let stale = ''
    if (/arrives today/i.test(summary) && filedDay < todayEt) stale = 'filed ' + filedDay.slice(5) + ' — that arrival has passed'
    else if (/arrives tomorrow/i.test(summary) && filedDay < todayEt && etDay(new Date(Date.parse(str(r.created_at)) + 86400000).toISOString()) < todayEt) stale = 'filed ' + filedDay.slice(5) + ' — that arrival has passed'
    else if ((action === 'guest_reply_draft') && conv && lastHost[conv] && lastHost[conv] > str(r.created_at)) stale = 'someone already replied to the guest ' + lastHost[conv].slice(5, 16).replace('T', ' ')
    if (stale) { urgency = 'later'; urgencyWhy = stale; group = { key: 'stale', label: 'Out of date — the moment has passed' } }

    if (reservationId) links.unshift({ label: 'Booking', href: '/reservations/' + reservationId, kind: 'booking' }, { label: 'Guesty', href: 'https://app.guesty.com/reservations/' + reservationId + '/summary', kind: 'guesty' })
    if (taskId) links.push({ label: 'Breezeway task', href: 'https://app.breezeway.io/task/' + taskId, kind: 'task' })
    if (listingId) links.push({ label: unit || 'Unit', href: '/listings/' + listingId, kind: 'unit' })
    if (unit && !links.some(l => l.kind === 'glitch')) links.push({ label: 'Glitches here', href: '/glitches?q=' + encodeURIComponent(unit), kind: 'glitch' })

    needs.push({
      id: str(r.id), source: 'proposal', action, title: clip(title, 120), subtitle: [unit, ACTION_VERB[action] || action.replace(/_/g, ' ')].filter(Boolean).join(' · '),
      what, why, evidence: Array.isArray(p.evidence) ? p.evidence.map(str).slice(0, 6) : [], links,
      reservationId, listingId, unit, urgency, urgencyWhy, filedAt: str(r.created_at), group, by, status: str(r?.result?.delivery) === 'undeliverable' ? 'undeliverable' : 'waiting',
    })
  }

  for (const l of loops) {
    const ev = l.evidence || {}
    const hours = (now - Date.parse(l.first_seen)) / 3600000
    const late = l.kind === 'guest_ask' ? hours >= 4 : hours >= 48
    const links: NeedLink[] = [{ label: 'Slack thread', kind: 'slack', href: `https://slack.com/archives/${l.channel}/p${str(l.msg_ts).replace('.', '')}${l.thread_ts && l.thread_ts !== l.msg_ts ? `?thread_ts=${l.thread_ts}&cid=${l.channel}` : ''}` }]
    const what: { label: string; text: string }[] = []
    if (ev.text) what.push({ label: 'What was said' + (ev.who ? ' — ' + str(ev.who) : ''), text: str(ev.text) })
    if (ev.guest) what.push({ label: 'Guest', text: str(ev.guest) + (ev.ask ? ' · asks for ' + str(ev.ask) : '') + (ev.amount ? ' · $' + str(ev.amount) : '') })
    let reservationId: string | null = ev.reservationId ? str(ev.reservationId) : null
    let listingId: string | null = null
    if (ev.taskId) {
      const t = taskInfo[str(ev.taskId)]
      links.push({ label: 'Breezeway task', href: 'https://app.breezeway.io/task/' + str(ev.taskId), kind: 'task' })
      if (t) { what.push({ label: 'Matched task', text: `${t.name} — ${t.status || 'open'}${t.assignees.length ? ' · ' + t.assignees.join(', ') : ' · nobody assigned'}` }); listingId = t.listingId || null }
    } else what.push({ label: 'Task', text: 'No Breezeway task matched to this yet.' })
    if (ev.glitchId) {
      const g = glitchInfo[str(ev.glitchId)]
      links.push({ label: 'Glitch', href: '/glitches?q=' + encodeURIComponent(l.unit || (g ? g.overview : '')), kind: 'glitch' })
      if (g) { what.push({ label: 'Glitch', text: `${g.overview} — ${g.status || 'open'}` }); reservationId = reservationId || g.reservationId; listingId = listingId || g.listingId || null }
    }
    if (ev.conversationId) links.push({ label: 'Guest thread', href: '/messages/' + str(ev.conversationId), kind: 'thread' })
    if (ev.guestTold) what.push({ label: 'Guest told', text: 'We replied to the guest' + (ev.guestToldBy ? ' — ' + str(ev.guestToldBy) : '') + ' ' + str(ev.guestTold).slice(0, 16).replace('T', ' ') })
    if (ev.matchedBy) what.push({ label: 'How the task was matched', text: str(ev.matchedBy) })
    if (reservationId) links.unshift({ label: 'Booking', href: '/reservations/' + reservationId, kind: 'booking' })
    const urgency: Urgency = l.urgent ? 'now' : l.kind === 'guest_ask' && late ? 'now' : late ? 'today' : 'today'
    needs.push({
      id: str(l.id), source: 'loop', action: 'loop', title: clip(str(l.summary), 140),
      subtitle: [l.unit || l.building, l.channel_name ? '#' + l.channel_name : ''].filter(Boolean).join(' · '),
      what, why: late ? `Open ${hours < 48 ? Math.round(hours) + 'h' : Math.round(hours / 24) + 'd'} — past its limit for a ${l.kind === 'guest_ask' ? 'guest ask (4h)' : 'loop (48h)'}` : `Open ${Math.round(hours)}h`,
      evidence: [], links, reservationId, listingId, unit: l.unit || null,
      urgency, urgencyWhy: l.urgent ? 'marked urgent' : late ? 'past its limit' : '', filedAt: str(l.first_seen), group: null, by: 'slack', status: 'open',
      loopKind: str(l.kind), owner: l.owner_name || null,
    })
  }

  // ONE PER THING: the watches re-file the same proposal each time they run (three drafts to one
  // guest). Keep the newest per action + thread / task / unit + title; the older ones are dropped.
  const seen = new Map<string, Need>()
  const deduped: Need[] = []
  for (const n of needs.slice().sort((a, b) => String(b.filedAt).localeCompare(String(a.filedAt)))) {
    if (n.source !== 'proposal') { deduped.push(n); continue }
    const thread = n.links.find(l => l.kind === 'thread')?.href || ''
    const task = n.links.find(l => l.kind === 'task')?.href || ''
    const key = n.action + '|' + (thread || task || (n.listingId || '') + '|' + n.title.toLowerCase())
    const kept = seen.get(key)
    if (kept) { (kept.dupes = kept.dupes || []).push(n.id); continue }
    seen.set(key, n); deduped.push(n)
  }
  needs.length = 0; needs.push(...deduped)
  needs.sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || (a.source === 'loop' ? -1 : 0) - (b.source === 'loop' ? -1 : 0) || String(b.filedAt).localeCompare(String(a.filedAt)))
  return { needs, partial }
}
