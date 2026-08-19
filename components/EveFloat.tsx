'use client'
// EVE AS A FLOATING COLLEAGUE, NOT A DESTINATION (Jon, 2026-08-19: "Eve does not need her own
// page — a floating icon"). The bubble sits bottom-right on every signed-in page; the panel opens
// over whatever you were doing, so asking her something never costs the page you were on. The
// conversation lives in sessionStorage, so navigating between tabs mid-thought keeps the thread.
// Managing what she BELIEVES moved to Settings → Users & admin → Eve (memory, voice, direction).
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Send, ThumbsUp, ThumbsDown, X, Eraser } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string; chatId?: string | null; meta?: any; rated?: number }

const STORE = 'eve-float-chat-v1'
const SUGGEST = [
  'What is going wrong today that I should know about?',
  'Which arrivals today need attention?',
  'What is our cost per clean this month vs last?',
]
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'

function loadStored(): Msg[] {
  try { const raw = sessionStorage.getItem(STORE); return raw ? JSON.parse(raw) : [] } catch { return [] }
}

export function EveFloat() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [noteFor, setNoteFor] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setMsgs(loadStored()) }, [])
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))) } catch { /* full */ } }, [msgs])
  useEffect(() => { if (open) { endRef.current?.scrollIntoView({ behavior: 'smooth' }); boxRef.current?.focus() } }, [open, msgs, busy])

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
    <>
      {/* The bubble. Always present, never in the way. */}
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Ask Eve"
          className="fixed bottom-16 lg:bottom-5 right-4 z-40 w-12 h-12 rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 grid place-items-center transition-transform hover:scale-105">
          <Sparkles size={20} />
        </button>
      )}

      {open && (
        <div className="fixed z-50 inset-0 sm:inset-auto sm:bottom-5 sm:right-4 sm:w-[400px] flex flex-col bg-white sm:border sm:border-line sm:rounded-2xl sm:shadow-2xl overflow-hidden"
          style={{ maxHeight: '100dvh', height: 'min(640px, calc(100dvh - 2rem))' }}>
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-line bg-app/60">
            <Sparkles size={15} className="text-brand-600" />
            <span className="text-sm font-semibold text-ink">Eve</span>
            <span className="text-[11px] text-muted hidden sm:inline">sees ops, money, quality, labor, guests</span>
            {msgs.length > 0 && (
              <button onClick={() => setMsgs([])} title="Clear the conversation"
                className="ml-auto p-1.5 rounded-lg text-muted hover:text-ink"><Eraser size={14} /></button>
            )}
            <button onClick={() => setOpen(false)} aria-label="Close"
              className={`${msgs.length ? '' : 'ml-auto '}p-1.5 rounded-lg text-muted hover:text-ink`}><X size={16} /></button>
          </div>

          <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
            {!msgs.length && (
              <div className="text-center py-8">
                <Sparkles size={22} className="text-brand-500 mx-auto mb-2" />
                <p className="text-[13px] text-muted max-w-[260px] mx-auto">
                  Ask her something you would otherwise open four tabs to answer.
                </p>
                <div className="flex flex-col gap-1.5 mt-4">
                  {SUGGEST.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="text-left text-[12.5px] text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-xl px-3 py-2">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i}>
                <div className={`text-[13.5px] whitespace-pre-wrap rounded-2xl px-3 py-2 max-w-[90%] ${m.role === 'user' ? 'ml-auto bg-brand-600 text-white' : 'bg-app border border-line text-ink'}`}>{m.content}</div>
                {m.role === 'assistant' && m.chatId && (
                  <div className="flex items-center gap-1.5 mt-1 pl-0.5">
                    <button onClick={() => rate(i, 1)} title="Good answer"
                      className={`p-1 rounded-lg ${m.rated === 1 ? 'text-brand-600 bg-brand-50' : 'text-muted hover:text-ink'}`}><ThumbsUp size={12} /></button>
                    <button onClick={() => setNoteFor(noteFor === i ? null : i)} title="Wrong — teach her"
                      className={`p-1 rounded-lg ${m.rated === -1 ? 'text-brand-600 bg-brand-50' : 'text-muted hover:text-ink'}`}><ThumbsDown size={12} /></button>
                    {m.meta && (
                      <span className="text-[10.5px] text-muted">
                        {(m.meta.ms / 1000).toFixed(1)}s{m.meta.tools?.length ? ` · ${m.meta.tools.length} lookups` : ''}{m.meta.memories ? ` · ${m.meta.memories} memories` : ''}
                      </span>
                    )}
                  </div>
                )}
                {noteFor === i && (
                  <div className="mt-1.5 p-2.5 bg-app border border-line rounded-xl max-w-[90%]">
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className={input}
                      placeholder="What did she get wrong? This is written into her memory." />
                    <div className="flex gap-2 mt-1.5">
                      <button onClick={() => rate(i, -1, note)} className="text-[11.5px] font-semibold bg-brand-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-brand-700">Save correction</button>
                      <button onClick={() => rate(i, -1)} className="text-[11.5px] font-semibold text-muted hover:text-ink px-1.5">Just mark wrong</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="text-xs text-muted px-1">Looking…</div>}
            <div ref={endRef} />
          </div>

          <div className="border-t border-line p-2 flex items-end gap-2">
            <textarea ref={boxRef} value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1} placeholder="Ask Eve…" className={`${input} resize-none max-h-28`} />
            <button onClick={() => send()} disabled={busy || !text.trim()}
              className="inline-flex items-center justify-center rounded-xl bg-brand-600 text-white p-2.5 hover:bg-brand-700 disabled:opacity-50"><Send size={15} /></button>
          </div>
        </div>
      )}
    </>
  )
}
