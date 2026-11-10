'use client'
// The small shared part of Eve's inbox (2026-11-10): types, labels and the one POST — used by the
// /eve Inbox (components/EveInbox) and the head of it on Today (components/EveInboxToday), so Today
// does not pull in the whole inbox page.
import type { InboxItem, InboxKind, InboxAction, InboxSummary } from '@/lib/eve/inbox'
import type { Tone } from '@/components/lean'

export type { InboxItem, InboxKind, InboxAction, InboxSummary }
export const INBOX_URL = '/api/eve/inbox'
export const KIND_LABEL: Record<InboxKind, string> = {
  approve: 'Wants a yes', review_draft: 'Reply draft', loop: 'Slack', answer: 'Question', plan: 'Plan', note: 'Note', decide: 'Would have done',
}
export const KIND_PLURAL: Record<InboxKind, string> = {
  approve: 'Approvals', review_draft: 'Reply drafts', loop: 'Slack loops', answer: 'Questions', plan: 'Plans', note: 'Notes', decide: 'Would have done',
}
export const KIND_TONE: Record<InboxKind, Tone> = {
  approve: 'amber', review_draft: 'violet', loop: 'sky', answer: 'violet', plan: 'brand', note: 'slate', decide: 'slate',
}

export type InboxResponse = {
  ok?: boolean; error?: string; message?: string
  summary?: InboxSummary; items?: InboxItem[]; total?: number; partial?: boolean
  viewer?: { admin: boolean; loopsEdit: boolean; thoughts: boolean }
}

export const ageLabel = (h: number) => (h < 1 ? 'just now' : h < 48 ? `${h}h` : `${Math.round(h / 24)}d`)
export const primaryOf = (i: InboxItem): InboxAction | null => i.actions.find(a => a.style === 'primary') || i.actions[0] || null

/** POST one decision. Returns { ok, msg } — never throws. A 409 (somebody else got there) counts as gone. */
export async function decideInbox(i: InboxItem, a: InboxAction, extra: { text?: string; note?: string } = {}): Promise<{ ok: boolean; gone: boolean; msg: string }> {
  try {
    const res = await fetch(INBOX_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: i.id, action: a.key, text: extra.text, note: extra.note || undefined, dupes: a.key === 'approve' || a.key === 'reject' ? i.dupes : undefined }),
    })
    const j: any = await res.json().catch(() => ({}))
    if (res.status === 409) return { ok: false, gone: true, msg: String(j?.error || 'Somebody already acted on this.') }
    if (j?.closed) return { ok: false, gone: true, msg: String(j?.error || 'That review is closed — no reply can go on it.') }
    if (!res.ok || j?.ok === false || j?.error) return { ok: false, gone: false, msg: String(j?.error || j?.message || 'That did not work.') }
    return { ok: true, gone: true, msg: j?.done ? String(j.done) : a.label + ' — done.' }
  } catch (e: any) { return { ok: false, gone: false, msg: String(e?.message || e) } }
}

