'use client'
// EVE'S SETTINGS — memory, voice and direction, living where every other setting lives (Jon,
// 2026-08-19: "she should be able to see memories in the settings; work on a robust settings and
// memory feature"). The chat became a floating bubble on every page; THIS is where you open her
// head: everything she believes (editable, deletable, reweighable), how she sounds, what she has
// recommended and how those calls actually graded, and a button to make her learn RIGHT NOW.
import { useState, useEffect, useCallback } from 'react'
import { Brain, Mic, Compass, Trash2, Plus, Save, X, Check, TrendingUp, Pencil, Zap, KeyRound, Hash, MapPin, RefreshCw, ShieldAlert, BellOff, Clock, HelpCircle, Layers, Merge, Send } from 'lucide-react'
import { TelegramAdmin } from '@/components/TelegramAdmin'

type Memory = {
  id: string; kind: string; text: string; why: string | null; scope: string; weight: number
  source: string; use_count: number; last_used_at: string | null; created_by: string | null; created_at: string
}

const KINDS = ['rule', 'preference', 'insight', 'decision', 'person', 'issue', 'correction']
const KIND_HELP: Record<string, string> = {
  rule: 'A standing instruction she must follow.',
  preference: 'How you want things done or said.',
  insight: 'Something she worked out from the data.',
  decision: 'A call that was already made, so she stops re-litigating it.',
  person: 'Who someone is, or how their name is spelled in another system.',
  issue: 'A recurring problem worth remembering.',
  correction: 'Something she got wrong, so she does not repeat it.',
}

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'

