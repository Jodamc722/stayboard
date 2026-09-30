'use client'
// EVE'S BRAIN, AS TABS (Jon, 2026-09-30: "Think through the Eve interface as a roadmap to
// understanding her brain: what she's thinking about, what she's working on, and what questions she
// might have that the team can help sort through, train, and manage").
//
//   NeedsTab   what she wants a yes on + what is burning in Slack — every row opens to the exact thing
//              she will do, why, and links to everything involved (booking, thread, Breezeway task,
//              glitch, claim, Slack), sorted Now / Today / This week / Whenever. Routine batches
//              (25 "PM audit" tasks) are one row with Approve all.
//   IssuesTab  every guest issue as a chain: reported → glitch → task → someone on it → started →
//              fixed → guest told. The red link is the next thing to do.
//   DayTab     what she did, proposed and noticed today — repeats folded ("×4").
//   DesksTab   her desks and night shift: on/off and when each last ran.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, X, Loader2, ExternalLink, AlertTriangle, Link2, ChevronDown, Calendar, MessageSquare, Wrench, Scale, Hash, Home, Star, Mail, FileText } from 'lucide-react'
import { LeanList, LeanRow, LeanSection, LeanEmpty, Tag, Pill, IconBtn, Tip } from '@/components/lean'
import { StayPanel } from '@/components/StayPanel'

type Link = { label: string; href: string; kind: string }
type Need = {
  id: string; source: 'proposal' | 'loop'; action: string; title: string; subtitle: string
  what: { label: string; text: string }[]; why: string; evidence: string[]; links: Link[]
  reservationId: string | null; listingId: string | null; unit: string | null
  urgency: 'now' | 'today' | 'week' | 'later'; urgencyWhy: string; filedAt: string
  group: { key: string; label: string } | null; by: string; status: string; loopKind?: string; owner?: string | null; dupes?: string[]
  investigation?: { method: string; confidence: number; reasoning: string; taskId: string | null; glitchId: string | null; stillOpen: string | null; nextStep: string | null; unit: string | null; pinned: boolean } | null
}
type Step = { key: string; label: string; state: 'done' | 'missing' | 'waiting' | 'na'; detail: string }
type Issue = {
  id: string; source: 'glitch' | 'slack' | 'sentiment'; title: string; unit: string | null; guest: string | null
  reportedAt: string; inHouse: boolean; arriving: boolean; severe: boolean
  urgency: 'now' | 'today' | 'week' | 'done'; urgencyWhy: string; next: string | null
  steps: Step[]; links: Link[]; reservationId: string | null; assignees: string[]
  investigation?: Need['investigation']
}

export const URG: Record<string, { label: string; tone: 'roseSolid' | 'amber' | 'brand' | 'slate' | 'emerald'; blurb: string }> = {
  now: { label: 'Now', tone: 'roseSolid', blurb: 'a guest is affected right now or has been waiting' },
  today: { label: 'Today', tone: 'amber', blurb: 'should be handled before the day ends' },
  week: { label: 'This week', tone: 'brand', blurb: 'real, but nothing breaks today' },
  later: { label: 'Whenever', tone: 'slate', blurb: 'routine — preventative work on its cadence' },
  done: { label: 'Done', tone: 'emerald', blurb: 'every link closed' },
}
const LINK_ICON: Record<string, any> = { booking: Calendar, thread: MessageSquare, guesty: ExternalLink, task: Wrench, glitch: AlertTriangle, claim: Scale, slack: Hash, unit: Home, review: Star, email: Mail, page: FileText }
const KIND: Record<string, string> = { guest_ask: 'guest ask', problem: 'problem', commitment: 'promised', question: 'unanswered', decision: 'decision' }

