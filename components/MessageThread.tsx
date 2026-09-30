'use client'
// A guest conversation: full transcript (who sent each message), a reservation-details pop-up,
// Eve's draft when a watch wrote one, and — for people with edit on Messages — a reply box
// (2026-09-28 audit, D1). The reply goes out through Guesty on the thread's own channel; "Draft with
// Eve" fills the box, and nothing reaches the guest until a person presses Send.
import { useEffect, useRef, useState } from 'react'
import { plainText, isMachineName } from '@/lib/message-text'
import Link from 'next/link'
import { CalendarDays, X, ExternalLink, User, Phone, DollarSign, Home, BedDouble, Sparkles, Send, Loader2 } from 'lucide-react'

type Msg = { id: string; sender: string; sender_name?: string | null; body: string | null; sent_at: string | null; module?: string | null; is_automated?: boolean | null }
type Reservation = {
  id: string; guest_name?: string | null; guest_phone?: string | null; listing_name?: string | null
  check_in?: string | null; check_out?: string | null; nights?: number | null; status?: string | null
  money_total?: number | null; money_balance?: number | null; money_currency?: string | null; source?: string | null
} | null

const fmtDay = (s?: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }

export function MessageThread({ conversationId, channel, guest, unit, initialMessages, reservation, guestyUrl, canReply }: {
  conversationId: string; channel: string; guest: string; unit: string; initialMessages: Msg[]; reservation: Reservation; guestyUrl: string; canReply: boolean
}) {
  const [showRes, setShowRes] = useState(false)
  const [sent, setSent] = useState<Msg[]>([])
  const [replyOpen, setReplyOpen] = useState(false)
  const [hideAuto, setHideAuto] = useState(false)
  const messages = initialMessages.concat(sent)
  // Open at the newest message, like any inbox.
  const scroller = useRef<HTMLDivElement | null>(null)
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }, [messages.length])
  const counts = { guest: messages.filter(m => m.sender === 'guest').length, team: messages.filter(m => m.sender !== 'guest' && m.sender !== 'system' && !isAuto(m)).length, auto: messages.filter(m => m.sender !== 'guest' && m.sender !== 'system' && isAuto(m)).length }
  const stay = reservation && reservation.check_in ? `${fmtShort(reservation.check_in)} → ${fmtShort(reservation.check_out)}${reservation.nights != null ? ' · ' + reservation.nights + ' nights' : ''}` : ''

  return (
    /* The transcript only scrolls INSIDE its own box if the box has a height. A min-height alone
       let the card grow to the length of the conversation, so on a phone reading a long thread
       meant scrolling the whole page — and losing the header that tells you whose thread it is.
       Below sm the card is capped to what you can actually see (dvh, so Safari's URL bar is not
       counted as viewport) and the message list becomes the scroller. From sm up nothing is
       capped, so the desktop card is exactly as before. */
    <div className="bg-white rounded-2xl border border-line shadow-soft overflow-hidden flex flex-col max-h-[calc(100dvh-11rem)] sm:max-h-none" style={{ minHeight: '55vh' }}>
      {/* Thread header */}
      <div className="px-3 sm:px-5 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-ink truncate">{guest || 'Guest'}</span>
          {unit && <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Unit {unit}</span>}
          {channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{channel}</span>}
          {stay && <span className="text-[11px] text-ink/70" title={reservation?.status || ''}>{stay}{reservation?.status ? ' · ' + reservation.status : ''}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap gap-y-2">
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

      {/* WHO SAID WHAT (2026-09-30). A legend with the counts, and a switch to hide the templates. */}
      <div className="px-3 sm:px-5 py-1.5 border-b border-line bg-app/30 flex items-center gap-3 flex-wrap text-[11px]">
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-500" /> {guest.split(' ')[0] || 'Guest'} (guest) · {counts.guest}</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-brand-600" /> Our team · {counts.team}</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300" /> Automated (Guesty templates) · {counts.auto}</span>
        {counts.auto ? <label className="ml-auto inline-flex items-center gap-1 text-muted cursor-pointer"><input type="checkbox" checked={hideAuto} onChange={e => setHideAuto(e.target.checked)} /> hide automated</label> : null}
      </div>

      {/* Messages (read-only) */}
      <div ref={scroller} className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-3">
        {messages.length === 0 ? (
          <p className="text-center text-muted py-8 text-sm">No messages cached for this thread yet. Sync to pull the latest.</p>
        ) : messages.filter(m => !(hideAuto && m.sender !== 'guest' && m.sender !== 'system' && isAuto(m))).map((m, i, arr) => {
          const day = dayOf(m.sent_at)
          const newDay = day && day !== dayOf(arr[i - 1]?.sent_at)
          return (
            <div key={m.id}>
              {newDay ? <div className="flex items-center gap-2 my-2"><div className="flex-1 h-px bg-line" /><span className="text-[10.5px] font-semibold text-muted uppercase tracking-wider">{day}</span><div className="flex-1 h-px bg-line" /></div> : null}
              <Bubble m={m} guest={guest} />
            </div>
          )
        })}
      </div>

      {/* EVE'S DRAFT (2026-09-21). When the guest_unanswered_1h watch (or Eve in chat) drafted a
          reply for this thread, it sits here with Send / Discard. Send is the only way it reaches
          the guest, and the person who presses it is on the receipt. */}
      <EveDraftCard conversationId={conversationId} guest={guest} onSent={(body) => setSent(prev => prev.concat([{ id: 'eve-' + Date.now(), sender: 'host', sender_name: 'Eve (sent by you)', body, sent_at: new Date().toISOString() }]))} />

      {/* THE REPLY BOX (D1). The footer "Reply in Guesty" link it replaces pointed at the same place
          as the header's "Open in Guesty", which stays for anything the box cannot do. */}
      {canReply && !replyOpen ? (
        <div className="border-t border-line px-3 sm:px-5 py-2.5 bg-app/30 flex items-center gap-2">
          <button onClick={() => setReplyOpen(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 border border-brand-200 bg-white hover:bg-brand-50 px-2.5 py-1.5 rounded-lg"><Send size={13} /> Write a reply</button>
          <span className="text-[11px] text-muted">Sends through Guesty on the thread&apos;s own channel. Or answer in Guesty.</span>
        </div>
      ) : canReply ? (
        <ReplyBox conversationId={conversationId} guest={guest} channel={channel}
          onSent={(body, by) => setSent(prev => prev.concat([{ id: 'sent-' + Date.now(), sender: 'host', sender_name: by, body, sent_at: new Date().toISOString() }]))} />
      ) : (
        <div className="border-t border-line px-3 sm:px-5 py-2.5 bg-app/30 text-[12px] text-muted">View only — replying needs edit access on Messages.</div>
      )}

      {/* Reservation modal */}
      {showRes && reservation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowRes(false)}>
          <div className="bg-white rounded-2xl border border-line shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-line flex items-center justify-between">
              <h3 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><CalendarDays size={15} className="text-brand-600" /> Reservation</h3>
              <button onClick={() => setShowRes(false)} title="Close" className="text-muted hover:text-ink"><X size={16} /></button>
            </div>
            {/* Ten rows of detail plus a header and a footer is taller than a phone in landscape,
                and the card is centred in the overlay — without an inner scroller the top and
                bottom of it were simply unreachable. */}
            <div className="px-5 py-4 space-y-2.5 text-sm max-h-[60dvh] overflow-y-auto sm:max-h-none sm:overflow-y-visible">
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
              <Link href={`/reservations/${reservation.id}`} className="text-[12px] font-semibold text-brand-700 hover:underline">Open in Lighthouse</Link>
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

const ET = 'America/New_York'
const fmtShort = (s?: string | null) => { if (!s) return '?'; const d = new Date(String(s).slice(0, 10) + 'T12:00:00Z'); return isNaN(d.getTime()) ? '?' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }
function dayOf(s?: string | null): string {
  if (!s) return ''
  const d = new Date(s); if (isNaN(d.getTime())) return ''
  const k = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: ET })
  if (k(d) === k(new Date())) return 'Today'
  if (k(d) === k(new Date(Date.now() - 864e5))) return 'Yesterday'
  return d.toLocaleDateString('en-US', { timeZone: ET, weekday: 'long', month: 'short', day: 'numeric' })
}
const timeOf = (s?: string | null) => { if (!s) return ''; const d = new Date(s); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { timeZone: ET, hour: 'numeric', minute: '2-digit' }) }
function via(mod?: string | null): string {
  const m = String(mod || '').toLowerCase()
  if (!m) return ''
  if (/airbnb/.test(m)) return 'Airbnb'
  if (/booking/.test(m)) return 'Booking.com'
  if (/homeaway|vrbo/.test(m)) return 'Vrbo'
  if (m === 'sms') return 'SMS'
  if (m === 'email') return 'Email'
  if (m === 'whatsapp') return 'WhatsApp'
  if (m === 'note') return 'Internal note'
  return ''
}

/**
 * ONE MESSAGE, WITH WHO AND WHEN SPELLED OUT (2026-09-30). Guest on the left in grey-blue; our team
 * on the right in brand colour with the teammate's name; Guesty templates on the right, muted and
 * folded to a few lines, labelled Automated; notes and system lines centred. Every bubble says the
 * time and the channel it went through.
 */
const isAuto = (m: Msg) => m.is_automated === true || isMachineName(m.sender_name)

function Bubble({ m, guest }: { m: Msg; guest: string }) {
  const [open, setOpen] = useState(false)
  const g = m.sender === 'guest'
  if (m.sender === 'system') return <div className="text-center text-[11px] text-muted italic px-6">{m.sender_name && m.sender_name !== 'System' ? m.sender_name + ': ' : ''}{plainText(m.body)} · {timeOf(m.sent_at)}</div>
  const auto = !g && isAuto(m)
  const name = g ? (m.sender_name || guest || 'Guest') : auto ? 'Automated message' : (m.sender_name || 'Our team')
  const role = g ? 'Guest' : auto ? 'Guesty template' : 'Team'
  const ch = via(m.module)
  const text = plainText(m.body)
  const long = auto && text.length > 260
  const body = long && !open ? text.slice(0, 260).trimEnd() + '…' : text
  const box = g ? 'bg-sky-50 text-ink border border-sky-100' : auto ? 'bg-slate-50 text-ink/75 border border-dashed border-slate-300' : 'bg-brand-600 text-white'
  const meta = g ? 'text-sky-800/70' : auto ? 'text-slate-500' : 'text-white/75'
  return (
    <div className={`flex ${g ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${box}`}>
        <div className={`text-[11px] mb-0.5 flex items-center gap-1.5 flex-wrap ${meta}`}>
          <span className="font-bold">{name}</span>
          <span className="opacity-80">· {role}</span>
          {ch ? <span className="opacity-80">· via {ch}</span> : null}
          <span className="opacity-80">· {timeOf(m.sent_at)}</span>
        </div>
        <div className="whitespace-pre-wrap leading-relaxed break-words">{body}</div>
        {long ? <button onClick={() => setOpen(o => !o)} className={`mt-0.5 text-[11px] font-semibold ${meta} hover:underline`}>{open ? 'Show less' : 'Show all'}</button> : null}
      </div>
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

/** Guesty's module names, as a person says them. */
function moduleLabel(m: string): string {
  const s = String(m || '').toLowerCase()
  if (/airbnb/.test(s)) return 'Airbnb'
  if (/booking/.test(s)) return 'Booking.com'
  if (/homeaway|vrbo/.test(s)) return 'Vrbo'
  if (/expedia/.test(s)) return 'Expedia'
  if (s === 'sms') return 'SMS'
  if (s === 'whatsapp') return 'WhatsApp'
  return s || 'Guesty'
}

/**
 * THE REPLY BOX (2026-09-28 audit, D1). Type — or press Draft with Eve — then Send. It goes out
 * through Guesty on the thread's own channel (POST /api/messages/send → guest_reply_send), and the
 * receipt says which channel carried it; a message that went out by email instead of inside the
 * OTA thread is called out, not buried. Nothing is sent without a press of Send.
 */
function ReplyBox({ conversationId, guest, channel, onSent }: { conversationId: string; guest: string; channel: string; onSent: (body: string, by: string) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'' | 'send' | 'draft'>('')
  const [err, setErr] = useState('')
  const [receipt, setReceipt] = useState<{ label: string; warn: boolean; title: string } | null>(null)
  const who = guest || 'the guest'

  const draft = async () => {
    if (busy) return
    if (text.trim() && !confirm('Replace what you have typed with Eve’s draft?')) return
    setBusy('draft'); setErr(''); setReceipt(null)
    try {
      const r = await fetch('/api/messages/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId }) }).then(x => x.json())
      if (!r?.ok) setErr(r?.error || r?.message || 'Eve could not draft this.')
      else setText(String(r.draft || ''))
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy('') }
  }

  const send = async () => {
    const body = text.trim()
    if (busy || !body) return
    if (!confirm('Send this to ' + who + (channel ? ' on ' + channel : '') + ' now?')) return
    setBusy('send'); setErr(''); setReceipt(null)
    try {
      const res = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, body }) })
      const r = await res.json().catch(() => ({} as any))
      if (!res.ok || !r?.ok) { setErr(r?.error || r?.message || "Guesty didn't confirm — check the thread in Guesty before resending."); return }
      onSent(body, String(r.by || 'You'))
      setText('')
      const mod = String(r.module || '')
      const offThread = mod === 'email' && /airbnb|booking|vrbo|expedia/i.test(channel)
      const time = new Date(r.at || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      setReceipt({
        label: offThread ? `Sent by email, not inside the ${channel} thread · ${time} — check Guesty` : `Sent via ${moduleLabel(mod)} · ${time}`,
        warn: offThread,
        title: `Guesty module: ${mod || 'not reported'}${r.id ? ' · message ' + r.id : ''}`,
      })
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy('') }
  }

  return (
    <div className="border-t border-line px-3 sm:px-5 py-3 bg-app/30">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder={'Reply to ' + who + '…'} aria-label="Reply to the guest"
        className="w-full text-sm text-ink bg-white border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <button onClick={send} disabled={!!busy || !text.trim()} title={'Send this to ' + who + ' now, on the thread’s own channel'}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg disabled:opacity-50">
          {busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send
        </button>
        <button onClick={draft} disabled={!!busy} title="Eve reads the thread and writes a reply into the box — nothing is sent"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 bg-white border border-brand-200 hover:bg-brand-50 px-2.5 py-1.5 rounded-lg disabled:opacity-50">
          {busy === 'draft' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Draft with Eve
        </button>
        {receipt ? <span className={'text-[11.5px] ' + (receipt.warn ? 'font-semibold text-amber-700' : 'text-emerald-700')} title={receipt.title}>{receipt.label}</span> : null}
      </div>
      {err ? <div className="mt-1.5 text-[12px] text-rose-700">{err}</div> : null}
    </div>
  )
}

type EveDraft = { id: string; draft: string; why: string; by: string; createdAt: string }

function EveDraftCard({ conversationId, guest, onSent }: { conversationId: string; guest: string; onSent: (body: string) => void }) {
  const [draft, setDraft] = useState<EveDraft | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'' | 'send' | 'discard'>('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  useEffect(() => {
    let alive = true
    fetch('/api/eve/guest-drafts?conversation=' + encodeURIComponent(conversationId)).then(r => r.json()).then(r => {
      if (!alive) return
      const d = Array.isArray(r?.drafts) && r.drafts[0] ? r.drafts[0] as EveDraft : null
      setDraft(d); setText(d ? d.draft : '')
    }).catch(() => { /* no card */ })
    return () => { alive = false }
  }, [conversationId])
  if (!draft) return null
  const act = async (op: 'send' | 'discard') => {
    if (busy) return
    if (op === 'send' && !confirm('Send this to ' + (guest || 'the guest') + ' now?')) return
    setBusy(op); setErr('')
    try {
      const r = await fetch('/api/eve/guest-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id: draft.id, body: text }) }).then(x => x.json())
      if (!r?.ok) { setErr(r?.error || 'That did not work.'); return }
      if (op === 'send') { onSent(text); setDone('Sent to ' + (guest || 'the guest') + '.') } else setDone('Discarded.')
      setDraft(null)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy('') }
  }
  return (
    <div className="border-t border-line px-3 sm:px-5 py-3 bg-brand-50/40">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 mb-1.5"><Sparkles size={13} /> Eve's draft <span className="text-muted font-normal">· {draft.why}</span></div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} aria-label="Eve's draft reply"
        className="w-full text-sm text-ink bg-white border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <button onClick={() => act('send')} disabled={!!busy || !text.trim()} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg disabled:opacity-50">{busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send to guest</button>
        <button onClick={() => act('discard')} disabled={!!busy} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted bg-white border border-line hover:text-ink px-2.5 py-1.5 rounded-lg disabled:opacity-50"><X size={13} /> Discard</button>
        <span className="text-[11px] text-muted">Nothing reaches the guest until you press Send. You can edit it first.</span>
      </div>
      {err && <div className="mt-1.5 text-[12px] text-rose-700">{err}</div>}
      {done && <div className="mt-1.5 text-[12px] text-emerald-700">{done}</div>}
    </div>
  )
}
