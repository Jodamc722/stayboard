'use client'
// Read-only AUDIT view of a guest conversation: full transcript (who sent each message),
// a reservation-details pop-up, and a button to open + reply in Guesty's inbox.
// (In-app replying is intentionally off for now — this is a quality/audit surface.)
import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays, X, ExternalLink, User, Phone, DollarSign, Home, BedDouble, MessageSquare } from 'lucide-react'

type Msg = { id: string; sender: string; sender_name?: string | null; body: string | null; sent_at: string | null }
type Reservation = {
  id: string; guest_name?: string | null; guest_phone?: string | null; listing_name?: string | null
  check_in?: string | null; check_out?: string | null; nights?: number | null; status?: string | null
  money_total?: number | null; money_balance?: number | null; money_currency?: string | null; source?: string | null
} | null

const fmt = (s?: string | null) => { if (!s) return ''; const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const fmtDay = (s?: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }

export function MessageThread({ conversationId, channel, guest, unit, initialMessages, reservation, guestyUrl }: {
  conversationId: string; channel: string; guest: string; unit: string; initialMessages: Msg[]; reservation: Reservation; guestyUrl: string
}) {
  const [showRes, setShowRes] = useState(false)
  const messages = initialMessages

  return (
    <div className="bg-white rounded-2xl border border-line shadow-soft overflow-hidden flex flex-col" style={{ minHeight: '55vh' }}>
      {/* Thread header */}
      <div className="px-5 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-ink truncate">{guest || 'Guest'}</span>
          {unit && <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Unit {unit}</span>}
          {channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{channel}</span>}
        </div>
        <div className="flex items-center gap-2">
          {reservation && (
            <button onClick={() => setShowRes(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg">
              <CalendarDays size={13} /> Reservation details
            </button>
          )}
          <a href={guestyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg">
            <ExternalLink size={13} /> Open in Guesty
          </a>
        </div>
      </div>

      {/* Messages (read-only) */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-center text-muted py-8 text-sm">No messages cached for this thread yet. Sync to pull the latest.</p>
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
      </div>

      {/* Audit footer — reply happens in Guesty */}
      <div className="border-t border-line px-5 py-3 flex items-center justify-between gap-3 flex-wrap bg-app/30">
        <span className="text-[12px] text-muted inline-flex items-center gap-1.5"><MessageSquare size={13} /> Audit view — reply to the guest in Guesty.</span>
        <a href={guestyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 hover:underline">
          Reply in Guesty <ExternalLink size={12} />
        </a>
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
