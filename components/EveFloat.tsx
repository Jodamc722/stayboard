'use client'
// EVE AS A FLOATING COLLEAGUE, NOT A DESTINATION (Jon, 2026-08-19: "Eve does not need her own
// page — a floating icon"). The bubble sits bottom-right on every signed-in page; the panel opens
// over whatever you were doing, so asking her something never costs the page you were on. The
// conversation lives in sessionStorage, so navigating between tabs mid-thought keeps the thread.
// Managing what she BELIEVES moved to Settings → Users & admin → Eve (memory, voice, direction).
//
// 2026-08-21 — THE PHONE PASS (Jon: "eve should work for me"). Three things were in the way:
//
//   1. THERE WERE THREE EVES. This one (v2: memory, tool domains, thumbs, logging), BrainChat in
//      the root layout (v1, z-50 — so every "Ask Eve" tap in the app actually hit the OLD one and
//      this panel never opened), and BrainConsole embedded in the Command Center (v1 again, but the
//      only one that could listen and talk). Now there is one Eve, and the voice moved in here.
//   2. On a phone the bubble sat at bottom-5 — on top of the mobile bottom nav bar, over the home
//      indicator. It now clears both, and the panel is a real full-height sheet with a safe area.
//   3. Typing on a phone is the slowest way to ask a question while you are standing in a lobby.
//      Hold the mic, say it, let go. Turn the speaker on and she reads the answer back.
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Send, ThumbsUp, ThumbsDown, X, Eraser, Mic, Volume2, VolumeX, KeyRound } from 'lucide-react'

type Msg = { role: 'user' | 'assistant'; content: string; chatId?: string | null; meta?: any; rated?: number }

const STORE = 'eve-float-chat-v1'

// Phone-first: the first thing on the list is the thing you ask while standing at a door.
const SUGGEST = [
  { icon: true,  text: 'What is the door code for ' },
  { icon: false, text: 'What is going wrong today that I should know about?' },
  { icon: false, text: 'Which arrivals today need attention?' },
  { icon: false, text: 'What is our cost per clean this month vs last?' },
]
const input = 'w-full text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'

function loadStored(): Msg[] {
  try { const raw = sessionStorage.getItem(STORE); return raw ? JSON.parse(raw) : [] } catch { return [] }
}

/** Anything in the app can open Eve, optionally with a question already in her mouth. */
export function openEve(question?: string) {
  try { window.dispatchEvent(new CustomEvent('eve:open', { detail: { q: question || '' } })) } catch { /* SSR */ }
}

