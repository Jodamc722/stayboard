'use client'
// EVE'S SETTINGS — memory, voice and direction, living where every other setting lives (Jon,
// 2026-08-19: "she should be able to see memories in the settings; work on a robust settings and
// memory feature"). The chat became a floating bubble on every page; THIS is where you open her
// head: everything she believes (editable, deletable, reweighable), how she sounds, what she has
// recommended and how those calls actually graded, and a button to make her learn RIGHT NOW.
import { useState, useEffect, useCallback } from 'react'
import { Brain, Mic, Compass, Trash2, Plus, Save, X, Check, TrendingUp, Pencil, Zap } from 'lucide-react'

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
  const [tab, setTab] = useState<'memory' | 'voice' | 'direction'>('memory')
  return (
    <div>
      <div className="flex items-center gap-1 mb-3 border-b border-line">
        {([['memory', 'Memory', Brain], ['voice', 'Voice', Mic], ['direction', 'Direction', Compass]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      {tab === 'memory' && <EveMemoryAdmin canEdit={canEdit} />}
      {tab === 'voice' && <EveVoiceAdmin canEdit={canEdit} />}
      {tab === 'direction' && <EveDirectionAdmin canEdit={canEdit} />}
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
