'use client'
// EVE'S CHAT TAB — a learning chat (Jon, 2026-11-05: "EVE chat needs to be a learning chat, where we
// can teach Eve" and "She can learn from any CCS agent, she can also learn from Roberto, Karla &
// Bernadette").
//
// Same brain as the floating bubble (POST /api/agent → lib/eve/run.ts), with what the bubble cannot
// hold: past conversations kept on the server (eve_conversations, migration 171) to resume or start
// fresh; a Teach Eve switch that makes the message an instruction she files with `remember`; every
// memory a turn wrote shown as a chip to Undo or Edit; a "What I used" expander per answer; and the
// "What Eve learned" panel — the last 7 days (or this conversation), grouped by who taught it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Send, GraduationCap, Plus, History, Loader2, ThumbsUp, ThumbsDown, Pencil, Trash2, X, Sparkles } from 'lucide-react'
import { LearnedChips, WhatIUsed, type Learned } from '@/components/EveChatBits'

type Msg = { role: 'user' | 'assistant'; content: string; chatId?: string | null; meta?: any; learned?: Learned[]; teach?: boolean; rated?: number }
type Conv = { id: string; title: string | null; updated_at: string }
type Mem = { id: string; kind: string; text: string; scope: string; weight: number; source: string; teacher: string; canEdit: boolean; updated_at: string; evidence: any }

const field = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const ago = (iso: string) => {
  const m = (Date.now() - Date.parse(iso)) / 60000
  if (!Number.isFinite(m)) return ''
  if (m < 60) return `${Math.max(1, Math.round(m))}m`
  if (m < 48 * 60) return `${Math.round(m / 60)}h`
  return `${Math.round(m / 1440)}d`
}
const scopeLabel = (s: string) => (s === 'portfolio' ? 'Everywhere' : String(s || '').replace(/^(building|unit|channel|person):/, ''))

