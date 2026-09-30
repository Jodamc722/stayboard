'use client'
// EVE — her own tab (Jon, 2026-09-28: "we need to have an Eve tab where open loops are, training
// questions, Eve command center overview").
//
// Three tabs, each already a real thing somewhere else, brought together where a person looks
// for Eve:
//   Overview   what needs a person from her today (proposals waiting, questions, unseen thinking,
//              loops), what she did today, and whether each of her desks is on and actually ran
//   Open loops the page behind "Keeping tabs" (components/OpenLoops), unchanged
//   Questions  the things only a person can tell her — answer one and it becomes a memory with
//              your name on it. "Training questions" in Jon's words.
//   Expectations  the notes she prepares for CS and admin (Jon, 2026-09-28): what guests keep
//              being surprised by — parking fees, check-in, what is in the unit — and the sentence
//              for the listing, the rules or the pre-arrival message that would have spared them.
//              lib/eve/expectations.ts. Nothing is published; a person marks a note updated.
// Memory, voice, agent mode and the thinking feed stay in Settings → Eve; the overview links there.
// Lean rules (components/lean.tsx): one-line header with pills, tabs with counts, rows, detail
// behind a click.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles, Check, X, HelpCircle, RefreshCw, ExternalLink, Loader2, Radar, Brain, Sliders, MessageSquareWarning, Copy, RotateCcw, Play, MessageCircle, Search } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'
import { OpenLoops } from '@/components/OpenLoops'
import { openEve } from '@/components/EveFloat'
import { NeedsTab, IssuesTab, DayTab, DesksTab } from '@/components/EveBrain'

// WHAT EACH TAB IS, IN ONE LINE (Jon, 2026-09-30: "We need to better understand what each of those
// things means in the tabs"). Shown under the tabs so nobody has to guess.
const TAB_BLURB: Record<string, string> = {
  overview: 'Decisions only a person can make. Open any row to see exactly what she will do, why, and links to the booking, guest thread, Breezeway task, glitch or Slack thread.',
  issues: 'Every problem a guest raised, followed until it is fixed and the guest has heard back: reported → glitch → task → someone on it → started → fixed → guest told. Red is the missing step.',
  loops: 'Things said in Slack she is keeping tabs on. She closes them herself when the matching task finishes or the guest is answered.',
  questions: 'What she does not know yet. Your answer becomes her memory, with your name on it — this is how the team trains her.',
  day: 'Everything she did, asked for, drafted or only noticed today — repeats folded together.',
  expectations: 'What guests keep being surprised by (parking, fees, check-in…) and the listing or message copy that would fix it.',
  desks: 'Her desks and night shift — whether each is on, and when it last actually ran.',
}

type TabKey = 'overview' | 'issues' | 'loops' | 'questions' | 'day' | 'expectations' | 'desks'
type HotLoop = { id: string; kind: string; summary: string; unit: string | null; building: string | null; owner: string | null; urgent: boolean; late: boolean; hours: number; link: string; channel: string | null }

type Overview = {
  ok: boolean; day: string
  today: { headline: string | null; counts: any; waiting: any[]; decisions: any[]; gaps: string[] | null; error: string | null }
  loops: { open: number; byKind: Record<string, number>; urgent: number; oldestHours: number | null; top?: HotLoop[] }
  questions: number
  questionsTop?: { id: string; question: string; why: string | null; scope: string; kind: string }[]
  expectations: number
  thoughts: { unseen: number; allObserving: boolean }
  agent: { enabled: boolean; rungs: Record<string, number> | null }
  desks: { key: string; label: string; what: string; runs: string; settings: string | null; on: boolean | null; last: { at: string; ok: boolean; did: number | null; error: string | null } | null }[]
}

const KIND_LABEL: Record<string, string> = { guest_ask: 'guest asks', problem: 'problems', commitment: 'promised', question: 'unanswered', decision: 'decisions' }
const MODE_TONE: Record<string, 'emerald' | 'amber' | 'sky' | 'slate' | 'violet'> = { act: 'emerald', propose: 'amber', draft: 'sky', deferred: 'violet', observe: 'slate' }

