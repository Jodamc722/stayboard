'use client'
// The phone thread for one guest number: texts, voicemails and calls in one timeline, a reservation
// pop-up, and an SMS composer that sends through Talkroute (needs edit on Messages and a texting
// plan on the number — Talkroute's own refusal is shown verbatim when it says no).
import { useState } from 'react'
import Link from 'next/link'
import { CalendarDays, X, User, Phone, DollarSign, Home, BedDouble, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing, Voicemail, Send, Loader2, MessageSquare, Play } from 'lucide-react'

type Ev =
  | { kind: 'sms'; id: string; at: string; direction: 'incoming' | 'outgoing'; body: string; by: string; conversationId: string; attachments: any[] }
  | { kind: 'voicemail'; id: string; at: string; duration: number; transcript: string; transcribing: boolean; audio: string; callerName: string }
  | { kind: 'call'; id: string; at: string; direction: 'inbound' | 'outbound'; result: string; duration: number; recording: string; matchKind: string; externalName: string }
type Reservation = {
  id: string; guest_name?: string | null; guest_phone?: string | null; listing_name?: string | null
  check_in?: string | null; check_out?: string | null; nights?: number | null; status?: string | null
  money_total?: number | null; money_balance?: number | null; money_currency?: string | null; source?: string | null
} | null

