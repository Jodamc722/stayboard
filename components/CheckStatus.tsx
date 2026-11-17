'use client'
// ONE LINE PER GUEST (Jon, 2026-11-16: "This is so noisy"). An ID & deposits row used to carry up to
// nine coloured tags — channel, arrival, To verify, ✗ID, ✗Selfie, ✗$350, the ID tag, "deposit to
// collect · $350", a RELEASE DUE in capitals — several saying the same thing twice. Now:
//
//   • ONE coloured chip: the next thing someone has to do, in plain words ("Needs ID, selfie and
//     $350 deposit", "Release the $350 deposit", "Ready"). Colour only when it needs a person.
//   • One grey line of facts: channel · when · what is already in (ID ✓ guest link · $350 held).
//   • ONE button: the next action. Everything else sits behind Details.
//
// Shared by Today's ID & deposits tile and the Calls desk's ID & deposits tab, so both say the same thing.
import type { ReactNode } from 'react'
import { Tag } from '@/components/lean'
import type { GuestCheckRow } from '@/app/api/guest-checks/route'
import { ID_METHOD_LABEL } from '@/components/IdCheckBits'

type Tone = 'rose' | 'amber' | 'sky' | 'emerald' | 'slate'
export type CheckState = 'mismatch' | 'look' | 'todo' | 'release' | 'scheduled' | 'done'
export type CheckStatus = { state: CheckState; tone: Tone; label: string; missing: string[]; idOpen: boolean; depOpen: boolean; urgent: boolean }

const usd = (n?: number | null) => n != null ? '$' + Math.round(n).toLocaleString() : ''
const day = (s?: string | null) => s ? new Date(s.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const andList = (xs: string[]) => xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]

export const releaseIsDue = (r: GuestCheckRow, today: string) => r.depositStatus === 'captured' && !!r.depositReleaseDue && r.depositReleaseDue <= today

/** Where this guest stands, as the one next step. */
export function checkStatus(r: GuestCheckRow, today: string): CheckStatus {
  const c = r.checklist
  const idOpen = r.needId && (r.idStatus === 'pending' || r.idStatus === 'check')
  const depScheduled = r.needDeposit && r.depositStatus === 'pending' && !!r.depositScheduled
  const depOpen = r.needDeposit && r.depositStatus === 'pending' && !r.depositScheduled
  const base = { idOpen, depOpen }
  if (r.needId && r.idStatus === 'check') {
    return r.idMatch === 'mismatch'
      ? { ...base, state: 'mismatch', tone: 'rose', label: 'Name on the ID doesn’t match', missing: [], urgent: true }
      : { ...base, state: 'look', tone: 'amber', label: 'Look at the ID photo', missing: [], urgent: r.today }
  }
  const missing: string[] = []
  if (r.needId) {
    if (c ? !c.id.ok : idOpen) missing.push('ID')
    if (c ? !c.selfie.ok : false) missing.push('selfie')
  }
  if (depOpen) missing.push((usd(r.depositDue) ? usd(r.depositDue) + ' ' : '') + 'deposit')
  if (missing.length) return { ...base, state: 'todo', tone: r.today ? 'rose' : 'amber', label: 'Needs ' + andList(missing), missing, urgent: r.today }
  if (releaseIsDue(r, today)) return { ...base, state: 'release', tone: 'rose', label: 'Release the ' + (usd(r.depositAmount) ? usd(r.depositAmount) + ' ' : '') + 'deposit', missing, urgent: true }
  if (depScheduled) return { ...base, state: 'scheduled', tone: 'sky', label: 'Guesty holds ' + (usd(r.depositScheduled?.amount) || 'the deposit') + (r.depositScheduled?.due ? ' on ' + day(r.depositScheduled.due) : ''), missing, urgent: false }
  return { ...base, state: 'done', tone: 'emerald', label: 'Ready', missing, urgent: false }
}

/** When, in a few words. */
export function whenText(r: GuestCheckRow, today: string) {
  return r.today ? 'arrives today' : r.inHouse ? 'in-house · out ' + day(r.checkOut) : r.checkIn < today ? 'left ' + day(r.checkOut) : 'arrives ' + day(r.checkIn)
}

/** The grey facts after the chip: channel · when · what is already in. No colour, no capitals. */
export function checkFacts(r: GuestCheckRow, today: string): string {
  const bits: string[] = [r.channel, whenText(r, today)]
  if (r.needId) {
    if (r.idStatus === 'verified') bits.push('ID ✓ ' + (ID_METHOD_LABEL[String(r.idMethod || '')] || 'verified'))
    else if (r.idStatus === 'waived') bits.push('ID waived')
    else if (r.idStatus === 'pending' && r.idLinkSentAt) bits.push('ID link sent ' + day(r.idLinkSentAt))
  }
  if (r.needDeposit) {
    const amt = usd(r.depositAmount)
    if (r.depositStatus === 'captured') bits.push((amt || 'deposit') + ' held' + (r.depositReleaseDue && !releaseIsDue(r, today) ? ' · release ' + day(r.depositReleaseDue) : ''))
    else if (r.depositStatus === 'released') bits.push('deposit released')
    else if (r.depositStatus === 'claimed') bits.push('deposit claimed')
    else if (r.depositStatus === 'waived') bits.push('deposit waived')
  }
  return bits.join(' · ')
}

/** The one chip. Hover gives the detail the chip leaves out. */
export function CheckChip({ s, r }: { s: CheckStatus; r: GuestCheckRow }) {
  const c = r.checklist
  const title = c ? ['ID: ' + c.id.how, 'Selfie: ' + c.selfie.how, r.needDeposit ? 'Deposit: ' + c.deposit.how : '', r.by ? 'Last change by ' + String(r.by).split('@')[0] : ''].filter(Boolean).join('\n') : undefined
  return <Tag tone={s.tone} title={title}>{s.label}</Tag>
}

/** Row dot: only for what needs someone today. */
export const checkDot = (s: CheckStatus): 'rose' | 'amber' | null => s.urgent && s.state !== 'done' && s.state !== 'scheduled' ? 'rose' : null

/** A strip of every other button, shown under the row when Details is open. */
export function MoreActions({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex items-center gap-1.5 flex-wrap rounded-xl border border-line bg-app/50 p-2">{children}</div>
}
