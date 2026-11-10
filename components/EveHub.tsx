'use client'
import { EveLearningAdmin } from '@/components/EveLearningAdmin'
// EVE — her page (Jon, 2026-09-28: "we need to have an Eve tab where open loops are, training
// questions, Eve command center overview"). REBUILT 2026-11-10 around one idea: everything she needs
// from a person is ONE inbox, and the page is five sections, not nine tabs.
//
//   Ask Eve          the chat — and Teach mode (components/EveChat), unchanged
//   Inbox            THE ONE QUEUE (components/EveInbox, lib/eve/inbox.ts): approvals, reply drafts,
//                    hot Slack loops, questions, plans, notes — ranked, one row each, decided in place.
//                    Two sub-views keep the full desks behind it: Questions (answered history, "ask
//                    her what she is unsure of") and Expectations (the copy, the coverage check, publish).
//   What Eve knows   her knowledge base (components/EveKnowledge — another file, mounted here)
//   What Eve did     receipts with undo, her day, guest issues, what she is watching, reports
//   How Eve is doing her health (components/EveHealth — another file) and her desks / night shift
//
// EVERY OLD DEEP LINK STILL LANDS (/eve?tab=…): chat → Ask Eve; overview → Inbox; questions and
// expectations → Inbox's sub-views; loops, issues, day, reports → What Eve did's sub-views; desks →
// How Eve is doing. ?q= still opens the chat with the question filled in; ?id= still opens a report.
import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { Sparkles, Check, X, HelpCircle, RefreshCw, ExternalLink, Loader2, Radar, Brain, Sliders, Copy, RotateCcw, Play, Search, Undo2 } from 'lucide-react'
import { LeanHead, LeanTabs, LeanList, LeanRow, LeanEmpty, Tag, Pill, IconBtn } from '@/components/lean'
import { OpenLoops } from '@/components/OpenLoops'
import { IssuesTab, DayTab, DesksTab } from '@/components/EveBrain'
import { EveReports } from '@/components/EveReports'
import { EveChat } from '@/components/EveChat'
import { EveInbox } from '@/components/EveInbox'

type SectionProps = { canEdit?: boolean; isAdmin?: boolean }
// Built by other hands at the same time: loaded on their own, so a problem in one fails that
// section only (the boundary below catches a render error; a missing export shows NotReady).
function NotReady() { return <LeanEmpty>This section is not ready yet.</LeanEmpty> }
const EveKnowledge = dynamic<SectionProps>(() => import('@/components/EveKnowledge').then((m: any) => m.EveKnowledge || m.default || NotReady), {
  ssr: false, loading: () => <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Opening what she knows…</LeanEmpty>,
})
const EveHealth = dynamic<SectionProps>(() => import('@/components/EveHealth').then((m: any) => m.EveHealth || m.default || NotReady), {
  ssr: false, loading: () => <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Reading how she is doing…</LeanEmpty>,
})

class SectionBoundary extends Component<{ name: string; children: ReactNode }, { failed: string | null }> {
  state: { failed: string | null } = { failed: null }
  static getDerivedStateFromError(e: any) { return { failed: String(e?.message || e || 'error').slice(0, 200) } }
  render() {
    if (this.state.failed) return <LeanEmpty>{this.props.name} could not open: {this.state.failed}</LeanEmpty>
    return this.props.children
  }
}

type Section = 'ask' | 'inbox' | 'knows' | 'did' | 'health'
type InboxView = 'queue' | 'questions' | 'expectations'
type DidView = 'receipts' | 'day' | 'issues' | 'loops' | 'reports'
type TabKey = string