const fmt = (s?: string | null) => { if (!s) return ''; const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
const fmtDay = (s?: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }
const dur = (sec: number) => sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`
const MATCH: Record<string, string> = { welcome: 'Welcome call', post_checkout: 'Post-checkout call', stay: 'During the stay' }

export function PhoneThread({ number, display, guest, unit, events: initial, reservation, conversationId, fromNumber, connected }: {
  number: string; display: string; guest: string; unit: string; events: Ev[]; reservation: Reservation; conversationId: string; fromNumber: string; connected: boolean
}) {
  const [showRes, setShowRes] = useState(false)
  const [events, setEvents] = useState<Ev[]>(initial)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const canText = connected && (!!conversationId || !!fromNumber)

  async function send() {
    const body = text.trim(); if (!body || busy) return
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/talkroute/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(conversationId ? { conversationId, body } : { from: fromNumber, to: number, body }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Could not send.')
      setEvents(prev => prev.concat([{ kind: 'sms', id: String(j.id || Date.now()), at: j.at || new Date().toISOString(), direction: 'outgoing', body, by: j.by || 'you', conversationId: conversationId || '', attachments: [] }]))
      setText('')
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="bg-white rounded-2xl border border-line shadow-soft overflow-hidden flex flex-col max-h-[calc(100dvh-11rem)] sm:max-h-none" style={{ minHeight: '55vh' }}>
      <div className="px-3 sm:px-5 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-semibold text-ink truncate">{guest || display}</span>
          {unit && <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Unit {unit}</span>}
          <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">Phone · Talkroute</span>
          <a href={`tel:+${number}`} className="text-[12px] font-semibold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1"><PhoneCall size={12} /> {display}</a>
        </div>
        <div className="flex items-center gap-2 flex-wrap gap-y-2">
          {reservation && (
            <button onClick={() => setShowRes(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg"><CalendarDays size={13} /> Reservation details</button>
          )}
          {!reservation && <span className="text-[11px] text-muted">No booking matched to this number</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
        {events.length === 0 ? (
          <p className="text-center text-muted py-8 text-sm">Nothing from this number yet.</p>
        ) : events.map(e => {
          if (e.kind === 'call') {
            const answered = e.result === 'answered'
            const Icon = e.direction === 'outbound' ? PhoneOutgoing : answered ? PhoneIncoming : PhoneMissed
            const label = e.direction === 'outbound' ? (answered ? `Called the guest · answered · ${dur(e.duration)}` : `Called the guest · ${e.result === 'missed' ? 'no answer' : e.result || 'no answer'}`) : (answered ? `Guest called · answered · ${dur(e.duration)}` : 'Missed call from the guest')
            return (
              <div key={e.id} className="flex items-center justify-center gap-2 text-[11px] text-muted">
                <Icon size={12} className={answered ? 'text-emerald-600' : 'text-rose-500'} />
                <span>{label}{e.matchKind && MATCH[e.matchKind] ? ` · ${MATCH[e.matchKind]}` : ''} · {fmt(e.at)}</span>
                {e.recording && <a href={e.recording} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-brand-600 hover:underline"><Play size={10} /> recording</a>}
              </div>
            )
          }
          if (e.kind === 'voicemail') {
            return (
              <div key={e.id} className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                  <div className="text-[11px] font-semibold text-amber-800 flex items-center gap-1.5"><Voicemail size={12} /> Voicemail · {dur(e.duration)} · {fmt(e.at)}</div>
                  <div className="text-[13px] text-ink mt-1 whitespace-pre-wrap">{e.transcript || (e.transcribing ? <span className="italic text-muted">Transcribing…</span> : <span className="italic text-muted">No transcript</span>)}</div>
                  {e.audio && <a href={e.audio} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-brand-600 hover:underline mt-1"><Play size={10} /> Listen</a>}
                </div>
              </div>
            )
          }
          const mine = e.direction === 'outgoing'
          return (
            <div key={e.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${mine ? 'bg-brand-600 text-white rounded-br-md' : 'bg-app text-ink rounded-bl-md'}`}>
                <div className="text-[13px] whitespace-pre-wrap break-words">{e.body}</div>
                {e.attachments.length > 0 && <div className="mt-1 flex gap-1 flex-wrap">{e.attachments.map((a: any, i: number) => a?.link ? <a key={i} href={a.link} target="_blank" rel="noopener noreferrer" className={`text-[11px] underline ${mine ? 'text-white/90' : 'text-brand-600'}`}>attachment</a> : null)}</div>}
                <div className={`text-[10px] mt-1 ${mine ? 'text-white/70' : 'text-muted'}`}>{mine ? (e.by ? `${e.by.split('@')[0]} · ` : '') : ''}{fmt(e.at)} · SMS</div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="border-t border-line px-3 sm:px-5 py-3">
        {!connected ? (
          <p className="text-[12px] text-muted">Talkroute is not connected — an admin can paste the key on Users &amp; admin → Talkroute.</p>
        ) : !canText ? (
          <p className="text-[12px] text-muted">No Talkroute number has texted or called this guest yet, so there is nothing to reply from. Text them first from the Talkroute app and the thread will appear here.</p>
        ) : (
          <>
            <div className="flex gap-2 items-end">
              <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send() }} rows={2} placeholder={`Text ${guest || display}…`}
                className="flex-1 rounded-xl border border-line px-3 py-2 text-[13px] resize-none" />
              <button onClick={send} disabled={busy || !text.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 text-white px-3.5 py-2 text-[13px] font-semibold hover:bg-brand-700 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send</button>
            </div>
            <div className="text-[11px] text-muted mt-1 flex items-center gap-1"><MessageSquare size={11} /> Sends as an SMS from the Talkroute number{fromNumber ? ` ending ${fromNumber.slice(-4)}` : ''}. ⌘/Ctrl+Enter to send.</div>
            {err && <p className="text-[12px] text-rose-700 mt-1">{err}</p>}
          </>
        )}
      </div>

      {showRes && reservation && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-3" onClick={() => setShowRes(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white border border-line shadow-soft p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><span className="font-semibold text-ink">Reservation</span><button onClick={() => setShowRes(false)} className="text-muted hover:text-ink"><X size={16} /></button></div>
            <dl className="text-[13px] space-y-1.5">
              <Row Icon={User} k="Guest" v={reservation.guest_name || '—'} />
              <Row Icon={Phone} k="Phone" v={reservation.guest_phone || display} />
              <Row Icon={Home} k="Unit" v={reservation.listing_name || '—'} />
              <Row Icon={BedDouble} k="Stay" v={`${fmtDay(reservation.check_in)} → ${fmtDay(reservation.check_out)}${reservation.nights ? ` · ${reservation.nights} nights` : ''}`} />
              <Row Icon={DollarSign} k="Total" v={reservation.money_total != null ? `${reservation.money_currency || '$'} ${Number(reservation.money_total).toLocaleString()}` : '—'} />
            </dl>
            <div className="mt-3 flex gap-2">
              <Link href={`/reservations/${reservation.id}`} className="text-[12px] font-semibold text-brand-600 hover:underline">Open in Lighthouse</Link>
              <a href={`https://app.guesty.com/reservations/${reservation.id}/summary`} target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold text-muted hover:text-ink">Open in Guesty</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ Icon, k, v }: { Icon: any; k: string; v: string }) {
  return <div className="flex items-start gap-2"><Icon size={13} className="text-muted mt-0.5" /><dt className="text-muted w-14 shrink-0">{k}</dt><dd className="text-ink">{v}</dd></div>
}
