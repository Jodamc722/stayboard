// ONE INBOX (2026-11-10). Everything Eve needs from a person, as ONE typed, ranked list.
//
// Until now the things she needed a person for lived in seven pipes, each with its own page and its
// own decide endpoint: proposals and drafts in eve_actions, guest reply drafts (eve_actions kind
// 'guest_draft'), questions in eve_questions, plans in eve_recommendations, findings in eve_audits,
// Slack loops in eve_slack_items and the expectation notes. The same thing could show in four places.
// This module is a READ MODEL over those tables — no new table — and a dispatcher that hands each
// decision to the library function the old route already called. It never decides who may approve
// what: the POST route runs the same gate the old route ran, and the functions below are the old
// routes' own logic, moved here so both paths share one copy.
//
//   item.id      '<kind>:<rowid>' — expectation notes and audit findings are both 'note', so their
//                row id carries a prefix ('note:exp-<id>', 'note:audit-<id>')
//   rank         guest-impacting AND time-bound first, then guest-impacting OR time-bound, then money,
//                then everything else; within a bucket the most urgent level, then the oldest
//   dedupe       the same guest thread / review / Breezeway task seen in two pipes is one row: the
//                more actionable pipe keeps it (draft > proposal > loop > question > plan > note) and
//                the other is listed under `also`
//   thoughts     ("she would have done …") are kind 'decide' and appear only when asked for
//                (?kind=decide), never in the main list
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isSuperadmin, type Access } from '@/lib/access'
import { atLeast } from '@/lib/features'
import { isVrLogin } from '@/lib/vr-gate'
import { canUseEve } from '@/lib/eve/run'
import { bustDay } from '@/lib/bust'
import { loadNeeds, type Need } from './needs'

const str = (v: any): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const clip = (s: any, n: number) => { const t = str(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

export type InboxKind = 'approve' | 'answer' | 'decide' | 'review_draft' | 'loop' | 'plan' | 'note'
export const INBOX_KINDS: InboxKind[] = ['approve', 'review_draft', 'loop', 'answer', 'plan', 'note', 'decide']
export const KIND_LABEL: Record<InboxKind, string> = {
  approve: 'Wants a yes', review_draft: 'Reply draft', loop: 'Slack loop', answer: 'Question', plan: 'Plan', note: 'Note', decide: 'Would have done',
}
export type InboxLevel = 'now' | 'today' | 'week' | 'later'
export type InboxAction = {
  key: string
  label: string
  style: 'primary' | 'secondary' | 'danger'
  /** A link instead of a POST (open the Slack thread, the Expectations desk). */
  href?: string
  /** The action takes text: an answer, or the edited draft. */
  input?: 'answer' | 'draft' | 'note'
  confirm?: string
}
export type InboxItem = {
  id: string
  kind: InboxKind
  rowId: string
  title: string
  why: string
  unit: string | null
  building: string | null
  urgency: { level: InboxLevel; reason: string; guest: boolean; money: boolean; due: string | null; ageHours: number }
  created_at: string
  /** Where it came from — 'proposal', 'guest draft', 'slack', 'question', 'review plan', 'expectations', 'audit', 'thought'. */
  source: string
  actions: InboxAction[]
  /** False when the viewer may see it but not decide it (the old pages showed it the same way). */
  canAct: boolean
  /** The action key bulk "clear stale" uses. */
  dismissKey: string
  stale: boolean
  detail: { label: string; text: string }[]
  links: { label: string; href: string; kind: string }[]
  /** The text an input action starts from (the draft she wrote). */
  draft?: string | null
  group?: { key: string; label: string } | null
  /** Older copies of the same proposal, declined with it (what Needs you did). */
  dupes?: string[]
  /** The same thing in another pipe — shown, not decided with this row. */
  also?: { id: string; kind: InboxKind; source: string; title: string }[]
  reservationId?: string | null
}

// ── Who sees what (the read gates of the old GET routes, as booleans) ───────────────────────────
export type InboxViewer = {
  email: string
  eve: boolean            // eveGate + isVrLogin: proposals, questions, plans, audits (needs / questions / recommendations / audits GET)
  eveAny: boolean         // eveGate alone: expectation notes (expectations GET)
  admin: boolean          // requireAdmin('admin'): approve / reject a proposal (agent POST)
  vrAdmin: boolean        // requireVrAdmin('admin'): thoughts (thoughts GET / POST)
  loopsView: boolean      // requireLevel('loops','view')
  loopsEdit: boolean      // requireLevel('loops','edit'): close / dismiss (loops PATCH)
  msgsView: boolean; msgsEdit: boolean
  reviewsView: boolean; reviewsEdit: boolean
  expEdit: boolean        // the expectations route's edit rule
}

/** The expectations route's edit rule — written once, used by that route and by the inbox. */
export function canEditExpectations(a: Pick<Access, 'email' | 'role' | 'levels'>): boolean {
  return isSuperadmin(a.email) || a.role === 'admin' || atLeast(a.levels?.eve, 'edit')
}

export function viewerOf(a: Access): InboxViewer {
  const admin = isSuperadmin(a.email) || a.role === 'admin'
  const vr = isVrLogin(a)
  const eveAny = !!a.user && a.allowed && canUseEve(a)
  return {
    email: str(a.email).toLowerCase(),
    eve: eveAny && vr, eveAny, admin, vrAdmin: admin && vr,
    loopsView: atLeast(a.levels?.loops, 'view'), loopsEdit: atLeast(a.levels?.loops, 'edit'),
    msgsView: atLeast(a.levels?.messages, 'view'), msgsEdit: atLeast(a.levels?.messages, 'edit'),
    reviewsView: atLeast(a.levels?.reviews, 'view'), reviewsEdit: atLeast(a.levels?.reviews, 'edit'),
    expEdit: canEditExpectations(a),
  }
}

// ── Ranking ────────────────────────────────────────────────────────────────────────────────────
const LEVEL_RANK: Record<InboxLevel, number> = { now: 0, today: 1, week: 2, later: 3 }
function bucketOf(i: InboxItem): number {
  if (i.stale) return 9
  const timeBound = i.urgency.level === 'now' || i.urgency.level === 'today' || !!i.urgency.due
  if (i.urgency.guest && timeBound) return 0
  if (i.urgency.guest || timeBound) return 1
  if (i.urgency.money) return 2
  return 3
}
export function rankItems(items: InboxItem[]): InboxItem[] {
  return items.slice().sort((a, b) =>
    bucketOf(a) - bucketOf(b)
    || LEVEL_RANK[a.urgency.level] - LEVEL_RANK[b.urgency.level]
    || (a.urgency.due && b.urgency.due ? a.urgency.due.localeCompare(b.urgency.due) : a.urgency.due ? -1 : b.urgency.due ? 1 : 0)
    || b.urgency.ageHours - a.urgency.ageHours)
}

const ageH = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 3600000)) : 0 }
const MONEY = /refund|\$\s?\d|deposit|charge|invoice|discount|comp\b|credit|payout|revenue|claim/i

