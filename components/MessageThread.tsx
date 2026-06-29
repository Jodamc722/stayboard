'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Send, Loader2, AlertTriangle, CalendarDays, X, ExternalLink, User, Phone, DollarSign, Home, BedDouble } from 'lucide-react'

type Msg = { id: string; sender: string; sender_name?: string | null; body: string | null; sent_at: string | null }
type Reservation = {
  id: string; guest_name?: string | null; guest_phone?: string | null; listing_name?: string | null
  check_in?: string | null; check_out?: string | null; nights?: number | null; status?: string | null
  money_total?: number | null; money_balance?: number | null; money_currency?: string | null; source?: string | null
} | null

const fmt = (s?: string | null) => { if (!s) return ''; const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const fmtDay = (s?: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }

export function MessageThread({ conversationId, channel, guest, unit, initialMessages, reservation }: {
  conversationId: string; channel: string; guest: string; unit: string; initialMessages: Msg[]; reservation: Reservation
}) {
  const router = useRouter()
  const [messages, setMessages] = useState<Msg[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showRes, setShowRes] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function send() {
    const b = text.trim()
    if (!b || sending) return
    setSending(true); setErr(null)
    // optimistic
    const optimistic: Msg = { id: `tmp-${Date.now()}`, sender: 'host', sender_name: 'You', body: b, sent_at: new Date().toISOString() }
    setMessages(m => [...m, optimistic]); setText('')
    try {
      const res = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, body: b }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) throw new Error(d.error || `HTTP ${res.status}`)
      router.refresh()
    } catch (e: any) {
      setErr(e?.message || String(e))
      setMessages(m => m.filter(x => x.id !== optimistic.id)); setText(b)
    } finally { setSending(false) }
  }

  return (
    <div className="bg-white rounded-2xl border border-line shadow-soft overflow-hidden flex flex-col" style={{ minHeight: '60vh' }}>
      {/* Thread header */}
      <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-ink truncate">{guest || 'Guest'}</span>
          {unit && <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Unit {unit}</span>}
          {channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{channel}</span>}
        </div>
        {reservation && (
          <button onClick={() => setShowRes(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg">
            <CalendarDays size={13} /> Reservation details
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-center text-muted py-8 text-sm">No messages in this thread yet.</p>
        ) : messages.map(m => {
          const guestMsg = m.sender === 'guest'
          const system = m.sender === 'system'
          if (system) return <div key={m.id} className="text-center text-[11px] text-muted italic">{m.body}</div>
          return (
            <div key={m.id} className={`flex ${guestMsg ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${guestMsg ? 'bg-app text-ink border border-line' : 'bg-brand-600 text-white'}`}>
                <div className={`text-[10px] mb-0.5 ${guestMsg ? 'text-muted' : 'text-white/70'}`}>{m.sender_name || (guestMsg ? guest : 'Team')}</div>
                <div className="whitespace-pre-wrap leading-relaxed">{m.body}</div>
                <div className={`text-[10px] mt-0.5 ${guestMsg ? 'text-muted' : 'text-white/70'}`}>{fmt(m.sent_at)}</div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-line p-3">
        {err && <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 flex items-center gap-2"><AlertTriangle size={13} /> {err}</div>}
        <div className="flex items-end gap-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }}
            placeholder={`Reply to ${guest || 'the guest'} on ${channel || 'their channel'}…  (⌘/Ctrl+Enter to send)`}
            className="flex-1 resize-y text-sm text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          <button onClick={send} disabled={sending || !text.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50 flex-shrink-0">
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        <p className="text-[10px] text-muted mt-1.5">Sends to the guest on {channel || 'their channel'} via Guesty. Replying quickly lifts your OTA ranking.</p>
      </div>

      {/* Reservation modal */}
      {showRes && reservation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowRes(false)}>
          <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-line flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><CalendarDays size={15} className="text-brand-600" /> Reservation</h3>
              <button onClick={() => setShowRes(false)} className="text-muted hover:text-ink"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-2.5 text-sm">
              <Row Icon={User} label="Guest" value={reservation.guest_name || guest} />
              {reservation.guest_phone && <Row Icon={Phone} label="Phone" value={reservation.guest_phone} link={`tel:${reservation.guest_phone}`} />}
              <Row Icon={Home} label="Unit" value={reservation.listing_name || (unit ? `Unit ${unit}` : '—')} />
              <Row Icon={CalendarDays} label="Check-in" value={fmtDay(reservation.check_in)} />
              <Row Icon={CalendarDays} label="Check-out" value={fmtDay(reservation.check_out)} />
              {reservation.nights != null && <Row Icon={BedDouble} label="Nights" value={`${reservation.nights}`} />}
              <Row Icon={DollarSign} label="Total" value={reservation.money_total != null ? `${reservation.money_currency || 'USD'} ${Number(reservation.money_total).toLocaleString()}` : '—'} />
              {reservation.money_balance != null && Number(reservation.money_balance) > 0.01 && <Row Icon={DollarSign} label="Balance due" value={`${reservation.money_currency || 'USD'} ${Number(reservation.money_balance).toLocaleString()}`} />}
              {reservation.status && <Row Icon={User} label="Status" value={reservation.status} />}
            </div>
            <div className="px-5 py-3 border-t border-line flex items-center justify-between gap-2">
              <Link href={`/reservations/${reservation.id}`} className="text-[12px] font-semibold text-brand-700 hover:underline">Open in StayBoard</Link>
              <a href={`https://app.guesty.com/reservations/${reservation.id}/summary`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg">
                <ExternalLink size={12} /> Open in Guesty
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ Icon, label, value, link }: { Icon: any; label: string; value: string; link?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted inline-flex items-center gap-1.5"><Icon size={13} /> {label}</span>
      {link ? <a href={link} className="font-medium text-brand-700 hover:underline text-right">{value}</a> : <span className="font-medium text-ink text-right">{value}</span>}
    </div>
  )
}