export const ago = (iso: string | null | undefined): string => {
  if (!iso) return ''
  const m = (Date.now() - Date.parse(iso)) / 60000
  if (!Number.isFinite(m)) return ''
  if (m < 1) return 'just now'
  if (m < 60) return `${Math.round(m)}m ago`
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

export function LinkChips({ links }: { links: Link[] }) {
  if (!links?.length) return null
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {links.map((l, i) => {
        const I = LINK_ICON[l.kind] || Link2
        const ext = /^https?:/.test(l.href)
        return (
          <a key={i} href={l.href} target={ext ? '_blank' : undefined} rel={ext ? 'noopener noreferrer' : undefined}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:border-brand-300 hover:text-brand-700">
            <I size={12} className="text-muted" /> {l.label}{ext ? <ExternalLink size={10} className="text-muted" /> : null}
          </a>
        )
      })}
    </div>
  )
}

/** The context card under a row: what exactly happens, why, evidence, links, the whole stay. */
function Context({ n }: { n: Need }) {
  return (
    <div className="space-y-2">
      {n.what.map((w, i) => (
        <div key={i}>
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-0.5">{w.label}</div>
          <div className={'text-[13px] text-ink whitespace-pre-wrap rounded-lg px-3 py-2 ' + (/reply|email|message|description|what was said/i.test(w.label) ? 'bg-app border border-line' : 'bg-white border border-line/60')}>{w.text}</div>
        </div>
      ))}
      {n.why && <p className="text-[12.5px] text-ink/85"><b>Why:</b> {n.why}</p>}
      {n.evidence.length > 0 && <ul className="text-[12px] text-muted list-disc pl-5">{n.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <LinkChips links={n.links} />
      {n.source === 'loop' && <TeachMatch n={n} />}
      {n.reservationId && <StayPanel reservationId={n.reservationId} compact />}
      <p className="text-[11px] text-muted">{n.source === 'loop' ? 'Seen in Slack' : 'Filed by ' + (n.by || 'Eve')} · {ago(n.filedAt)}</p>
    </div>
  )
}

/**
 * TEACH HER THE MATCH (Jon, 2026-09-30). On a Slack report: re-run her investigation, tell her the
 * task she linked is wrong (and why), or paste the right Breezeway task. Every correction goes into
 * her match-lesson book and her memory, and she reads it on every future match.
 */
function TeachMatch({ n }: { n: Need }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [task, setTask] = useState('')
  const [why, setWhy] = useState('')
  const inv = n.investigation
  const call = async (body: any, ok: string) => {
    setBusy(true); setMsg('')
    try { const r = await fetch('/api/loops', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id, ...body }) }).then(x => x.json()); setMsg(r?.ok ? (r.investigation ? ok + ' — ' + String(r.investigation.reasoning || '').slice(0, 220) : ok) : (r?.error || 'Could not do that.')) }
    catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap text-[12px]">
        <b className="text-violet-900">Her match:</b>
        {inv ? <>
          <Tag tone={inv.method === 'linked' ? 'emerald' : inv.confidence >= 0.7 ? 'emerald' : inv.confidence >= 0.4 ? 'amber' : 'slate'}>{inv.method === 'linked' ? 'linked in the message' : inv.method === 'none' ? 'nothing found' : Math.round(inv.confidence * 100) + '% sure'}</Tag>
          {inv.taskId ? <span className="text-ink">task {inv.taskId}{inv.pinned ? '' : ' (not pinned)'}</span> : <span className="text-muted">no task</span>}
          {inv.unit ? <span className="text-muted">· {inv.unit}</span> : null}
        </> : <span className="text-muted">not investigated yet</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <button disabled={busy} onClick={() => call({ action: 'investigate' }, 'Looked again')} className="rounded-md border border-violet-300 bg-white px-2 py-0.5 font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50">{busy ? <Loader2 size={11} className="animate-spin inline" /> : 'Look again'}</button>
          {inv?.pinned ? <button disabled={busy} onClick={() => call({ action: 'unlink_task', why }, 'Unlinked — she will remember why')} className="rounded-md border border-rose-200 bg-white px-2 py-0.5 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Not this task</button> : null}
        </span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={task} onChange={e => setTask(e.target.value)} placeholder="Paste the right Breezeway task link or number"
          className="flex-1 min-w-[200px] rounded-md border border-line bg-white px-2 py-1 text-[12px]" />
        <input value={why} onChange={e => setWhy(e.target.value)} placeholder="Why (she learns from this)"
          className="flex-1 min-w-[160px] rounded-md border border-line bg-white px-2 py-1 text-[12px]" />
        <button disabled={busy || !task.trim()} onClick={() => call({ action: 'link_task', task, why }, 'Linked — she will remember this')} className="rounded-md bg-violet-700 text-white px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40">Link task</button>
      </div>
      {msg ? <p className="text-[12px] text-violet-900">{msg}</p> : null}
    </div>
  )
}

// ── NEEDS YOU ─────────────────────────────────────────────────────────────────────────────────
export function NeedsTab({ isAdmin, canEdit, extras, onCount }: { isAdmin: boolean; canEdit: boolean; extras?: ReactNode; onCount?: (n: number) => void }) {
  const [needs, setNeeds] = useState<Need[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [gone, setGone] = useState<Record<string, true>>({})
  const load = useCallback(async () => {
    try { const r = await fetch('/api/eve/needs', { cache: 'no-store' }).then(x => x.json()); if (r?.ok) { setNeeds(r.needs || []); setErr(''); onCount?.((r.needs || []).length) } else setErr(r?.error || 'Could not load') }
    catch (e: any) { setErr(String(e?.message || e)) }
  }, [onCount])
  useEffect(() => { load() }, [load])

  const act = async (n: Need, op: 'approve' | 'reject' | 'close' | 'dismiss') => {
    setBusy(n.id); setNote('')
    try {
      const r = n.source === 'loop'
        ? await fetch('/api/loops', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id, action: op }) }).then(x => x.json())
        : await fetch('/api/eve/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id: n.id }) }).then(x => x.json())
      // The older copies of the same proposal are superseded either way — decline them quietly.
      if (r?.ok && n.source === 'proposal' && n.dupes?.length) {
        for (const d of n.dupes) { try { await fetch('/api/eve/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'reject', id: d }) }) } catch { /* fine */ } }
      }
      if (r?.ok) { setGone(g => ({ ...g, [n.id]: true })); setNote(op === 'approve' ? 'Done — ' + n.title : op === 'reject' ? 'Declined.' : op === 'close' ? 'Closed.' : 'Dismissed.') }
      else setNote(r?.error || r?.message || 'Could not do that.')
    } catch (e: any) { setNote(String(e?.message || e)) }
    setBusy('')
  }
  const actAll = async (xs: Need[], op: 'approve' | 'reject') => {
    for (const n of xs) await act(n, op)
    setNote((op === 'approve' ? 'Approved ' : 'Declined ') + xs.length + '.')
  }

  const live = useMemo(() => (needs || []).filter(n => !gone[n.id]), [needs, gone])
  if (err && !needs) return <LeanEmpty>{err}</LeanEmpty>
  if (!needs) return <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Reading what she needs from you…</LeanEmpty>

  const sections = (['now', 'today', 'week', 'later'] as const).map(u => ({ u, items: live.filter(n => n.urgency === u) })).filter(s => s.items.length)
  return (
    <div>
      {note ? <p className="text-[12.5px] text-muted mb-2 px-1">{note}</p> : null}
      {!sections.length && <LeanEmpty>Nothing needs you — no proposals out and nothing in Slack urgent or late.</LeanEmpty>}
      {sections.map(({ u, items }) => {
        // Batches: the same routine thing, many times — one row.
        const groups: Record<string, Need[]> = {}
        const singles: Need[] = []
        for (const n of items) { if (n.group) (groups[n.group.key] = groups[n.group.key] || []).push(n); else singles.push(n) }
        return (
          <LeanSection key={u} title={URG[u].label} n={items.length} tone={u === 'now' ? 'rose' : undefined} right={<span className="text-muted">{URG[u].blurb}</span>}>
            <LeanList>
              {Object.entries(groups).map(([k, xs]) => xs.length === 1 ? null : (
                <LeanRow key={k} name={`${xs.length} × ${xs[0].group!.label}`} meta={`${xs[0].by.replace(/^cron:/, '')} · ${Array.from(new Set(xs.map(x => x.unit).filter(Boolean))).slice(0, 4).join(', ')}${xs.length > 4 ? '…' : ''}`}
                  tags={<><Tag tone="slate">batch</Tag><Tag tone="amber">wants a yes</Tag></>}
                  actions={isAdmin ? <>
                    <IconBtn title={'Approve all ' + xs.length + ' — each is created in Breezeway'} tone="ok" onClick={() => actAll(xs, 'approve')} disabled={!!busy}><Check size={14} /></IconBtn>
                    <IconBtn title={'Decline all ' + xs.length} tone="bad" onClick={() => actAll(xs, 'reject')} disabled={!!busy}><X size={14} /></IconBtn>
                  </> : undefined}>
                  <p className="text-[12.5px] text-muted">Open any one to see exactly what it creates; approve them one by one or all at once.</p>
                  <LeanList>
                    {xs.map(n => <NeedRow key={n.id} n={n} isAdmin={isAdmin} canEdit={canEdit} busy={busy === n.id} act={act} />)}
                  </LeanList>
                </LeanRow>
              ))}
              {Object.values(groups).filter(xs => xs.length === 1).map(xs => <NeedRow key={xs[0].id} n={xs[0]} isAdmin={isAdmin} canEdit={canEdit} busy={busy === xs[0].id} act={act} />)}
              {singles.map(n => <NeedRow key={n.id} n={n} isAdmin={isAdmin} canEdit={canEdit} busy={busy === n.id} act={act} />)}
            </LeanList>
          </LeanSection>
        )
      })}
      {extras}
    </div>
  )
}

function NeedRow({ n, isAdmin, canEdit, busy, act }: { n: Need; isAdmin: boolean; canEdit: boolean; busy: boolean; act: (n: Need, op: 'approve' | 'reject' | 'close' | 'dismiss') => void }) {
  const primary = n.links[0]
  return (
    <LeanRow name={n.title}
      meta={[n.subtitle, n.owner ? n.owner : n.source === 'loop' ? 'nobody on it' : '', ago(n.filedAt)].filter(Boolean).join(' · ')}
      tags={<>
        {n.source === 'loop' ? <Tag tone={n.loopKind === 'guest_ask' ? 'rose' : 'slate'}>{KIND[n.loopKind || ''] || 'Slack'}</Tag> : <Tag tone="amber">wants a yes</Tag>}
        {n.urgencyWhy ? <Tag tone={n.urgency === 'now' ? 'rose' : 'slate'}>{n.urgencyWhy}</Tag> : null}
        {n.reservationId ? <Tag tone="brand">booking linked</Tag> : null}
        {n.status === 'undeliverable' ? <Tag tone="rose">approver never told</Tag> : null}
        {n.dupes?.length ? <Tag tone="slate" title="She filed this same thing more than once; deciding this one clears the copies">filed {n.dupes.length + 1}×</Tag> : null}
      </>}
      actions={<>
        {primary ? <IconBtn title={'Open ' + primary.label} href={primary.href}><ExternalLink size={14} /></IconBtn> : null}
        {n.source === 'proposal' && isAdmin ? <>
          <IconBtn title="Approve — she does exactly what is shown" tone="ok" onClick={() => act(n, 'approve')} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}</IconBtn>
          <IconBtn title="Decline" tone="bad" onClick={() => act(n, 'reject')} disabled={busy}><X size={14} /></IconBtn>
        </> : null}
        {n.source === 'loop' && canEdit ? <>
          <IconBtn title="It got done — close it" tone="ok" onClick={() => act(n, 'close')} disabled={busy}><Check size={14} /></IconBtn>
          <IconBtn title="Not a real loop" tone="bad" onClick={() => act(n, 'dismiss')} disabled={busy}><X size={14} /></IconBtn>
        </> : null}
      </>}>
      <Context n={n} />
    </LeanRow>
  )
}

// ── GUEST ISSUES — the closed loop ───────────────────────────────────────────────────────────
const STEP_TONE: Record<string, string> = {
  done: 'bg-emerald-100 text-emerald-800', missing: 'bg-rose-600 text-white', waiting: 'bg-amber-100 text-amber-800', na: 'bg-slate-50 text-slate-300',
}
export function StepChain({ steps }: { steps: Step[] }) {
  return (
    <span className="inline-flex items-center gap-0.5 flex-wrap">
      {steps.map(s => (
        <Tip key={s.key} label={s.label + ': ' + (s.detail || (s.state === 'na' ? 'does not apply' : s.state))}>
          <span className={'text-[10px] font-bold px-1.5 py-[3px] leading-none rounded ' + STEP_TONE[s.state]}>{s.state === 'done' ? '✓ ' : s.state === 'missing' ? '✗ ' : ''}{s.label.replace('Breezeway task', 'Task').replace('Someone on it', 'Assigned').replace('Work started', 'Started').replace('Glitch filed', 'Glitch').replace('Guest told', 'Told')}</span>
        </Tip>
      ))}
    </span>
  )
}

export function IssuesTab({ onCount }: { onCount?: (n: number) => void }) {
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [err, setErr] = useState('')
  const [showDone, setShowDone] = useState(false)
  const load = useCallback(async () => {
    try { const r = await fetch('/api/eve/issues', { cache: 'no-store' }).then(x => x.json()); if (r?.ok) { setIssues(r.issues || []); onCount?.((r.issues || []).filter((i: Issue) => i.urgency !== 'done').length) } else setErr(r?.error || 'Could not load') }
    catch (e: any) { setErr(String(e?.message || e)) }
  }, [onCount])
  useEffect(() => { load() }, [load])
  if (err && !issues) return <LeanEmpty>{err}</LeanEmpty>
  if (!issues) return <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Following every guest issue…</LeanEmpty>
  const counts: Record<string, number> = { now: 0, today: 0, week: 0, done: 0 }
  for (const i of issues) counts[i.urgency]++
  const shown = issues.filter(i => showDone || i.urgency !== 'done')
  const missing: Record<string, number> = {}
  for (const i of issues) if (i.urgency !== 'done' && i.next) missing[i.next] = (missing[i.next] || 0) + 1
  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {counts.now ? <Pill tone="roseSolid">{counts.now} now</Pill> : null}
        {counts.today ? <Pill tone="amber">{counts.today} today</Pill> : null}
        {counts.week ? <Pill tone="brand">{counts.week} this week</Pill> : null}
        {Object.entries(missing).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => <Tag key={k} tone={/File|Create|Assign|Tell/.test(k) ? 'rose' : 'slate'}>{v} · {k}</Tag>)}
        <label className="ml-auto text-[12px] text-muted inline-flex items-center gap-1.5"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> show closed ({counts.done})</label>
      </div>
      {!shown.length ? <LeanEmpty>No open guest issue — every one reported has a glitch, a task, someone on it, and the guest has heard back.</LeanEmpty> : (
        <LeanList>
          {shown.map(i => (
            <LeanRow key={i.id} name={i.title}
              meta={[i.unit, i.guest, i.source === 'glitch' ? 'glitch board' : i.source === 'slack' ? 'Slack' : 'guest messages', ago(i.reportedAt)].filter(Boolean).join(' · ')}
              tags={<>
                <Tag tone={URG[i.urgency].tone} title={i.urgencyWhy}>{URG[i.urgency].label}</Tag>
                {i.inHouse ? <Tag tone="rose">guest in unit</Tag> : i.arriving ? <Tag tone="amber">arriving</Tag> : null}
                {i.next ? <Tag tone={/File|Create|Assign|Tell/.test(i.next) ? 'rose' : 'amber'}>Next: {i.next}</Tag> : null}
                <StepChain steps={i.steps} />
              </>}
              actions={i.links[0] ? <IconBtn title={'Open ' + i.links[0].label} href={i.links[0].href}><ExternalLink size={14} /></IconBtn> : undefined}>
              <ol className="space-y-0.5">
                {i.steps.filter(s => s.state !== 'na').map(s => (
                  <li key={s.key} className="text-[12.5px] flex items-center gap-2">
                    <span className={'w-4 h-4 rounded-full grid place-items-center text-[10px] font-bold ' + STEP_TONE[s.state]}>{s.state === 'done' ? '✓' : s.state === 'missing' ? '!' : '…'}</span>
                    <b className="text-ink">{s.label}</b> <span className="text-muted">{s.detail}</span>
                  </li>
                ))}
              </ol>
              <p className="text-[12px] text-muted">{i.urgencyWhy}</p>
              {i.investigation?.reasoning ? <p className="text-[12.5px] text-ink/85"><b>What Eve found:</b> {i.investigation.reasoning}</p> : null}
              <LinkChips links={i.links} />
              {i.source === 'slack' ? <TeachMatch n={{ id: i.id.slice(2), investigation: i.investigation || null } as any} /> : null}
              {i.reservationId && <StayPanel reservationId={i.reservationId} compact hide={['issues']} />}
            </LeanRow>
          ))}
        </LeanList>
      )}
    </div>
  )
}