// WHAT EACH SECTION IS, IN ONE LINE (Jon, 2026-09-30: "We need to better understand what each of
// those things means in the tabs").
const BLURB: Record<Section, string> = {
  ask: 'Talk to her — and teach her. Switch on Teach Eve to give her a rule; what she keeps shows under her answer with Undo and Edit.',
  inbox: 'Everything she needs from a person, in one queue, most urgent first. The button on a row is the decision; "more" shows exactly what happens, why, and the links.',
  knows: 'What she knows — the knowledge base she answers from, and what the team has taught her.',
  did: 'What she did — every action with its undo, her day, the guest issues she is following, what she is watching in Slack, and the long reports.',
  health: 'How she is doing — her scores, what she gets wrong, and whether each desk and night shift is on and actually ran.',
}
const INBOX_VIEWS: { key: InboxView; label: string }[] = [
  { key: 'queue', label: 'Queue' }, { key: 'questions', label: 'Questions' }, { key: 'expectations', label: 'Expectations' },
]
const DID_VIEWS: { key: DidView; label: string; blurb: string }[] = [
  { key: 'receipts', label: 'Receipts', blurb: 'What she carried out in the last 24 hours — each with Undo while it can still be undone.' },
  { key: 'day', label: 'Her day', blurb: 'Everything she did, asked for, drafted or only noticed today — repeats folded together.' },
  { key: 'issues', label: 'Guest issues', blurb: 'Every problem a guest raised, followed until it is fixed and the guest has heard back. Red is the missing step.' },
  { key: 'loops', label: 'Watching', blurb: 'Things said in Slack she is keeping tabs on. She closes them herself when the matching task finishes or the guest is answered.' },
  { key: 'reports', label: 'Reports', blurb: 'The long reads — Ops Command, the shared-boards digest, the Monday quality audit, the Sunday scorecard, the plans.' },
]

/** Old ?tab= keys (and the new ones) → where they land now. */
const TAB_MAP: Record<string, { s: Section; inbox?: InboxView; did?: DidView }> = {
  chat: { s: 'ask' }, ask: { s: 'ask' },
  overview: { s: 'inbox', inbox: 'queue' }, inbox: { s: 'inbox', inbox: 'queue' }, needs: { s: 'inbox', inbox: 'queue' },
  questions: { s: 'inbox', inbox: 'questions' }, expectations: { s: 'inbox', inbox: 'expectations' },
  knows: { s: 'knows' }, knowledge: { s: 'knows' },
  did: { s: 'did', did: 'receipts' }, receipts: { s: 'did', did: 'receipts' }, day: { s: 'did', did: 'day' }, issues: { s: 'did', did: 'issues' },
  loops: { s: 'did', did: 'loops' }, watching: { s: 'did', did: 'loops' }, reports: { s: 'did', did: 'reports' },
  health: { s: 'health' }, desks: { s: 'health' },
}