export function EveChat() {
  const [convs, setConvs] = useState<Conv[]>([])
  const [needsMigration, setNeedsMigration] = useState(false)
  const [convId, setConvId] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingConv, setLoadingConv] = useState(false)
  const [teach, setTeach] = useState(false)
  const [me, setMe] = useState<{ teacher: boolean; tier: string | null; maxWeight: number } | null>(null)
  const [side, setSide] = useState(false)          // the sidebar, on a phone
  const [noteFor, setNoteFor] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const [learnedTick, setLearnedTick] = useState(0)

  const loadConvs = useCallback(async () => {
    try {
      const d = await fetch('/api/eve/conversations', { cache: 'no-store' }).then(r => r.json())
      setConvs(d?.conversations || []); setNeedsMigration(!!d?.needsMigration)
    } catch { /* the chat works without the list */ }
  }, [])
  useEffect(() => { loadConvs() }, [loadConvs])
  useEffect(() => { fetch('/api/eve/teachers').then(r => r.json()).then(d => { if (d?.me) setMe(d.me) }).catch(() => {}) }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function openConv(id: string) {
    setSide(false); setLoadingConv(true); setConvId(id); setMsgs([])
    try {
      const d = await fetch(`/api/eve/conversations/${id}`, { cache: 'no-store' }).then(r => r.json())
      const out: Msg[] = []
      for (const t of (d?.turns || [])) {
        out.push({ role: 'user', content: t.question })
        out.push({ role: 'assistant', content: t.answer, chatId: t.chatId, rated: t.rating ?? undefined, meta: { tools: t.tools } })
      }
      setMsgs(out)
    } catch { setMsgs([{ role: 'assistant', content: '⚠ Could not load that conversation.' }]) }
    setLoadingConv(false)
  }
  function newConv() { setConvId(null); setMsgs([]); setSide(false); setTimeout(() => boxRef.current?.focus(), 50) }

  const send = useCallback(async () => {
    const q = text.trim()
    if (!q || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: q, teach }]
    setMsgs(next); setText(''); setBusy(true)
    try {
      const res = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })), conversationId: convId, teach }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || d.message || `HTTP ${res.status}`)
      setMsgs(m => [...m, { role: 'assistant', content: d.reply || '(no response)', chatId: d.chatId, meta: d.meta, learned: d.meta?.learned || [] }])
      if (d.conversationId && d.conversationId !== convId) { setConvId(d.conversationId); loadConvs() }
      else if (d.conversationId) setConvs(cs => cs.map(c => (c.id === d.conversationId ? { ...c, updated_at: new Date().toISOString() } : c)))
      if ((d.meta?.learned || []).length) setLearnedTick(n => n + 1)
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: '⚠ ' + (e?.message || String(e)) }])
    } finally { setBusy(false) }
  }, [text, busy, msgs, convId, teach, loadConvs])

  async function rate(i: number, rating: number, correction?: string) {
    const m = msgs[i]
    if (!m?.chatId) return
    setMsgs(list => list.map((x, j) => (j === i ? { ...x, rated: rating } : x)))
    setNoteFor(null); setNote('')
    try { await fetch('/api/eve/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: m.chatId, rating, correction: correction || '' }) }) } catch { /* best-effort */ }
  }

  const sidebar = (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <button onClick={newConv} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-600 text-white px-3 py-2 text-[13px] font-semibold hover:bg-brand-700"><Plus size={14} /> New conversation</button>
      <div className="min-h-0 flex-1 overflow-y-auto -mx-1 px-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Conversations</div>
        {needsMigration && <p className="text-[12px] text-muted">Past conversations appear once migration 171 is run.</p>}
        {!needsMigration && !convs.length && <p className="text-[12px] text-muted">Nothing yet — ask her something.</p>}
        <div className="flex flex-col gap-0.5">
          {convs.map(c => (
            <button key={c.id} onClick={() => openConv(c.id)}
              className={`text-left rounded-lg px-2 py-1.5 text-[12.5px] ${c.id === convId ? 'bg-brand-50 text-brand-800 font-semibold' : 'text-ink hover:bg-app'}`}>
              <span className="line-clamp-2">{c.title || 'Untitled'}</span>
              <span className="text-[10.5px] text-muted font-normal">{ago(c.updated_at)} ago</span>
            </button>
          ))}
        </div>
        <div className="mt-4"><LearnedPanel conversationId={convId} tick={learnedTick} /></div>
      </div>
    </div>
  )

  return (
    <div className="grid lg:grid-cols-[270px_1fr] gap-3" style={{ height: 'calc(100dvh - 210px)', minHeight: 480 }}>
      <aside className="hidden lg:block bg-white border border-line rounded-2xl p-3 min-h-0">{sidebar}</aside>
      {side && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/30" onClick={() => setSide(false)}>
          <div className="absolute inset-y-0 left-0 w-[86%] max-w-[340px] bg-white p-3 pt-safe flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-end mb-1"><button onClick={() => setSide(false)} className="p-2 text-muted hover:text-ink" aria-label="Close"><X size={16} /></button></div>
            {sidebar}
          </div>
        </div>
      )}

      <section className="bg-white border border-line rounded-2xl flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-line bg-app/60 flex-shrink-0">
          <button onClick={() => setSide(true)} className="lg:hidden p-1.5 rounded-lg text-muted hover:text-ink" aria-label="Conversations and what she learned"><History size={16} /></button>
          <span className="text-[13px] font-semibold text-ink truncate">{convId ? (convs.find(c => c.id === convId)?.title || 'Conversation') : 'New conversation'}</span>
          {me?.teacher && <span title="Your word is kept as a rule at this weight" className="hidden sm:inline text-[10.5px] font-semibold rounded-full px-1.5 py-0.5 border border-brand-200 bg-brand-50 text-brand-700">teacher · weight {me.maxWeight}</span>}
          <button onClick={() => { setTeach(!teach); setTimeout(() => boxRef.current?.focus(), 30) }}
            title="In Teach mode your message is filed as an instruction, not answered as a question"
            className={`ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 h-7 text-[12px] font-semibold border ${teach ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white border-line text-ink hover:bg-app'}`}>
            <GraduationCap size={13} /> {teach ? 'Teaching — on' : 'Teach Eve'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-3">
          {loadingConv && <div className="text-xs text-muted"><Loader2 size={12} className="animate-spin inline mr-1" /> Loading…</div>}
          {!msgs.length && !loadingConv && (
            <div className="text-center py-10 max-w-md mx-auto">
              <Sparkles size={22} className="text-brand-500 mx-auto mb-2" />
              <p className="text-[13px] text-muted">Ask her anything — or switch on <b>Teach Eve</b> and tell her how things are done. What she keeps shows under her answer, with Undo and Edit.</p>
              <div className="flex flex-col gap-1.5 mt-4 text-left">
                {/* Starters only — the teacher finishes the sentence; nothing here is a real rule. */}
                {['From now on, at Salato we always ', 'Our rule for late checkout is ', 'Recuerda: a partir de ahora '].map(s => (
                  <button key={s} onClick={() => { setTeach(true); setText(s); boxRef.current?.focus() }}
                    className="text-[12.5px] text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-xl px-3 py-2">
                    <GraduationCap size={12} className="inline mr-1" />{s}…
                  </button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i}>
              <div className={`text-[13.5px] whitespace-pre-wrap rounded-2xl px-3 py-2 max-w-[90%] sm:max-w-[80%] ${m.role === 'user' ? (m.teach ? 'ml-auto bg-amber-500 text-white' : 'ml-auto bg-brand-600 text-white') : 'bg-app border border-line text-ink'}`}>
                {m.role === 'user' && m.teach && <span className="block text-[10px] uppercase tracking-wide opacity-80 mb-0.5">Teaching</span>}
                {m.content}
              </div>
              {m.role === 'assistant' && (
                <>
                  <LearnedChips items={m.learned || []} onChange={next => { setMsgs(list => list.map((x, j) => (j === i ? { ...x, learned: next } : x))); setLearnedTick(n => n + 1) }} />
                  <WhatIUsed used={m.meta?.used} tools={m.meta?.tools} chatId={m.chatId} conversationId={convId} />
                  {m.chatId && (
                    <div className="flex items-center gap-1.5 mt-0.5 pl-0.5">
                      <button onClick={() => rate(i, 1)} title="Good answer" className={`p-1.5 rounded-lg ${m.rated === 1 ? 'text-brand-600 bg-brand-50' : 'text-muted hover:text-ink'}`}><ThumbsUp size={13} /></button>
                      <button onClick={() => setNoteFor(noteFor === i ? null : i)} title="Wrong — teach her" className={`p-1.5 rounded-lg ${m.rated === -1 ? 'text-brand-600 bg-brand-50' : 'text-muted hover:text-ink'}`}><ThumbsDown size={13} /></button>
                      {m.meta?.ms ? <span className="text-[10.5px] text-muted">{(m.meta.ms / 1000).toFixed(1)}s</span> : null}
                    </div>
                  )}
                  {noteFor === i && (
                    <div className="mt-1.5 p-2.5 bg-app border border-line rounded-xl max-w-[90%]">
                      <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={field} placeholder="What did she get wrong? This is written into her memory." />
                      <div className="flex gap-2 mt-1.5">
                        <button onClick={() => rate(i, -1, note)} className="text-[11.5px] font-semibold bg-brand-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-brand-700">Save correction</button>
                        <button onClick={() => rate(i, -1)} className="text-[11.5px] font-semibold text-muted hover:text-ink px-1.5">Just mark wrong</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
          {busy && <div className="text-xs text-muted px-1">{teach ? 'Taking that down…' : 'Looking…'}</div>}
          <div ref={endRef} />
        </div>

        <div className={`border-t p-2 flex items-end gap-1.5 flex-shrink-0 ${teach ? 'border-amber-300 bg-amber-50' : 'border-line bg-white'}`}>
          <textarea ref={boxRef} value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={2} placeholder={teach ? 'Teach Eve a rule — e.g. "At Botanica, checkout is 10am on Sundays"' : 'Ask Eve…'} className={`${field} resize-none max-h-40`} />
          <button onClick={() => send()} disabled={busy || !text.trim()} aria-label="Send" title="Send"
            className={`inline-flex items-center justify-center rounded-xl text-white p-2.5 flex-shrink-0 disabled:opacity-50 ${teach ? 'bg-amber-500 hover:bg-amber-600' : 'bg-brand-600 hover:bg-brand-700'}`}>{teach ? <GraduationCap size={17} /> : <Send size={17} />}</button>
        </div>
      </section>
    </div>
  )
}

/** "What Eve learned": the last 7 days, or this conversation, grouped by who taught it. */
function LearnedPanel({ conversationId, tick }: { conversationId: string | null; tick: number }) {
  const [onlyConv, setOnlyConv] = useState(false)
  const [rows, setRows] = useState<Mem[] | null>(null)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ recent: '7' })
      if (onlyConv && conversationId) qs.set('conversationId', conversationId)
      const d = await fetch(`/api/eve/memory?${qs}`, { cache: 'no-store' }).then(r => r.json())
      setRows(d?.memories || []); setErr(d?.ok === false ? 'Memory is not set up yet.' : '')
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [onlyConv, conversationId])
  useEffect(() => { load() }, [load, tick])
  const groups = useMemo(() => {
    const g: Record<string, Mem[]> = {}
    for (const r of rows || []) { const k = r.teacher === 'eve' || r.teacher === 'slack' ? 'Picked up by Eve' : (String(r.teacher || 'Someone').split('@')[0]); (g[k] = g[k] || []).push(r) }
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length)
  }, [rows])
  const post = async (payload: any) => {
    const r = await fetch('/api/eve/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d?.error) { setErr(d?.error || `HTTP ${r.status}`); return false }
    setErr(''); return true
  }
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">What Eve learned</div>
        <div className="ml-auto inline-flex rounded-lg border border-line overflow-hidden text-[10.5px]">
          <button onClick={() => setOnlyConv(false)} className={`px-1.5 py-0.5 ${!onlyConv ? 'bg-brand-600 text-white' : 'text-muted'}`}>7 days</button>
          <button onClick={() => setOnlyConv(true)} disabled={!conversationId} className={`px-1.5 py-0.5 disabled:opacity-40 ${onlyConv ? 'bg-brand-600 text-white' : 'text-muted'}`}>This chat</button>
        </div>
      </div>
      {err && <p className="text-[11.5px] text-rose-700 mb-1">{err}</p>}
      {rows == null ? <p className="text-[12px] text-muted"><Loader2 size={11} className="animate-spin inline" /></p>
        : !rows.length ? <p className="text-[12px] text-muted">{onlyConv ? 'Nothing kept from this conversation yet.' : 'Nothing new this week.'}</p>
        : groups.map(([who, list]) => (
          <div key={who} className="mb-2">
            <div className="text-[11.5px] font-semibold text-ink mb-0.5">{who} <span className="text-muted font-normal">· {list.length}</span></div>
            {list.map(r => (
              <div key={r.id} className="group rounded-lg px-1.5 py-1 hover:bg-app">
                <div className="flex items-start gap-1">
                  <span className="text-[12px] text-ink flex-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted mr-1">{r.kind}</span>{r.text}
                    <span className="text-[10.5px] text-muted"> · {scopeLabel(r.scope)} · w{r.weight}</span>
                  </span>
                  {r.canEdit && (
                    <span className="flex-shrink-0 flex gap-0.5 opacity-70 group-hover:opacity-100">
                      <button title="Edit" onClick={() => { setEditing(editing === r.id ? null : r.id); setDraft(r.text) }} className="p-1 text-muted hover:text-ink"><Pencil size={11} /></button>
                      <button title="Delete" onClick={async () => { if (await post({ op: 'delete', id: r.id })) load() }} className="p-1 text-muted hover:text-rose-700"><Trash2 size={11} /></button>
                    </span>
                  )}
                </div>
                {editing === r.id && (
                  <div className="mt-1">
                    <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} className="w-full text-[12px] text-ink bg-white border border-line rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                    <div className="flex gap-2 mt-1">
                      <button onClick={async () => { if (await post({ op: 'update', id: r.id, text: draft.trim() })) { setEditing(null); load() } }} className="text-[11px] font-semibold bg-brand-600 text-white rounded-lg px-2 py-0.5">Save</button>
                      <button onClick={() => setEditing(null)} className="text-[11px] text-muted">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}
