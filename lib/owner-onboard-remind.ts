// SMART REMINDERS FOR OWNERS (Jon, 2026-11-13: "have reminder if they have not got started, if ACH and W-9 are not
// filled out etc. Be smart"). What an owner is nudged about, and when. Pure rules, no sending: the cron
// (/api/cron/owner-onboarding-reminders) and the report both read this, so what the team sees is what will happen.
//
// THE RULES
//   · An owner is reminded about two things only (Jon, 2026-11-13), one at a time:
//       start      invited, but has not opened the portal and created a password
//       paperwork  in the portal, but the W-9 and bank details are missing
//     ('home', 'supplies' and 'order' remain as names only so older log lines still read; nothing sends them.)
//   · Each step gets at most three reminders, spaced further apart each time, counted from the last thing that
//     happened (the invite, their last visit, the day the order list was sent, the last reminder).
//   · Never two reminders to the same owner within two days, whatever they are about.
//   · After the third goes unanswered, the team is told once, so someone can call.
//   · No reminders when the link is archived, paused, already live, or the owner was never invited by email.
// Isomorphic and pure, so it is tested (lib/__tests__/owner-onboard-remind.test.mjs).
import type { OORecord, OOAuth } from './owner-onboard'

export type RemindKind = 'start' | 'home' | 'supplies' | 'paperwork' | 'order'
export type RemindLog = { at: string; kind: RemindKind | 'escalate'; about?: RemindKind; owner: string; to?: string }
export const REMIND_LABEL: Record<RemindKind, string> = { start: 'Set up the portal', home: 'Fill in the home', supplies: 'Supplies check', paperwork: 'W-9 and bank details', order: 'Review the order list' }
/** Days to wait before the 1st, 2nd and 3rd reminder of each kind. */
export const REMIND_GAPS: Record<RemindKind, [number, number, number]> = { start: [2, 3, 5], home: [3, 4, 7], supplies: [3, 4, 7], paperwork: [3, 4, 7], order: [2, 3, 5] }
const MIN_BETWEEN_DAYS = 2, ESCALATE_AFTER_DAYS = 3, DAY = 86_400_000
const t = (s?: string | null) => { const n = s ? Date.parse(s) : NaN; return Number.isFinite(n) ? n : 0 }

export type RemindPlan = { owner: string; name: string; email: string; kind: RemindKind; n: 1 | 2 | 3; dueAt: number; due: boolean }
export type RemindState = { on: boolean; why: string; plans: RemindPlan[]; escalate: { owner: string; name: string; kind: RemindKind }[] }

type Acct = { id: string; name: string; email: string; auth?: OOAuth | null }
const accts = (r: OORecord): Acct[] => [{ id: 'p', name: r.custom.ownerName, email: r.custom.ownerEmail, auth: r.auth }, ...(r.owners || []).map(o => ({ id: o.id, name: o.name, email: o.email, auth: o.auth }))]

/** What an owner already in the portal is reminded about. ONLY THE PAPERWORK (Jon, 2026-11-13: "only reminder for W-9
 *  and ACH and getting access to their portal"): the home, the supplies check and the order list are chased by the
 *  team, not by automatic email. */
export function ownerTask(r: OORecord): Exclude<RemindKind, 'start'> | null {
  return r.custom.askPayout !== false && !r.payout ? 'paperwork' : null
}

export function remindState(r: OORecord, now = Date.now()): RemindState {
  const off = (why: string): RemindState => ({ on: false, why, plans: [], escalate: [] })
  if (r.archived) return off('This link is archived.')
  if (r.remind?.paused) return off('Reminders are paused for this owner.')
  if (r.steps?.find(s => s.key === 'live')?.status === 'done') return off('The home is live.')
  const log: RemindLog[] = r.remind?.log || []
  const plans: RemindPlan[] = [], escalate: RemindState['escalate'] = []
  const task = ownerTask(r)
  for (const a of accts(r)) {
    if (!a.email) continue
    const started = !!a.auth?.pass
    if (!started && !a.auth?.invitedAt) continue                      // never invited by email: nothing to remind about
    const kind: RemindKind | null = started ? task : 'start'
    if (!kind) continue
    const mine = log.filter(l => l.owner === a.id)
    const sent = mine.filter(l => l.kind === kind).sort((x, y) => t(x.at) - t(y.at))
    const anchor = kind === 'start' ? t(a.auth?.invitedAt) : kind === 'order' ? Math.max(t(r.order?.sentAt), t(a.auth?.lastSeenAt)) : Math.max(t(a.auth?.lastSeenAt), t(a.auth?.activatedAt))
    if (!anchor) continue
    if (sent.length >= 3) {
      // three sent and still nothing: the team hears about it once
      if (now - t(sent[2].at) >= ESCALATE_AFTER_DAYS * DAY && !mine.some(l => l.kind === 'escalate' && l.about === kind)) escalate.push({ owner: a.id, name: a.name, kind })
      continue
    }
    const since = sent.length ? Math.max(t(sent[sent.length - 1].at), anchor) : anchor
    const lastAny = Math.max(0, ...mine.filter(l => l.kind !== 'escalate').map(l => t(l.at)))
    const dueAt = Math.max(since + REMIND_GAPS[kind][sent.length] * DAY, lastAny ? lastAny + MIN_BETWEEN_DAYS * DAY : 0)
    plans.push({ owner: a.id, name: a.name, email: a.email, kind, n: (sent.length + 1) as 1 | 2 | 3, dueAt, due: now >= dueAt })
  }
  return { on: true, why: plans.length || escalate.length ? '' : 'Nothing is waiting on the owner right now.', plans, escalate }
}
