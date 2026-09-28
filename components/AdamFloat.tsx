'use client'
// ADAM AS A FLOATING COLLEAGUE — the Garden Hotel's bubble, bottom-right on every hotel page, in
// the seat Eve has on the VR side. Same shape on purpose (Jon: "should look like my current
// board"), different brain: everything goes to /api/garden/adam, nothing to Eve.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Hotel, X, Send, Loader2, ThumbsUp, ThumbsDown, Trash2 } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string; chatId?: string | null; meta?: any }
const input = 'w-full rounded-xl border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:border-brand-500'

export function openAdam(question?: string) {
  try { window.dispatchEvent(new CustomEvent('adam:open', { detail: { q: question || '' } })) } catch {}
}

export function AdamFloat() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('Adam')
  const [noteFor, setNoteFor] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const boxRef = useRef<HTMLTextAreaElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/garden/adam', { cache: 'no-store' }).then(r => r.json()).then(d => { if (alive && d?.ok && d.settings?.name) setName(d.settings.name) }).catch(() => {})
    const onOpen = (e: any) => { setOpen(true); const q = String(e?.detail?.q || ''); if (q) setTimeout(() => { setText(q); boxRef.current?.focus() }, 60) }
    window.addEventListener('adam:open', onOpen as any)
    return () => { alive = false; window.removeEventListener('adam:open', onOpen as any) }
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs, open])

  const send = useCallback(async () => {
    const q = text.trim()
    if (!q || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next); setText(''); setBusy(true)
    try {
      const res = await fetch('/api/garden/adam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })) }) })
      const d = await res.json()
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      setMsgs(m => [...m, { role: 'assistant', content: d.reply || '(no response)', chatId: d.chatId, meta: d.meta }])
    } catch (e: any) { setMsgs(m => [...m, { role: 'assistant', content: '⚠ ' + (e?.message || String(e)) }]) }
    finally { setBusy(false) }
  }, [text, busy, msgs])

  const rate = async (i: number, rating: number, correction?: string) => {
    const m = msgs[i]; if (!m?.chatId) return
    await fetch('/api/garden/adam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rate: { chatId: m.chatId, rating, note: correction || null } }) }).catch(() => {})
    setMsgs(ms => ms.map((x, j) => j === i ? { ...x, meta: { ...(x.meta || {}), rated: rating } } : x))
    setNoteFor(null); setNote('')
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label={`Ask ${name}`}
          className="print:hidden fixed above-bar lg:bottom-5 right-4 z-40 w-14 h-14 lg:w-12 lg:h-12 rounded-full bg-emerald-700 text-white shadow-lg hover:bg-emerald-800 grid place-items-center transition-transform active:scale-95">
          <Hotel size={22} />
        </button>
      )}
      {open && (
        <div className="print:hidden fixed z-50 inset-0 sm:inset-auto sm:bottom-5 sm:right-4 sm:w-[400px] flex flex-col bg-white sm:border sm:border-line sm:rounded-2xl sm:shadow-2xl overflow-hidden pt-safe sm:pt-0" style={{ height: '100dvh', maxHeight: '100dvh' }}>
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-line bg-emerald-50/60 flex-shrink-0">
            <Hotel size={15} className="text-emerald-700" />
            <span className="text-sm font-semibold text-ink">{name}</span>
            <span className="text-[11px] text-muted hidden sm:inline">Garden Hotel · rooms · cleans · calls · numbers</span>
            <span className="flex-1" />
            <a href="/garden/adam" title="What he knows, his direction, his model" className="text-[11px] text-emerald-800 font-semibold hover:underline">his page</a>
            {msgs.length > 0 && <button onClick={() => setMsgs([])} title="Clear the conversation" className="text-muted hover:text-ink"><Trash2 size={14} /></button>}
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted hover:text-ink"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5">
            {msgs.length === 0 && (
              <div className="text-[12.5px] text-muted space-y-1">
                <p>Ask {name} about the hotel — who arrives today, which rooms are dirty, whether a guest was called, this month&apos;s occupancy.</p>
                <p>Tell him a rule (&ldquo;room 204 is the owner&apos;s, never sell it&rdquo;) and he remembers it. He knows nothing about the vacation rentals, on purpose.</p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={`max-w-[92%] rounded-2xl px-3 py-2 text-[13px] whitespace-pre-wrap ${m.role === 'user' ? 'bg-ink text-white' : 'bg-app text-ink'}`}>{m.content}</div>
                {m.role === 'assistant' && m.chatId ? (
                  <div className="flex items-center gap-1.5 mt-1 text-muted">
                    {m.meta?.tools?.length ? <span className="text-[10.5px]">{m.meta.tools.join(' · ')}</span> : null}
                    <span className="flex-1" />
                    <button onClick={() => rate(i, 1)} title="Good answer" className={m.meta?.rated === 1 ? 'text-emerald-700' : 'hover:text-ink'}><ThumbsUp size={13} /></button>
                    <button onClick={() => setNoteFor(noteFor === i ? null : i)} title="Wrong — teach him" className={m.meta?.rated === -1 ? 'text-rose-700' : 'hover:text-ink'}><ThumbsDown size={13} /></button>
                  </div>
                ) : null}
                {noteFor === i ? (
                  <div className="mt-1 flex gap-1.5">
                    <input value={note} onChange={e => setNote(e.target.value)} placeholder="What is actually true?" className={input} />
                    <button onClick={() => rate(i, -1, note)} className="rounded-xl bg-ink text-white px-3 text-[12px] font-semibold">Teach</button>
                  </div>
                ) : null}
              </div>
            ))}
            {busy && <div className="text-[12px] text-muted inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> {name} is looking…</div>}
            <div ref={endRef} />
          </div>
          <div className="border-t border-line p-2.5 flex items-end gap-2 flex-shrink-0 pb-safe">
            <textarea ref={boxRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1} placeholder={`Ask ${name}…`} className={`${input} resize-none max-h-28`} />
            <button onClick={send} disabled={busy || !text.trim()} aria-label="Send" className="w-10 h-10 rounded-xl bg-emerald-700 text-white grid place-items-center disabled:opacity-40"><Send size={16} /></button>
          </div>
        </div>
      )}
    </>
  )
}