export function EveAdmin({ canEdit }: { canEdit: boolean }) {
  const [tab, setTab] = useState<'memory' | 'voice' | 'direction' | 'approvals' | 'audits' | 'telegram'>('memory')
  return (
    <div>
      <div className="flex items-center gap-1 mb-3 border-b border-line">
        {([['memory', 'Memory', Brain], ['voice', 'Voice', Mic], ['direction', 'Direction', Compass], ['approvals', 'Approvals', KeyRound], ['audits', 'Audits', ShieldAlert], ['telegram', 'Telegram', Send]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      {tab === 'memory' && <EveMemoryAdmin canEdit={canEdit} />}
      {tab === 'voice' && <EveVoiceAdmin canEdit={canEdit} />}
      {tab === 'direction' && <EveDirectionAdmin canEdit={canEdit} />}
      {tab === 'approvals' && <EveApprovalsAdmin canEdit={canEdit} />}
      {tab === 'audits' && <EveAuditsAdmin canEdit={canEdit} />}
      {tab === 'telegram' && <TelegramAdmin canEdit={canEdit} />}
    </div>
  )
}

function EveMemoryAdmin({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Memory[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState({ text: '', why: '', weight: 5, kind: 'rule', scope: 'portfolio' })
  const [draft, setDraft] = useState({ text: '', kind: 'rule', scope: 'portfolio', why: '', weight: 8 })
  const [learning, setLearning] = useState(false)
  const [learnNote, setLearnNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/memory')
      const d = await r.json()
      if (d.needsMigration) setErr('Migration 045 has not been run yet — she has nowhere to store what she learns.')
      else setErr('')
      setRows(d.memories || [])
      setCounts(d.counts || {})
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function post(payload: any) {
    await fetch('/api/eve/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    await load()
  }

  async function learnNow() {
    setLearning(true); setLearnNote('')
    try {
      const r = await fetch('/api/eve/learn?days=30', { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      setLearnNote(r.ok ? 'Learning pass finished — new insights are in the list below.' : (d?.error || 'Learning pass failed.'))
      await load()
    } catch (e: any) { setLearnNote(e?.message || String(e)) } finally { setLearning(false) }
  }

  const shown = rows.filter(r =>
    (!kind || r.kind === kind) &&
    (!filter || (r.text + ' ' + (r.why || '') + ' ' + r.scope + ' ' + r.kind).toLowerCase().includes(filter.toLowerCase())))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search her memory…" className={`${input} max-w-xs`} />
        <span className="text-xs text-muted">{shown.length} of {rows.length}</span>
        {canEdit && (
          // "Learn now" + "Teach her something" would not fit beside the filter box on a phone.
          <div className="ml-auto flex items-center gap-2 flex-wrap gap-y-2">
            <button onClick={learnNow} disabled={learning}
              title="Run the learning sweep now — she mines recent ops, money, quality and guest data for new insights"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 hover:bg-brand-100 disabled:opacity-50">
              <Zap size={13} /> {learning ? 'Learning…' : 'Learn now'}
            </button>
            <button onClick={() => setAdding(a => !a)} className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700">
              {adding ? <X size={13} /> : <Plus size={13} />} {adding ? 'Cancel' : 'Teach her'}
            </button>
          </div>
        )}
      </div>

      {/* Kind chips double as counters — one glance says what her memory is made of. */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button onClick={() => setKind('')}
          className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${!kind ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:text-ink'}`}>
          all {rows.length}
        </button>
        {KINDS.filter(k => counts[k]).map(k => (
          <button key={k} onClick={() => setKind(kind === k ? '' : k)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${kind === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-muted border-line hover:text-ink'}`}>
            {k} {counts[k]}
          </button>
        ))}
      </div>

      <EveQuestions canEdit={canEdit} onAnswered={load} />
      <EveMemoryHealth canEdit={canEdit} onChanged={load} />

      {err && <div className="mb-3 text-[13px] text-[#9A6200] bg-[#FDF3E0] border border-[#F0DAA8] rounded-xl px-3.5 py-2.5">{err}</div>}
      {learnNote && <div className="mb-3 text-[13px] text-ink bg-app border border-line rounded-xl px-3.5 py-2.5">{learnNote}</div>}

      {adding && (
        <div className={`${card} p-4 mb-4 space-y-3`}>
          <textarea value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} rows={2}
            placeholder="Never offer a refund over $350 without my approval." className={input} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted font-semibold">Kind</label>
              <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })} className={input}>
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
              <p className="text-[11px] text-muted mt-1">{KIND_HELP[draft.kind]}</p>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted font-semibold">Scope</label>
              <input value={draft.scope} onChange={e => setDraft({ ...draft, scope: e.target.value })} className={input} placeholder="portfolio or building:Botanica" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wide text-muted font-semibold">Weight 1-10</label>
              <input type="number" min={1} max={10} value={draft.weight} onChange={e => setDraft({ ...draft, weight: Number(e.target.value) })} className={input} />
            </div>
          </div>
          <input value={draft.why} onChange={e => setDraft({ ...draft, why: e.target.value })} placeholder="Why (optional) — helps her apply it sensibly" className={input} />
          <button disabled={!draft.text.trim()}
            onClick={async () => { await post(draft); setDraft({ text: '', kind: 'rule', scope: 'portfolio', why: '', weight: 8 }); setAdding(false) }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-50"><Save size={13} /> Save</button>
        </div>
      )}

      {loading ? <p className="text-sm text-muted">Loading…</p> : !shown.length ? (
        <div className={`${card} p-8 text-center`}>
          <Brain size={22} className="text-muted mx-auto mb-2" />
          <p className="text-sm text-muted">Nothing here yet. She writes memories as she learns — or teach her something directly.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {shown.map(m => (
            <div key={m.id} className={`${card} p-3.5`}>
              {editing === m.id ? (
                <div className="space-y-2">
                  <textarea value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} rows={2} className={input} />
                  {/* Three controls across 375px left each one ~100px, and iOS renders a select at
                      16px — the scope box showed about four characters. */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <select value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })} className={input}>
                      {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input value={edit.scope} onChange={e => setEdit({ ...edit, scope: e.target.value })} className={input} />
                    <input type="number" min={1} max={10} value={edit.weight} onChange={e => setEdit({ ...edit, weight: Number(e.target.value) })} className={input} />
                  </div>
                  <input value={edit.why} onChange={e => setEdit({ ...edit, why: e.target.value })} placeholder="Why (optional)" className={input} />
                  <div className="flex gap-2">
                    <button onClick={async () => { await post({ op: 'update', id: m.id, ...edit }); setEditing(null) }}
                      className="inline-flex items-center gap-1 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700"><Check size={12} /> Save</button>
                    <button onClick={() => setEditing(null)} className="text-xs font-semibold text-muted hover:text-ink px-2">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md bg-brand-50 text-brand-700 border border-brand-200 shrink-0">{m.kind}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{m.text}</p>
                    {m.why && <p className="text-[12px] text-muted mt-0.5">Why: {m.why}</p>}
                    <p className="text-[11px] text-muted mt-1.5">
                      {m.scope} · weight {m.weight} · from {m.source}
                      {m.use_count ? ` · used ${m.use_count}×` : ' · never used yet'}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => { setEditing(m.id); setEdit({ text: m.text, why: m.why || '', weight: m.weight, kind: m.kind, scope: m.scope }) }}
                        title="Edit" className="text-muted hover:text-ink p-1"><Pencil size={13} /></button>
                      <button onClick={() => post({ op: 'delete', id: m.id })} title="Delete — she stops believing this"
                        className="text-muted hover:text-[#A32020] p-1"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EveVoiceAdmin({ canEdit }: { canEdit: boolean }) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/eve/voice').then(r => r.json()).then(d => { setText(d.text || '') }).catch(() => {}).finally(() => setLoading(false))
  }, [])
  async function save() {
    await fetch('/api/eve/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }
  return (
    <div>
      <p className="text-[13px] text-muted mb-3 max-w-2xl">
        Anything written here is appended on top of her built-in register and overrides it, so you
        can tune her tone without a deploy. Be specific — &quot;stop hedging, give me the call
        first&quot; beats &quot;be more natural&quot;.
      </p>
      {loading ? <p className="text-sm text-muted">Loading…</p> : (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={7} disabled={!canEdit}
            className={`${input} font-mono text-[13px]`} placeholder="Lead with the call. Never open with a summary of my question. If you are not sure, say so in one line and tell me what you would check." />
          {canEdit && (
            <button onClick={save} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700">
              <Save size={13} /> {saved ? 'Saved' : 'Save voice profile'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

type Rec = {
  id: string; title: string; detail: string | null; scope: string; metric: string
  expect_direction: string; expect_pct: number | null; measure_on: string; measure_window: number
  baseline_value: number | null; baseline_days: number | null
  status: string; decided_by: string | null; decision_note: string | null
  outcome: string | null; outcome_note: string | null; actual_value: number | null; delta_pct: number | null
  created_at: string
}

const OUTCOME_UI: Record<string, { label: string; cls: string }> = {
  worked: { label: 'Worked', cls: 'bg-[#E8F6F0] text-[#0F7B52] border-[#B7E3D0]' },
  didnt: { label: "Didn't work", cls: 'bg-[#FCECEC] text-[#A32020] border-[#F2C4C4]' },
  inconclusive: { label: 'Inconclusive', cls: 'bg-app text-muted border-line' },
}

function EveDirectionAdmin({ canEdit }: { canEdit: boolean }) {
  const [recs, setRecs] = useState<Rec[]>([])
  const [score, setScore] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/recommendations').then(x => x.json())
      if (r.needsMigration) setErr('Migration 046 has not been run yet — nothing can be logged or graded.')
      else setErr('')
      setRecs(r.recommendations || [])
      setScore(r.scorecard || null)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function decide(id: string, status: string) {
    setBusy(id)
    try {
      await fetch('/api/eve/recommendations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'decide', id, status }) })
      await load()
    } finally { setBusy('') }
  }

  const open = recs.filter(r => r.status === 'open')
  const live = recs.filter(r => r.status === 'accepted' && !r.outcome)
  const done = recs.filter(r => !!r.outcome)

  return (
    <div className="space-y-4">
      {err && <div className="text-[13px] text-[#9A6200] bg-[#FDF3E0] border border-[#F0DAA8] rounded-xl px-3.5 py-2.5">{err}</div>}

      <div className={`${card} p-4`}>
        <p className="text-sm text-ink font-semibold mb-1 flex items-center gap-1.5"><TrendingUp size={14} className="text-brand-600" /> Track record</p>
        {score?.available ? (
          <>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted mt-2">
              <span><strong className="text-ink">{score.total}</strong> logged</span>
              <span><strong className="text-ink">{score.accepted}</strong> accepted</span>
              <span><strong className="text-ink">{score.graded}</strong> graded</span>
              <span className="text-[#0F7B52]"><strong>{score.worked}</strong> worked</span>
              <span className="text-[#A32020]"><strong>{score.didnt}</strong> didn&apos;t</span>
              {score.hit_rate != null && <span><strong className="text-ink">{score.hit_rate}%</strong> hit rate</span>}
            </div>
            {score.note && <p className="text-[12px] text-muted mt-2">{score.note}</p>}
          </>
        ) : <p className="text-[13px] text-muted">{score?.note || 'Not available yet.'}</p>}
      </div>

      {loading ? <p className="text-sm text-muted">Loading…</p> : (
        <>
          <RecList title="Waiting on you" rows={open} canEdit={canEdit} busy={busy} onDecide={decide} />
          <RecList title="Accepted — being measured" rows={live} canEdit={false} busy={busy} onDecide={decide} />
          <RecList title="Graded" rows={done} canEdit={false} busy={busy} onDecide={decide} />
          {!recs.length && !err && (
            <p className="text-sm text-muted">Nothing logged yet. When Eve advises a real change in chat, she records what she expects to move — it lands here for you to accept, and the nightly job grades it.</p>
          )}
        </>
      )}
    </div>
  )
}

function RecList({ title, rows, canEdit, busy, onDecide }: { title: string; rows: Rec[]; canEdit: boolean; busy: string; onDecide: (id: string, s: string) => void }) {
  if (!rows.length) return null
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted font-bold mb-2">{title}</p>
      <div className="space-y-2">
        {rows.map(r => (
          <div key={r.id} className={`${card} p-4`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{r.title}</p>
                {r.detail && <p className="text-[13px] text-muted mt-1 whitespace-pre-wrap">{r.detail}</p>}
                <p className="text-[12px] text-muted mt-2">
                  Expects <strong className="text-ink">{r.metric}</strong> to go <strong className="text-ink">{r.expect_direction}</strong>
                  {r.expect_pct ? ` by about ${r.expect_pct}%` : ''} on <strong className="text-ink">{r.scope}</strong>, measured {r.measure_on}
                  {r.baseline_value != null ? ` · baseline ${r.baseline_value}` : ''}
                  {(r.baseline_days ?? 0) < 14 ? ' · ⚠ thin baseline' : ''}
                </p>
                {r.outcome && (
                  <div className="mt-2">
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md border ${OUTCOME_UI[r.outcome]?.cls || 'bg-app text-muted border-line'}`}>{OUTCOME_UI[r.outcome]?.label || r.outcome}</span>
                    {r.outcome_note && <p className="text-[12px] text-muted mt-1.5">{r.outcome_note}</p>}
                  </div>
                )}
                {r.status === 'rejected' && <span className="inline-block mt-2 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md border bg-app text-muted border-line">Rejected</span>}
              </div>
              {canEdit && r.status === 'open' && (
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button disabled={!!busy} onClick={() => onDecide(r.id, 'accepted')}
                    className="inline-flex items-center gap-1 text-xs font-semibold bg-brand-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-brand-700 disabled:opacity-50"><Check size={12} /> Accept</button>
                  <button disabled={!!busy} onClick={() => onDecide(r.id, 'rejected')}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-ink border border-line rounded-lg px-2.5 py-1.5"><X size={12} /> No</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------------------------
// APPROVALS — door codes waiting on a human, and where they get announced.
//
// Jon, 2026-08-24: "need a place to quickly be able to approve the code requests, can we make it
// pop up on slack in a PTE channel... make it great and easy." So: it pops up in Slack AND it is
// here, and either place is one tap. What is deliberately NOT here is the code — this screen gets
// left open on a laptop in an office. The code only ever appears on the single-use release page,
// after the tap.
// ---------------------------------------------------------------------------------------------

type Pending = {
  id: string; token: string | null; unit: string; building: string | null; address: string | null
  verdict: string; headline: string; occupancy: string | null
  quote: { from: string; at: string; text: string } | null
  taskToday: { name: string; assignees: string[] } | null
  vacancyScan: { result: string; summary: string; findings: { from: string; at: string; text: string }[] } | null
  calendar: { ok: boolean; status: string | null; error?: string } | null
  confidence: { level: string; label: string; suspect: boolean; problems: string[]; conflicts: string[]; sharedWith: number; transition?: { expect: string; reason: string; hasPrevious: boolean } | null } | null
  arrivalWarning: string | null
  requestedBy: string; reason: string | null; createdAt: string; minutesLeft: number | null
}

function EveApprovalsAdmin({ canEdit }: { canEdit: boolean }) {
  const [pending, setPending] = useState<Pending[]>([])
  const [channels, setChannels] = useState<{ id: string; name: string; isPrivate: boolean }[]>([])
  const [current, setCurrent] = useState<{ id: string; name: string } | null>(null)
  const [connected, setConnected] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, b] = await Promise.all([
        fetch('/api/eve/door-code').then(r => r.json()).catch(() => ({})),
        fetch('/api/eve/approvals-channel').then(r => r.json()).catch(() => ({})),
      ])
      setPending(a?.pending || [])
      setChannels(b?.channels || [])
      setCurrent(b?.current || null)
      setConnected(b?.connected !== false)
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function pickChannel(name: string) {
    if (!name) return
    setBusy('channel'); setNote('')
    try {
      const r = await fetch('/api/eve/approvals-channel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: name }),
      }).then(x => x.json())
      if (r?.ok) { setCurrent(r.channel); setNote(`Door-code requests will post to #${r.channel.name}.`) }
      else setNote(r?.error || 'Could not set that channel.')
    } finally { setBusy('') }
  }

  async function decide(p: Pending, approve: boolean) {
    if (!p.token) return
    if (approve) { window.open(`/doorcode/${p.token}`, '_blank'); return }
    setBusy(p.id)
    try {
      await fetch('/api/eve/door-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'reject', token: p.token }),
      })
      setPending(rows => rows.filter(x => x.id !== p.id))
    } finally { setBusy('') }
  }

  return (
    <div className="space-y-4">
      {/* Where it announces */}
      <div className={`${card} p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><Hash size={14} /> Slack approvals channel</p>
            <p className="text-[13px] text-muted mt-1 max-w-xl">
              Every door-code request that clears the checks gets posted here with the unit, the address, who is
              in it, what the guest said and a Release button. Pick a private channel — the post carries a
              guest&apos;s own words, though never the code itself.
            </p>
          </div>
          <button onClick={load} className="text-muted hover:text-ink shrink-0" title="Refresh"><RefreshCw size={14} /></button>
        </div>

        {!connected ? (
          <p className="text-[13px] text-[#A32020] mt-3">Slack is not connected yet. Connect it in Integrations first.</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              className={input + ' max-w-xs'} disabled={!canEdit || busy === 'channel'}
              value={current?.name || ''} onChange={e => pickChannel(e.target.value)}
            >
              <option value="">{channels.length ? 'Choose a channel…' : 'No channels the bot is in'}</option>
              {channels.map(c => <option key={c.id} value={c.name}>#{c.name}{c.isPrivate ? ' (private)' : ''}</option>)}
            </select>
            {current
              ? <span className="text-[13px] text-ink">Posting to <strong>#{current.name}</strong></span>
              : <span className="text-[13px] text-muted">Nothing set — requests will not announce anywhere.</span>}
          </div>
        )}
        <p className="text-[12px] text-muted mt-2">
          Private channel missing from the list? Run <code className="font-mono">/invite @Lighthouse</code> in it, then refresh.
        </p>
        {note && <p className="text-[13px] text-ink mt-2">{note}</p>}
      </div>

      {/* What is waiting */}
      <div>
        <p className="text-sm font-semibold text-ink mb-2">
          Waiting on you {pending.length ? <span className="text-muted font-normal">({pending.length})</span> : null}
        </p>
        {loading ? <p className="text-[13px] text-muted">Loading…</p>
        : !pending.length ? (
          <div className={`${card} p-5 text-center`}>
            <p className="text-[13px] text-muted">Nothing waiting. Requests appear here the moment someone asks Eve or runs <code className="font-mono">/doorcode</code>.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map(p => {
              const occupied = p.verdict === 'permission_found'
              return (
                <div key={p.id} className={`${card} p-4 ${occupied ? 'border-[#F0C9C9]' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink">{p.unit}{p.building ? <span className="text-muted font-normal"> · {p.building}</span> : null}</p>
                      {p.address && <p className="text-[12px] text-muted inline-flex items-center gap-1 mt-0.5"><MapPin size={11} /> {p.address}</p>}
                      <p className={`text-[13px] mt-1.5 ${occupied ? 'text-[#7A1A1A] font-semibold' : 'text-ink'}`}>{p.headline}</p>
                      {p.occupancy && <p className="text-[12px] text-muted mt-0.5">{p.occupancy}</p>}
                      {p.quote && (
                        <div className="mt-2 rounded-lg bg-app border border-line px-2.5 py-2">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">Guest said</p>
                          <p className="text-[13px] text-ink italic mt-0.5">&ldquo;{p.quote.text.slice(0, 240)}&rdquo;</p>
                          <p className="text-[11px] text-muted mt-0.5">{String(p.quote.at).slice(0, 10)}</p>
                        </div>
                      )}
                      {p.arrivalWarning && <p className="text-[12px] text-[#7A1A1A] mt-2 font-semibold">{p.arrivalWarning}</p>}
                      {p.confidence?.transition?.hasPrevious && (
                        <p className="text-[12px] text-muted mt-2">🧹 {p.confidence.transition.reason}</p>
                      )}
                      {p.confidence && (p.confidence.suspect || p.confidence.conflicts.length > 0) && (
                        <p className="text-[12px] text-[#7A1A1A] mt-2 font-semibold">🔴 {p.confidence.label}{p.confidence.conflicts.length ? ` The field disagrees with ${p.confidence.conflicts.join(' and ')}.` : ''}</p>
                      )}
                      {p.calendar && !p.calendar.ok && (
                        <p className="text-[12px] text-[#7A1A1A] mt-2">❔ Live Guesty calendar could not be read — an extension made minutes ago would not show.</p>
                      )}
                      {p.vacancyScan && (
                        <p className={`text-[12px] mt-2 ${p.vacancyScan.result === 'clean' ? 'text-muted' : 'text-[#7A1A1A]'}`}>
                          {p.vacancyScan.result === 'clean' ? '✅' : '⚠️'} {p.vacancyScan.summary}
                        </p>
                      )}
                      <p className="text-[12px] text-muted mt-2">
                        Asked by {p.requestedBy}{p.reason ? ` — ${p.reason}` : ''}
                        {p.taskToday ? ` · work booked today: ${p.taskToday.name}` : ''}
                        {p.minutesLeft != null ? ` · expires in ${p.minutesLeft} min` : ''}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button onClick={() => decide(p, true)} disabled={busy === p.id}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-[13px] font-semibold px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
                          <Check size={13} /> Review &amp; release
                        </button>
                        <button onClick={() => decide(p, false)} disabled={busy === p.id}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-line text-ink text-[13px] font-semibold px-3 py-2 hover:bg-app disabled:opacity-50">
                          <X size={13} /> Turn down
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------------------------
// AUDITS — the standing tab of what is wrong right now (Jon, 2026-08-24: "she needs to run audits
// and scans of all activities and keep things on tab").
//
// Sorted by consequence, then by AGE, because the number that actually matters on this screen is
// how many days something has been open. A critical found this morning is a task; the same critical
// still open on Friday is a process failure, and the list should make that impossible to miss.
//
// There is no dismiss button anywhere on this screen — only acknowledge and snooze. If a finding is
// real it comes straight back on the next run, and a list you can permanently silence is a list
// that quietly stops being true.
// ---------------------------------------------------------------------------------------------

type Audit = {
  id: string; area: string; severity: string; title: string; detail: string; fix: string | null
  count: number; status: string; ageDays: number; first_seen_at: string; last_seen_at: string
  snooze_until: string | null; acked_by: string | null
}

const SEV: Record<string, { dot: string; label: string; ring: string }> = {
  critical: { dot: 'bg-[#C62828]', label: 'Critical', ring: 'border-[#F0C9C9]' },
  warn: { dot: 'bg-[#E08A00]', label: 'Warning', ring: 'border-line' },
  info: { dot: 'bg-[#9AA3AF]', label: 'Info', ring: 'border-line' },
}
const AREA_LABEL: Record<string, string> = {
  pipeline: 'Data feeds', guests: 'Guests', reviews: 'Reviews',
  ops: 'Operations', listings: 'Listings', money: 'Money', eve: 'Eve',
}

function EveAuditsAdmin({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<Audit[]>([])
  const [status, setStatus] = useState<'open' | 'all'>('open')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [ranAt, setRanAt] = useState('')

  const load = useCallback(async (st: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/eve/audits?status=${st}`).then(x => x.json())
      setItems(r?.items || [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(status) }, [load, status])

  async function runNow() {
    setBusy('run')
    try {
      const r = await fetch('/api/eve/audits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'run' }),
      }).then(x => x.json())
      setItems(r?.items || [])
      setRanAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      setStatus('open')
    } finally { setBusy('') }
  }

  async function decide(id: string, op: 'ack' | 'snooze' | 'reopen') {
    setBusy(id)
    try {
      await fetch('/api/eve/audits', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id, days: 7 }),
      })
      await load(status)
    } finally { setBusy('') }
  }

  const crit = items.filter(i => i.severity === 'critical' && i.status === 'open')
  const pipelineBad = crit.some(i => i.area === 'pipeline')

  return (
    <div className="space-y-4">
      <div className={`${card} p-4`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5"><ShieldAlert size={14} /> Standing audit</p>
            <p className="text-[13px] text-muted mt-1 max-w-2xl">
              Eve re-runs these checks every hour and posts anything NEW to the Slack approvals channel — never the
              whole list, because an alert that repeats is an alert people mute. Items close themselves when the
              problem goes away.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select className={input + ' w-auto'} value={status} onChange={e => setStatus(e.target.value as any)}>
              <option value="open">Open</option>
              <option value="all">Everything, including closed</option>
            </select>
            <button onClick={runNow} disabled={busy === 'run'}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white text-[13px] font-semibold px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
              <Zap size={13} /> {busy === 'run' ? 'Scanning…' : 'Scan now'}
            </button>
          </div>
        </div>
        {ranAt && <p className="text-[12px] text-muted mt-2">Last scanned at {ranAt}.</p>}
        {pipelineBad && (
          <p className="text-[13px] text-[#7A1A1A] mt-3 font-semibold">
            A data feed is down. Until that clears, every number in this app — and every answer Eve gives — is older than it looks.
          </p>
        )}
      </div>

      {loading ? <p className="text-[13px] text-muted">Loading…</p>
      : !items.length ? (
        <div className={`${card} p-6 text-center`}>
          <p className="text-sm font-semibold text-ink">Nothing on the tab.</p>
          <p className="text-[13px] text-muted mt-1">Every feed is current, nobody has been waiting on a reply past six hours, and no arrival is missing a clean.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(i => {
            const sev = SEV[i.severity] || SEV.info
            const closed = i.status === 'resolved'
            return (
              <div key={i.id} className={`${card} p-4 border ${closed ? 'opacity-60' : sev.ring}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-block w-2 h-2 rounded-full ${sev.dot}`} />
                      <span className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">{AREA_LABEL[i.area] || i.area}</span>
                      {i.status !== 'open' && <span className="text-[11px] rounded-full bg-app border border-line px-2 py-0.5 text-muted">{i.status}</span>}
                      <span className="text-[12px] text-muted inline-flex items-center gap-1">
                        <Clock size={11} /> {closed ? 'closed' : i.ageDays === 0 ? 'found today' : `open ${i.ageDays} day${i.ageDays === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-ink mt-1">{i.title}</p>
                    <p className="text-[13px] text-ink mt-1">{i.detail}</p>
                    {i.fix && <p className="text-[13px] text-brand-700 mt-1.5">→ {i.fix}</p>}
                  </div>
                  {canEdit && !closed && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button onClick={() => decide(i.id, 'ack')} disabled={busy === i.id}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-line text-ink text-[12px] font-semibold px-2.5 py-1.5 hover:bg-app disabled:opacity-50">
                        <Check size={12} /> On it
                      </button>
                      <button onClick={() => decide(i.id, 'snooze')} disabled={busy === i.id}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-line text-muted text-[12px] font-semibold px-2.5 py-1.5 hover:bg-app disabled:opacity-50">
                        <BellOff size={12} /> Snooze 7d
                      </button>
                    </div>
                  )}
                  {canEdit && closed && (
                    <button onClick={() => decide(i.id, 'reopen')} disabled={busy === i.id}
                      className="text-[12px] text-muted hover:text-ink shrink-0">Reopen</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


// ---------------------------------------------------------------------------------------------
// WHAT SHE DOES NOT KNOW (Jon, 2026-08-24: "improve how she understands the business, ask
// questions etc"). Everything else she learns is inferred from records; this is the one channel
// where knowledge arrives because a person said it. An answer becomes a memory with their name on
// it, weighted above anything she worked out herself.
//
// Sits ABOVE the memory list on purpose. Answering one question is worth more than reading fifty
// memories, and a question list you have to scroll to find is a question list nobody answers.
// ---------------------------------------------------------------------------------------------
type Question = {
  id: string; question: string; why: string | null; scope: string; kind: string
  asked_count: number; source: string; created_at: string
}

function EveQuestions({ canEdit, onAnswered }: { canEdit: boolean; onAnswered: () => void }) {
  const [qs, setQs] = useState<Question[]>([])
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/eve/questions').then(x => x.json())
      setQs(r?.questions || [])
    } catch { /* silent — this is an extra, not the page */ }
  }, [])
  useEffect(() => { load() }, [load])

  async function act(id: string, op: 'answer' | 'dismiss') {
    setBusy(id)
    try {
      await fetch('/api/eve/questions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, id, answer: draft[id] || '' }),
      })
      setQs(x => x.filter(q => q.id !== id))
      if (op === 'answer') onAnswered()
    } finally { setBusy('') }
  }

  if (!qs.length) return null
  return (
    <div className={`${card} p-4 mb-4 border-brand-200`}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center justify-between w-full text-left">
        <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
          <HelpCircle size={14} /> She is asking you {qs.length} thing{qs.length === 1 ? '' : 's'}
        </p>
        <span className="text-[12px] text-muted">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-muted">
            Everything else she knows she worked out from records. These are the things only a person can tell her —
            your answer becomes a memory with your name on it, and outranks anything she concluded herself.
          </p>
          {qs.map(q => (
            <div key={q.id} className="rounded-xl border border-line bg-app px-3 py-2.5">
              <p className="text-[13px] font-semibold text-ink">{q.question}</p>
              {q.why && <p className="text-[12px] text-muted mt-0.5">Why she is asking: {q.why}</p>}
              <p className="text-[11px] text-muted mt-1">
                {q.scope}{q.asked_count > 1 ? ` · asked ${q.asked_count} times` : ''}{q.source === 'eve' ? ' · came up in conversation' : ''}
              </p>
              {canEdit && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    className={input + ' flex-1 min-w-[220px]'} placeholder="Tell her…"
                    value={draft[q.id] || ''} onChange={e => setDraft({ ...draft, [q.id]: e.target.value })}
                  />
                  <button onClick={() => act(q.id, 'answer')} disabled={busy === q.id || !(draft[q.id] || '').trim()}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
                    <Check size={13} /> Save
                  </button>
                  <button onClick={() => act(q.id, 'dismiss')} disabled={busy === q.id}
                    className="text-xs font-semibold text-muted hover:text-ink px-2 py-2">Not worth answering</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// MEMORY HEALTH — duplicates, contradictions, vague lines and memories nobody ever used.
//
// Memory is the only part of Eve with a running cost per turn, so a useless line is not neutral:
// it is rent, paid forever, in the space a useful line could have used. Nothing here deletes on its
// own and nothing touches a memory a person wrote — every row is a proposal with its reason.
// ---------------------------------------------------------------------------------------------
type MemFinding = {
  kind: string; severity: string; reason: string; proposal: string; ids: string[]
  rows: { id: string; kind: string; scope: string; weight: number; source: string; text: string; use_count: number }[]
}

function EveMemoryHealth({ canEdit, onChanged }: { canEdit: boolean; onChanged: () => void }) {
  const [data, setData] = useState<any>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try { setData(await fetch('/api/eve/memory-audit').then(x => x.json())) } catch { /* extra */ }
  }, [])
  useEffect(() => { load() }, [load])

  async function apply(f: MemFinding, op: 'expire' | 'merge' | 'keep') {
    setBusy(f.ids.join(','))
    try {
      await fetch('/api/eve/memory-audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ids: f.ids }),
      })
      await load(); onChanged()
    } finally { setBusy('') }
  }

  if (!data?.ok) return null
  const findings: MemFinding[] = data.findings || []

  return (
    <div className={`${card} p-4 mb-4`}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center justify-between w-full text-left">
        <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">
          <Layers size={14} /> Memory health
          {findings.length > 0 && <span className="text-[11px] font-semibold rounded-full bg-[#FDF3E0] text-[#9A6200] border border-[#F0DAA8] px-2 py-0.5">{findings.length} to clean up</span>}
        </p>
        <span className="text-[12px] text-muted">{open ? 'hide' : 'show'}</span>
      </button>
      <p className="text-[12px] text-muted mt-1">{data.summary}</p>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-[12px] text-muted">
            {data.promptCost?.note} Nothing here is deleted — items are expired, recoverable, and anything you wrote yourself is never touched.
          </p>
          {!findings.length && <p className="text-[13px] text-ink">Nothing to clean up. Her memory is tight.</p>}
          {findings.map((f, i) => (
            <div key={i} className={`rounded-xl border px-3 py-2.5 ${f.severity === 'high' ? 'border-[#F0C9C9] bg-[#FDF3F3]' : 'border-line bg-app'}`}>
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted font-semibold">{f.kind}</p>
              <p className="text-[13px] text-ink mt-1">{f.reason}</p>
              <div className="mt-2 space-y-1">
                {f.rows.slice(0, 6).map(r => (
                  <p key={r.id} className="text-[12px] text-muted">
                    <span className="font-mono text-[11px]">{r.scope}</span> · w{r.weight} · used {r.use_count}× — {r.text.slice(0, 160)}
                  </p>
                ))}
                {f.rows.length > 6 && <p className="text-[12px] text-muted">…and {f.rows.length - 6} more.</p>}
              </div>
              {canEdit && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.proposal === 'merge' && (
                    <button onClick={() => apply(f, 'merge')} disabled={!!busy}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-50">
                      <Merge size={12} /> Merge into one
                    </button>
                  )}
                  {f.proposal === 'expire' && (
                    <button onClick={() => apply(f, 'expire')} disabled={!!busy}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-50">
                      <Trash2 size={12} /> Retire {f.ids.length}
                    </button>
                  )}
                  <button onClick={() => apply(f, 'keep')} disabled={!!busy}
                    className="text-xs font-semibold text-muted hover:text-ink px-2 py-1.5">Leave them</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