export function EveFloat() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [noteFor, setNoteFor] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [speak, setSpeak] = useState(false)
  const [listening, setListening] = useState(false)
  const [micOk, setMicOk] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const recRef = useRef<any>(null)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)

  useEffect(() => { setMsgs(loadStored()) }, [])
  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))) } catch { /* full */ } }, [msgs])
  useEffect(() => { if (open) { endRef.current?.scrollIntoView({ behavior: 'smooth' }); } }, [open, msgs, busy])

  // Speech recognition, where the browser has it (Safari on iOS and Chrome both do). Absent
  // elsewhere, so the mic button only renders once we know it exists rather than failing on tap.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    setMicOk(true)
    const r = new SR()
    r.lang = 'en-US'; r.continuous = false; r.interimResults = true
    r.onresult = (e: any) => {
      let said = ''
      for (let i = e.resultIndex; i < e.results.length; i++) said += e.results[i][0].transcript
      setText(said)
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    recRef.current = r
    return () => { try { r.abort() } catch { /* already stopped */ } }
  }, [])

  // A voice that does not sound like a 1998 satnav, where the device offers one.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const pick = () => {
      const voices = window.speechSynthesis.getVoices()
      if (!voices.length) return
      const pref = ['Samantha', 'Google UK English Female', 'Microsoft Aria', 'Victoria', 'Karen', 'Serena', 'Google US English']
      voiceRef.current = voices.find(x => pref.some(p => x.name.includes(p)))
        || voices.find(x => /^en/i.test(x.lang))
        || voices[0]
    }
    pick()
    window.speechSynthesis.onvoiceschanged = pick
  }, [])

  const say = useCallback((s: string) => {
    if (!speak || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.cancel()
      // Strip the markdown scaffolding — read the sentence, not the asterisks.
      const u = new SpeechSynthesisUtterance(String(s).replace(/[*_`#>]/g, '').slice(0, 900))
      if (voiceRef.current) u.voice = voiceRef.current
      u.rate = 1.02
      window.speechSynthesis.speak(u)
    } catch { /* speech is a nicety, never a failure */ }
  }, [speak])

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
      say(d.reply || '')
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: '⚠ ' + (e?.message || String(e)) }])
    } finally { setBusy(false) }
  }, [text, busy, msgs, say])

  // Opened from anywhere else in the app — the Command Center card, a row action, a deep link.
  useEffect(() => {
    const onOpen = (e: any) => {
      setOpen(true)
      const q = String(e?.detail?.q || '')
      if (q) setTimeout(() => { setText(q); boxRef.current?.focus() }, 60)
    }
    window.addEventListener('eve:open', onOpen as any)
    return () => window.removeEventListener('eve:open', onOpen as any)
  }, [])

  function toggleMic() {
    const r = recRef.current
    if (!r) return
    if (listening) { try { r.stop() } catch { /* noop */ } ; setListening(false); return }
    try { setText(''); r.start(); setListening(true) } catch { setListening(false) }
  }

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
      {/* The bubble. Always present, never in the way — and on a phone it clears the bottom nav
          bar AND the home indicator, which is where it used to sit. */}
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="Ask Eve"
          className="print:hidden fixed above-bar lg:bottom-5 right-4 z-40 w-14 h-14 lg:w-12 lg:h-12 rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700 grid place-items-center transition-transform active:scale-95">
          <Sparkles size={22} />
        </button>
      )}

      {open && (
        <div className="print:hidden fixed z-50 inset-0 sm:inset-auto sm:bottom-5 sm:right-4 sm:w-[400px] flex flex-col bg-white sm:border sm:border-line sm:rounded-2xl sm:shadow-2xl overflow-hidden pt-safe sm:pt-0"
          style={{ height: '100dvh', maxHeight: '100dvh' }}>
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-line bg-app/60 flex-shrink-0">
            <Sparkles size={15} className="text-brand-600" />
            <span className="text-sm font-semibold text-ink">Eve</span>
            <span className="text-[11px] text-muted hidden sm:inline">ops · money · quality · labor · guests</span>
            <div className="ml-auto flex items-center gap-0.5">
              <button onClick={() => { const n = !speak; setSpeak(n); if (!n && typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel() }}
                title={speak ? 'Stop reading answers aloud' : 'Read answers aloud'}
                className={`p-2 rounded-lg ${speak ? 'text-brand-600 bg-brand-50' : 'text-muted hover:text-ink'}`}>
                {speak ? <Volume2 size={15} /> : <VolumeX size={15} />}
              </button>
              {msgs.length > 0 && (
                <button onClick={() => setMsgs([])} title="Clear the conversation"
                  className="p-2 rounded-lg text-muted hover:text-ink"><Eraser size={15} /></button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Close"
                className="p-2 rounded-lg text-muted hover:text-ink"><X size={17} /></button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3">
            {!msgs.length && (
              <div className="text-center py-6">
                <Sparkles size={22} className="text-brand-500 mx-auto mb-2" />
                <p className="text-[13px] text-muted max-w-[280px] mx-auto">
                  Ask her something you would otherwise open four tabs to answer.
                </p>
                <div className="flex flex-col gap-1.5 mt-4">
                  {SUGGEST.map(s => (
                    <button key={s.text} onClick={() => { if (s.icon) { setText(s.text); boxRef.current?.focus() } else { send(s.text) } }}
                      className="flex items-center gap-2 text-left text-[12.5px] text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-xl px-3 py-2.5">
                      {s.icon && <KeyRound size={14} className="flex-shrink-0" />}
                      <span>{s.text}{s.icon ? '…' : ''}</span>
                    </button>
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
                      className={`p-1.5 rounded-lg ${m.rated === 1 ? 'text-brand-600 bg-brand-50' : 'text-muted hover:text-ink'}`}><ThumbsUp size={13} /></button>
                    <button onClick={() => setNoteFor(noteFor === i ? null : i)} title="Wrong — teach her"
                      className={`p-1.5 rounded-lg ${m.rated === -1 ? 'text-brand-600 bg-brand-50' : 'text-muted hover:text-ink'}`}><ThumbsDown size={13} /></button>
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

          <div className="border-t border-line p-2 pb-safe-keep flex items-end gap-1.5 flex-shrink-0 bg-white">
            {micOk && (
              <button onClick={toggleMic} aria-label={listening ? 'Stop listening' : 'Ask by voice'}
                className={`inline-flex items-center justify-center rounded-xl p-2.5 flex-shrink-0 ${listening ? 'bg-red-600 text-white animate-pulse' : 'bg-app border border-line text-muted hover:text-ink'}`}>
                <Mic size={17} />
              </button>
            )}
            <textarea ref={boxRef} value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1} placeholder={listening ? 'Listening…' : 'Ask Eve…'} className={`${input} resize-none max-h-28`} />
            <button onClick={() => send()} disabled={busy || !text.trim()} aria-label="Send"
              className="inline-flex items-center justify-center rounded-xl bg-brand-600 text-white p-2.5 flex-shrink-0 hover:bg-brand-700 disabled:opacity-50"><Send size={17} /></button>
          </div>
        </div>
      )}
    </>
  )
}
