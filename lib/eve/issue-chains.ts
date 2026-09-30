// EVERY GUEST ISSUE, FOLLOWED TO DONE (Jon, 2026-09-30).
//
// "Guest reports an issue: we got to check to see if a task is created. There's a glitch created in
// the glitch board, if the task has been assigned to a person that's actively working, and then we
// need to stay on top of it. The more urgent the issue is, the more intuitive it needs to be."
//
// One chain per issue, the same seven links every time:
//   reported → glitch filed → Breezeway task → someone assigned → work started → fixed → guest told
// A missing link is the next thing to do, and it is named. Sources:
//   • glitches (open, or closed in the last 3 days) with their Breezeway task
//   • Slack problems / guest asks Eve is keeping tabs on that have no glitch (loop-match has already
//     tied some of them to a Breezeway task)
//   • guest threads the sentiment scan flagged unhappy in the last 3 days with no glitch on the stay
// Urgency: NOW when the guest is in the unit and the issue is one that ruins a stay (A/C, water,
// lock-out, power, pests, safety) or has sat 4h+ unstarted; TODAY when the guest is in the unit or
// arriving within a day; WEEK otherwise.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { NeedLink } from './needs'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const INTERNAL = new Set(['log', 'note', 'notes', 'internal', 'internal_note', 'activity', 'system'])
const SEVERE = /\b(a\/?c|air ?con|hvac|no (hot )?water|leak|flood|lock(ed)? ?out|door code|keypad|no power|electric|smoke|fire|gas|pest|roach|bed ?bug|mice|rat|injur|safety|security|mold|sewage|toilet)\b/i

export type Step = { key: string; label: string; state: 'done' | 'missing' | 'waiting' | 'na'; detail: string }
export type IssueChain = {
  id: string
  source: 'glitch' | 'slack' | 'sentiment'
  title: string
  unit: string | null
  guest: string | null
  reportedAt: string
  inHouse: boolean
  arriving: boolean
  severe: boolean
  urgency: 'now' | 'today' | 'week' | 'done'
  urgencyWhy: string
  next: string | null
  steps: Step[]
  links: NeedLink[]
  reservationId: string | null
  assignees: string[]
  /** slack issues: Eve's investigation of which task/glitch belongs to the report */
  investigation?: { method: string; confidence: number; reasoning: string; taskId: string | null; glitchId: string | null; stillOpen: string | null; nextStep: string | null; unit: string | null; pinned: boolean } | null
}

