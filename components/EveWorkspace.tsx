'use client'
// The full-page Eve: a wider chat, plus the two tabs that make her safe to trust —
// MEMORY (everything she believes, editable and deletable) and VOICE (how she sounds, tunable
// without a deploy). The thumbs on every answer are the improvement loop: a thumbs-down with a note
// is written straight into her memory as a correction.
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Send, ThumbsUp, ThumbsDown, Trash2, Plus, Save, X, Brain, MessageSquare, Mic } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string; chatId?: string | null; meta?: any; rated?: number }
type Memory = {
  id: string; kind: string; text: string; why: string | null; scope: string; weight: number
  source: string; use_count: number; last_used_at: string | null; created_by: string | null; created_at: string
}
type Tab = 'chat' | 'memory' | 'voice'

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
const SUGGEST = [
  'What is going wrong today that I should know about?',
  'Why is Botanica underperforming?',
  'Which units are dragging our review average down, and what would fix them?',
  'What is our cost per clean this month vs last?',
]

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'

export function EveWorkspace({ canEdit }: { canEdit: boolean }) {
  const [tab, setTab] = useState<Tab>('chat')
  return (
    <div>
      <div className="flex items-center gap-1 mb-4 border-b border-line">
        {([['chat', 'Chat', MessageSquare], ['memory', 'Memory', Brain], ['voice', 'Voice', Mic]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k as Tab)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tab === 'chat' && <EveChat />}
      {tab === 'memory' && <EveMemory canEdit={canEdit} />}
      {tab === 'voice' && <EveVoice canEdit={canEdit} />}
    </div>
  )
}

function EveChat() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [noteFor, setNoteFor] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const send = useCallback(async (override?: string) => {
    const q = (override ?? text).trim()
    if (!q || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next); setText(''); setBusy(true)
    try {
      const res = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })) }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setMsgs(m => [...m, { role: 'assistant', content: d.reply || '(no response)', chatId: d.chatId, meta: d.meta }])
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: '⚠ ' + (e?.message || String(e)) }])
    } finally { setBusy(false) }
  }, [text, busy, msgs])

  async function rate(i: number, rating: number, correction?: string) {
    const m = msgs[i]
    if (!m?.chatId) return
    setMsgs(list => list.map((x, j) => j === i ? { ...x, rated: rating } : x))
    setNoteFor(null); setNote('')
    try {
      await fetch('/api/eve/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: m.chatId, rating, correction: correction || '' }),
      })
    } catch { /* feedback is best-effort */ }
  }

  return (
    <div className={`${card} flex flex-col`} style={{ height: 'min(72vh, 700px)' }}>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!msgs.length && (
          <div className="text-center py-10">
            <Sparkles size={26} className="text-brand-500 mx-auto mb-3" />
            <p className="text-sm text-muted max-w-md mx-auto">
              She can see operations, money, quality, labor and guests. Ask her something you would
              otherwise have to open four tabs to answer.
            </p>
            <div className="flex flex-col gap-1.5 mt-5 max-w-lg mx-auto">
              {SUGGEST.map(s => (
                <button key={s} onClick={() => send(s)}
                  className="text-left text-[13px] text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-xl px-3 py-2">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i}>
            <div className={`text-sm whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 max-w-[86%] ${m.role === 'user' ? 'ml-auto bg-brand-600 text-white' : 'bg-app border border-line text-ink'}`}>{m.content}</div>
            {m.role === 'assistant' && m.chatId && (
              <div className="flex items-center gap-2 mt-1.5 pl-1">
                <button onClick={() => rate(i, 1)} title="Good answer"
                  className={`p-1 rounded-lg ${m.rated === 1 ? 'text-brand-600 bg-brand-50' : 'text-muted hover:text-ink'}`}><ThumbsUp size={13} /></button>
                <button onClick={() => setNoteFor(noteFor === i ? null : i)} title="Wrong, or does not sound like me"
                  className={`p-1 rounded-lg ${m.rated === -1 ? 'text-brand-600 bg-brand-50' : 'text-muted hover:text-ink'}`}><ThumbsDown size={13} /></button>
                {m.meta && (
                  <span className="text-[11px] text-muted">
                    {m.meta.turns} turn{m.meta.turns === 1 ? '' : 's'} · {(m.meta.ms / 1000).toFixed(1)}s
                    {m.meta.tools?.length ? ` · ${m.meta.tools.length} lookups` : ''}
                    {m.meta.memories ? ` · ${m.meta.memories} memories` : ''}
                    {m.meta.moneyRedacted ? ' · $ hidden' : ''}
                  </span>
                )}
              </div>
            )}
            {noteFor === i && (
              <div className="mt-2 ml-1 p-3 bg-app border border-line rounded-xl max-w-[86%]">
                <p className="text-xs text-muted mb-2">What did she get wrong, or how should this have sounded? This gets written into her memory so it does not happen again.</p>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={input} placeholder="She should have checked the clean status before calling it vacant." />
                <div className="flex gap-2 mt-2">
                  <button onClick={() => rate(i, -1, note)} className="text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700">Save the correction</button>
                  <button onClick={() => rate(i, -1)} className="text-xs font-semibold text-muted hover:text-ink px-2">Just mark it wrong</button>
                </div>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="text-xs text-muted px-1">Looking…</div>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-line p-2.5 flex items-end gap-2">
        <textarea value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1} placeholder="Ask anything…" className={`${input} resize-none max-h-32`} />
        <button onClick={() => send()} disabled={busy || !text.trim()}
          className="inline-flex items-center justify-center rounded-xl bg-brand-600 text-white p-2.5 hover:bg-brand-700 disabled:opacity-50"><Send size={16} /></button>
      </div>
    </div>
  )
}

function EveMemory({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ text: '', kind: 'rule', scope: 'portfolio', why: '', weight: 8 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/eve/memory')
      const d = await r.json()
      if (d.needsMigration) setErr('Migration 045 has not been run yet — she has nowhere to store what she learns.')
      else setErr('')
      setRows(d.memories || [])
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  async function post(payload: any) {
    await fetch('/api/eve/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    await load()
  }

  const shown = rows.filter(r => !filter || (r.text + ' ' + (r.why || '') + ' ' + r.scope + ' ' + r.kind).toLowerCase().includes(filter.toLowerCase()))

  return (
    <div>
      <div className={`${card} p-4 mb-4`}>
        <p className="text-sm text-ink font-semibold mb-1">Everything Eve believes</p>
        <p className="text-[13px] text-muted">
          The high-weight rows go into her prompt on every question. If she has learned something
          wrong, delete it here — she will stop acting on it immediately.
        </p>
      </div>

      {err && <div className="mb-3 text-[13px] text-[#9A6200] bg-[#FDF3E0] border border-[#F0DAA8] rounded-xl px-3.5 py-2.5">{err}</div>}

      <div className="flex items-center gap-2 mb-3">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…" className={`${input} max-w-xs`} />
        <span className="text-xs text-muted">{shown.length} of {rows.length}</span>
        {canEdit && (
          <button onClick={() => setAdding(a => !a)} className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700">
            {adding ? <X size={13} /> : <Plus size={13} />} {adding ? 'Cancel' : 'Teach her something'}
          </button>
        )}
      </div>

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
          <p className="text-sm text-muted">Nothing stored yet. She writes here as she learns — or teach her something directly.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map(m => (
            <div key={m.id} className={`${card} p-3.5 flex items-start gap-3`}>
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
                <button onClick={() => post({ op: 'delete', id: m.id })} title="Delete — she stops believing this"
                  className="text-muted hover:text-[#A32020] p-1 shrink-0"><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function EveVoice({ canEdit }: { canEdit: boolean }) {
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
    <div className={`${card} p-4`}>
      <p className="text-sm text-ink font-semibold mb-1">How Eve should sound</p>
      <p className="text-[13px] text-muted mb-3 max-w-2xl">
        Her prompt already carries worked examples of the register you want. Anything you write here
        is appended on top and overrides them, so you can tune her tone without waiting for a deploy.
        Be specific — &quot;stop hedging, give me the call first&quot; beats &quot;be more natural&quot;.
      </p>
      {loading ? <p className="text-sm text-muted">Loading…</p> : (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={8} disabled={!canEdit}
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