// ── HER DAY — repeats folded ─────────────────────────────────────────────────────────────────
const MODE_TONE: Record<string, 'emerald' | 'amber' | 'sky' | 'slate' | 'violet'> = { act: 'emerald', propose: 'amber', draft: 'sky', deferred: 'violet', observe: 'slate' }
const MODE_WORD: Record<string, string> = { act: 'did it', propose: 'asked for a yes', draft: 'wrote a draft', deferred: 'held for morning', observe: 'noticed only' }
export function DayTab({ ov }: { ov: any }) {
  if (!ov) return <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Reading her receipts…</LeanEmpty>
  const decisions: any[] = ov.today?.decisions || []
  const folded: { key: string; d: any; n: number; times: string[] }[] = []
  const at: Record<string, number> = {}
  for (const d of decisions) {
    const k = String(d.mode) + '|' + String(d.summary || d.action)
    if (at[k] != null) { folded[at[k]].n++; folded[at[k]].times.push(d.time) }
    else { at[k] = folded.length; folded.push({ key: k, d, n: 1, times: [d.time] }) }
  }
  const byMode: Record<string, number> = ov.today?.counts?.by_mode || {}
  return (
    <div>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {(['act', 'propose', 'draft', 'deferred', 'observe'] as const).map(m => byMode[m] ? <Tag key={m} tone={MODE_TONE[m]} title={MODE_WORD[m]}>{byMode[m]} {MODE_WORD[m]}</Tag> : null)}
        {ov.thoughts?.unseen ? <a href="/users?tab=settings&panel=eve" className="ml-auto text-[12px] font-semibold text-brand-700 hover:underline">{ov.thoughts.unseen} unseen thoughts →</a> : null}
      </div>
      {ov.today?.error ? <LeanEmpty>Her decision log could not be read: {ov.today.error}</LeanEmpty>
        : folded.length ? (
          <LeanList>
            {folded.map(({ key, d, n, times }) => (
              <LeanRow key={key} name={d.summary || d.action} meta={`${times[0]}${n > 1 ? ' … ' + times[times.length - 1] : ''} · ${String(d.action || '').replace(/_/g, ' ')}${d.by ? ' · ' + String(d.by).replace(/^watch:/, 'watch ').replace(/^cron:/, '') : ''}`}
                tags={<>
                  <Tag tone={MODE_TONE[d.mode] || 'slate'} title={MODE_WORD[d.mode]}>{MODE_WORD[d.mode] || d.mode}</Tag>
                  {n > 1 ? <Tag tone="slate" title={'the same thing, ' + n + ' times today: ' + times.join(', ')}>×{n}</Tag> : null}
                  {d.outcome ? <Tag tone={/done|replied|ok/i.test(d.outcome) ? 'emerald' : /overdue|silent|gone/i.test(d.outcome) ? 'rose' : 'slate'}>{d.outcome}</Tag> : null}
                  {d.undone_at ? <Tag tone="rose">undone</Tag> : null}
                </>}>
                {d.why || d.outcome_note ? <p className="text-[12.5px] text-ink/85">{d.why}{d.outcome_note ? ` — ${d.outcome_note}` : ''}</p> : null}
              </LeanRow>
            ))}
          </LeanList>
        ) : <LeanEmpty>No decisions logged yet today.</LeanEmpty>}
    </div>
  )
}