const ago = (iso: string | null | undefined): string => {
  if (!iso) return 'never'
  const m = (Date.now() - Date.parse(iso)) / 60000
  if (!Number.isFinite(m)) return 'never'
  if (m < 1) return 'just now'
  if (m < 60) return `${Math.round(m)}m ago`
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`
  return `${Math.round(m / 1440)}d ago`
}

export function EveHub({ canEdit, loopsLevel, initialTab, isAdmin }: { canEdit: boolean; loopsLevel: string; initialTab?: TabKey; isAdmin?: boolean }) {
  const [tab, setTab] = useState<TabKey>(initialTab || 'overview')
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  const [qCount, setQCount] = useState<number | null>(null)
  const [xCount, setXCount] = useState<number | null>(null)
  const [nCount, setNCount] = useState<number | null>(null)
  const [iCount, setICount] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/eve/overview', { cache: 'no-store' }).then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load'); return }
      setOv(r); setQCount(r.questions); setXCount(r.expectations || 0); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])
  // The Guest issues count shows on its tab before anyone opens it.
  useEffect(() => { fetch('/api/eve/issues', { cache: 'no-store' }).then(x => x.json()).then(r => { if (r?.ok) setICount((r.issues || []).filter((i: any) => i.urgency !== 'done').length) }).catch(() => {}) }, [])

  // Deep links: /eve?tab=loops. Written back so a refresh lands on the same tab.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const t = sp.get('tab')
      if (t === 'loops' || t === 'questions' || t === 'overview' || t === 'expectations' || t === 'issues' || t === 'day' || t === 'desks') setTab(t)
    } catch { /* server */ }
  }, [])
  const pick = (t: TabKey) => {
    setTab(t)
    try { const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u.toString()) } catch { /* fine */ }
  }

  const waiting = ov?.today.waiting.length || 0
  const hot = ov?.loops.top?.length || 0
  const needsYou = nCount != null ? nCount : waiting + hot
  const tabs = useMemo(() => ([
    { key: 'overview' as TabKey, label: 'Needs you', n: needsYou || null },
    { key: 'issues' as TabKey, label: 'Guest issues', n: iCount || null },
    { key: 'loops' as TabKey, label: 'Watching', n: ov?.loops.open || null },
    { key: 'questions' as TabKey, label: 'Questions', n: qCount || null },
    { key: 'day' as TabKey, label: 'Her day', n: null as number | null },
    { key: 'expectations' as TabKey, label: 'Expectations', n: xCount || null },
    { key: 'desks' as TabKey, label: 'How she runs', n: null as number | null },
  ]), [needsYou, iCount, ov, qCount, xCount])

  return (
    <div>
      <LeanHead title="Eve" icon={<Sparkles size={20} className="text-brand-600" />}>
        {ov ? (
          <>
            <Pill tone={needsYou ? 'rose' : 'emerald'} title="Proposals waiting for a yes, and Slack loops that are urgent or late" onClick={() => pick('overview')}>{needsYou ? `${needsYou} need you` : 'nothing needs you'}</Pill>
            <Pill tone={ov.thoughts.unseen ? 'sky' : 'slate'} title="What she would have done, and did not — Settings → Eve → Thinking"
              onClick={() => { window.location.href = '/users?tab=settings&panel=eve' }}>{ov.thoughts.unseen} unseen thoughts</Pill>
            <Pill tone={ov.agent.enabled ? 'emerald' : 'slate'} title={ov.agent.enabled ? 'Agent mode is on — she acts inside the fence set in Settings → Eve' : 'Agent mode is off — she observes and answers only'}>{ov.agent.enabled ? 'Agent on' : 'Agent off'}</Pill>
          </>
        ) : err ? <Pill tone="rose">{err}</Pill> : <Pill><Loader2 size={12} className="animate-spin inline" /></Pill>}
        <button onClick={() => openEve()} className="inline-flex items-center gap-1 rounded-lg bg-brand-600 text-white px-2.5 h-7 text-[12px] font-semibold hover:bg-brand-700"><MessageCircle size={13} /> Ask Eve</button>
        <IconBtn title="Refresh" onClick={load}><RefreshCw size={14} /></IconBtn>
        <IconBtn title="Memory, voice, agent mode, thinking — Settings → Eve" href="/users?tab=settings&panel=eve"><Sliders size={14} /></IconBtn>
      </LeanHead>

      <LeanTabs tabs={tabs} value={tab} onChange={pick} />
      <p className="text-[12.5px] text-muted -mt-1.5 mb-3 px-1">{TAB_BLURB[tab]}</p>

      {tab === 'overview' && <NeedsTab isAdmin={!!isAdmin} canEdit={canEdit} onCount={setNCount} extras={
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {qCount ? <button onClick={() => pick('questions')} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-violet-800 hover:bg-violet-100"><HelpCircle size={13} /> {qCount} question{qCount === 1 ? '' : 's'} she needs answered</button> : null}
          {xCount ? <button onClick={() => pick('expectations')} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-amber-800 hover:bg-amber-100"><MessageSquareWarning size={13} /> {xCount} expectation note{xCount === 1 ? '' : 's'}</button> : null}
          {iCount ? <button onClick={() => pick('issues')} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-rose-800 hover:bg-rose-100">{iCount} open guest issue{iCount === 1 ? '' : 's'}</button> : null}
        </div>
      } />}
      {tab === 'issues' && <IssuesTab onCount={setICount} />}
      {tab === 'day' && <DayTab ov={ov} />}
      {tab === 'desks' && <DesksTab ov={ov} />}
      {tab === 'loops' && (loopsLevel === 'off'
        ? <LeanEmpty>Open loops are switched off for your role. Ask Jon to turn them on in Users → Roles.</LeanEmpty>
        : <OpenLoops canEdit={loopsLevel === 'edit' || loopsLevel === 'full'} embedded />)}
      {tab === 'questions' && <QuestionsTab canEdit={canEdit} onCount={n => { setQCount(n) }} />}
      {tab === 'expectations' && <ExpectationsTab canEdit={canEdit} onCount={n => { setXCount(n) }} />}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────
function OverviewTab({ ov, err, pick, isAdmin, canEdit, reload }: { ov: Overview | null; err: string; pick: (t: TabKey) => void; isAdmin: boolean; canEdit: boolean; reload: () => void }) {
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [draft, setDraft] = useState<Record<string, string>>({})
  if (err && !ov) return <LeanEmpty>{err}</LeanEmpty>
  if (!ov) return <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Reading her receipts…</LeanEmpty>
  const c = ov.today.counts || {}
  const byMode: Record<string, number> = c.by_mode || {}
  const hot = ov.loops.top || []
  const qs = ov.questionsTop || []
  const total = ov.today.waiting.length + hot.length + (ov.questions || 0) + (ov.expectations || 0)

  // Every action here is the same call the deeper tab makes — the inbox is a shortcut, not a fork.
  const call = async (id: string, fn: () => Promise<Response>, okText: string) => {
    setBusy(id); setNote('')
    try { const r = await fn().then(x => x.json()); setNote(r?.ok ? okText : (r?.error || 'Could not do that.')) } catch (e: any) { setNote(String(e?.message || e)) }
    setBusy(''); reload()
  }
  const decide = (id: string, op: 'approve' | 'reject') => call(id, () => fetch('/api/eve/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id }) }), op === 'approve' ? 'Done.' : 'Declined.')
  const closeLoop = (id: string, action: 'close' | 'dismiss') => call(id, () => fetch('/api/loops', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) }), action === 'close' ? 'Closed.' : 'Dismissed.')
  const answer = (id: string, op: 'answer' | 'dismiss') => call(id, () => fetch('/api/eve/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id, answer: draft[id] || '' }) }), op === 'answer' ? 'Remembered, with your name on it.' : 'Dismissed.')
  const KIND: Record<string, string> = { guest_ask: 'guest ask', problem: 'problem', commitment: 'promised', question: 'unanswered', decision: 'decision' }

  return (
    <div>
      {note ? <p className="text-[12px] text-muted mb-2 px-1">{note}</p> : null}
      {/* NEEDS YOU — one list, every kind of thing a person has to touch, with the action on the
          row. Proposals: approve or decline here (admins). Loops: close or open the thread.
          Questions: answer inline. Nothing here links away to be acted on somewhere else. */}
      <LeanSection title="Needs you" n={total} tone={ov.today.waiting.length || hot.some(h => h.urgent) ? 'rose' : undefined}>
        {total ? (
          <LeanList>
            {ov.today.waiting.map((w: any) => (
              <LeanRow key={w.id} name={w.summary || w.action || w.kind}
                meta={`she wants to ${String(w.action || w.kind).replace(/_/g, ' ')} · filed ${w.filed}`}
                tags={<><Tag tone="amber">wants a yes</Tag>{w.status !== 'waiting' ? <Tag tone={w.status === 'deferred' ? 'violet' : 'rose'}>{w.status}</Tag> : null}</>}
                actions={isAdmin ? <>
                  <IconBtn title="Approve — she does it now" tone="ok" onClick={() => decide(w.id, 'approve')} disabled={busy === w.id}><Check size={14} /></IconBtn>
                  <IconBtn title="Decline" tone="bad" onClick={() => decide(w.id, 'reject')} disabled={busy === w.id}><X size={14} /></IconBtn>
                </> : <IconBtn title="An admin approves this in Settings → Eve → Agent mode" href="/users?tab=settings&panel=eve"><ExternalLink size={14} /></IconBtn>}>
                {w.summary && String(w.summary).length > 40 ? <p className="text-[12.5px] text-ink/85">{w.summary}</p> : null}
              </LeanRow>
            ))}
            {hot.map(h => (
              <LeanRow key={h.id} name={h.summary}
                meta={`${h.unit || h.building || ''}${h.owner ? ` · ${h.owner}` : ' · nobody on it'}${h.channel ? ` · #${h.channel}` : ''} · ${h.hours < 48 ? `${h.hours}h` : `${Math.round(h.hours / 24)}d`} open`}
                tags={<><Tag tone={h.kind === 'guest_ask' ? 'rose' : 'slate'}>{KIND[h.kind] || h.kind}</Tag>{h.urgent ? <Tag tone="roseSolid">urgent</Tag> : null}{h.late ? <Tag tone="amber">late</Tag> : null}</>}
                actions={<>
                  <IconBtn title="Open the Slack thread" href={h.link}><ExternalLink size={14} /></IconBtn>
                  {canEdit ? <IconBtn title="It got done — close it" tone="ok" onClick={() => closeLoop(h.id, 'close')} disabled={busy === h.id}><Check size={14} /></IconBtn> : null}
                  {canEdit ? <IconBtn title="Not a real loop" tone="bad" onClick={() => closeLoop(h.id, 'dismiss')} disabled={busy === h.id}><X size={14} /></IconBtn> : null}
                </>} />
            ))}
            {qs.map(q => (
              <LeanRow key={q.id} name={q.question} meta={`${q.scope} · only you can answer this`} tags={<Tag tone="violet">question</Tag>} defaultOpen={false}>
                {q.why ? <p className="text-[12.5px] text-muted">Why she is asking: {q.why}</p> : null}
                {canEdit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="flex-1 min-w-[220px] rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink" placeholder="Tell her…" value={draft[q.id] || ''} onChange={e => setDraft({ ...draft, [q.id]: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter' && (draft[q.id] || '').trim()) answer(q.id, 'answer') }} />
                    <button onClick={() => answer(q.id, 'answer')} disabled={busy === q.id || !(draft[q.id] || '').trim()} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-50"><Check size={13} /> Save</button>
                    <button onClick={() => answer(q.id, 'dismiss')} disabled={busy === q.id} className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink px-2 py-2"><X size={13} /> Not worth answering</button>
                  </div>
                ) : null}
              </LeanRow>
            ))}
            {(ov.questions || 0) > qs.length ? (
              <LeanRow name={`${(ov.questions || 0) - qs.length} more question${(ov.questions || 0) - qs.length === 1 ? '' : 's'}`} meta="on the Questions tab" tags={<Tag tone="violet">question</Tag>}
                actions={<IconBtn title="Open Questions" onClick={() => pick('questions')}><HelpCircle size={14} /></IconBtn>} />
            ) : null}
            {ov.expectations ? (
              <LeanRow name={`${ov.expectations} expectation note${ov.expectations === 1 ? '' : 's'} for CS and admin`} meta="what guests keep being surprised by, and the copy that would fix it"
                tags={<Tag tone="amber">listing & comms</Tag>}
                actions={<IconBtn title="Open Expectations" onClick={() => pick('expectations')}><MessageSquareWarning size={14} /></IconBtn>} />
            ) : null}
            {ov.loops.open > hot.length ? (
              <LeanRow name={`${ov.loops.open - hot.length} more loop${ov.loops.open - hot.length === 1 ? '' : 's'} she is keeping tabs on`} meta={Object.entries(ov.loops.byKind).map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`).join(' · ') + ' · none of them urgent or late'}
                tags={<Tag>watching</Tag>}
                actions={<IconBtn title="Open loops" onClick={() => pick('loops')}><Radar size={14} /></IconBtn>} />
            ) : null}
          </LeanList>
        ) : <LeanEmpty>Nothing needs you. No proposals out, no loop urgent or late, no questions.</LeanEmpty>}
      </LeanSection>

      {/* WHAT SHE DID TODAY — her own receipts (my_actions_today), not a recollection. */}
      <LeanSection title={`Today · ${ov.day}`} right={
        <span className="flex items-center gap-1 flex-wrap">
          {(['act', 'propose', 'draft', 'deferred', 'observe'] as const).map(m => byMode[m] ? <Tag key={m} tone={MODE_TONE[m]}>{byMode[m]} {m === 'act' ? 'done' : m === 'observe' ? 'observed' : m + 'd'}</Tag> : null)}
          {c.on_watch_flags ? <Tag tone="sky">{c.on_watch_flags} on-watch</Tag> : null}
          {c.slack_nudges ? <Tag tone="sky">{c.slack_nudges} nudges</Tag> : null}
        </span>
      }>
        {ov.today.error ? <LeanEmpty>Her decision log could not be read: {ov.today.error}</LeanEmpty>
          : ov.today.decisions.length ? (
            <LeanList>
              {ov.today.decisions.map((d: any, i: number) => (
                <LeanRow key={i} name={d.summary || d.action} meta={`${d.time} · ${d.action}${d.by ? ' · ' + d.by : ''}`}
                  tags={<>
                    <Tag tone={MODE_TONE[d.mode] || 'slate'}>{d.mode}</Tag>
                    {d.outcome ? <Tag tone={/done|replied|ok/i.test(d.outcome) ? 'emerald' : /overdue|silent|gone/i.test(d.outcome) ? 'rose' : 'slate'}>{d.outcome}</Tag> : null}
                    {d.undone_at ? <Tag tone="rose">undone</Tag> : null}
                  </>}>
                  {d.why || d.outcome_note ? <p className="text-[12.5px] text-ink/85">{d.why}{d.outcome_note ? ` — ${d.outcome_note}` : ''}</p> : null}
                </LeanRow>
              ))}
            </LeanList>
          ) : <LeanEmpty>No decisions logged yet today.</LeanEmpty>}
        {ov.today.gaps?.length ? <p className="text-[11.5px] text-muted mt-1.5 px-1">{ov.today.gaps.join(' ')}</p> : null}
      </LeanSection>

      {/* HER DESKS — on or off, and when each last actually ran. The switch is in Settings → Eve. */}
      <LeanSection title="Desks and night shift" n={ov.desks.length} right={<a href="/users?tab=settings&panel=eve" className="text-brand-700 hover:underline text-[12px]">switch them in Settings → Eve</a>}>
        {ov.desks.length ? (
          <LeanList>
            {ov.desks.map(d => {
              const stale = d.last && (Date.now() - Date.parse(d.last.at)) > 36 * 3600000
              return (
                <LeanRow key={d.key} name={d.label} meta={d.runs}
                  tags={<>
                    <Tag tone={d.on === false ? 'slate' : 'emerald'}>{d.on === null ? 'always on' : d.on ? 'on' : 'off'}</Tag>
                    {d.last ? <Tag tone={!d.last.ok ? 'rose' : stale ? 'amber' : 'slate'} title={d.last.at}>{d.last.ok ? 'ran' : 'failed'} {ago(d.last.at)}{d.last.did != null ? ` · ${d.last.did}` : ''}</Tag> : <Tag tone="slate">no run recorded</Tag>}
                  </>}>
                  <p className="text-[12.5px] text-ink/85">{d.what}</p>
                  {d.last?.error ? <p className="text-[12px] text-rose-700">{d.last.error}</p> : null}
                </LeanRow>
              )
            })}
          </LeanList>
        ) : <LeanEmpty>No Eve automations are registered.</LeanEmpty>}
      </LeanSection>

      <p className="text-[12px] text-muted px-1 inline-flex items-center gap-1.5">
        <Brain size={13} /> Her memory, beliefs, voice, agent mode and the thinking feed live in <a href="/users?tab=settings&panel=eve" className="text-brand-700 hover:underline">Settings → Eve</a>.
      </p>
    </div>
  )
}

