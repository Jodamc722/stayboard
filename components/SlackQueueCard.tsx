'use client'
// WAITING TO SEND — the Command Center half of the Slack approval queue.
//
// Jon, 2026-08-19: "This need to be approved before sending in the command center."
//
// Shows the message EXACTLY as it will land in Slack, because the whole point of approving is
// reading the thing you are approving. Mentions render as @name rather than <@U0B8DC5VDRQ>, which
// is the one place we deliberately differ from the raw text.
//
// Returns null when the queue is empty, like ConnectTools — a card that says "nothing here" is
// just furniture.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Check, X, Clock, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

type Pending = {
  id: string
  eventKey: string
  building: string | null
  body: string
  summary: string | null
  itemCount: number
  audience: string[]
  channelId: string | null
  dmUserIds: string[]
  createdAt: string
  expiresAt: string | null
}

const EVENT_TONE: Record<string, string> = {
  late_cleans: 'bg-amber-100 text-amber-800',
  glitches: 'bg-orange-100 text-orange-800',
  overtime: 'bg-sky-100 text-sky-800',
  digest: 'bg-slate-100 text-slate-700',
  sync: 'bg-rose-100 text-rose-700',
  personal_brief: 'bg-emerald-100 text-emerald-800',
}
const EVENT_LABEL: Record<string, string> = {
  late_cleans: 'Cleans behind',
  glitches: 'Guest issues',
  overtime: 'Over hours',
  digest: 'Digest',
  sync: 'Sync',
  personal_brief: 'Brief',
}

/** '<@U123>' is unreadable in a review UI. Swap in the name we already know. */
function humanise(body: string, names: Record<string, string>): string {
  return body.replace(/<@([A-Z0-9]+)>/g, (_m, id) => '@' + (names[id] || id))
}

function expiresIn(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'expiring now'
  const mins = Math.round(ms / 60000)
  return mins < 60 ? mins + 'm left' : Math.round(mins / 60) + 'h left'
}

export function SlackQueueCard() {
  const router = useRouter()
  const [items, setItems] = useState<Pending[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/slack/queue', { cache: 'no-store' })
      const d = await r.json()
      if (d && d.ok) setItems(d.pending || [])
      else setItems([])
    } catch { setItems([]) }
  }, [])

  useEffect(() => { load() }, [load])

  // The directory is only needed to make mentions readable; a failure here is cosmetic.
  useEffect(() => {
    let alive = true
    fetch('/api/settings/slack-rules', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!alive || !d || !Array.isArray(d.users)) return
        const map: Record<string, string> = {}
        for (const u of d.users) map[u.id] = u.name
        setNames(map)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  async function decide(item: Pending, approve: boolean) {
    setBusy(b => ({ ...b, [item.id]: true })); setErr(null)
    try {
      const r = await fetch('/api/slack/queue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, approve }),
      })
      const d = await r.json().catch(() => ({} as any))
      if (r.ok && d.ok) {
        setDone(x => ({ ...x, [item.id]: approve ? 'Sent' : 'Skipped' }))
        router.refresh()
      } else {
        setErr(d.error || 'Could not update that one.')
      }
    } catch {
      setErr('Could not reach the server.')
    }
    setBusy(b => ({ ...b, [item.id]: false }))
  }

  if (items === null || !items.length) return null
  const live = items.filter(i => !done[i.id])
  if (!live.length) return null

  return (
    <section className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line flex items-center gap-2">
        <span className="w-6 h-6 rounded-lg flex items-center justify-center bg-brand-100 text-brand-700">
          <Send size={14} />
        </span>
        <h3 className="text-sm font-bold text-ink">Waiting to send</h3>
        <span className="text-[11px] font-semibold text-muted bg-app rounded-full px-2 py-0.5">{live.length}</span>
      </div>

      {err ? (
        <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{err}</div>
      ) : null}

      <ul className="divide-y divide-line/70">
        {live.map(item => {
          const isOpen = !!open[item.id]
          const preview = humanise(item.body, names)
          return (
            <li key={item.id} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${EVENT_TONE[item.eventKey] || 'bg-slate-100 text-slate-600'}`}>
                  {EVENT_LABEL[item.eventKey] || item.eventKey}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {item.summary || item.building || 'Message'}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5 flex items-center gap-1.5">
                    <Clock size={11} />
                    {expiresIn(item.expiresAt)}
                    {item.itemCount > 1 ? <span>· {item.itemCount} grouped</span> : null}
                    {item.audience && item.audience.length ? <span>· {item.audience.length} tagged</span> : null}
                  </div>
                </div>
              </div>

              <button
                onClick={() => setOpen(o => ({ ...o, [item.id]: !isOpen }))}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline"
              >
                {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {isOpen ? 'Hide the message' : 'Read the message'}
              </button>

              {isOpen ? (
                <pre className="mt-2 rounded-xl border border-line bg-app/40 p-3 text-[12px] text-ink whitespace-pre-wrap font-sans leading-relaxed">
                  {preview}
                </pre>
              ) : null}

              <div className="flex items-center gap-1.5 mt-2.5">
                <button
                  onClick={() => decide(item, true)} disabled={!!busy[item.id]}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy[item.id] ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Send it
                </button>
                <button
                  onClick={() => decide(item, false)} disabled={!!busy[item.id]}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 disabled:opacity-50"
                >
                  <X size={13} /> Skip
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <a href="/users?tab=settings" className="block px-4 py-2 text-[12px] font-semibold text-brand-700 hover:underline border-t border-line">
        Alert rules &amp; channels
      </a>
    </section>
  )
}
