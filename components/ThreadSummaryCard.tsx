'use client'
// "WHAT'S GOING ON" — the top of the booking pane (lib/thread-summary, /api/messages/summary). Read in five seconds
// before the thread: where it stands, what matters, and the next step. Re-asked when the thread changes (the server
// answers from its cache when nothing new was said).
import { useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { Tag } from '@/components/lean'

type S = { headline: string; status: 'waiting_on_us' | 'waiting_on_guest' | 'resolved' | 'fyi'; points: string[]; next: string; at: string; over: number }
const STATUS: Record<S['status'], { label: string; tone: 'rose' | 'amber' | 'emerald' | 'slate' }> = {
  waiting_on_us: { label: 'Waiting on us', tone: 'rose' }, waiting_on_guest: { label: 'Waiting on guest', tone: 'amber' },
  resolved: { label: 'Resolved', tone: 'emerald' }, fyi: { label: 'Nothing pending', tone: 'slate' },
}
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !Number.isFinite(m) ? '' : m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago' }

export function ThreadSummaryCard({ conversationId, version }: { conversationId: string | null | undefined; version?: string }) {
  const [s, setS] = useState<S | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [none, setNone] = useState(false)
  // Only the answer for the thread on screen may land: a slow summary of the PREVIOUS thread arriving after you
  // moved on once painted the wrong guest's story over this one.
  const current = useRef(conversationId)
  current.current = conversationId
  const load = (refresh: boolean) => {
    const c = conversationId
    if (!c) return
    setBusy(true); setErr('')
    fetch('/api/messages/summary?c=' + encodeURIComponent(c) + (refresh ? '&refresh=1' : ''), { cache: 'no-store' })
      .then(r => r.json()).then(j => {
        if (current.current !== c) return
        if (j?.summary) setS(j.summary); else if (j?.ok) setNone(true)
        if (!j?.ok) setErr(j?.error || 'Could not write the summary.')
      }).catch(() => { if (current.current === c) setErr('Could not reach Lighthouse.') }).finally(() => { if (current.current === c) setBusy(false) })
  }
  useEffect(() => { setS(null); setNone(false); setErr(''); setBusy(false) }, [conversationId])
  useEffect(() => { load(false) }, [conversationId, version]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!conversationId) return null
  const st = s ? STATUS[s.status] : null
  return (
    <section className="rounded-2xl border border-brand-200 bg-gradient-to-b from-brand-50/70 to-white p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-brand-700 inline-flex items-center gap-1"><Sparkles size={12} /> What’s going on</span>
        {st && <Tag tone={st.tone}>{st.label}</Tag>}
        <button onClick={() => load(true)} disabled={busy} className="ml-auto h-6 w-6 rounded-md hover:bg-white inline-flex items-center justify-center text-muted hover:text-ink disabled:opacity-50" title="Write the summary again from the thread as it is now" aria-label="Refresh the summary">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </button>
      </div>
      {!s && busy && <div className="mt-2 space-y-1.5" aria-label="Reading the thread"><div className="h-3 rounded bg-brand-100/70 w-11/12 animate-pulse" /><div className="h-3 rounded bg-brand-100/50 w-3/4 animate-pulse" /><div className="h-3 rounded bg-brand-100/40 w-2/3 animate-pulse" /></div>}
      {!s && !busy && none && <p className="mt-1.5 text-[12px] text-muted">Nothing said in this thread yet beyond automated messages.</p>}
      {s && (
        <div className="mt-1.5 space-y-1.5">
          <p className="text-[13.5px] font-semibold text-ink leading-snug">{s.headline}</p>
          {s.points.length > 0 && <ul className="space-y-0.5">{s.points.map((p, i) => <li key={i} className="text-[12.5px] text-ink/85 leading-snug flex gap-1.5"><span className="text-brand-500 mt-[1px]">•</span><span>{p}</span></li>)}</ul>}
          {s.next && <p className="text-[12.5px] rounded-lg bg-white border border-brand-100 px-2 py-1 text-ink"><b className="text-brand-700">Next:</b> {s.next}</p>}
          <p className="text-[10.5px] text-muted">From {s.over} message{s.over === 1 ? '' : 's'} · {ago(s.at)} · AI summary — check the thread before acting on money or access</p>
        </div>
      )}
      {err && <p className="mt-1 text-[11.5px] text-amber-800">{err}</p>}
    </section>
  )
}