// ── Questions ─────────────────────────────────────────────────────────────────────────────────
type Question = {
  id: string; question: string; why: string | null; scope: string; kind: string
  asked_count: number; source: string; created_at: string; status?: string; answer?: string | null; answered_by?: string | null; answered_at?: string | null
}

function QuestionsTab({ canEdit, onCount }: { canEdit: boolean; onCount: (n: number) => void }) {
  const [status, setStatus] = useState<'open' | 'answered'>('open')
  const [qs, setQs] = useState<Question[] | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [gen, setGen] = useState<string>('')

  const load = useCallback(async (st: 'open' | 'answered') => {
    try {
      const r = await fetch('/api/eve/questions?status=' + st, { cache: 'no-store' }).then(x => x.json())
      const list: Question[] = r?.questions || []
      setQs(list)
      if (st === 'open') onCount(list.length)
    } catch { setQs([]) }
  }, [onCount])
  useEffect(() => { setQs(null); load(status) }, [status, load])

  async function act(id: string, op: 'answer' | 'dismiss') {
    setBusy(id)
    try {
      const r = await fetch('/api/eve/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id, answer: draft[id] || '' }) }).then(x => x.json())
      if (r?.ok) { setQs(x => { const next = (x || []).filter(q => q.id !== id); if (status === 'open') onCount(next.length); return next }) }
    } finally { setBusy('') }
  }
  async function generate() {
    setGen('…')
    try {
      const r = await fetch('/api/eve/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'generate' }) }).then(x => x.json())
      setGen(r?.ok ? `${r.asked || 0} new` : 'failed')
      if (r?.questions) { setQs(r.questions); onCount(r.questions.length) }
    } catch { setGen('failed') }
  }

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="inline-flex rounded-xl border border-line overflow-hidden text-[12.5px]">
          {(['open', 'answered'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 font-semibold border-l border-line first:border-l-0 ${status === s ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
              {s === 'open' ? 'Open' : 'Answered'}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted">Everything else she knows she worked out from records. These are the things only a person can tell her — an answer becomes a memory with your name on it, and outranks anything she concluded herself.</p>
        {canEdit && status === 'open' ? (
          <button onClick={generate} disabled={gen === '…'} className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border border-line bg-white px-3 py-1.5 text-ink hover:bg-app disabled:opacity-50">
            {gen === '…' ? <Loader2 size={13} className="animate-spin" /> : <HelpCircle size={13} />} Ask her what she is unsure of{gen && gen !== '…' ? ` · ${gen}` : ''}
          </button>
        ) : null}
      </div>
      {qs == null ? <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Loading…</LeanEmpty>
        : !qs.length ? <LeanEmpty>{status === 'open' ? 'She has nothing to ask right now.' : 'No answered questions yet.'}</LeanEmpty>
        : (
          <LeanList>
            {qs.map(q => (
              <LeanRow key={q.id} name={q.question} meta={`${q.scope}${q.asked_count > 1 ? ` · asked ${q.asked_count}×` : ''}${q.source === 'eve' ? ' · came up in conversation' : ''}`}
                tags={<>{q.kind ? <Tag tone="violet">{q.kind}</Tag> : null}{status === 'answered' && q.answered_by ? <Tag tone="emerald">by {q.answered_by}</Tag> : null}</>}
                defaultOpen={status === 'open'}>
                {/* The row clips a long question; the question in full is the first line inside. */}
                {q.question.length > 40 ? <p className="text-[13px] font-semibold text-ink">{q.question}</p> : null}
                {q.why ? <p className="text-[12.5px] text-muted">Why she is asking: {q.why}</p> : null}
                {status === 'answered' && q.answer ? <p className="text-[12.5px] text-ink/85">Answer: {q.answer}</p> : null}
                {status === 'open' && canEdit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input className="flex-1 min-w-[220px] rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink" placeholder="Tell her…"
                      value={draft[q.id] || ''} onChange={e => setDraft({ ...draft, [q.id]: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter' && (draft[q.id] || '').trim()) act(q.id, 'answer') }} />
                    <button onClick={() => act(q.id, 'answer')} disabled={busy === q.id || !(draft[q.id] || '').trim()}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-50"><Check size={13} /> Save</button>
                    <button onClick={() => act(q.id, 'dismiss')} disabled={busy === q.id} className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink px-2 py-2"><X size={13} /> Not worth answering</button>
                  </div>
                ) : null}
              </LeanRow>
            ))}
          </LeanList>
        )}
    </div>
  )
}

// ── Expectations ──────────────────────────────────────────────────────────────────────────────
type XNote = {
  id: string; building: string; theme: string; title: string; what_guests_hit: string; gap: string
  fix_where: string; proposed_copy: string; owner: 'cs' | 'admin'; priority: 1 | 2 | 3
  evidence: { quote: string; unit: string; source: string; when: string; rating?: number | null }[]
  guests: number; status: string; status_by?: string | null; status_at?: string | null; status_note?: string | null
  first_seen: string; last_seen: string; runs: number; reopened?: string | null
  copy_history?: { at: string; by: string; instruction: string; before: string }[]
  copy_edited_by?: string | null
  check?: { at: string; by: string; summary: string; units: { unit: string; task: string | null; taskDate: string | null; taskPhotos: number; listingPhotos: number; verdict: string; differences: string[]; note: string }[] }
  coverage?: Coverage
  // Where she says it goes, decided when the note is written and revised by the coverage check.
  where?: { sections: string[]; why: string; by: 'desk' | 'coverage'; at: string } | null
  // The [bracket] facts she will not invent, filed as questions so a person fills them in.
  gaps?: { token: string; question: string; qid: string | null }[]
  published?: { at: string; by: string; sections: string[]; labels: string[]; listings: number; okCount: number; failCount: number }
}
// Is it already said? — every listing section on every unit, the messages we sent guests of that
// building, the guidebooks, the FAQ (lib/eve/expectations.ts coverageForNote).
type Coverage = {
  at: string; by: string; topic: string; building: string; units: number
  listing: { section: string; label: string; mentioning: number; sample: { unit: string; sentence: string } | null; variants: number }[]
  messages: { total: number; mentioning: number; conversations: number; samples: { unit: string; when: string; sentence: string }[] }
  guidebook: { units_with_book: number; mentioning: number; sample: { unit: string; sentence: string } | null }
  faq: { entries: number; mentioning: number; sample: { unit: string; sentence: string } | null }
  verdict: 'not_covered' | 'partly' | 'covered'
  why: string; best_sections?: string[]; best_section: string; placement_note: string; revised_copy: string | null
  open_questions?: { question: string; why: string }[]
}
// What Publish would write: for each chosen section, the full text before and after on a
// representative unit. More than one section is allowed — the fee can belong next to the parking
// sentence in Guest access and in House rules.
type SectionPlan = { section: string; label: string; head: string; block: string; representative: string; before: string; after: string; same: number; differ: { unit: string; length: number }[] }
type Preview = { building: string; chosen: string[]; units: number; plan: SectionPlan[]; sections: { key: string; label: string; filled: number }[]; why: string }
const SECTION_LABEL: Record<string, string> = { access: 'Guest access', neighborhood: 'Neighborhood', transit: 'Getting around', notes: 'Other notes', houseRules: 'House rules', summary: 'Summary', space: 'The space' }
const labelsOf = (keys: string[] | undefined) => (keys || []).map(k => SECTION_LABEL[k] || k).join(' + ')
const blanksIn = (copy: string): string[] => Array.from(new Set(Array.from(String(copy || '').matchAll(/\[([^\]\n]{1,60})\]/g)).map(m => m[1].trim()).filter(Boolean))).slice(0, 6)
const VERDICT: Record<string, { tone: 'emerald' | 'amber' | 'rose'; label: string }> = {
  not_covered: { tone: 'emerald', label: 'not said anywhere' },
  partly: { tone: 'amber', label: 'partly said already' },
  covered: { tone: 'rose', label: 'we already say this' },
}
const PUBLISHABLE = new Set(['listing', 'house_rules', 'faq'])
const CHECKABLE = /photo|picture|as described|advertis|match|not as|smaller|different from|misleading|what is in the unit/i
const FIX_LABEL: Record<string, string> = { listing: 'Listing', house_rules: 'House rules', pre_arrival: 'Pre-arrival message', checkin_guide: 'Check-in guide', faq: 'FAQ', guidebook: 'Guidebook' }

function ExpectationsTab({ canEdit, onCount }: { canEdit: boolean; onCount: (n: number) => void }) {
  const [status, setStatus] = useState<'open' | 'done' | 'dismissed'>('open')
  const [notes, setNotes] = useState<XNote[] | null>(null)
  const [busy, setBusy] = useState('')
  const [run, setRun] = useState('')
  const [copied, setCopied] = useState('')

  const load = useCallback(async (st: 'open' | 'done' | 'dismissed') => {
    try {
      const r = await fetch('/api/eve/expectations?status=' + st, { cache: 'no-store' }).then(x => x.json())
      const list: XNote[] = r?.notes || []
      setNotes(list)
      if (st === 'open') onCount(list.length)
    } catch { setNotes([]) }
  }, [onCount])
  useEffect(() => { setNotes(null); load(status) }, [status, load])

  async function mark(id: string, st: 'open' | 'done' | 'dismissed') {
    setBusy(id)
    try {
      const r = await fetch('/api/eve/expectations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'status', id, status: st }) }).then(x => x.json())
      if (r?.ok) setNotes(x => { const next = (x || []).filter(n => n.id !== id); if (status === 'open') onCount(next.length); return next })
    } finally { setBusy('') }
  }
  async function runNow() {
    setRun('…')
    try {
      const r = await fetch('/api/eve/expectations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'run' }) }).then(x => x.json())
      if (r?.ok) { setRun(`${r.written} note${r.written === 1 ? '' : 's'}${r.reopened ? `, ${r.reopened} reopened` : ''}`); setStatus('open'); setNotes(r.notes || []); onCount((r.notes || []).length) }
      else setRun('failed: ' + (r?.error || 'unknown'))
    } catch (e: any) { setRun('failed: ' + String(e?.message || e)) }
  }
  const copy = async (n: XNote) => { try { await navigator.clipboard.writeText(n.proposed_copy); setCopied(n.id); setTimeout(() => setCopied(''), 1500) } catch { /* no clipboard */ } }
  const patchNote = (id: string, patch: Partial<XNote>) => setNotes(x => (x || []).map(n => n.id === id ? { ...n, ...patch } : n))

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="inline-flex rounded-xl border border-line overflow-hidden text-[12.5px]">
          {(['open', 'done', 'dismissed'] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 font-semibold border-l border-line first:border-l-0 ${status === s ? 'bg-brand-600 text-white' : 'bg-white text-muted hover:text-ink'}`}>
              {s === 'open' ? 'To do' : s === 'done' ? 'Updated' : 'Not a gap'}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-muted max-w-[60ch]">What guests keep being surprised by, from reviews and their messages, and the sentence for the listing, the rules or the pre-arrival message that would have spared them. Before anything is published she shows you what we already say, which section it lands in, and the text before and after.</p>
        {canEdit ? (
          <button onClick={runNow} disabled={run === '…'} className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-lg border border-line bg-white px-3 py-1.5 text-ink hover:bg-app disabled:opacity-50" title="Reads the last 45 days again. Runs on its own every Monday.">
            {run === '…' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Read the last 45 days now{run && run !== '…' ? ` · ${run}` : ''}
          </button>
        ) : null}
      </div>
      {notes == null ? <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Loading…</LeanEmpty>
        : !notes.length ? <LeanEmpty>{status === 'open' ? 'Nothing waiting. Either guests are not being surprised, or the desk has not run yet — it runs every Monday, or now with the button above.' : status === 'done' ? 'Nothing marked updated yet.' : 'Nothing dismissed.'}</LeanEmpty>
        : (
          <LeanList>
            {notes.map(n => (
              <LeanRow key={n.id} name={n.title} meta={`${n.building} · ${n.theme} · ${n.guests} guest${n.guests === 1 ? '' : 's'} · last ${n.last_seen}`}
                tint={n.priority === 1 && status === 'open' ? 'amber' : undefined}
                tags={<>
                  <Tag tone={n.priority === 1 ? 'rose' : n.priority === 2 ? 'amber' : 'slate'}>P{n.priority}</Tag>
                  <Tag tone="sky">{FIX_LABEL[n.fix_where] || n.fix_where}</Tag>
                  <Tag tone={n.owner === 'cs' ? 'violet' : 'brand'}>{n.owner === 'cs' ? 'CS' : 'Admin'}</Tag>
                  {n.reopened ? <Tag tone="rose">reopened</Tag> : null}
                </>}
                actions={canEdit && status === 'open' ? (
                  <>
                    <IconBtn title="Updated — the copy is live" tone="ok" onClick={() => mark(n.id, 'done')} disabled={busy === n.id}><Check size={14} /></IconBtn>
                    <IconBtn title="Not a gap — we already say this, or it is not ours to say" tone="bad" onClick={() => mark(n.id, 'dismissed')} disabled={busy === n.id}><X size={14} /></IconBtn>
                  </>
                ) : canEdit ? (
                  <IconBtn title="Back to the to-do list" onClick={() => mark(n.id, 'open')} disabled={busy === n.id}><RotateCcw size={14} /></IconBtn>
                ) : null}
                defaultOpen={status === 'open' && n.priority === 1}>
                <p className="text-[13px] text-ink">{n.what_guests_hit}</p>
                {n.reopened ? <p className="text-[12px] text-rose-700">{n.reopened}</p> : null}
                {n.evidence?.length ? (
                  <ul className="space-y-1">
                    {n.evidence.map((e, i) => (
                      <li key={i} className="text-[12px] text-muted">“{e.quote}” <span className="text-ink/70">— {e.unit}{e.rating != null ? `, ${e.rating}★` : ''}, {e.source}, {e.when}</span></li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-[12.5px] text-ink/85"><span className="font-semibold">The gap:</span> {n.gap}</p>
                <CopyPanel n={n} canEdit={canEdit && status === 'open'} copied={copied === n.id} onCopy={() => copy(n)} onPatch={patch => patchNote(n.id, patch)} onPublished={() => setNotes(x => { const next = (x || []).filter(q => q.id !== n.id); if (status === 'open') onCount(next.length); return next })} />
                {n.status !== 'open' && n.status_by ? <p className="text-[11.5px] text-muted">{n.status === 'done' ? 'Marked updated' : 'Dismissed'} by {n.status_by}{n.status_at ? ' · ' + String(n.status_at).slice(0, 10) : ''}{n.status_note ? ' · ' + n.status_note : ''}</p> : null}
              </LeanRow>
            ))}
          </LeanList>
        )}
    </div>
  )
}

// THE COPY, AND EVERYTHING A PERSON DOES TO IT BEFORE IT GOES ANYWHERE.
//
// Jon, 2026-09-28: "It should show where it's going to add it into the description. Check the
// entire listing to make sure that it's not in it. Also check all the messages that go out to a
// guest… I can't just rewrite it, not knowing how it adds it or where it adds it." Then: "When you
// go to post, it should tell you where in the listing description it's going to post. Is it going
// to be in other notes? Is it going to be about the space? Is it going to be in multiple sections?
// When it makes a recommendation, it should recommend where it goes. Also, when we're optimizing
// listings, if there are questions that these things prompt up, it should auto-prompt us to fill
// those sections."
//
// So the note itself says where it goes — "Goes in: Guest access + House rules", her words, before
// anything is clicked — and any fact she will not invent is a field to fill in right there, which
// also answers the question she filed for it. Publish is then three steps on one panel:
//   1. IS IT ALREADY SAID?  Every section of the listing on every unit, every message we sent
//      guests there in 60 days, the guidebooks and the FAQ, with the sentences found — then her
//      verdict, and the questions the evidence raises (a price nobody wrote down, our messages
//      saying per night where the reviews say per day).
//   2. WHERE IT GOES.  Her sections, pre-selected; any of the five can be added or removed.
//   3. WHAT CHANGES.  Per section, the full text before and after on a representative unit, the
//      added block marked, and how many units share that text.
function CopyPanel({ n, canEdit, copied, onCopy, onPatch, onPublished }: { n: XNote; canEdit: boolean; copied: boolean; onCopy: () => void; onPatch: (p: Partial<XNote>) => void; onPublished: () => void }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'rewrite' | 'publish'>('view')
  const [draft, setDraft] = useState(n.proposed_copy)
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [force, setForce] = useState(false)
  const [fill, setFill] = useState<Record<string, string>>({})
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const post = (body: any) => fetch('/api/eve/expectations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: n.id, ...body }) }).then(x => x.json())

  async function save() {
    setBusy('edit')
    try { const r = await post({ op: 'edit', proposed_copy: draft }); if (r?.ok) { onPatch({ proposed_copy: draft }); setMode('view'); setMsg('Saved.'); setPreview(null) } else setMsg(r?.error || 'Could not save') } finally { setBusy('') }
  }
  async function rewrite() {
    setBusy('rewrite')
    try { const r = await post({ op: 'rewrite', instruction: ask }); if (r?.ok) { onPatch({ proposed_copy: r.proposed_copy, copy_history: (n.copy_history || []).concat([{ at: new Date().toISOString(), by: 'you', instruction: ask, before: n.proposed_copy }]) }); setDraft(r.proposed_copy); setAsk(''); setMode('view'); setMsg('Rewritten.'); setPreview(null) } else setMsg(r?.error || 'Could not rewrite') } finally { setBusy('') }
  }
  async function useRevised(text: string) {
    setBusy('edit')
    try { const r = await post({ op: 'edit', proposed_copy: text }); if (r?.ok) { onPatch({ proposed_copy: text }); setDraft(text); setMsg('Copy replaced with her version.'); await loadPreview(preview?.chosen) } else setMsg(r?.error || 'Could not save') } finally { setBusy('') }
  }
  // THE BLANKS — filling one here also answers the question she filed for it, so it is remembered.
  async function fillIn() {
    setBusy('fill')
    try {
      const r = await post({ op: 'fill', values: fill })
      if (r?.ok) { onPatch({ proposed_copy: r.proposed_copy }); setDraft(r.proposed_copy); setFill({}); setMsg(r.answered ? `Filled in, and ${r.answered} question${r.answered === 1 ? '' : 's'} answered in her memory.` : 'Filled in.'); if (preview) await loadPreview(preview.chosen) }
      else setMsg(r?.error || 'Could not fill that in')
    } finally { setBusy('') }
  }
  async function answerGap(qid: string, text: string) {
    setBusy(qid)
    try {
      const r = await fetch('/api/eve/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'answer', id: qid, answer: text }) }).then(x => x.json())
      setMsg(r?.ok ? 'Answered — she will remember it with your name on it.' : (r?.error || 'Could not save that'))
      if (r?.ok) setAnswers({ ...answers, [qid]: '' })
    } finally { setBusy('') }
  }
  async function check() {
    setBusy('check'); setMsg('Looking at the crew photos next to the listing photos…')
    try { const r = await post({ op: 'check' }); if (r?.ok) { onPatch({ check: r.check }); setMsg('') } else setMsg(r?.error || 'Could not check') } finally { setBusy('') }
  }
  // STEP 1 — the whole listing, our sent messages, the guidebooks, the FAQ; plus the questions it raises.
  async function coverage() {
    setBusy('coverage'); setMsg('Reading every section of the listing, the messages we sent guests here, the guidebooks and the FAQ…')
    try {
      const r = await post({ op: 'coverage' })
      if (r?.ok) {
        onPatch({ coverage: r.coverage, gaps: r.gaps || [], where: { sections: r.coverage?.best_sections || [r.coverage?.best_section], why: r.coverage?.placement_note || '', by: 'coverage', at: r.coverage?.at } })
        setMsg(r.asked ? `${r.asked} question${r.asked === 1 ? '' : 's'} filed for the team.` : '')
        await loadPreview(r.coverage?.best_sections)
      } else setMsg(r?.error || 'Could not check what we already say')
    } finally { setBusy('') }
  }
  // STEPS 2 AND 3 — the sections, and the before/after for each on a representative unit.
  async function loadPreview(sections?: string[]) {
    setBusy('preview')
    try { const r = await post({ op: 'preview', sections }); if (r?.ok) setPreview(r as Preview); else setMsg(r?.error || 'Cannot publish this one') } finally { setBusy('') }
  }
  const toggleSection = (key: string) => {
    if (!preview) return
    const next = preview.chosen.includes(key) ? preview.chosen.filter(k => k !== key) : preview.chosen.concat([key])
    if (!next.length) { setMsg('It has to go somewhere — pick at least one section.'); return }
    loadPreview(next)
  }
  async function openPublish() {
    setMode('publish'); setMsg('')
    if (!preview) await loadPreview(n.where?.sections)
  }
  async function publish() {
    if (!preview) return
    setBusy('publish'); setMsg('Writing to Guesty…')
    try {
      const r = await post({ op: 'publish', sections: preview.chosen })
      if (r?.ok) { setMsg(`Published to ${r.okCount} of ${r.listings} listing${r.listings === 1 ? '' : 's'} — ${(r.labels || []).join(' + ')}${r.failCount ? ` · ${r.failCount} failed` : ''}.`); setMode('view'); setTimeout(onPublished, 1400) }
      else setMsg(r?.error || 'Publish failed')
    } finally { setBusy('') }
  }
  const publishable = PUBLISHABLE.has(n.fix_where)
  const checkable = CHECKABLE.test(n.title + ' ' + n.gap + ' ' + n.what_guests_hit + ' ' + n.theme)
  const blanks = blanksIn(n.proposed_copy)
  const blank = blanks.length > 0
  const cov = n.coverage || null
  const where = n.where && n.where.sections?.length ? n.where : null
  const openQs = (n.gaps || []).filter(g => !g.token && g.qid)

  return (
    <div className="rounded-xl border border-line bg-app px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Proposed copy · {FIX_LABEL[n.fix_where] || n.fix_where} · {n.owner === 'cs' ? 'customer service' : 'admin'}{n.copy_edited_by ? ' · edited' : ''}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && mode === 'view' ? <button onClick={() => { setDraft(n.proposed_copy); setMode('edit') }} className="text-[11.5px] font-semibold text-brand-700 hover:underline">Edit</button> : null}
          {canEdit && mode === 'view' ? <button onClick={() => setMode('rewrite')} className="text-[11.5px] font-semibold text-brand-700 hover:underline">Rewrite…</button> : null}
          <button onClick={onCopy} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 hover:underline"><Copy size={12} /> {copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>

      {mode === 'edit' ? (
        <div className="space-y-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink" />
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy === 'edit' || !draft.trim()} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-50"><Check size={13} /> Save</button>
            <button onClick={() => setMode('view')} className="text-xs font-semibold text-muted hover:text-ink px-2 py-1.5">Cancel</button>
          </div>
        </div>
      ) : mode === 'rewrite' ? (
        <div className="space-y-2">
          <p className="text-[13px] text-ink whitespace-pre-wrap">{n.proposed_copy}</p>
          <input value={ask} onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ask.trim()) rewrite() }} placeholder="Tell her how to rewrite it — shorter, warmer, say the fee is $45, mention the gate code comes the day before…" className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[13px] text-ink" />
          <div className="flex items-center gap-2">
            <button onClick={rewrite} disabled={busy === 'rewrite' || !ask.trim()} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-50">{busy === 'rewrite' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Rewrite</button>
            <button onClick={() => setMode('view')} className="text-xs font-semibold text-muted hover:text-ink px-2 py-1.5">Cancel</button>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-ink whitespace-pre-wrap">{n.proposed_copy}</p>
      )}

      {/* WHERE IT GOES — part of the recommendation, said before anything is clicked. */}
      {publishable && where && mode !== 'edit' ? (
        <p className="text-[12px] text-muted">
          <span className="text-ink/80 font-semibold">Goes in:</span> {labelsOf(where.sections)}
          {where.sections.length > 1 ? <span className="text-ink/50"> · both sections</span> : null}
          {where.why ? ` — ${where.why}` : null}
          <span className="text-ink/45"> ({where.by === 'coverage' ? 'after reading the listings' : 'her first read'})</span>
        </p>
      ) : publishable && mode !== 'edit' ? (
        <p className="text-[12px] text-muted">Where it goes is decided when she checks the listings — open Publish.</p>
      ) : null}

      {/* THE BLANKS SHE WILL NOT INVENT — fields, right here, that also answer her question. */}
      {blank && canEdit && (mode === 'view' || mode === 'publish') ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 space-y-1.5">
          <p className="text-[12px] text-amber-900">She left {blanks.length === 1 ? 'a blank' : blanks.length + ' blanks'} because the fact is not hers to invent. Fill {blanks.length === 1 ? 'it' : 'them'} in and it goes into the copy — and into her memory, so she never asks again.</p>
          <div className="flex items-end gap-2 flex-wrap">
            {blanks.map(t => (
              <label key={t} className="text-[11px] font-semibold text-amber-900">
                {t}
                <input value={fill[t] || ''} onChange={e => setFill({ ...fill, [t]: e.target.value })} onKeyDown={e => { if (e.key === 'Enter' && Object.values(fill).some(v => v.trim())) fillIn() }}
                  placeholder="…" className="block mt-0.5 w-44 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[13px] text-ink font-normal" />
              </label>
            ))}
            <button onClick={fillIn} disabled={busy === 'fill' || !Object.values(fill).some(v => v.trim())} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-50">{busy === 'fill' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Fill in</button>
          </div>
        </div>
      ) : null}

      {/* ── PUBLISH: the three steps, on the panel, in order ─────────────────────────────────── */}
      {mode === 'publish' ? (
        <div className="rounded-lg border border-line bg-white px-3 py-2.5 space-y-3">
          {/* 1 — is it already said? */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">1 · Do we already say this?</p>
            {!cov ? (
              <div className="space-y-1.5">
                <p className="text-[12.5px] text-muted">Nothing is written until this has run. She reads all seven sections of the listing on every unit at {n.building}, every message we sent guests there in the last 60 days, the guidebooks and the FAQ, shows you the sentences she finds, and files a question for anything nobody has settled.</p>
                <button onClick={coverage} disabled={busy === 'coverage'} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-line bg-white px-3 py-1.5 text-ink hover:bg-app disabled:opacity-50">
                  {busy === 'coverage' ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Check the listing and the message threads
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="flex items-center gap-2 flex-wrap text-[12.5px] text-ink">
                  <Tag tone={VERDICT[cov.verdict]?.tone || 'slate'}>{VERDICT[cov.verdict]?.label || cov.verdict}</Tag>
                  <span>{cov.why}</span>
                </p>
                <ul className="space-y-0.5">
                  {cov.listing.map(l => (
                    <li key={l.section} className="text-[12px] text-muted">
                      <span className="text-ink/80 font-semibold">{l.label}</span> — {l.mentioning ? <>{l.mentioning} of {cov.units} units: “{l.sample?.sentence}” <span className="text-ink/60">({l.sample?.unit})</span></> : 'no mention on any unit'}{l.variants > 1 ? <span className="text-ink/50"> · {l.variants} different versions of this section</span> : null}
                    </li>
                  ))}
                  <li className="text-[12px] text-muted">
                    <span className="text-ink/80 font-semibold">Messages we sent guests</span> — {cov.messages.mentioning} of {cov.messages.total} in {cov.messages.conversations} threads, last 60 days{cov.messages.samples.length ? ':' : '.'}
                    {cov.messages.samples.map((s, i) => <span key={i} className="block pl-3">“{s.sentence}” <span className="text-ink/60">({s.unit}, {s.when})</span></span>)}
                  </li>
                  <li className="text-[12px] text-muted"><span className="text-ink/80 font-semibold">Guidebooks</span> — {cov.guidebook.mentioning} of {cov.guidebook.units_with_book} mention it{cov.guidebook.sample ? `: “${cov.guidebook.sample.sentence}”` : '.'}</li>
                  <li className="text-[12px] text-muted"><span className="text-ink/80 font-semibold">FAQ</span> — {cov.faq.mentioning} of {cov.faq.entries} entries mention it{cov.faq.sample ? `: “${cov.faq.sample.sentence}”` : '.'}</li>
                </ul>
                {cov.revised_copy ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 space-y-1">
                    <p className="text-[12px] text-amber-900">Given what is already there, she would say it this way instead:</p>
                    <p className="text-[12.5px] text-ink whitespace-pre-wrap">{cov.revised_copy}</p>
                    <button onClick={() => useRevised(cov.revised_copy as string)} disabled={busy === 'edit'} className="text-[11.5px] font-semibold text-brand-700 hover:underline">Use this copy</button>
                  </div>
                ) : null}
                {/* WHAT THIS PROMPTED — answer it here; it becomes a memory with your name on it. */}
                {openQs.length ? (
                  <div className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 space-y-1.5">
                    <p className="text-[12px] text-violet-900">{openQs.length === 1 ? 'This raised a question' : `This raised ${openQs.length} questions`} nobody has settled. {canEdit ? 'Answer here, or on the Questions tab.' : 'They are on the Questions tab.'}</p>
                    {openQs.map(g => (
                      <div key={g.qid as string} className="space-y-1">
                        <p className="text-[12.5px] text-ink">{g.question}</p>
                        {canEdit ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <input value={answers[g.qid as string] || ''} onChange={e => setAnswers({ ...answers, [g.qid as string]: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Enter' && (answers[g.qid as string] || '').trim()) answerGap(g.qid as string, answers[g.qid as string]) }}
                              placeholder="Tell her…" className="flex-1 min-w-[220px] rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-[13px] text-ink" />
                            <button onClick={() => answerGap(g.qid as string, answers[g.qid as string] || '')} disabled={busy === g.qid || !(answers[g.qid as string] || '').trim()} className="inline-flex items-center gap-1 text-xs font-semibold bg-brand-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-50"><Check size={13} /> Save</button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <button onClick={coverage} disabled={busy === 'coverage'} className="text-[11.5px] font-semibold text-brand-700 hover:underline">{busy === 'coverage' ? 'Checking…' : 'Check again'} <span className="text-muted font-normal">· last checked {String(cov.at).slice(0, 10)}</span></button>
              </div>
            )}
          </div>

          {/* 2 — which section, or sections, of the description */}
          {preview ? (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">2 · Where it goes in the description</p>
              <p className="text-[12.5px] text-ink">She would put it in <span className="font-semibold">{labelsOf(preview.chosen)}</span>. Click to add or remove a section — it can go in more than one.</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {preview.sections.map(s => {
                  const on = preview.chosen.includes(s.key)
                  return (
                    <button key={s.key} onClick={() => toggleSection(s.key)} disabled={busy === 'preview'}
                      title={`${s.filled} of ${preview.units} units have text in ${s.label} today`}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-muted hover:text-ink'}`}>
                      {on ? <Check size={12} /> : null}{s.label} <span className={on ? 'text-white/70' : 'text-ink/40'}>{s.filled}/{preview.units}</span>
                    </button>
                  )
                })}
              </div>
              {preview.why ? <p className="text-[12px] text-muted">Her reason: {preview.why}</p> : null}
            </div>
          ) : null}

          {/* 3 — each section before and after, in full */}
          {preview ? (
            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">3 · What changes on the listing</p>
              {preview.plan.map(pl => (
                <div key={pl.section} className="space-y-1">
                  <p className="text-[12.5px] text-ink">It appends a block under “{pl.head}” at the end of <span className="font-semibold">{pl.label}</span> on all {preview.units} live listings at {preview.building}, on every channel. Whatever a person wrote in that section stays; only the block is rewritten next time.</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-semibold text-muted mb-1">{pl.label} today · {pl.representative}</p>
                      <pre className="text-[12px] text-ink/70 whitespace-pre-wrap rounded-lg border border-line bg-app px-3 py-2 font-sans max-h-64 overflow-auto">{pl.before || '(empty)'}</pre>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-muted mb-1">After publishing</p>
                      <pre className="text-[12px] whitespace-pre-wrap rounded-lg border border-emerald-200 bg-white px-3 py-2 font-sans max-h-64 overflow-auto">{(() => { const cut = pl.after.indexOf(pl.block); const keep = cut >= 0 ? pl.after.slice(0, cut) : pl.after; const added = cut >= 0 ? pl.after.slice(cut) : ''; return <><span className="text-ink/70">{keep}</span><span className="bg-emerald-50 text-emerald-900">{added}</span></> })()}</pre>
                    </div>
                  </div>
                  <p className="text-[12px] text-muted">
                    {pl.same} of {preview.units} units have exactly this text in {pl.label} today and end up identical.
                    {pl.differ.length ? <> {pl.differ.length} differ and keep their own — {pl.differ.slice(0, 6).map(d => d.unit).join(', ')}{pl.differ.length > 6 ? `, +${pl.differ.length - 6} more` : ''}; the same block is appended to each.</> : null}
                  </p>
                </div>
              ))}
            </div>
          ) : busy === 'preview' ? <p className="text-[12px] text-muted"><Loader2 size={13} className="animate-spin inline mr-1" /> Reading the listings…</p> : null}

          <div className="flex items-center gap-2 flex-wrap pt-0.5">
            <button onClick={publish} disabled={busy === 'publish' || !preview || blank || (!cov && !force)}
              title={blank ? 'Fill in the blank above first' : !cov && !force ? 'Run the check above first' : `Writes to ${labelsOf(preview?.chosen)} on ${preview?.units} listings`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-50">
              {busy === 'publish' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Publish to {preview?.units || ''} listing{preview?.units === 1 ? '' : 's'}{preview ? ` · ${labelsOf(preview.chosen)}` : ''}
            </button>
            <button onClick={() => setMode('view')} className="text-xs font-semibold text-muted hover:text-ink px-2 py-1.5">Not now</button>
            {blank ? <span className="text-[11.5px] text-amber-700">Fill in the blank above first.</span> : null}
            {!cov && !force && !blank ? <button onClick={() => setForce(true)} className="text-[11.5px] text-muted hover:text-ink underline">publish without checking</button> : null}
            {cov?.verdict === 'covered' ? <span className="text-[11.5px] text-rose-700">She thinks this is already covered — read her reason before publishing.</span> : null}
          </div>
        </div>
      ) : null}

      {n.copy_history?.length ? (
        <details className="text-[11.5px] text-muted"><summary className="cursor-pointer">{n.copy_history.length} earlier version{n.copy_history.length === 1 ? '' : 's'}</summary>
          <ul className="mt-1 space-y-1">{n.copy_history.slice().reverse().map((h, i) => <li key={i}>“{h.instruction}” · {String(h.at).slice(0, 10)} — <span className="text-ink/70">{h.before}</span></li>)}</ul>
        </details>
      ) : null}

      {mode === 'view' && canEdit ? (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {publishable ? (
            <button onClick={openPublish} disabled={busy === 'preview'} title="Shows what we already say, which sections it goes in, and the before and after — then publishes"
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-50">{busy === 'preview' ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />} Publish to listings…</button>
          ) : <span className="text-[11.5px] text-muted">Goes in the {(FIX_LABEL[n.fix_where] || n.fix_where).toLowerCase()} — copy it there.</span>}
          {checkable ? (
            <button onClick={check} disabled={busy === 'check'} title="Puts the crew's photos from the last completed clean or inspection next to the listing photos and asks whether they still match"
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border border-line bg-white px-3 py-1.5 text-ink hover:bg-app disabled:opacity-50">{busy === 'check' ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />} Check against photos</button>
          ) : null}
          {cov ? <span className="text-[11.5px] text-muted">Checked {String(cov.at).slice(0, 10)}: {VERDICT[cov.verdict]?.label || cov.verdict}.</span> : null}
        </div>
      ) : null}
      {msg ? <p className="text-[12px] text-ink/80">{msg}</p> : null}
      {n.published ? <p className="text-[11.5px] text-emerald-700">Published {String(n.published.at).slice(0, 10)} by {n.published.by} to {n.published.okCount} of {n.published.listings} listings · {(n.published.labels || []).join(' + ')}.</p> : null}

      {n.check ? (
        <div className="rounded-lg border border-line bg-white px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Checked {String(n.check.at).slice(0, 10)} · crew photos vs listing photos</p>
          <p className="text-[12.5px] text-ink mt-1">{n.check.summary}</p>
          <ul className="mt-1 space-y-1">
            {n.check.units.map((u, i) => (
              <li key={i} className="text-[12px] text-muted">
                <Tag tone={u.verdict === 'differs' ? 'rose' : u.verdict === 'matches' ? 'emerald' : 'slate'}>{u.verdict}</Tag> <span className="text-ink">{u.unit}</span>{u.task ? ` · ${u.task} ${u.taskDate}` : ''}{u.differences.length ? ' — ' + u.differences.join('; ') : u.note ? ' — ' + u.note : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
