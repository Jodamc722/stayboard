'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Send, Wand2, Mic, Volume2, VolumeX } from 'lucide-react'

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
  const [voiceOn, setVoiceOn] = useState(false)        // speak Eve's replies aloud
  const [listening, setListening] = useState(false)    // mic capturing
  const [speechOk, setSpeechOk] = useState(false)       // browser supports speech recognition
  const endRef = useRef<HTMLDivElement>(null)
  const recRef = useRef<any>(null)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  // Pick a pleasant, refined English voice for Eve (prefer a natural female voice).
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const pick = () => {
      const voices = window.speechSynthesis.getVoices()
      if (!voices.length) return
      const pref = ['Samantha', 'Google UK English Female', 'Microsoft Aria', 'Microsoft Jenny', 'Victoria', 'Karen', 'Serena', 'Google US English']
      let v = voices.find(x => pref.some(p => x.name.includes(p)))
      if (!v) v = voices.find(x => /female/i.test(x.name) && /en/i.test(x.lang))
      if (!v) v = voices.find(x => /^en/i.test(x.lang))
      voiceRef.current = v || voices[0]
    }
    pick()
    window.speechSynthesis.onvoiceschanged = pick
    // Set up speech recognition if supported
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (SR) setSpeechOk(true)
  }, [])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text.replace(/[*_#`>]/g, '').slice(0, 1200))
      if (voiceRef.current) u.voice = voiceRef.current
      u.rate = 1.0; u.pitch = 1.0
      window.speechSynthesis.speak(u)
    } catch { /* ignore */ }
  }, [])

  const send = useCallback(async (textArg?: string) => {
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
      const reply = d.reply || '(no response)'
      setMsgs(m => [...m, { role: 'assistant', content: reply }])
      if (voiceOn) speak(reply)
    } catch (e: any) {
      setMsgs(m => [...m, { role: 'assistant', content: `I hit a snag: ${e?.message || String(e)}` }])
    } finally {
      setBusy(false)
    }
  }, [input, busy, msgs, voiceOn, speak])

  // Mic: capture speech → text → auto-send.
  function toggleMic() {
    if (typeof window === 'undefined') return
    if (listening) { recRef.current?.stop(); return }
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false
    let finalText = ''
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += t
        else interim += t
      }
      setInput(finalText || interim)
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => {
      setListening(false)
      const t = finalText.trim()
      if (t) send(t)
    }
    recRef.current = rec
    setListening(true)
    rec.start()
  }

  function toggleVoice() {
    const nv = !voiceOn
    setVoiceOn(nv)
    if (!nv && typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  return (
    <div className="rounded-2xl border border-line bg-white shadow-soft overflow-hidden flex flex-col" style={{ minHeight: '460px' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-line flex items-center justify-between bg-gradient-to-r from-brand-50 to-white">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white shadow-sm"><Sparkles size={17} /></span>
          <div>
            <div className="font-bold text-ink text-[15px] tracking-tight leading-none">Eve</div>
            <div className="text-[11px] text-muted mt-0.5">Your hospitality intelligence</div>
          </div>
        </div>
        <button onClick={toggleVoice} title={voiceOn ? 'Voice replies on' : 'Voice replies off'}
          className={`inline-flex items-center gap-1.5 text-[12px] font-medium rounded-lg px-2.5 py-1.5 border transition-colors ${voiceOn ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-white text-muted border-line hover:text-ink'}`}>
          {voiceOn ? <Volume2 size={13} /> : <VolumeX size={13} />} {voiceOn ? 'Voice on' : 'Voice off'}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 max-h-[52vh]">
        {msgs.length === 0 ? (
          <div className="text-center py-6">
            <span className="inline-flex w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 items-center justify-center text-white shadow-soft"><Wand2 size={22} /></span>
            <h3 className="mt-4 text-lg font-bold text-ink tracking-tight">Hey Jon — I&apos;m Eve, your hospitality concierge.</h3>
            <p className="mt-1.5 text-sm text-muted max-w-md mx-auto">I see your reviews, messages, reservations and open work. Ask me anything — or tap the mic and just talk to me.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGEST.map((s, i) => (
                <button key={i} onClick={() => send(s)} className="text-[12px] font-medium px-3 py-1.5 rounded-full border border-line bg-white text-muted hover:text-brand-700 hover:border-brand-200 transition-colors">{s}</button>
              ))}
            </div>
          </div>
        ) : msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-app text-ink border border-line'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-app text-muted border border-line rounded-2xl px-3.5 py-2.5 text-sm inline-flex items-center gap-2"><Sparkles size={14} className="animate-pulse" /> Eve is thinking…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t border-line">
        {listening && <div className="text-[11px] text-brand-700 font-medium mb-1.5 inline-flex items-center gap-1.5 px-1"><span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" /> Listening… speak now</div>}
        <div className="flex items-center gap-2">
          {speechOk && (
            <button onClick={toggleMic} disabled={busy} title="Talk to Eve"
              className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center border transition-colors ${listening ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-white text-muted border-line hover:text-brand-700 hover:border-brand-200'} disabled:opacity-50`}>
              <Mic size={17} />
            </button>
          )}
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Ask Eve anything…"
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-line bg-white text-sm focus:outline-none focus:border-brand-500"
          />
          <button onClick={() => send()} disabled={busy || !input.trim()}
            className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand-600 text-white flex items-center justify-center hover:bg-brand-700 disabled:opacity-50">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
