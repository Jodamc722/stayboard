'use client'
// EVE ON TODAY (2026-11-10) — one compact line and her top three, in the "Eve & Slack — your call"
// band. It replaced the band's own Eve rows (questions, plans, reply drafts) and the "Eve is thinking
// about N things" line: everything Eve needs from a person now lives in ONE inbox (/eve?tab=inbox),
// and Today shows its head with the main button on each row. Decisions go through the same
// POST /api/eve/inbox the Eve page uses, so they run the same checks.
import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Sparkles, ChevronRight } from 'lucide-react'
import { Tag } from '@/components/lean'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { decideInbox, primaryOf, ageLabel, KIND_LABEL, KIND_TONE, type InboxItem, type InboxAction, type InboxResponse } from '@/components/EveInboxCore'

export const EVE_INBOX_TODAY_URL = '/api/eve/inbox?limit=3&fresh=1'
export const EVE_INBOX_HREF = '/eve?tab=inbox'

/** The inbox's head for Today: the number waiting and the top three live rows. Nothing when the role cannot see it. */
export function useEveInboxToday() {
  const { data, error } = useCachedFetch<InboxResponse>(EVE_INBOX_TODAY_URL, { ttl: 120_000, persist: false })
  const [gone, setGone] = useState<Record<string, true>>({})
  const [busy, setBusy] = useState('')
  const ok = !error && !!data?.ok
  const items = ok ? (data!.items || []).filter(i => !gone[i.id]) : []
  const acted = Object.keys(gone).length
  const total = ok ? Math.max(0, Number(data!.summary?.total || 0) - acted) : 0
  const act = async (i: InboxItem, a: InboxAction, text?: string) => {
    setBusy(i.id)
    try {
      const r = await decideInbox(i, a, { text })
      if (r.gone) { setGone(g => ({ ...g, [i.id]: true })); invalidateCache(EVE_INBOX_TODAY_URL) }
      return r
    } finally { setBusy('') }
  }
  return { ok, total, items, busy, act }
}

const DOT: Record<string, string> = { now: 'bg-rose-500', today: 'bg-amber-400', week: 'bg-transparent', later: 'bg-transparent' }
const BTN = 'inline-flex items-center gap-1 rounded-lg px-2.5 min-h-[30px] text-[12px] font-semibold whitespace-nowrap bg-ink text-white disabled:opacity-50'

export function EveInboxToday({ q }: { q: ReturnType<typeof useEveInboxToday> }) {
  if (!q.ok || q.total <= 0) return null
  const top = q.items[0]
  return (
    <div className="divide-y divide-line">
      <Link href={EVE_INBOX_HREF} className="px-3 py-1.5 min-h-[44px] flex items-center gap-2 hover:bg-app/60">
        <Sparkles size={12} className="text-brand-600 shrink-0" />
        <span className="flex-1 min-w-0 text-[13px] text-ink truncate">
          <b>Eve: {q.total} for you</b>{top ? <span className="text-muted"> — top: {top.title}</span> : null}
        </span>
        <ChevronRight size={14} className="text-muted shrink-0" />
      </Link>
      {q.items.map(i => <TodayRow key={i.id} i={i} busy={q.busy === i.id} act={q.act} />)}
    </div>
  )
}

function TodayRow({ i, busy, act }: { i: InboxItem; busy: boolean; act: ReturnType<typeof useEveInboxToday>['act'] }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string>(i.draft || '')
  const [err, setErr] = useState('')
  const p = primaryOf(i)
  const needsText = p?.input === 'answer'
  const go = async () => {
    if (!p || p.href) return
    if (needsText && !text.trim()) { setOpen(true); return }
    if (p.confirm && !window.confirm(p.confirm)) return
    setErr('')
    const r = await act(i, p, p.input ? text : undefined)
    if (!r.ok && !r.gone) setErr(r.msg)
  }
  const meta = [i.unit || i.building || '', i.urgency.reason, ageLabel(i.urgency.ageHours)].filter(Boolean).join(' · ')
  return (
    <div className="px-3 py-1.5 min-h-[44px] flex flex-col justify-center">
      <div className="flex items-center gap-2 min-w-0">
        <span className={'w-1.5 h-1.5 rounded-full shrink-0 ' + DOT[i.urgency.level]} aria-hidden />
        {p && (i.canAct || p.href) ? (
          p.href
            ? <Link href={p.href} className={BTN}>{p.label}</Link>
            : <button onClick={go} disabled={busy} className={BTN}>{busy ? <Loader2 size={11} className="animate-spin" /> : null}{needsText && !open ? 'Answer' : p.label}</button>
        ) : null}
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex-1 min-w-0 text-left">
          <span className="flex items-center gap-x-1.5 flex-wrap min-w-0">
            <span className="text-[13px] font-semibold text-ink truncate leading-snug max-w-full">{i.title}</span>
            <Tag tone={KIND_TONE[i.kind]}>{KIND_LABEL[i.kind]}</Tag>
            {meta ? <span className="text-[11.5px] text-muted truncate leading-snug max-w-full">{meta}</span> : null}
          </span>
        </button>
      </div>
      {err ? <p className="text-[11.5px] font-semibold mt-1 pl-3.5 text-rose-600">{err}</p> : null}
      {open && (
        <div className="mt-1.5 pl-3.5 space-y-1.5">
          {i.why ? <p className="text-[12.5px] text-ink/80 leading-snug">{i.why}</p> : null}
          {p?.input === 'draft' && i.canAct
            ? <textarea value={text} onChange={e => setText(e.target.value)} rows={4} aria-label="Eve's draft" className="w-full rounded-xl border border-line bg-white px-3 py-2 text-[13px] text-ink leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-200" />
            : null}
          {needsText && i.canAct
            ? <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} placeholder="Tell her…" aria-label={'Answer: ' + i.title}
                className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] min-h-[34px] focus:outline-none focus:ring-2 focus:ring-brand-200" />
            : null}
          <Link href={EVE_INBOX_HREF} className="text-[11.5px] font-semibold text-brand-700 hover:underline">More options in Eve&apos;s inbox</Link>
        </div>
      )}
    </div>
  )
}
