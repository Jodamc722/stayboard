'use client'
// OPEN LOOPS — the page behind Eve's "Keeping tabs".
//
// Jon, 2026-09-28: "where does this live? The long Slack post is not super helpful at all." One row
// per loop: what, unit, who has it, how old, where it was said (a Slack link), and two verbs — Done
// and Not a loop. Guest asks first, because they cost money by the hour; then problems, promises,
// unanswered questions, decisions. Lean rules (components/lean.tsx): one line, tags, detail behind
// the click.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, X, ExternalLink, BellRing, Loader2, RotateCcw, Radar } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'

type Item = {
  id: string; channel: string; channel_name: string | null; msg_ts: string; thread_ts: string | null
  kind: 'guest_ask' | 'problem' | 'commitment' | 'question' | 'decision' | string
  summary: string; owner_name: string | null; unit: string | null; building: string | null
  urgent: boolean; status: string; tracked_in: string | null; nudge_count: number; nudged_at: string | null
  first_seen: string; last_seen: string; closed_reason?: string | null; closed_at?: string | null
  evidence: any; link: string
}
type TabKey = 'guest_ask' | 'problem' | 'commitment' | 'question' | 'decision' | 'closed'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'guest_ask', label: 'Guest asks' }, { key: 'problem', label: 'Problems' }, { key: 'commitment', label: 'Promised' },
  { key: 'question', label: 'Unanswered' }, { key: 'decision', label: 'Decisions' }, { key: 'closed', label: 'Closed' },
]
const KIND_TONE: Record<string, 'rose' | 'amber' | 'sky' | 'violet' | 'slate'> = { guest_ask: 'rose', problem: 'amber', commitment: 'sky', question: 'violet', decision: 'slate' }
const ASK_LABEL: Record<string, string> = { inquiry: 'wants to book', discount: 'discount', extension: 'extend', callback: 'call back', refund: 'refund', change: 'change', other: 'ask' }

