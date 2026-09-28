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
import { Sparkles, Check, X, HelpCircle, RefreshCw, ExternalLink, Loader2, Radar, Brain, Sliders, MessageSquareWarning, Copy, RotateCcw, Play } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanSection, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'
import { OpenLoops } from '@/components/OpenLoops'

type TabKey = 'overview' | 'loops' | 'questions' | 'expectations'

type Overview = {
  ok: boolean; day: string
  today: { headline: string | null; counts: any; waiting: any[]; decisions: any[]; gaps: string[] | null; error: string | null }
  loops: { open: number; byKind: Record<string, number>; urgent: number; oldestHours: number | null }
  questions: number
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

export function EveHub({ canEdit, loopsLevel, initialTab }: { canEdit: boolean; loopsLevel: string; initialTab?: TabKey }) {
  const [tab, setTab] = useState<TabKey>(initialTab || 'overview')
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  const [qCount, setQCount] = useState<number | null>(null)
  const [xCount, setXCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/eve/overview', { cache: 'no-store' }).then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load'); return }
      setOv(r); setQCount(r.questions); setXCount(r.expectations || 0); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  // Deep links: /eve?tab=loops. Written back so a refresh lands on the same tab.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const t = sp.get('tab')
      if (t === 'loops' || t === 'questions' || t === 'overview' || t === 'expectations') setTab(t)
    } catch { /* server */ }
  }, [])
  const pick = (t: TabKey) => {
    setTab(t)
    try { const u = new URL(window.location.href); u.searchParams.set('tab', t); window.history.replaceState(null, '', u.toString()) } catch { /* fine */ }
  }

  const waiting = ov?.today.waiting.length || 0
  const tabs = useMemo(() => ([
    { key: 'overview' as TabKey, label: 'Overview', n: waiting || null },
    { key: 'loops' as TabKey, label: 'Open loops', n: ov?.loops.open || null },
    { key: 'questions' as TabKey, label: 'Questions', n: qCount || null },
    { key: 'expectations' as TabKey, label: 'Expectations', n: xCount || null },
  ]), [waiting, ov, qCount, xCount])

  return (
    <div>
      <LeanHead title="Eve" icon={<Sparkles size={20} className="text-brand-600" />}>
        {ov ? (
          <>
            <Pill tone={waiting ? 'amber' : 'slate'} title="Proposals and drafts she filed that are still waiting on a person" onClick={() => pick('overview')}>{waiting} waiting on you</Pill>
            <Pill tone={ov.loops.urgent ? 'rose' : ov.loops.open ? 'amber' : 'slate'} title="Loops she is keeping tabs on across Slack" onClick={() => pick('loops')}>{ov.loops.open} open loops</Pill>
            <Pill tone={qCount ? 'violet' : 'slate'} title="Things only a person can tell her" onClick={() => pick('questions')}>{qCount || 0} questions</Pill>
            <Pill tone={xCount ? 'amber' : 'slate'} title="Notes for CS and admin: what guests keep being surprised by, and the copy that would fix it" onClick={() => pick('expectations')}>{xCount || 0} expectation notes</Pill>
            <Pill tone={ov.thoughts.unseen ? 'sky' : 'slate'} title="Thinking you have not looked at yet — Settings → Eve → Thinking"
              onClick={() => { window.location.href = '/users?tab=settings&panel=eve' }}>{ov.thoughts.unseen} unseen thoughts</Pill>
            <Pill tone={ov.agent.enabled ? 'emerald' : 'slate'} title={ov.agent.enabled ? 'Agent mode is on' : 'Agent mode is off — she observes and answers only'}>{ov.agent.enabled ? 'Agent on' : 'Agent off'}</Pill>
          </>
        ) : err ? <Pill tone="rose">{err}</Pill> : <Pill><Loader2 size={12} className="animate-spin inline" /></Pill>}
        <IconBtn title="Refresh" onClick={load}><RefreshCw size={14} /></IconBtn>
        <IconBtn title="Memory, voice, agent mode, thinking — Settings → Eve" href="/users?tab=settings&panel=eve"><Sliders size={14} /></IconBtn>
      </LeanHead>

      <LeanTabs tabs={tabs} value={tab} onChange={pick} />

      {tab === 'overview' && <OverviewTab ov={ov} err={err} pick={pick} />}
      {tab === 'loops' && (loopsLevel === 'off'
        ? <LeanEmpty>Open loops are switched off for your role. Ask Jon to turn them on in Users → Roles.</LeanEmpty>
        : <OpenLoops canEdit={loopsLevel === 'edit' || loopsLevel === 'full'} />)}
      {tab === 'questions' && <QuestionsTab canEdit={canEdit} onCount={n => { setQCount(n) }} />}
      {tab === 'expectations' && <ExpectationsTab canEdit={canEdit} onCount={n => { setXCount(n) }} />}
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────
function OverviewTab({ ov, err, pick }: { ov: Overview | null; err: string; pick: (t: TabKey) => void }) {
  if (err && !ov) return <LeanEmpty>{err}</LeanEmpty>
  if (!ov) return <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Reading her receipts…</LeanEmpty>
  const c = ov.today.counts || {}
  const byMode: Record<string, number> = c.by_mode || {}
  const loopsLine = Object.entries(ov.loops.byKind).map(([k, n]) => `${n} ${KIND_LABEL[k] || k}`).join(' · ')

  return (
    <div>
      {/* WHAT NEEDS A PERSON. The one section that can cost something if it is ignored. */}
      <LeanSection title="Needs a person" n={ov.today.waiting.length + (ov.questions || 0)} tone={ov.today.waiting.length ? 'rose' : undefined}>
        {ov.today.waiting.length || ov.questions || ov.loops.open || ov.expectations ? (
          <LeanList>
            {ov.today.waiting.map((w: any) => (
              <LeanRow key={w.id} name={w.summary || w.action || w.kind}
                meta={`${w.kind}${w.action && w.action !== w.kind ? ' · ' + w.action : ''} · filed ${w.filed}`}
                tags={<Tag tone={w.status === 'waiting' ? 'amber' : w.status === 'deferred' ? 'violet' : 'rose'}>{w.status}</Tag>}
                actions={<IconBtn title="Approve or decline in Settings → Eve → Agent mode" href="/users?tab=settings&panel=eve"><ExternalLink size={14} /></IconBtn>}>
                {/* The row clips a long summary; the proposal in full is one click away. */}
                {w.summary && String(w.summary).length > 40 ? <p className="text-[12.5px] text-ink/85">{w.summary}</p> : null}
              </LeanRow>
            ))}
            {ov.questions ? (
              <LeanRow name={`${ov.questions} question${ov.questions === 1 ? '' : 's'} only you can answer`} meta="each answer becomes a memory with your name on it"
                tags={<Tag tone="violet">training</Tag>}
                actions={<IconBtn title="Open Questions" onClick={() => pick('questions')}><HelpCircle size={14} /></IconBtn>} />
            ) : null}
            {ov.expectations ? (
              <LeanRow name={`${ov.expectations} expectation note${ov.expectations === 1 ? '' : 's'} for CS and admin`} meta="what guests keep being surprised by, and the copy that would fix it"
                tags={<Tag tone="amber">listing & comms</Tag>}
                actions={<IconBtn title="Open Expectations" onClick={() => pick('expectations')}><MessageSquareWarning size={14} /></IconBtn>} />
            ) : null}
            {ov.loops.open ? (
              <LeanRow name={`${ov.loops.open} open loop${ov.loops.open === 1 ? '' : 's'} on Slack`} meta={loopsLine}
                tags={<>{ov.loops.urgent ? <Tag tone="rose">{ov.loops.urgent} urgent</Tag> : null}{ov.loops.oldestHours != null && ov.loops.oldestHours >= 24 ? <Tag tone="amber">oldest {Math.round(ov.loops.oldestHours / 24)}d</Tag> : null}</>}
                actions={<IconBtn title="Open loops" onClick={() => pick('loops')}><Radar size={14} /></IconBtn>} />
            ) : null}
          </LeanList>
        ) : <LeanEmpty>Nothing is waiting on a person. She has no proposals out, no questions, and no open loops.</LeanEmpty>}
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
}
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
        <p className="text-[12px] text-muted max-w-[60ch]">What guests keep being surprised by, from reviews and their messages, and the sentence for the listing, the rules or the pre-arrival message that would have spared them. She prepares; you paste and mark it updated.</p>
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
                <div className="rounded-xl border border-line bg-app px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Proposed copy · {FIX_LABEL[n.fix_where] || n.fix_where} · {n.owner === 'cs' ? 'customer service' : 'admin'}</p>
                    <button onClick={() => copy(n)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 hover:underline"><Copy size={12} /> {copied === n.id ? 'Copied' : 'Copy'}</button>
                  </div>
                  <p className="text-[13px] text-ink whitespace-pre-wrap">{n.proposed_copy}</p>
                </div>
                {n.status !== 'open' && n.status_by ? <p className="text-[11.5px] text-muted">{n.status === 'done' ? 'Marked updated' : 'Dismissed'} by {n.status_by}{n.status_at ? ' · ' + String(n.status_at).slice(0, 10) : ''}{n.status_note ? ' · ' + n.status_note : ''}</p> : null}
              </LeanRow>
            ))}
          </LeanList>
        )}
    </div>
  )
}