// ── Dedupe ─────────────────────────────────────────────────────────────────────────────────────
const KEEP_ORDER: Record<InboxKind, number> = { review_draft: 0, approve: 1, loop: 2, answer: 3, plan: 4, note: 5, decide: 6 }
function thingKeys(i: InboxItem & { _keys?: string[] }): string[] { return i._keys || [] }
const normTitle = (s: string) => str(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

export function dedupeItems(items: (InboxItem & { _keys?: string[] })[]): InboxItem[] {
  // Who keeps the row: a live one over an out-of-date one, one this viewer can decide over one they
  // cannot, then the more actionable pipe, then the newest.
  const ordered = items.slice().sort((a, b) =>
    Number(a.stale) - Number(b.stale) || Number(b.canAct) - Number(a.canAct)
    || KEEP_ORDER[a.kind] - KEEP_ORDER[b.kind] || String(b.created_at).localeCompare(String(a.created_at)))
  const owner = new Map<string, InboxItem>()
  const out: InboxItem[] = []
  for (const it of ordered) {
    const keys = thingKeys(it).concat(it.kind === 'answer' || it.kind === 'plan' ? ['title:' + normTitle(it.title)] : [])
    // Only across pipes: two rows of the same kind stay two rows (the proposal copies are already
    // folded by loadNeeds, and two drafts to one guest are two different texts).
    const kept = keys.map(k => owner.get(k)).find(k => k && k.kind !== it.kind)
    if (kept) { (kept.also = kept.also || []).push({ id: it.id, kind: it.kind, source: it.source, title: it.title }); continue }
    for (const k of keys) if (!owner.has(k)) owner.set(k, it)
    const { _keys, ...clean } = it as any
    void _keys
    out.push(clean as InboxItem)
  }
  return out
}

// ── The pipes, each turned into items ─────────────────────────────────────────────────────────
function fromNeed(n: Need, v: InboxViewer): InboxItem & { _keys?: string[] } {
  const keys: string[] = []
  for (const l of n.links) {
    if (l.kind === 'thread') keys.push('thread:' + l.href.replace(/^\/inbox\//, ''))
    // A loop's "Possible task" is her guess, not a match — never a reason to fold two rows.
    if (l.kind === 'task' && l.label !== 'Possible task') keys.push('task:' + l.href.replace(/^.*\/task\//, ''))
  }
  const stale = n.group?.key === 'stale'
  if (n.source === 'loop') {
    const slack = n.links.find(l => l.kind === 'slack')
    const canAct = v.loopsEdit
    const actions: InboxAction[] = []
    if (canAct) actions.push({ key: 'close', label: 'Done — close it', style: 'primary' }, { key: 'dismiss', label: 'Not a real loop', style: 'danger' })
    if (slack) actions.push({ key: 'open', label: 'Open in Slack', style: 'secondary', href: slack.href })
    const guest = n.loopKind === 'guest_ask'
    return {
      id: 'loop:' + n.id, kind: 'loop', rowId: n.id, title: n.title, why: n.why, unit: n.unit, building: null,
      urgency: { level: n.urgency, reason: n.urgencyWhy || (guest ? 'a guest asked' : ''), guest, money: n.what.some(w => /\$/.test(w.text)), due: null, ageHours: ageH(n.filedAt) },
      created_at: n.filedAt, source: 'slack' + (n.subtitle.includes('#') ? ' · ' + n.subtitle.split(' · ').filter(s => s.startsWith('#')).join('') : ''),
      actions, canAct, dismissKey: 'dismiss', stale: false, detail: n.what, links: n.links, group: null, reservationId: n.reservationId,
      _keys: keys,
    }
  }
  const guestish = /guest_reply|guest_notice/.test(n.action) || /guest|arriv|check.?in/i.test(n.title + ' ' + n.urgencyWhy)
  const money = MONEY.test(n.title + ' ' + n.why + ' ' + n.what.map(w => w.text).join(' ')) || n.action === 'guesty_write'
  const dueM = /\bon (\d{4}-\d{2}-\d{2})\b/.exec(n.what.map(w => w.text).join(' '))
  const draft = n.what.find(w => /reply she wrote|email|message/i.test(w.label))?.text || null
  const canAct = v.admin
  const actions: InboxAction[] = canAct
    ? (stale
      ? [{ key: 'reject', label: 'Clear — out of date', style: 'primary' }, { key: 'approve', label: 'Approve anyway', style: 'secondary', confirm: 'This is out of date. Approve it anyway?' }]
      : [{ key: 'approve', label: 'Approve', style: 'primary' }, { key: 'reject', label: 'Decline', style: 'danger', input: 'note' }])
    : []
  if (n.links[0]) actions.push({ key: 'open', label: 'Open ' + n.links[0].label, style: 'secondary', href: n.links[0].href })
  return {
    id: 'approve:' + n.id, kind: 'approve', rowId: n.id, title: n.title, why: [n.why, n.evidence.length ? n.evidence.join(' · ') : ''].filter(Boolean).join(' — '),
    unit: n.unit, building: null,
    urgency: { level: n.urgency, reason: n.urgencyWhy, guest: guestish && !stale, money, due: dueM ? dueM[1] : null, ageHours: ageH(n.filedAt) },
    created_at: n.filedAt, source: 'proposal' + (n.by ? ' · ' + n.by.replace(/^cron:/, '').replace(/^watch:/, 'watch ') : ''),
    actions, canAct, dismissKey: 'reject', stale, detail: n.what, links: n.links, draft, group: stale ? null : n.group, dupes: n.dupes, reservationId: n.reservationId,
    _keys: keys,
  }
}

export type GuestDraft = { id: string; conversationId: string | null; reviewId: string | null; draft: string; guest: string | null; unit: string | null; channel: string | null; why: string; by: string; createdAt: string; followedUp?: { at: string; by: string | null } }

function fromDraft(d: GuestDraft, v: InboxViewer): InboxItem & { _keys?: string[] } {
  const isReview = !d.conversationId && !!d.reviewId
  const canAct = isReview ? v.reviewsEdit : v.msgsEdit
  const answered = !!d.followedUp
  const who = (d.guest || 'Guest') + (d.unit ? ' · ' + d.unit : '')
  const actions: InboxAction[] = !canAct ? [] : answered
    ? [{ key: 'discard', label: 'Clear', style: 'primary' }]
    : [{ key: 'send', label: isReview ? 'Post reply' : 'Send', style: 'primary', input: 'draft', confirm: isReview ? `Post this public reply to ${d.guest || 'the guest'}'s review?` : `Send this to ${d.guest || 'the guest'} now?` },
       { key: 'discard', label: 'Discard', style: 'danger' }]
  const links: InboxItem['links'] = []
  if (d.conversationId) links.push({ label: 'Guest thread', href: '/inbox/' + d.conversationId, kind: 'thread' })
  if (d.reviewId) links.push({ label: 'Reviews', href: '/reviews', kind: 'review' })
  if (links[0]) actions.push({ key: 'open', label: 'Open ' + links[0].label.toLowerCase(), style: 'secondary', href: links[0].href })
  const keys: string[] = []
  if (d.conversationId) keys.push('thread:' + d.conversationId)
  if (d.reviewId) keys.push('review:' + d.reviewId)
  return {
    id: 'review_draft:' + d.id, kind: 'review_draft', rowId: d.id,
    title: (isReview ? 'Reply to review from ' : 'Reply to ') + who,
    why: answered ? 'Already answered' + (d.followedUp?.by ? ' by ' + d.followedUp.by : '') + ' — Eve wrote this before that' : [d.channel || '', d.why].filter(Boolean).join(' · '),
    unit: d.unit, building: null,
    urgency: { level: answered ? 'later' : isReview ? 'today' : 'now', reason: answered ? 'already answered' : isReview ? 'a public review is waiting for an answer' : 'a guest is waiting', guest: !answered, money: false, due: null, ageHours: ageH(d.createdAt) },
    created_at: d.createdAt, source: 'guest draft' + (d.by && d.by !== 'eve' ? ' · ' + d.by.replace(/^watch:/, 'watch ') : ''),
    actions, canAct, dismissKey: 'discard', stale: answered,
    detail: [{ label: isReview ? 'Public reply she wrote' : 'Reply she wrote', text: d.draft }], links, draft: d.draft, group: null,
    _keys: keys,
  }
}

function fromQuestion(q: any, v: InboxViewer): InboxItem & { _keys?: string[] } {
  const canAct = v.eve
  const assume = q?.evidence?.what_i_will_assume ? str(q.evidence.what_i_will_assume) : ''
  return {
    id: 'answer:' + str(q.id), kind: 'answer', rowId: str(q.id), title: clip(q.question, 200), why: str(q.why), unit: null,
    building: /^building:/.test(str(q.scope)) ? str(q.scope).slice(9) : null,
    urgency: { level: q.kind === 'conflict' ? 'today' : 'week', reason: q.kind === 'conflict' ? 'two sources disagree' : q.kind === 'plan' ? 'from the weekly review' : '', guest: false, money: MONEY.test(str(q.question)), due: null, ageHours: ageH(str(q.created_at)) },
    created_at: str(q.created_at), source: 'question' + (q.source === 'eve' ? ' · came up in conversation' : q.kind ? ' · ' + str(q.kind) : ''),
    actions: canAct ? [{ key: 'answer', label: 'Answer', style: 'primary', input: 'answer' }, { key: 'dismiss', label: 'Not worth answering', style: 'secondary' }] : [],
    canAct, dismissKey: 'dismiss', stale: false,
    detail: [q.question && str(q.question).length > 200 ? { label: 'Question', text: str(q.question) } : null, assume ? { label: 'If you say nothing, she assumes', text: assume } : null, { label: 'Scope', text: str(q.scope) || 'portfolio' }].filter(Boolean) as InboxItem['detail'],
    links: [], group: null,
  }
}

function fromPlan(p: any, v: InboxViewer): InboxItem & { _keys?: string[] } {
  const canAct = v.eve
  const first = (str(p.detail).match(/FIRST STEP:\s*([^\n]+)/) || [])[1] || ''
  return {
    id: 'plan:' + str(p.id), kind: 'plan', rowId: str(p.id), title: clip(p.title, 200), why: first ? 'First step: ' + first : 'Graded on ' + str(p.metric),
    unit: null, building: null,
    urgency: { level: 'week', reason: '', guest: false, money: /money|revenue|pricing/i.test(str(p.area)) || MONEY.test(str(p.title)), due: null, ageHours: ageH(str(p.created_at)) },
    created_at: str(p.created_at), source: p.review_id ? 'review plan' : 'recommendation' + (p.source ? ' · ' + str(p.source) : ''),
    actions: canAct ? [{ key: 'accept', label: 'Accept', style: 'primary' }, { key: 'reject', label: 'Reject', style: 'danger', input: 'note' }] : [],
    canAct, dismissKey: 'reject', stale: ageH(str(p.created_at)) > 21 * 24,
    detail: [p.detail ? { label: 'The plan', text: str(p.detail) } : null, { label: 'Graded on', text: `${str(p.metric)} (${str(p.scope) || 'portfolio'})` }].filter(Boolean) as InboxItem['detail'],
    links: [], group: null,
  }
}

function fromExpectation(n: any, v: InboxViewer): InboxItem & { _keys?: string[] } {
  const canAct = v.expEdit
  const actions: InboxAction[] = [{ key: 'open', label: 'Open the note', style: canAct ? 'primary' : 'secondary', href: '/eve?tab=expectations' }]
  if (canAct) actions.push({ key: 'done', label: 'Updated — copy is live', style: 'secondary' }, { key: 'dismiss', label: 'Not a gap', style: 'danger' })
  return {
    id: 'note:exp-' + str(n.id), kind: 'note', rowId: 'exp-' + str(n.id), title: clip(n.title, 200), why: str(n.gap || n.what_guests_hit),
    unit: null, building: str(n.building) || null,
    urgency: { level: n.priority === 1 ? 'week' : 'later', reason: `${Number(n.guests) || 0} guest${Number(n.guests) === 1 ? '' : 's'} hit this`, guest: false, money: /fee|deposit|charge/i.test(str(n.theme) + ' ' + str(n.title)), due: null, ageHours: ageH(str(n.first_seen)) },
    created_at: str(n.first_seen), source: 'expectations · ' + (n.owner === 'cs' ? 'CS' : 'admin'),
    actions, canAct, dismissKey: 'dismiss', stale: false,
    detail: [{ label: 'What guests hit', text: str(n.what_guests_hit) }, { label: 'Proposed copy', text: str(n.proposed_copy) }],
    links: [{ label: 'Expectations', href: '/eve?tab=expectations', kind: 'page' }], group: null,
  }
}

function fromAudit(a: any, v: InboxViewer): InboxItem & { _keys?: string[] } {
  const canAct = v.eve
  return {
    id: 'note:audit-' + str(a.id), kind: 'note', rowId: 'audit-' + str(a.id), title: clip(a.title, 200), why: str(a.detail),
    unit: null, building: null,
    urgency: { level: a.severity === 'critical' ? 'today' : 'week', reason: a.severity === 'critical' ? 'critical finding' : '', guest: a.area === 'guests', money: a.area === 'money', due: null, ageHours: ageH(str(a.first_seen_at)) },
    created_at: str(a.first_seen_at), source: 'audit · ' + str(a.area),
    actions: canAct ? [{ key: 'ack', label: 'Got it', style: 'primary' }, { key: 'snooze', label: 'Snooze a week', style: 'secondary' }] : [],
    canAct, dismissKey: 'snooze', stale: false,
    detail: [a.fix ? { label: 'Fix', text: str(a.fix) } : null, Number(a.count) > 1 ? { label: 'Count', text: str(a.count) } : null].filter(Boolean) as InboxItem['detail'],
    links: [], group: null,
  }
}

function fromThought(t: any, v: InboxViewer): InboxItem & { _keys?: string[] } {
  const canAct = v.vrAdmin
  const actions: InboxAction[] = canAct ? [{ key: 'do', label: 'Do it', style: 'primary', confirm: 'Run this once now, with your yes?' }, { key: 'dismiss', label: 'Not this', style: 'danger', input: 'note' }] : []
  if (canAct && str(t.source).startsWith('watch:')) actions.push({ key: 'ask_next_time', label: 'Ask me next time', style: 'secondary' })
  return {
    id: 'decide:' + str(t.id), kind: 'decide', rowId: str(t.id), title: clip(t.headline, 200), why: str(t.why), unit: str(t.payload?.unit) || null, building: null,
    urgency: { level: 'later', reason: 'she only observed', guest: false, money: false, due: null, ageHours: ageH(str(t.createdAt)) },
    created_at: str(t.createdAt), source: 'thought · ' + str(t.source).replace(/^watch:/, 'watch '),
    actions, canAct, dismissKey: 'dismiss', stale: false,
    detail: [t.draft ? { label: 'What she drafted', text: str(t.draft) } : null, (t.evidence || []).length ? { label: 'Evidence', text: (t.evidence as string[]).join('\n') } : null].filter(Boolean) as InboxItem['detail'],
    links: [], draft: t.draft || null, group: null,
  }
}

// ── Guest drafts: the list and the decision (moved from app/api/eve/guest-drafts, unchanged) ──
/** Every live draft the viewer's desk may see, newest first, with "already answered" marked. */
export async function listGuestDrafts(opts: { seesThreads: boolean; seesReviews: boolean; conversation?: string }): Promise<GuestDraft[]> {
  const conv = str(opts.conversation).trim()
  if (conv && !opts.seesThreads) return []
  try {
    let q = supabaseAdmin().from('eve_actions').select('id,payload,why,status,created_by,created_at').eq('kind', 'guest_draft').eq('status', 'proposed').order('created_at', { ascending: false }).limit(conv ? 1 : 40)
    if (conv) q = q.filter('payload->>conversationId', 'eq', conv)
    const { data, error } = await q
    if (error) return []
    const visible = ((data as any[]) || []).filter(r => (r.payload?.conversationId ? opts.seesThreads : opts.seesReviews))
    const drafts: GuestDraft[] = visible.map(r => ({
      id: str(r.id), conversationId: r.payload?.conversationId || null, reviewId: r.payload?.reviewId || null,
      draft: str(r.payload?.draft), guest: r.payload?.guest || null, unit: r.payload?.unit || null, channel: r.payload?.channel || null,
      why: str(r.why), by: r.payload?.by || r.created_by || 'eve', createdAt: r.created_at,
    }))
    // DID WE ALREADY FOLLOW UP? (Jon, 2026-10-16) — any draft with an outgoing message newer than the
    // draft is marked answered (not deleted), so Send cannot tell a guest a second time.
    const convIds = drafts.map(d => d.conversationId).filter(Boolean) as string[]
    if (convIds.length) {
      const { data: sent } = await supabaseAdmin()
        .from('guesty_messages').select('conversation_id,sent_at,sender_name,sender')
        .in('conversation_id', convIds).eq('sender', 'host')
        .order('sent_at', { ascending: false }).limit(400)
      const lastHost = new Map<string, { at: string; by: string }>()
      for (const m of (sent as any[]) || []) {
        const k = str(m.conversation_id)
        if (!lastHost.has(k)) lastHost.set(k, { at: str(m.sent_at), by: str(m.sender_name) })
      }
      for (const d of drafts) {
        const last = d.conversationId ? lastHost.get(str(d.conversationId)) : null
        if (last && Date.parse(last.at) > Date.parse(d.createdAt)) d.followedUp = { at: last.at, by: last.by || null }
      }
    }
    return drafts
  } catch { return [] }
}

/**
 * Send or discard one guest draft — the body of POST /api/eve/guest-drafts, moved here unchanged so
 * the inbox and the old route run one copy. The caller has already passed
 * requireAnyLevel(['messages','reviews'], 'edit'); this checks the desk the draft belongs to.
 */
export async function decideGuestDraft(input: { id: string; op: 'send' | 'discard'; body?: any; note?: any; by: string; levels: Record<string, any> }): Promise<{ status: number; json: any }> {
  const { id, op, by } = input
  const db = supabaseAdmin()
  const { data: row } = await db.from('eve_actions').select('id,payload,status').eq('id', id).eq('kind', 'guest_draft').maybeSingle()
  if (!row) return { status: 404, json: { error: 'that draft is no longer on file' } }
  if ((row as any).status !== 'proposed') return { status: 409, json: { error: `already ${(row as any).status}` } }
  const pl: any = (row as any).payload || {}
  const nowISO = new Date().toISOString()
  const isReview = !str(pl.conversationId) && !!str(pl.reviewId)
  if (!atLeast(input.levels[isReview ? 'reviews' : 'messages'], 'edit')) {
    return { status: 403, json: { error: `Your role needs edit access on ${isReview ? 'Reviews' : 'Messages'} to ${op} this draft.` } }
  }
  // CLAIM FIRST (2026-09-28): two presses a second apart must not message the guest twice.
  const { data: claim, error: claimErr } = await db.from('eve_actions')
    .update({ status: op === 'discard' ? 'rejected' : 'approved', decided_by: by, decided_at: nowISO })
    .eq('id', id).eq('status', 'proposed').select('id')
  if (claimErr) return { status: 500, json: { error: 'could not claim the draft: ' + claimErr.message } }
  if (!((claim as any[]) || []).length) return { status: 409, json: { error: 'someone else just acted on this draft' } }

  if (op === 'discard') {
    await db.from('eve_actions').update({ status: 'rejected', decided_by: by, decided_at: nowISO, result: { note: str(input.note).slice(0, 300) || 'discarded' } }).eq('id', id)
    const { logAgent } = await import('@/lib/eve/agent-mode')
    await logAgent({ action: 'guest_reply_draft', rung: 2, allowed: false, mode: 'observe', reason: `draft discarded by ${by}`, summary: `discarded draft to ${pl.guest || 'guest'}`, ref: id, by: 'chat', actor: by })
    bustDay()
    return { status: 200, json: { ok: true } }
  }

  if (isReview) {
    // A PUBLIC REVIEW REPLY: posted through the Reviews page's own path, with this person's yes.
    const text = str(input.body).trim() || str(pl.draft).trim()
    if (!text) return { status: 400, json: { error: 'nothing to send' } }
    const { postReviewReply } = await import('@/lib/review-reply')
    const out = await postReviewReply(str(pl.reviewId), text)
    const closed = !!out.body.closed
    const problem = out.ok ? '' : str(out.body.message || out.body.error || 'Guesty refused the reply')
    await db.from('eve_actions').update({ status: out.ok ? 'executed' : closed ? 'rejected' : 'failed', decided_by: by, decided_at: nowISO, executed_at: out.ok ? nowISO : null, result: { by, ok: out.ok, done: out.ok ? 'posted the public review reply' : undefined, error: problem || undefined, closed: closed || undefined, edited: text !== str(pl.draft).trim() } }).eq('id', id)
    const { logAgent } = await import('@/lib/eve/agent-mode')
    await logAgent({ action: 'guest_reply_draft', rung: 2, allowed: out.ok, mode: 'act', reason: out.ok ? `review reply posted by ${by} from the draft` : `review reply by ${by} not posted: ${problem}`, summary: out.ok ? `posted a public reply to ${pl.guest || 'a guest'}'s review` : `review reply not posted: ${problem}`, ref: str(pl.reviewId), by: 'chat', actor: by })
    if (out.ok) bustDay()   // reviews to answer are counted in the Command Center's cached day
    if (out.ok) return { status: 200, json: { ok: true, done: 'Posted the review reply' + (out.body.alreadyReplied ? ' (the channel already had one, so it is marked replied)' : '') + (out.body.saveError ? ' — ' + str(out.body.saveError) : '') } }
    return { status: closed ? 200 : out.status >= 400 ? out.status : 502, json: { ok: false, error: problem, closed: closed || undefined } }
  }

  const conversationId = str(pl.conversationId)
  if (!conversationId) return { status: 400, json: { error: 'This draft has no thread and no review to answer.' } }
  const text = str(input.body).trim() || str(pl.draft).trim()
  if (!text) return { status: 400, json: { error: 'nothing to send' } }
  const { runExecutor } = await import('@/lib/eve/executors')
  const { recordAgentAction, afterAct } = await import('@/lib/eve/agent-mode')
  const r = await runExecutor('guest_reply_send', { conversationId, body: text }, { by: 'chat', actor: by, human: true })
  await db.from('eve_actions').update({ status: r.ok ? 'executed' : 'failed', decided_by: by, decided_at: nowISO, executed_at: r.ok ? nowISO : null, result: { by, ok: r.ok, done: r.ok ? r.summary : undefined, error: r.error, edited: text !== str(pl.draft).trim() } }).eq('id', id)
  await recordAgentAction('guest_reply_send', { rung: 2, allowed: r.ok, mode: 'act', reason: r.ok ? `sent by ${by} from the draft` : `send by ${by} failed: ${r.error}`, summary: r.summary, ref: r.ref || id, by: 'chat', actor: by, countAs: r.ok ? 'action' : 'none' })
  // The thread leaves Needs reply now, not at the next guest-comms run (lib/response-times).
  if (r.ok) { try { const { refreshConversationStats } = await import('@/lib/response-times'); await refreshConversationStats(conversationId) } catch { /* the next run catches up */ } }
  if (r.ok) bustDay()   // …and the Command Center's cached day reads the same table
  if (r.ok) await afterAct('guest_reply_send', { ok: true, done: r.summary, ref: r.ref }, { by: str(pl.by || 'chat'), actor: by, summary: r.summary, metric: 'sentiment_negative' })
  // A "fixed" note sent for a glitch parks that glitch in manager_review (lib/glitch-complete).
  if (r.ok) { try { const { glitchIdOfDraft, requestGlitchCompletion } = await import('@/lib/glitch-complete'); const gid = glitchIdOfDraft(pl); if (gid) await requestGlitchCompletion(gid, by, `guest told via Eve's note, sent by ${by.split('@')[0]}`) } catch { /* the send stands */ } }
  return { status: r.ok ? 200 : 502, json: r.ok ? { ok: true, done: r.summary } : { ok: false, error: r.error || r.summary } }
}

// ── Slack loops: close / dismiss (moved from app/api/loops PATCH, unchanged) ────────────────────
/**
 * 'close' = it got done (a win for the person on it); 'dismiss' = not a real loop. The caller has
 * already passed requireLevel('loops', 'edit').
 */
export async function closeLoopItem(id: string, action: 'close' | 'dismiss', by: string, reasonIn?: any): Promise<{ status: number; json: any }> {
  const db = supabaseAdmin()
  const { data: it } = await db.from('eve_slack_items').select('*').eq('id', id).maybeSingle()
  if (!it) return { status: 404, json: { error: 'not found' } }
  const now = new Date().toISOString()
  const reason = action === 'dismiss' ? `dismissed by ${by}: ${String(reasonIn || 'not a real loop').slice(0, 120)}` : `${by}: ${String(reasonIn || 'done').slice(0, 120)}`
  const { error } = await db.from('eve_slack_items').update({ status: 'closed', closed_reason: reason, closed_at: now }).eq('id', id)
  return error ? { status: 500, json: { error: error.message } } : { status: 200, json: { ok: true } }
}

// ── The read model ────────────────────────────────────────────────────────────────────────────
export type InboxSummary = { total: number; counts: Record<InboxKind, number>; stale: number }
export type InboxResult = { items: InboxItem[]; summary: InboxSummary; partial: boolean; total: number }

/**
 * Build the inbox for one viewer. `kind` filters to one kind; 'decide' (her thoughts) is only ever
 * read when asked for. Every pipe is read in parallel and fails soft (partial: true).
 */
export async function loadInbox(v: InboxViewer, opts: { kind?: InboxKind | null; includeStale?: boolean } = {}): Promise<InboxResult> {
  const want = (k: InboxKind) => !opts.kind || opts.kind === k
  let partial = false
  const soft = async <T>(p: () => Promise<T>, fallback: T): Promise<T> => { try { return await p() } catch { partial = true; return fallback } }

  const [needs, drafts, questions, plans, exps, audits, thoughts, thoughtCount] = await Promise.all([
    (v.eve || v.loopsView) && (want('approve') || want('loop')) ? soft(() => loadNeeds(), { needs: [] as Need[], partial: true }) : Promise.resolve({ needs: [] as Need[], partial: false }),
    (v.msgsView || v.reviewsView) && want('review_draft') ? soft(() => listGuestDrafts({ seesThreads: v.msgsView, seesReviews: v.reviewsView }), [] as GuestDraft[]) : Promise.resolve([] as GuestDraft[]),
    v.eve && want('answer') ? soft(async () => { const { listQuestions } = await import('./questions'); return listQuestions('open', 60, { slim: true }) as Promise<any[]> }, [] as any[]) : Promise.resolve([] as any[]),
    v.eve && want('plan') ? soft(async () => {
      const { data, error } = await supabaseAdmin().from('eve_recommendations').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(40)
      if (error) return [] as any[]
      return ((data as any[]) || []).filter(r => r.kind !== 'action')
    }, [] as any[]) : Promise.resolve([] as any[]),
    v.eveAny && want('note') ? soft(async () => { const { listExpectations } = await import('./expectations'); return listExpectations('open', 60) as Promise<any[]> }, [] as any[]) : Promise.resolve([] as any[]),
    v.eve && want('note') ? soft(async () => { const { listAudits } = await import('./audit'); return (await listAudits({ status: 'open', limit: 60 })).filter(a => a.severity === 'critical' || a.severity === 'warn') as any[] }, [] as any[]) : Promise.resolve([] as any[]),
    v.vrAdmin && opts.kind === 'decide' ? soft(async () => { const { listThoughts } = await import('./thoughts'); return listThoughts({ status: 'open', limit: 100 }) as Promise<any[]> }, [] as any[]) : Promise.resolve([] as any[]),
    v.vrAdmin && !opts.kind ? soft(async () => { const { openCounts } = await import('./thoughts'); return (await openCounts(v.email)).open }, 0) : Promise.resolve(0),
  ])
  if (needs.partial) partial = true

  let raw: (InboxItem & { _keys?: string[] })[] = []
  for (const n of needs.needs) {
    if (n.source === 'proposal' && v.eve && want('approve')) raw.push(fromNeed(n, v))
    if (n.source === 'loop' && want('loop')) raw.push(fromNeed(n, v))
  }
  for (const d of drafts) raw.push(fromDraft(d, v))
  for (const q of questions) raw.push(fromQuestion(q, v))
  for (const p of plans) raw.push(fromPlan(p, v))
  for (const n of exps) raw.push(fromExpectation(n, v))
  for (const a of audits) raw.push(fromAudit(a, v))
  for (const t of thoughts) raw.push(fromThought(t, v))
  if (opts.kind) raw = raw.filter(i => i.kind === opts.kind)

  const items = rankItems(dedupeItems(raw))
  const counts = Object.fromEntries(INBOX_KINDS.map(k => [k, 0])) as Record<InboxKind, number>
  let stale = 0
  for (const i of items) { counts[i.kind]++; if (i.stale) stale++ }
  if (!opts.kind) counts.decide = thoughtCount
  // The headline number is what waits on a person: thoughts and out-of-date rows are not in it.
  const total = items.filter(i => i.kind !== 'decide' && !i.stale).length
  const shown = opts.includeStale === false ? items.filter(i => !i.stale) : items
  return { items: shown, summary: { total, counts, stale }, partial, total: shown.length }
}

// ── The dispatcher's table: which action keys each kind takes ─────────────────────────────────
export const KIND_ACTIONS: Record<InboxKind, string[]> = {
  approve: ['approve', 'reject'],
  review_draft: ['send', 'discard'],
  loop: ['close', 'dismiss'],
  answer: ['answer', 'dismiss'],
  plan: ['accept', 'reject'],
  note: ['done', 'dismiss', 'ack', 'snooze'],
  decide: ['do', 'dismiss', 'ask_next_time'],
}

/** '<kind>:<rowid>' → its parts, or null when it is not an inbox id. */
export function parseInboxId(id: string): { kind: InboxKind; rowId: string } | null {
  const s = str(id)
  const at = s.indexOf(':')
  if (at <= 0) return null
  const kind = s.slice(0, at) as InboxKind
  const rowId = s.slice(at + 1)
  if (!INBOX_KINDS.includes(kind) || !rowId) return null
  return { kind, rowId }
}