// ── HOW SHE RUNS ─────────────────────────────────────────────────────────────────────────────
export function DesksTab({ ov }: { ov: any }) {
  return <div><Lessons /><DesksList ov={ov} /></div>
}

/** What the team has taught her — every match correction and every follow-up people had to ask. */
function Lessons() {
  const [l, setL] = useState<{ match: any[]; voice: any[] } | null>(null)
  useEffect(() => { fetch('/api/eve/lessons', { cache: 'no-store' }).then(x => x.json()).then(r => { if (r?.ok) setL({ match: r.match || [], voice: r.voice || [] }) }).catch(() => {}) }, [])
  if (!l) return null
  return (
    <LeanSection title="What the team has taught her" n={l.match.length + l.voice.length} right={<span className="text-muted">read on every match and every Slack post; also kept in her memory</span>}>
      {!(l.match.length + l.voice.length) ? <LeanEmpty>Nothing yet. Correct a match on a Slack report (Not this task / Link task), and when someone has to ask her a follow-up in Slack she files it here herself.</LeanEmpty> : (
        <LeanList>
          {l.match.map((m, i) => <LeanRow key={'m' + i} name={m.right ? 'Right match: ' + m.right : 'Not a match: ' + (m.picked || 'the task she linked')} meta={`"${String(m.report).slice(0, 90)}"${m.unit ? ' · ' + m.unit : ''} · ${m.by} · ${ago(m.at)}`} tags={<Tag tone="violet">matching</Tag>}><p className="text-[12.5px]">{m.why}</p></LeanRow>)}
          {l.voice.map((v, i) => <LeanRow key={'v' + i} name={'Asked: "' + String(v.question).slice(0, 100) + '"'} meta={`after her post in #${v.channel} · ${v.asker} · ${ago(v.at)}`} tags={<Tag tone="amber">clarity</Tag>}><p className="text-[12.5px] text-muted">Her post: {v.herPost}</p></LeanRow>)}
        </LeanList>
      )}
    </LeanSection>
  )
}

function DesksList({ ov }: { ov: any }) {
  if (!ov) return <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Loading…</LeanEmpty>
  const desks: any[] = ov.desks || []
  return desks.length ? (
    <LeanList>
      {desks.map(d => {
        const stale = d.last && (Date.now() - Date.parse(d.last.at)) > 36 * 3600000
        return (
          <LeanRow key={d.key} name={d.label} meta={d.runs}
            tags={<>
              <Tag tone={d.on === false ? 'slate' : 'emerald'}>{d.on === null ? 'always on' : d.on ? 'on' : 'off'}</Tag>
              {d.last ? <Tag tone={!d.last.ok ? 'rose' : stale ? 'amber' : 'slate'} title={d.last.at}>{d.last.ok ? 'ran' : 'failed'} {ago(d.last.at)}{d.last.did != null ? ` · ${d.last.did}` : ''}</Tag> : <Tag tone="slate">never ran</Tag>}
            </>}>
            <p className="text-[12.5px] text-ink/85">{d.what}</p>
            {d.last?.error ? <p className="text-[12px] text-rose-700">{d.last.error}</p> : null}
          </LeanRow>
        )
      })}
    </LeanList>
  ) : <LeanEmpty>No Eve automations are registered.</LeanEmpty>
}