export async function loadIssueChains(): Promise<{ issues: IssueChain[]; partial: boolean }> {
  const db = supabaseAdmin()
  const now = Date.now()
  const today = new Date().toISOString().slice(0, 10)
  const since3 = new Date(now - 3 * 86400000).toISOString()
  let partial = false

  let glitches: any[] = []
  try {
    const { data } = await db.from('glitches').select('*').order('created_at', { ascending: false }).limit(300)
    glitches = ((data as any[]) || []).filter(g => !/closed|done|resolved/i.test(str(g.status)) || str(g.closed_at || g.updated_at) >= since3)
  } catch { partial = true }

  let loops: any[] = []
  try {
    const { data } = await db.from('eve_slack_items').select('id,kind,summary,unit,owner_name,urgent,first_seen,channel,channel_name,msg_ts,thread_ts,evidence,tracked_in')
      .eq('status', 'open').in('kind', ['problem', 'guest_ask']).limit(400)
    // A GUEST issue: tied to a unit or a named guest, or saying "guest". "Two housekeepers resigned"
    // is a real problem, but not one this chain is about — it stays on Watching.
    loops = ((data as any[]) || []).filter(l => !l?.evidence?.glitchId && l?.evidence?.weight !== 'small'
      && (l.kind === 'problem' || ['refund', 'change', 'callback'].indexOf(str(l?.evidence?.ask)) < 0)
      && (!!l.unit || !!l?.evidence?.guest || /\bguest/i.test(str(l.summary))))
  } catch { partial = true }

  let unhappy: any[] = []
  try {
    const { data } = await db.from('guesty_conversation_sentiment').select('conversation_id,reservation_id,listing_id,guest_name,top_issue,reason,guest_excerpt,dissatisfied,status,last_guest_at,scanned_at')
      .eq('dissatisfied', true).gte('last_guest_at', since3).limit(200)
    const withGlitch = new Set(glitches.map(g => str(g.reservation_id)).filter(Boolean))
    unhappy = ((data as any[]) || []).filter(s => !/closed/i.test(str(s.status)) && !(s.reservation_id && withGlitch.has(str(s.reservation_id))))
  } catch { /* sentiment table optional */ }

  // Tasks, bookings, listing names, and the last real host message per thread.
  const taskIds = new Set<string>(), resIds = new Set<string>(), convIds = new Set<string>(), listingIds = new Set<string>()
  for (const g of glitches) { if (g.breezeway_task_id) taskIds.add(str(g.breezeway_task_id)); if (g.reservation_id) resIds.add(str(g.reservation_id)); if (g.conversation_id) convIds.add(str(g.conversation_id)); if (g.listing_id) listingIds.add(str(g.listing_id)) }
  for (const l of loops) { if (l?.evidence?.taskId) taskIds.add(str(l.evidence.taskId)); if (l?.evidence?.conversationId) convIds.add(str(l.evidence.conversationId)) }
  for (const s of unhappy) { if (s.reservation_id) resIds.add(str(s.reservation_id)); convIds.add(str(s.conversation_id)); if (s.listing_id) listingIds.add(str(s.listing_id)) }

  const tasks: Record<string, any> = {}, res: Record<string, any> = {}, names: Record<string, string> = {}
  const convRes: Record<string, string> = {}
  await Promise.all([
    taskIds.size ? db.from('breezeway_tasks_sync').select('id,name,status,assignees,started_at,finished_at').in('id', Array.from(taskIds).slice(0, 400))
      .then(({ data }: any) => { for (const t of data || []) tasks[str(t.id)] = t }, () => { partial = true }) : null,
    convIds.size ? db.from('guesty_conversations').select('id,reservation_id').in('id', Array.from(convIds).slice(0, 400))
      .then(({ data }: any) => { for (const c of data || []) if (c.reservation_id) { convRes[str(c.id)] = str(c.reservation_id); resIds.add(str(c.reservation_id)) } }, () => { /* fine */ }) : null,
  ])
  // Glitches filed without a conversation: find the guest's thread through the booking.
  const resConv: Record<string, string> = {}
  if (resIds.size) {
    try {
      const [{ data: rs }, { data: cs }] = await Promise.all([
        db.from('guesty_reservations').select('id,guest_name,check_in,check_out,listing_id,status').in('id', Array.from(resIds).slice(0, 400)),
        db.from('guesty_conversations').select('id,reservation_id').in('reservation_id', Array.from(resIds).slice(0, 400)),
      ])
      for (const r of (rs as any[]) || []) { res[str(r.id)] = r; if (r.listing_id) listingIds.add(str(r.listing_id)) }
      for (const c of (cs as any[]) || []) { resConv[str(c.reservation_id)] = str(c.id); convIds.add(str(c.id)) }
    } catch { partial = true }
  }
  if (listingIds.size) {
    try { const { data } = await db.from('guesty_listings').select('id,nickname,title').in('id', Array.from(listingIds).slice(0, 400)); for (const l of (data as any[]) || []) names[str(l.id)] = str(l.nickname || l.title) } catch { /* names are a nicety */ }
  }
  const hostMsgs: Record<string, { at: string; by: string }[]> = {}
  if (convIds.size) {
    try {
      const { data } = await db.from('guesty_messages').select('conversation_id,sent_at,sender_name,module,is_automated').in('conversation_id', Array.from(convIds).slice(0, 400))
        .eq('sender', 'host').gte('sent_at', new Date(now - 30 * 86400000).toISOString()).limit(5000)
      for (const m of (data as any[]) || []) {
        if (INTERNAL.has(str(m.module).toLowerCase()) || m.is_automated === true) continue
        ;(hostMsgs[str(m.conversation_id)] = hostMsgs[str(m.conversation_id)] || []).push({ at: str(m.sent_at), by: str(m.sender_name) })
      }
    } catch { partial = true }
  }
  const toldAfter = (conv: string | null, after: string) => {
    if (!conv) return null
    const xs = (hostMsgs[conv] || []).filter(m => m.at > after).sort((a, b) => a.at.localeCompare(b.at))
    return xs[0] || null
  }
  const stay = (rid: string | null, ci?: any, co?: any) => {
    const r = rid ? res[rid] : null
    const inD = str(r?.check_in || ci).slice(0, 10), outD = str(r?.check_out || co).slice(0, 10)
    const tomorrow = new Date(now + 86400000).toISOString().slice(0, 10)
    return { inHouse: !!inD && inD <= today && outD > today, arriving: !!inD && inD > today && inD <= tomorrow, guest: r ? str(r.guest_name) : '' }
  }
  const taskSteps = (tid: string | null): { steps: Step[]; assignees: string[]; started: boolean; finished: boolean } => {
    const t = tid ? tasks[tid] : null
    const assignees: string[] = t && Array.isArray(t.assignees) ? t.assignees.map((a: any) => str(a?.name || a)).filter(Boolean) : []
    const finished = !!t && (!!t.finished_at || /complete|finish|close|approv/i.test(str(t.status)))
    const started = !!t && (finished || !!t.started_at || /progress|started/i.test(str(t.status)))
    return {
      assignees, started, finished,
      steps: [
        { key: 'task', label: 'Breezeway task', state: tid ? 'done' : 'missing', detail: t ? str(t.name) : tid ? 'task ' + tid : 'no task created' },
        { key: 'assigned', label: 'Someone on it', state: !tid ? 'na' : assignees.length ? 'done' : 'missing', detail: assignees.length ? assignees.join(', ') : tid ? 'nobody assigned' : '' },
        { key: 'started', label: 'Work started', state: !tid ? 'na' : started ? 'done' : 'waiting', detail: started ? (t?.started_at ? 'started ' + str(t.started_at).slice(5, 16).replace('T', ' ') : 'in progress') : 'not started' },
        { key: 'fixed', label: 'Fixed', state: !tid ? 'na' : finished ? 'done' : 'waiting', detail: finished ? 'finished ' + str(t?.finished_at || '').slice(5, 16).replace('T', ' ') : 'not yet' },
      ],
    }
  }
  const nextOf = (steps: Step[]) => {
    const m = steps.find(s => s.state === 'missing')
    if (m) return m.key === 'glitch' ? 'File a glitch' : m.key === 'task' ? 'Create the Breezeway task' : m.key === 'assigned' ? 'Assign someone' : m.key === 'told' ? 'Tell the guest' : m.label
    if (steps.some(s => s.key === 'fixed' && s.state === 'done')) return null
    const w = steps.find(s => s.state === 'waiting')
    return w ? (w.key === 'started' ? 'Waiting for work to start' : w.key === 'fixed' ? 'Waiting for the fix' : w.label) : null
  }
  const judge = (c: Omit<IssueChain, 'urgency' | 'urgencyWhy' | 'next'>, ageH: number, closed: boolean): Pick<IssueChain, 'urgency' | 'urgencyWhy' | 'next'> => {
    const next = nextOf(c.steps)
    if (closed || !next) return { urgency: 'done', urgencyWhy: closed ? 'closed' : 'every step done', next: null }
    const notStarted = c.steps.some(s => (s.key === 'started' && s.state !== 'done') || s.key === 'task' && s.state === 'missing')
    if (c.inHouse && (c.severe || (notStarted && ageH >= 4))) return { urgency: 'now', urgencyWhy: c.severe ? 'guest is in the unit and this ruins a stay' : `guest in the unit, ${Math.round(ageH)}h with no work started`, next }
    if (c.inHouse || c.arriving) return { urgency: 'today', urgencyWhy: c.inHouse ? 'guest is in the unit' : 'guest arrives within a day', next }
    return { urgency: 'week', urgencyWhy: 'no guest in the unit', next }
  }

  const out: IssueChain[] = []
  for (const g of glitches) {
    const rid = g.reservation_id ? str(g.reservation_id) : null
    const conv = g.conversation_id ? str(g.conversation_id) : (rid ? resConv[rid] || null : null)
    const st = stay(rid, g.check_in, g.check_out)
    const unit = str(g.unit) || names[str(g.listing_id)] || null
    const tid = g.breezeway_task_id ? str(g.breezeway_task_id) : null
    const ts = taskSteps(tid)
    const created = str(g.created_at)
    const told = toldAfter(conv, created)
    const closed = /closed|done|resolved/i.test(str(g.status))
    const steps: Step[] = [
      { key: 'reported', label: 'Reported', state: 'done', detail: (str(g.reported_via) || 'reported') + ' ' + created.slice(5, 16).replace('T', ' ') },
      { key: 'glitch', label: 'Glitch filed', state: 'done', detail: 'glitch — ' + (str(g.status) || 'open') },
      ...ts.steps,
      { key: 'told', label: 'Guest told', state: told ? 'done' : conv ? 'missing' : 'na', detail: told ? 'replied ' + told.at.slice(5, 16).replace('T', ' ') + (told.by ? ' — ' + told.by : '') : conv ? 'no reply since it was filed' : 'no guest thread linked' },
    ]
    const links: NeedLink[] = [{ label: 'Glitch', href: '/glitches?q=' + encodeURIComponent(unit || str(g.guest_name)), kind: 'glitch' }]
    if (rid) links.push({ label: 'Booking', href: '/reservations/' + rid, kind: 'booking' })
    if (tid) links.push({ label: 'Breezeway task', href: 'https://app.breezeway.io/task/' + tid, kind: 'task' })
    if (conv) links.push({ label: 'Guest thread', href: '/messages/' + conv, kind: 'thread' })
    const base = { id: 'g:' + str(g.id), source: 'glitch' as const, title: str(g.overview) || str(g.category) || 'Guest issue', unit, guest: str(g.guest_name) || st.guest || null, reportedAt: created, inHouse: st.inHouse, arriving: st.arriving, severe: SEVERE.test(str(g.overview) + ' ' + str(g.category)), steps, links, reservationId: rid, assignees: ts.assignees }
    out.push({ ...base, ...judge(base, (now - Date.parse(created)) / 3600000, closed) })
  }
  for (const l of loops) {
    const ev = l.evidence || {}
    const tid = ev.taskId ? str(ev.taskId) : null
    const ts = taskSteps(tid)
    const conv = ev.conversationId ? str(ev.conversationId) : null
    const rid = conv ? convRes[conv] || null : null
    const st = stay(rid)
    const steps: Step[] = [
      { key: 'reported', label: 'Reported', state: 'done', detail: 'Slack #' + str(l.channel_name) + (ev.who ? ' — ' + str(ev.who) : '') },
      { key: 'glitch', label: 'Glitch filed', state: l.kind === 'problem' && (st.inHouse || ev.guest) ? 'missing' : 'na', detail: 'no glitch on the board' },
      ...ts.steps,
      { key: 'told', label: 'Guest told', state: ev.guestTold ? 'done' : l.kind === 'guest_ask' ? 'missing' : 'na', detail: ev.guestTold ? 'replied ' + str(ev.guestTold).slice(5, 16).replace('T', ' ') : l.kind === 'guest_ask' ? 'no reply found' : '' },
    ]
    const links: NeedLink[] = [{ label: 'Slack thread', kind: 'slack', href: `https://slack.com/archives/${l.channel}/p${str(l.msg_ts).replace('.', '')}${l.thread_ts && l.thread_ts !== l.msg_ts ? `?thread_ts=${l.thread_ts}&cid=${l.channel}` : ''}` }]
    if (rid) links.push({ label: 'Booking', href: '/reservations/' + rid, kind: 'booking' })
    if (tid) links.push({ label: 'Breezeway task', href: 'https://app.breezeway.io/task/' + tid, kind: 'task' })
    if (conv) links.push({ label: 'Guest thread', href: '/messages/' + conv, kind: 'thread' })
    const iv = ev.investigation || null
    if (iv && !tid && iv.taskId) steps[2] = { ...steps[2], detail: 'possible: task ' + str(iv.taskId) + ' (' + Math.round((Number(iv.confidence) || 0) * 100) + '% sure — confirm)' }
    const investigation = iv ? { method: str(iv.method), confidence: Number(iv.confidence) || 0, reasoning: str(iv.reasoning), taskId: iv.taskId || null, glitchId: iv.glitchId || null, stillOpen: iv.stillOpen || null, nextStep: iv.nextStep || null, unit: iv.unit || null, pinned: !!ev.taskId } : null
    const base = { investigation, id: 's:' + str(l.id), source: 'slack' as const, title: str(l.summary), unit: l.unit || null, guest: str(ev.guest) || st.guest || null, reportedAt: str(l.first_seen), inHouse: st.inHouse || !!l.urgent, arriving: st.arriving, severe: !!l.urgent || SEVERE.test(str(l.summary)), steps, links, reservationId: rid, assignees: ts.assignees }
    out.push({ ...base, ...judge(base, (now - Date.parse(str(l.first_seen))) / 3600000, false) })
  }
  for (const s of unhappy) {
    const rid = s.reservation_id ? str(s.reservation_id) : convRes[str(s.conversation_id)] || null
    const st = stay(rid)
    const at = str(s.last_guest_at || s.scanned_at)
    const told = toldAfter(str(s.conversation_id), at)
    const steps: Step[] = [
      { key: 'reported', label: 'Reported', state: 'done', detail: 'unhappy in messages' + (s.guest_excerpt ? ' — “' + str(s.guest_excerpt).slice(0, 80) + '”' : '') },
      { key: 'glitch', label: 'Glitch filed', state: 'missing', detail: 'no glitch on this stay' },
      { key: 'task', label: 'Breezeway task', state: 'na', detail: '' },
      { key: 'told', label: 'Guest told', state: told ? 'done' : 'missing', detail: told ? 'replied ' + told.at.slice(5, 16).replace('T', ' ') : 'no reply since' },
    ]
    const links: NeedLink[] = [{ label: 'Guest thread', href: '/messages/' + str(s.conversation_id), kind: 'thread' }]
    if (rid) links.push({ label: 'Booking', href: '/reservations/' + rid, kind: 'booking' })
    links.push({ label: 'Sentiment board', href: '/messages?tab=sentiment', kind: 'page' })
    const unit = names[str(s.listing_id)] || (rid && res[rid] ? names[str(res[rid].listing_id)] : '') || null
    const base = { id: 'm:' + str(s.conversation_id), source: 'sentiment' as const, title: str(s.top_issue || s.reason) || 'Guest unhappy in messages', unit, guest: st.guest || str(s.guest_name) || null, reportedAt: at, inHouse: st.inHouse, arriving: st.arriving, severe: SEVERE.test(str(s.top_issue) + ' ' + str(s.reason)), steps, links, reservationId: rid, assignees: [] }
    out.push({ ...base, ...judge(base, (now - Date.parse(at)) / 3600000, false) })
  }
  const RANK = { now: 0, today: 1, week: 2, done: 3 } as const
  out.sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || String(b.reportedAt).localeCompare(String(a.reportedAt)))
  return { issues: out.slice(0, 150), partial }
}
