'use client'
import { useState, useRef, useEffect } from 'react'
import { Sparkles, Send, Wand2 } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const SUGGEST = [
  'What needs my attention today?',
  'Draft replies for the unanswered reviews',
  "What's overdue right now?",
  "Summarize today's arrivals",
]

export function BrainConsole() {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim()
    if (!text || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: text }]
    setMsgs(next); setInput(''); setBusy(true)
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setMsgs(m => [...m, { role: 'assistant', content: d.reply || '(no response)' }])
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: '⚠ ' + (e?.message || String(e)) }])
    } finally {
      setBusy(false)
    }
  }

  const empty = msgs.length === 0

  return (
    <div className="flex flex-col rounded-2xl border border-brand-200 bg-white overflow-hidden shadow-soft h-[min(72vh,640px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-line bg-gradient-to-r from-brand-50 to-white">
        <span className="font-semibold text-ink text-sm inline-flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white">
            <Sparkles size={13} />
          </span>
          Eve
        </span>
        <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">Command console</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {empty ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-soft">
              <Wand2 size={22} />
            </span>
            <h3 className="mt-4 text-lg font-bold text-ink tracking-tight">Hey Jon — I&apos;m Eve, your hospitality concierge.</h3>
            <p className="mt-1.5 text-sm text-muted max-w-md">
              I can see your reviews, messages, reservations and open work. Ask me what needs attention, who&apos;s arriving, or have me draft replies and plans.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 max-w-xl">
              {SUGGEST.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-sm text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-full px-3.5 py-1.5 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {msgs.map((m, i) => (
              <div
                key={i}
                className={`text-sm whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 max-w-[82%] ${
                  m.role === 'user'
                    ? 'ml-auto bg-brand-600 text-white'
                    : 'bg-app border border-line text-ink'
                }`}
              >
                {m.content}
              </div>
            ))}
            {busy && <div className="text-xs text-muted px-1 inline-flex items-center gap-1.5"><Sparkles size={12} className="text-brand-600" /> Thinking…</div>}
          </>
        )}
        <div ref={endRef} />
      </div>

      {/* Suggested chips (compact, when conversation is active) */}
      {!empty && (
        <div className="px-4 pt-2 flex flex-wrap gap-1.5 border-t border-line/70">
          {SUGGEST.map(s => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={busy}
              className="text-[12px] text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-full px-2.5 py-1 transition-colors disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-line p-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1}
          placeholder="Ask Eve anything…"
          className="flex-1 resize-none text-sm text-ink bg-app border border-line rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200 max-h-32"
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
        >
          <Send size={15} /> Send
        </button>
      </div>
    </div>
  )
}