type Overview = {
  ok: boolean; day: string
  today: { headline: string | null; counts: any; waiting: any[]; decisions: any[]; gaps: string[] | null; error: string | null }
  loops: { open: number; byKind: Record<string, number>; urgent: number; oldestHours: number | null }
  questions: number
  expectations: number
  thoughts: { unseen: number; allObserving: boolean }
  agent: { enabled: boolean; rungs: Record<string, number> | null }
  desks: any[]
}

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
  /* CHAT IS THE FIRST SECTION (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we can teach Eve"). */
  const start = TAB_MAP[initialTab || ''] || TAB_MAP.chat
  const [section, setSection] = useState<Section>(start.s)
  const [inboxView, setInboxView] = useState<InboxView>(start.inbox || 'queue')
  const [didView, setDidView] = useState<DidView>(start.did || 'receipts')
  const [reportId, setReportId] = useState<string | null>(null)
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  const [inboxN, setInboxN] = useState<number | null>(null)
  const [qCount, setQCount] = useState<number | null>(null)
  const [xCount, setXCount] = useState<number | null>(null)
  const [iCount, setICount] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/eve/overview', { cache: 'no-store' }).then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load'); return }
      setOv(r); setQCount(r.questions); setXCount(r.expectations || 0); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])
  // The inbox number shows on its section before anyone opens it (the inbox itself keeps it current).
  useEffect(() => { fetch('/api/eve/inbox?limit=1', { cache: 'no-store' }).then(x => x.json()).then(r => { if (r?.ok && r.summary) setInboxN(Number(r.summary.total) || 0) }).catch(() => {}) }, [])
  // The Guest issues count shows on its sub-view before anyone opens it.
  useEffect(() => { fetch('/api/eve/issues', { cache: 'no-store' }).then(x => x.json()).then(r => { if (r?.ok) setICount((r.issues || []).filter((i: any) => i.urgency !== 'done').length) }).catch(() => {}) }, [])

  // Deep links: /eve?tab=loops etc. Written back so a refresh lands on the same place.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const t = TAB_MAP[String(sp.get('tab') || sp.get('section') || '')]
      if (t) { setSection(t.s); if (t.inbox) setInboxView(t.inbox); if (t.did) setDidView(t.did) }
      setReportId(sp.get('id'))
      if (sp.get('q')) setSection('ask')
    } catch { /* server */ }
  }, [])
  const writeTab = (key: string) => {
    try { const u = new URL(window.location.href); u.searchParams.set('tab', key); window.history.replaceState(null, '', u.toString()) } catch { /* fine */ }
  }
  const pick = (s: Section) => { setSection(s); writeTab(s) }
  const pickInbox = (v: InboxView) => { setInboxView(v); writeTab(v === 'queue' ? 'inbox' : v) }
  const pickDid = (v: DidView) => { setDidView(v); writeTab(v) }

  const tabs = useMemo(() => ([
    { key: 'ask' as Section, label: 'Ask Eve', n: null as number | null },
    { key: 'inbox' as Section, label: 'Inbox', n: inboxN || null },
    { key: 'knows' as Section, label: 'What she knows', n: null as number | null },
    { key: 'did' as Section, label: 'What she did', n: null as number | null },
    { key: 'health' as Section, label: 'How she is doing', n: null as number | null },
  ]), [inboxN])
  const subBtn = (on: boolean) => `rounded-lg px-2.5 min-h-[30px] text-[12px] font-semibold border ${on ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:text-ink'}`

  return (
    <div>
      <LeanHead title="Eve" icon={<Sparkles size={20} className="text-brand-600" />}>
        {inboxN != null ? <Pill tone={inboxN ? 'rose' : 'emerald'} title="Everything in her inbox that waits on a person" onClick={() => { pick('inbox'); pickInbox('queue') }}>{inboxN ? `${inboxN} for you` : 'nothing for you'}</Pill> : null}
        {ov ? (
          <Pill tone={ov.agent.enabled ? 'emerald' : 'slate'} title={ov.agent.enabled ? 'Agent mode is on — she acts inside the fence set in Settings → Eve' : 'Agent mode is off — she observes and answers only'}>{ov.agent.enabled ? 'Agent on' : 'Agent off'}</Pill>
        ) : err ? <Pill tone="rose">{err}</Pill> : <Pill><Loader2 size={12} className="animate-spin inline" /></Pill>}
        <IconBtn title="Refresh" onClick={load}><RefreshCw size={14} /></IconBtn>
        <IconBtn title="Memory, voice, agent mode — Settings → Eve" href="/users?tab=settings&panel=eve"><Sliders size={14} /></IconBtn>
      </LeanHead>

      <LeanTabs tabs={tabs} value={section} onChange={pick} />
      <p className="text-[12.5px] text-muted -mt-1.5 mb-3 px-1">{BLURB[section]}</p>

      {section === 'ask' && <EveChat />}

      {section === 'inbox' && (
        <div>
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            {INBOX_VIEWS.map(v => (
              <button key={v.key} onClick={() => pickInbox(v.key)} className={subBtn(inboxView === v.key)}>
                {v.label}{v.key === 'questions' && qCount ? <span className="ml-1 opacity-80 tabular-nums">{qCount}</span> : v.key === 'expectations' && xCount ? <span className="ml-1 opacity-80 tabular-nums">{xCount}</span> : null}
              </button>
            ))}
          </div>
          {inboxView === 'queue' && <EveInbox onCount={setInboxN} />}
          {inboxView === 'questions' && <QuestionsTab canEdit={canEdit} onCount={setQCount} />}
          {inboxView === 'expectations' && <ExpectationsTab canEdit={canEdit} onCount={setXCount} />}
        </div>
      )}

      {section === 'knows' && <SectionBoundary name="What she knows"><EveKnowledge canEdit={canEdit} isAdmin={!!isAdmin} /></SectionBoundary>}

      {section === 'did' && (
        <div>
          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
            {DID_VIEWS.map(v => (
              <button key={v.key} onClick={() => pickDid(v.key)} className={subBtn(didView === v.key)}>
                {v.label}{v.key === 'issues' && iCount ? <span className="ml-1 opacity-80 tabular-nums">{iCount}</span> : v.key === 'loops' && ov?.loops.open ? <span className="ml-1 opacity-80 tabular-nums">{ov.loops.open}</span> : null}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-muted mb-2 px-1">{DID_VIEWS.find(v => v.key === didView)?.blurb}</p>
          {didView === 'receipts' && <Receipts isAdmin={!!isAdmin} />}
          {didView === 'day' && <DayTab ov={ov} />}
          {didView === 'issues' && <IssuesTab onCount={setICount} />}
          {didView === 'reports' && <EveReports initialId={reportId} />}
          {didView === 'loops' && (loopsLevel === 'off'
            ? <LeanEmpty>Open loops are switched off for your role. Ask Jon to turn them on in Users → Roles.</LeanEmpty>
            : <OpenLoops canEdit={loopsLevel === 'edit' || loopsLevel === 'full'} embedded />)}
        </div>
      )}

      {section === 'health' && (
        <div>
          <SectionBoundary name="How she is doing"><EveHealth canEdit={canEdit} isAdmin={!!isAdmin} /></SectionBoundary>
          {isAdmin && (
            <details className="mt-4 rounded-xl border border-line bg-white">
              <summary className="cursor-pointer px-3 py-2 text-[12px] font-bold uppercase tracking-wider text-muted">Learning sources, teachers and Google read access</summary>
              <div className="p-3"><EveLearningAdmin canEdit={canEdit} /></div>
            </details>
          )}
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5 px-1">Her desks and night shift</p>
            <DesksTab ov={ov} />
          </div>
          <p className="text-[12px] text-muted px-1 mt-2 inline-flex items-center gap-1.5">
            <Brain size={13} /> Her memory, voice and agent mode are set in <a href="/users?tab=settings&panel=eve" className="text-brand-700 hover:underline">Settings → Eve</a>.
          </p>
        </div>
      )}
    </div>
  )
}

// ── What she did: receipts with undo ──────────────────────────────────────────────────────────
// The agent log's undoable acts of the last 24 hours (GET /api/eve/agent?undoable=1) and the same
// undo the Settings panel uses (POST /api/eve/agent { op: 'undo', logId }). Admins — the route's gate.
type Receipt = { id: string | number; at: string; action: string; summary: string | null; by: string | null; actor: string | null; ref: string | null; undone_at: string | null }

function Receipts({ isAdmin }: { isAdmin: boolean }) {
  const [rows, setRows] = useState<Receipt[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/eve/agent?undoable=1', { cache: 'no-store' }).then(x => x.json())
      if (r?.ok) { setRows(r.undoable || []); setErr('') } else { setRows([]); setErr(r?.message || r?.error || 'Could not load') }
    } catch (e: any) { setRows([]); setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])
  const undo = async (r: Receipt) => {
    if (!window.confirm('Undo this? ' + (r.summary || String(r.action || '')))) return
    setBusy(String(r.id)); setNote('')
    try {
      const j = await fetch('/api/eve/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'undo', logId: String(r.id) }) }).then(x => x.json())
      setNote(j?.ok ? 'Undone.' : (j?.error || 'Could not undo that.'))
      if (j?.ok) await load()
    } catch (e: any) { setNote(String(e?.message || e)) }
    setBusy('')
  }
  if (!isAdmin) return <LeanEmpty>Receipts with undo are for admins. Her day, guest issues and reports are in the other views.</LeanEmpty>
  if (!rows) return <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1" /> Reading her receipts…</LeanEmpty>
  return (
    <div>
      {note ? <p className="text-[12px] text-muted mb-2 px-1">{note}</p> : null}
      {err ? <LeanEmpty>{err}</LeanEmpty> : !rows.length ? <LeanEmpty>Nothing she did in the last 24 hours can be undone — either she did nothing outward, or it is past its undo.</LeanEmpty> : (
        <LeanList>
          {rows.map(r => (
            <LeanRow key={String(r.id)} name={r.summary || String(r.action || '').replace(/_/g, ' ')}
              meta={[ago(r.at), String(r.action || '').replace(/_/g, ' '), r.actor ? 'yes from ' + r.actor.split('@')[0] : r.by ? String(r.by).replace(/^watch:/, 'watch ').replace(/^cron:/, '') : ''].filter(Boolean).join(' · ')}
              tags={r.undone_at ? <Tag tone="rose">undone</Tag> : <Tag tone="emerald">done</Tag>}
              actions={r.undone_at ? undefined : (
                <button onClick={() => undo(r)} disabled={busy === String(r.id)} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 min-h-[32px] text-[12px] font-semibold text-ink hover:bg-app disabled:opacity-50">
                  {busy === String(r.id) ? <Loader2 size={11} className="animate-spin" /> : <Undo2 size={12} />} Undo
                </button>
              )} />
          ))}
        </LeanList>
      )}
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
