'use client'
// SYSTEM HEALTH — the standing audit, on a screen instead of in Slack (Jon, 2026-09-15: "kill
// those and have a tab in the app that shares some of that performance").
//
// The audit has run every hour since migration 047 and posted its newly-opened findings into Slack.
// Two things were wrong with that. It ran 24 times a day to check things that move on the scale of
// days, and it pushed the app's OWN health into a channel people are in to run buildings — which is
// how a channel gets muted, and a muted channel is worse than no channel because everyone believes
// they are covered.
//
// So the audit now runs once a day and says nothing. This is where it says it. The findings were
// always written to eve_audits and there was always an API; there was simply never a screen.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, AlertTriangle, AlertCircle, Info, Check, Clock, RotateCcw } from 'lucide-react'

type Item = {
  id: string; area: string; severity: string; title: string; detail: string; fix: string
  count: number; status: string; first_seen_at: string; last_seen_at: string
  snooze_until: string | null; acked_by: string | null; ageDays: number
}

const SEV = {
  critical: { label: 'Critical', ring: 'ring-rose-200', bg: 'bg-rose-50', text: 'text-rose-700', Icon: AlertCircle },
  warn: { label: 'Warning', ring: 'ring-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', Icon: AlertTriangle },
  info: { label: 'Note', ring: 'ring-line', bg: 'bg-app', text: 'text-muted', Icon: Info },
} as const
const sevOf = (s: string) => (SEV as any)[s] || SEV.info

const VIEWS = [
  { key: 'open', label: 'Open' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'Everything' },
]

export function SystemHealth() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [view, setView] = useState('open')
  const [busy, setBusy] = useState(true)
  const [acting, setActing] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/eve/audits?status=' + view + '&limit=200', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'Could not load the audit.')
      setItems(j.items || [])
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }, [view])
  useEffect(() => { load() }, [load])

  const act = async (body: any, tag: string) => {
    setActing(tag); setErr('')
    try {
      const r = await fetch('/api/eve/audits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'That did not work.')
      if (j.items) setItems(j.items); else await load()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setActing('')
  }

  // The counts people actually scan for, taken from what is on screen rather than a second read.
  const counts = useMemo(() => {
    const c = { critical: 0, warn: 0, info: 0 }
    for (const i of items || []) (c as any)[i.severity] = ((c as any)[i.severity] || 0) + 1
    return c
  }, [items])

  const byArea = useMemo(() => {
    const m: Record<string, Item[]> = {}
    for (const i of items || []) (m[i.area] = m[i.area] || []).push(i)
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length)
  }, [items])

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {VIEWS.map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={'text-[12.5px] font-semibold px-3 h-8 rounded-xl border transition ' +
              (view === v.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink hover:border-ink/25')}>
            {v.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {/* Running it by hand is the whole reason a daily schedule is safe: if you have just */}
          {/* fixed something, you do not wait until tomorrow to find out whether it took. */}
          <button onClick={() => act({ op: 'run' }, 'run')} disabled={!!acting || busy}
            className="h-9 px-3.5 rounded-xl border border-line bg-white text-[12.5px] font-bold text-ink inline-flex items-center gap-1.5 disabled:opacity-40">
            {acting === 'run' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Run the audit now
          </button>
        </div>
      </div>

      {items && items.length > 0 ? (
        <div className="grid gap-2.5 grid-cols-3">
          {(['critical', 'warn', 'info'] as const).map(k => {
            const s = sevOf(k)
            return (
              <div key={k} className="min-w-0 rounded-2xl bg-white ring-1 ring-line px-4 py-3.5">
                <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted">{s.label}</p>
                <p className={'text-[22px] font-bold tabular-nums leading-tight mt-0.5 ' + (counts[k] ? s.text : 'text-faint')}>
                  {counts[k]}
                </p>
              </div>
            )
          })}
        </div>
      ) : null}

      {busy && !items ? (
        <div className="rounded-2xl bg-white ring-1 ring-line px-4 py-10 grid place-items-center">
          <Loader2 size={18} className="animate-spin text-muted" />
        </div>
      ) : null}

      {err ? <p className="text-[12.5px] font-semibold text-rose-700">{err}</p> : null}

      {items && !items.length && !busy ? (
        <div className="rounded-2xl bg-white ring-1 ring-line px-4 py-8 text-center">
          <Check size={20} className="text-emerald-600 mx-auto mb-2" />
          <p className="text-[13px] font-semibold text-ink">Nothing open.</p>
          <p className="text-[12px] text-muted mt-1">
            The audit checks syncs, guest pipeline, reviews, ops, listings and money once a day. A quiet
            result here is the confirmation that used to arrive in Slack.
          </p>
        </div>
      ) : null}

      {byArea.map(([area, list]) => (
        <div key={area}>
          <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted mb-1.5">{area}</p>
          <div className="space-y-2">
            {list.map(it => {
              const s = sevOf(it.severity)
              return (
                <div key={it.id} className={'min-w-0 rounded-2xl ring-1 px-4 py-3.5 ' + s.bg + ' ' + s.ring}>
                  <div className="flex items-start gap-2.5">
                    <s.Icon size={15} className={'mt-0.5 shrink-0 ' + s.text} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-bold text-ink break-words">
                        {it.title}
                        {it.count > 1 ? <span className="font-semibold text-muted"> · {it.count.toLocaleString()}</span> : null}
                      </p>
                      {it.detail ? <p className="text-[12.5px] text-ink/80 mt-0.5 leading-relaxed break-words">{it.detail}</p> : null}
                      {it.fix ? <p className="text-[12px] text-muted mt-1 leading-relaxed break-words"><b>Fix:</b> {it.fix}</p> : null}
                      <p className="text-[11.5px] text-muted mt-1.5">
                        {it.ageDays === 0 ? 'First seen today' : 'Open ' + it.ageDays + (it.ageDays === 1 ? ' day' : ' days')}
                        {it.acked_by ? ' · acknowledged by ' + it.acked_by : ''}
                        {it.snooze_until ? ' · snoozed to ' + new Date(it.snooze_until).toLocaleDateString() : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {it.status === 'open' ? (
                        <>
                          <button onClick={() => act({ op: 'ack', id: it.id }, 'ack' + it.id)} disabled={!!acting}
                            title="I have seen this and it is being handled"
                            className="h-8 px-2.5 rounded-xl border border-line bg-white text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">
                            {acting === 'ack' + it.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Ack
                          </button>
                          <button onClick={() => act({ op: 'snooze', id: it.id, days: 7 }, 'sn' + it.id)} disabled={!!acting}
                            title="Hide for a week — it comes back if it is still true"
                            className="h-8 px-2.5 rounded-xl border border-line bg-white text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">
                            {acting === 'sn' + it.id ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />} 7d
                          </button>
                        </>
                      ) : (
                        <button onClick={() => act({ op: 'reopen', id: it.id }, 're' + it.id)} disabled={!!acting}
                          className="h-8 px-2.5 rounded-xl border border-line bg-white text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">
                          {acting === 're' + it.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Reopen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
