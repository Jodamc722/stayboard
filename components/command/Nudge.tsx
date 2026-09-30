'use client'
// MESSAGE THE PEOPLE ON THE WORK (Jon, 2026-09-30: "be able to push a message out via Slack to the
// assigned team members of the tasks").
//
// One button, two sizes. On a row it sends about that one task; on a panel header it sends about
// every open task in view, one message per person. The server (/api/command/nudge) resolves each
// Breezeway assignee to their Slack user, writes a short bilingual note (Spanish first for field
// crews, English for vendors and office), posts it in the building's housekeeping or maintenance
// channel tagging them — or DMs them when the building has no channel — and reports who got it
// and who could not be reached, so nothing here ever looks sent when it was not.
import { useState } from 'react'
import { Loader2, Send, Check } from 'lucide-react'
import { BTN } from '@/components/CommandCockpit'

export type NudgeResult = { ok: boolean; sent: { who: string; via: string }[]; skipped: { who: string; reason: string }[]; error?: string }

export async function sendNudge(taskIds: string[], note?: string): Promise<NudgeResult> {
  const r = await fetch('/api/command/nudge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskIds, note }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error || 'Could not send')
  return j as NudgeResult
}

/** Summarise a result in one short line for the row. */
export function nudgeLine(res: NudgeResult): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  const s = res.sent.length, k = res.skipped.length
  if (s && !k) return { text: 'Sent to ' + res.sent.map(x => x.who.split(' ')[0]).join(', '), tone: 'ok' }
  if (s && k) return { text: 'Sent to ' + res.sent.map(x => x.who.split(' ')[0]).join(', ') + ' · not reached: ' + res.skipped.map(x => x.who.split(' ')[0] + ' (' + x.reason + ')').join(', '), tone: 'warn' }
  return { text: k ? 'Not sent — ' + res.skipped.map(x => x.who + ': ' + x.reason).join('; ') : 'Nothing to send', tone: 'bad' }
}

export function NudgeBtn({ taskIds, label, title, compact, className, onSent }: {
  taskIds: string[]; label?: string; title?: string; compact?: boolean; className?: string; onSent?: (r: NudgeResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ text: string; tone: 'ok' | 'warn' | 'bad' } | null>(null)
  const go = async () => {
    if (!taskIds.length || busy) return
    setBusy(true); setDone(null)
    try { const r = await sendNudge(taskIds); setDone(nudgeLine(r)); onSent?.(r) } catch (e: any) { setDone({ text: String(e?.message || e), tone: 'bad' }) }
    setBusy(false)
  }
  const base = className || (BTN + ' border border-line bg-white text-ink hover:border-ink/40')
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <button onClick={go} disabled={busy || !taskIds.length} className={base} title={title || 'Message the assigned person on Slack about this'}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : done?.tone === 'ok' ? <Check size={12} /> : <Send size={12} />}
        {compact ? null : <> {label || 'Message'}</>}
      </button>
      {done && <span className={'text-[11px] font-semibold truncate max-w-[260px] ' + (done.tone === 'ok' ? 'text-emerald-700' : done.tone === 'warn' ? 'text-amber-700' : 'text-rose-700')} title={done.text}>{done.text}</span>}
    </span>
  )
}
