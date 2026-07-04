'use client'
import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sparkles, X, Send } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string }

const HELLO: Msg = {
  role: 'assistant',
  content: "Hey Jon — I'm Eve. Ask me what needs approval, who's arriving today, or say \"draft an ops plan for the Miami and Broward teams.\""
}

const SUGGEST = [
  "What needs my approval right now?",
  "Who's arriving in the next 7 days?",
  "Draft an ops plan for Miami and Broward.",
]

export function BrainChat() {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([HELLO])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, open, busy])

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user' as const, content: text }]
    setMsgs(next); setInput(''); setBusy(true)
    try {
      const res = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next })
      })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setMsgs(m => [...m, { role: 'assistant', content: d.reply || '(no response)' }])
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: '⚠ ' + (e?.message || String(e)) }])
    } finally { setBusy(false) }
  }

  // The Command Center already embeds the full Eve console, so the floating pill there
  // is redundant and overlaps it. Hide the floater on /command, on public guest books (/g/), and on auth screens.
  if (path === '/command' || (path || '').startsWith('/g/') || path === '/login' || path === '/no-access' || (path || '').startsWith('/signup')) return null

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-brand-600 text-white px-4 py-3 shadow-lg hover:bg-brand-700 transition-colors">
          <Sparkles size={18} /> <span className="font-semibold text-sm">Ask Eve</span>
        </button>
      )}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[min(92vw,380px)] h-[min(72vh,580px)] flex flex-col rounded-2xl border border-brand-200 bg-white shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-brand-50">
            <span className="font-semibold text-ink text-sm inline-flex items-center gap-1.5"><Sparkles size={15} className="text-brand-600" /> Eve</span>
            <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={`text-sm whitespace-pre-wrap rounded-2xl px-3 py-2 max-w-[88%] ${m.role === 'user' ? 'ml-auto bg-brand-600 text-white' : 'bg-app border border-line text-ink'}`}>{m.content}</div>
            ))}
            {busy && <div className="text-xs text-muted px-1">Thinking…</div>}
            {msgs.length === 1 && !busy && (
              <div className="flex flex-col gap-1.5 pt-1">
                {SUGGEST.map(s => (
                  <button key={s} onClick={() => send(s)} className="text-left text-xs text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-lg px-2.5 py-1.5">{s}</button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="border-t border-line p-2 flex items-end gap-2">
            <textarea value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1} placeholder="Ask anything…"
              className="flex-1 resize-none text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200 max-h-28" />
            <button onClick={() => send()} disabled={busy || !input.trim()}
              className="inline-flex items-center justify-center rounded-xl bg-brand-600 text-white p-2.5 hover:bg-brand-700 disabled:opacity-50"><Send size={16} /></button>
          </div>
        </div>
      )}
    </>
  )
}