const age = (iso: string) => {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000)
  return m < 60 ? `${Math.round(m)}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}
const ageTone = (it: Item): 'rose' | 'amber' | 'slate' => {
  const h = (Date.now() - Date.parse(it.first_seen)) / 3600000
  if (it.kind === 'guest_ask') return h >= 4 ? 'rose' : h >= 1 ? 'amber' : 'slate'
  return h >= 48 ? 'rose' : h >= 24 ? 'amber' : 'slate'
}

export function OpenLoops({ canEdit, embedded }: { canEdit: boolean; embedded?: boolean }) {
  const [open, setOpen] = useState<Item[] | null>(null)
  const [closed, setClosed] = useState<Item[] | null>(null)
  const [tab, setTab] = useState<TabKey>('guest_ask')
  const [building, setBuilding] = useState('')
  const [owner, setOwner] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch('/api/loops?status=open', { cache: 'no-store' }).then(r => r.json()),
        fetch('/api/loops?status=closed&days=2', { cache: 'no-store' }).then(r => r.json()),
      ])
      setOpen(Array.isArray(a?.items) ? a.items : []); setClosed(Array.isArray(b?.items) ? b.items : [])
    } catch { setOpen([]); setClosed([]) }
  }, [])
  useEffect(() => { load() }, [load])

  // The first tab with anything in it, once, so the page never opens on an empty list.
  useEffect(() => {
    if (!open) return
    if (open.some(i => i.kind === tab)) return
    const first = TABS.find(t => t.key !== 'closed' && open.some(i => i.kind === t.key))
    if (first) setTab(first.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const act = async (it: Item, action: string, extra: any = {}) => {
    setBusy(it.id); setNote('')
    try {
      const r = await fetch('/api/loops', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, action, ...extra }) })
      const j = await r.json()
      if (!r.ok || j?.error) throw new Error(j?.error || 'failed')
      if (action === 'nudge') setNote(j.mode === 'act' ? 'Asked in the thread.' : `Nudge ${j.mode} — a ✅ in #vr-eve sends it.`)
      await load()
    } catch (e: any) { setNote(String(e?.message || e)) }
    setBusy(null)
  }

  const buildings = useMemo(() => Array.from(new Set((open || []).map(i => i.building).filter(Boolean) as string[])).sort(), [open])
  const owners = useMemo(() => Array.from(new Set((open || []).map(i => i.owner_name).filter(Boolean) as string[])).sort(), [open])
  const filt = (list: Item[]) => list.filter(i => (!building || i.building === building) && (!owner || i.owner_name === owner))
  const rows = tab === 'closed' ? filt(closed || []) : filt((open || []).filter(i => i.kind === tab)).sort((a, b) => Date.parse(a.first_seen) - Date.parse(b.first_seen))
  const n = (k: TabKey) => (k === 'closed' ? (closed || []).length : (open || []).filter(i => i.kind === k).length)
  const stale = (open || []).filter(i => ageTone(i) === 'rose').length
  const nobody = (open || []).filter(i => !i.owner_name && i.kind !== 'decision').length

  if (!open) return <p className="text-[12.5px] text-muted py-6"><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1.5" />Loading…</p>

  return (
    <div>
      {embedded ? (
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          <Pill tone={stale ? 'rose' : 'slate'} title="Open longer than the limit (guest ask 4h, anything else 48h)">{stale} overdue</Pill>
          <Pill tone={nobody ? 'amber' : 'slate'} title="Open with nobody's name on them">{nobody} unowned</Pill>
          <Pill title="Open in total">{open.length} open</Pill>
          <span className="text-[11.5px] text-muted">what Eve is keeping tabs on across Slack — closed when the thread, the task or the booking says so</span>
        </div>
      ) : (
      <LeanHead title="Open loops" icon={<Radar size={20} className="text-brand-600" />}>
        <Pill tone={n('guest_ask') ? 'rose' : 'slate'} title="Guest asks waiting on us">{n('guest_ask')} guest asks</Pill>
        <Pill tone={stale ? 'rose' : 'slate'} title="Open longer than the limit (guest ask 4h, anything else 48h)">{stale} overdue</Pill>
        <Pill tone={nobody ? 'amber' : 'slate'} title="Open with nobody's name on them">{nobody} unowned</Pill>
        <Pill title="Open in total">{open.length} open</Pill>
      </LeanHead>
      )}
      <LeanTabs tabs={TABS.map(t => ({ ...t, n: n(t.key) }))} value={tab} onChange={setTab} right={
        <>
          <select value={building} onChange={e => setBuilding(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-[12px] bg-white"><option value="">All buildings</option>{buildings.map(b => <option key={b} value={b}>{b}</option>)}</select>
          <select value={owner} onChange={e => setOwner(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-[12px] bg-white"><option value="">Anyone</option>{owners.map(o => <option key={o} value={o}>{o}</option>)}</select>
          {note && <span className="text-[12px] text-muted">{note}</span>}
        </>
      } />
      {rows.length === 0 ? <LeanEmpty>{tab === 'closed' ? 'Nothing closed in the last two days.' : 'Nothing open here.'}</LeanEmpty> : (
        <LeanList>
          {rows.map(it => {
            const ev = it.evidence || {}
            const askKind = it.kind === 'guest_ask' ? (ASK_LABEL[String(ev.ask)] || 'ask') : null
            return (
              <LeanRow key={it.id}
                tint={it.status === 'open' && ageTone(it) === 'rose' ? 'rose' : it.urgent ? 'amber' : undefined}
                name={<>{ev.guest ? ev.guest + ' · ' : ''}{it.summary}</>}
                meta={<>{it.unit || it.building ? `${it.unit || ''}${it.unit && it.building && !it.unit.includes(it.building) ? ' · ' + it.building : (!it.unit ? it.building : '')}` : ''}{it.channel_name ? ` · #${it.channel_name}` : ''}</>}
                tags={<>
                  {askKind && <Tag tone="rose">{askKind}</Tag>}
                  {ev.amount ? <Tag tone="rose">${Math.round(Number(ev.amount)).toLocaleString()}</Tag> : null}
                  {it.urgent && <Tag tone="amber">guest today</Tag>}
                  {it.status === 'open' && <Tag tone={ageTone(it)} title={'Since ' + new Date(it.first_seen).toLocaleString()}>{age(it.first_seen)}</Tag>}
                  {it.owner_name ? <Tag tone="sky">{it.owner_name}</Tag> : it.kind !== 'decision' && it.status === 'open' ? <Tag tone="amber">nobody</Tag> : null}
                  {ev.weight === 'small' && <Tag title="Routine coordination — kept for visibility, never chased">small</Tag>}
                  {ev.expires && it.status === 'open' && <Tag title={'Moot after ' + new Date(ev.expires).toLocaleString()}>until {new Date(ev.expires).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</Tag>}
                  {it.tracked_in && <Tag tone="sky" title={ev.taskName ? `Breezeway task #${ev.taskId} "${ev.taskName}" — ${ev.matchedBy}` : it.tracked_in}>{it.tracked_in.startsWith('breezeway') ? 'in Breezeway' : it.tracked_in.startsWith('glitch') ? 'on glitch board' : it.tracked_in.split(':')[0]}</Tag>}
                  {ev.guestTold && <Tag tone="emerald" title={'We wrote to the guest ' + new Date(ev.guestTold).toLocaleString() + (ev.guestToldBy ? ' — ' + ev.guestToldBy : '')}>guest told</Tag>}
                  {it.nudge_count > 0 && <Tag title={'Last asked ' + (it.nudged_at ? new Date(it.nudged_at).toLocaleString() : '')}>asked ×{it.nudge_count}</Tag>}
                  {ev.escalated && <Tag tone="roseSolid" title={'Escalated: ' + ev.escalatedWhy}>escalated</Tag>}
                  {it.status === 'closed' && it.closed_reason && <Tag tone={/dismissed/.test(it.closed_reason) ? 'slate' : 'emerald'} title={it.closed_reason}>{/dismissed/.test(it.closed_reason) ? 'not a loop' : /booked/.test(it.closed_reason) ? 'booked' : 'done'}</Tag>}
                </>}
                actions={<>
                  <IconBtn title="Open in Slack" href={it.link}><ExternalLink size={14} /></IconBtn>
                  {canEdit && it.status === 'open' && it.kind !== 'decision' && <IconBtn title="Ask in the thread now" onClick={() => act(it, 'nudge')} disabled={busy === it.id}><BellRing size={14} /></IconBtn>}
                  {canEdit && it.status === 'open' && <IconBtn title="Done — close it" tone="ok" onClick={() => act(it, 'close')} disabled={busy === it.id}><Check size={14} /></IconBtn>}
                  {canEdit && it.status === 'open' && <IconBtn title="Not a real loop — drop it" tone="bad" onClick={() => act(it, 'dismiss')} disabled={busy === it.id}><X size={14} /></IconBtn>}
                  {canEdit && it.status === 'closed' && <IconBtn title="Reopen" onClick={() => act(it, 'reopen')} disabled={busy === it.id}><RotateCcw size={14} /></IconBtn>}
                </>}
              >
                {ev.text && <p className="text-[12.5px] text-ink/80 whitespace-pre-wrap">“{String(ev.text)}”{ev.who ? <span className="text-muted"> — {ev.who}</span> : null}</p>}
                {it.closed_reason && <p className="text-[12px] text-muted">Closed: {it.closed_reason}{it.closed_at ? ' · ' + new Date(it.closed_at).toLocaleString() : ''}</p>}
                {canEdit && it.status === 'open' && (
                  <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('owner') as HTMLInputElement; act(it, 'owner', { owner: f.value }) }}>
                    <input name="owner" defaultValue={it.owner_name || ''} placeholder="Who has this?" className="rounded-lg border border-line px-2 py-1 text-[12px] w-48" />
                    <button className="text-[12px] font-semibold underline decoration-dotted">Set owner</button>
                  </form>
                )}
              </LeanRow>
            )
          })}
        </LeanList>
      )}
    </div>
  )
}
