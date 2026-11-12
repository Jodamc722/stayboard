'use client'
// A guest conversation: full transcript (who sent each message), a reservation-details pop-up,
// Eve's draft when a watch wrote one, and — for people with edit on Messages — a reply box
// (2026-09-28 audit, D1). The reply goes out through Guesty on the thread's own channel; "Draft with
// Eve" fills the box, and nothing reaches the guest until a person presses Send.
//
// INBOX AUDIT, 2026-11-09 — what changed for the person answering:
//   · the reply box is always there (it was behind a "Write a reply" tap) and keeps what you typed
//     if you look at another thread and come back;
//   · Send is one press — Ctrl/⌘+Enter from the keyboard — and asks again only when the text trips
//     a rail (lib/reply-guard: an access code, a promise of money back, taking the guest
//     off-platform, the wrong sign-off);
//   · a send that fails leaves the text in the box with the reason in red, and says whether nothing
//     went or whether it may have gone;
//   · saved replies, and translate both ways (read the guest in English; put the reply in theirs);
//   · the header says where the guest is in their stay and what we know about the door code;
//   · any guest message can become a task in one tap.
import { useStickToBottom } from '@/components/useStickToBottom'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { plainText, isMachineName } from '@/lib/message-text'
import Link from 'next/link'
import { CalendarDays, X, ExternalLink, User, Phone, DollarSign, Home, BedDouble, Sparkles, Send, Loader2, Languages, BookmarkPlus, ClipboardList, AlertTriangle, KeyRound, Undo2, Trash2, CheckCircle2, XCircle, Paperclip, FileText } from 'lucide-react'
import { checkReply, type ReplyWarning } from '@/lib/reply-guard'
import { etDay, stayPhase, type StayPhase } from '@/lib/inbox-queue'
import { fillSavedReply, type SavedReply } from '@/lib/saved-replies'
import { openAddTask } from '@/components/AddTaskSheet'

type Msg = { id: string; sender: string; sender_name?: string | null; body: string | null; sent_at: string | null; module?: string | null; is_automated?: boolean | null; attachments?: any[] | null }
type Reservation = {
  id: string; guest_name?: string | null; guest_phone?: string | null; listing_name?: string | null
  check_in?: string | null; check_out?: string | null; nights?: number | null; status?: string | null
  money_total?: number | null; money_balance?: number | null; money_currency?: string | null; source?: string | null
} | null

/** What we believe about the unit's door code — never the code (lib/message-thread DoorStatus). */
type Door = { verifiedAt: string | null; failedAt: string | null; fails: number; changedAt: string | null } | null

// A date-only value ("2026-11-12") is a calendar day, not midnight UTC: read at noon UTC and shown
// in UTC, or it prints as the day before for anyone west of Greenwich.
const fmtDay = (s?: string | null) => { if (!s) return '—'; const only = String(s).length === 10; const d = new Date(only ? s + 'T12:00:00Z' : s); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: only ? 'UTC' : 'America/New_York' }) }

const PHASE_UI: Record<StayPhase, { label: string; cls: string } | null> = {
  arriving: { label: 'Arriving today', cls: 'bg-amber-100 text-amber-800' },
  inhouse: { label: 'In-house', cls: 'bg-emerald-100 text-emerald-700' },
  departing: { label: 'Checking out today', cls: 'bg-amber-100 text-amber-800' },
  soon: { label: 'Arrives soon', cls: 'bg-sky-100 text-sky-700' },
  future: { label: 'Future stay', cls: 'bg-slate-100 text-slate-600' },
  inquiry: { label: 'Inquiry', cls: 'bg-slate-100 text-slate-600' },
  past: { label: 'Checked out', cls: 'bg-slate-100 text-slate-600' },
  canceled: { label: 'Cancelled', cls: 'bg-rose-100 text-rose-700' },
  none: null,
}
const shortDate = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }) }

/** Words that say a message is not in English — enough to offer Translate, not to decide anything. */
const FOREIGN = /[áéíóúñãõçêôâàèùïü¿¡]|\b(hola|gracias|buenos|buenas|por favor|necesito|tenemos|estamos|llegamos|llegada|salida|habitaci[oó]n|cu[aá]ndo|d[oó]nde|puede[ns]?|quiero|obrigad[oa]|ol[aá]|bom dia|boa (tarde|noite)|voc[eê]|chegada|bonjour|bonsoir|merci|nous|s['’]il vous|arriv[ée]e|danke|bitte|guten|grazie|buongiorno)\b/i
const looksForeign = (t: string) => FOREIGN.test(t)

export function MessageThread({ conversationId, channel, guest, unit, initialMessages, reservation, guestyUrl, canReply, signOff, door, listingId, listingName, onSent, fit }: {
  conversationId: string; channel: string; guest: string; unit: string; initialMessages: Msg[]; reservation: Reservation; guestyUrl: string; canReply: boolean
  /** The sign-off this home's replies carry when it has its own hosts (Boynton: "Vanessa & Taylor"). */
  signOff?: string | null
  door?: Door
  /** The Guesty listing — lets "Task" land on the right unit without a search. */
  listingId?: string | null
  listingName?: string | null
  /** A reply went out: the list beside the thread can drop it from Needs reply now. */
  onSent?: () => void
  /** A fixed height (CSS) — the inbox pane and the floater pass one so the messages scroll inside and open at the end. */
  fit?: string
}) {
  const [showRes, setShowRes] = useState(false)
  const [sent, setSent] = useState<Msg[]>([])
  const [hideAuto, setHideAuto] = useState(false)
  // LIVE (2026-10-06): the thread is re-read from Guesty while open, so a reply sent from here comes
  // back as the real post. The local copy steps aside once Guesty has it, rather than showing twice.
  const norm = (t: string | null | undefined) => plainText(t || '').replace(/\s+/g, ' ').trim()
  const pending = sent.filter(x => !initialMessages.some(m => m.sender !== 'guest' && norm(m.body) === norm(x.body)))
  const messages = initialMessages.concat(pending)
  // Open at the newest message, like any inbox.
  const scroller = useStickToBottom(messages.length + (hideAuto ? 0.5 : 0))
  const counts = { guest: messages.filter(m => m.sender === 'guest').length, team: messages.filter(m => m.sender !== 'guest' && m.sender !== 'system' && !isAuto(m)).length, auto: messages.filter(m => m.sender !== 'guest' && m.sender !== 'system' && isAuto(m)).length }
  const stay = reservation && reservation.check_in ? `${fmtShort(reservation.check_in)} → ${fmtShort(reservation.check_out)}${reservation.nights != null ? ' · ' + reservation.nights + ' nights' : ''}` : ''
  // WHERE THE GUEST IS IN THEIR STAY — the first thing to know before answering.
  const checkIn = reservation?.check_in ? String(reservation.check_in).slice(0, 10) : null
  const phase = reservation ? stayPhase({ checkIn, checkOut: reservation.check_out ? String(reservation.check_out).slice(0, 10) : null, status: reservation.status || null }, etDay(Date.now())) : 'none'
  const phaseUi = PHASE_UI[phase]
  // The guest's newest words: what "translate my reply" matches, and whether to offer it at all.
  const lastGuestText = useMemo(() => {
    for (let i = initialMessages.length - 1; i >= 0; i--) { const m = initialMessages[i]; if (m.sender === 'guest' && m.body) return plainText(m.body).slice(0, 600) }
    return ''
  }, [initialMessages])
  const taskFor = useCallback((text: string) => {
    openAddTask({
      listingId: listingId || undefined, unit: listingName || unit || undefined, reservationId: reservation?.id || undefined,
      desc: `Guest ${guest || ''} wrote${channel ? ' on ' + channel : ''}: “${text.replace(/\s+/g, ' ').trim().slice(0, 500)}”`,
    })
  }, [listingId, listingName, unit, reservation?.id, guest, channel])
  const pushSent = useCallback((id: string, body: string, by: string) => {
    setSent(prev => prev.concat([{ id: id + Date.now(), sender: 'host', sender_name: by, body, sent_at: new Date().toISOString() }]))
    if (onSent) onSent()
  }, [onSent])

  return (
    /* The transcript only scrolls INSIDE its own box if the box has a height. A min-height alone
       let the card grow to the length of the conversation, so on a phone reading a long thread
       meant scrolling the whole page — and losing the header that tells you whose thread it is.
       Below sm the card is capped to what you can actually see (dvh, so Safari's URL bar is not
       counted as viewport) and the message list becomes the scroller. From sm up nothing is
       capped, so the desktop card is exactly as before. */
    <div className={'bg-white rounded-2xl border border-line shadow-soft overflow-hidden flex flex-col ' + (fit ? '' : 'max-h-[calc(100dvh-11rem)] sm:max-h-none')} style={fit ? { height: fit, minHeight: 360 } : { minHeight: '55vh' }}>
      {/* Thread header */}
      <div className="px-3 sm:px-5 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-x-2 gap-y-1 min-w-0 flex-wrap">
          <span className="font-semibold text-ink truncate" title={/[?\uFFFD]/.test(guest) ? 'The booking channel sent this name with a letter missing — nothing was lost on our side.' : undefined}>{guest || 'Guest'}</span>
          {unit && <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">Unit {unit}</span>}
          {channel && <span className="text-[10px] uppercase tracking-wide text-muted bg-app px-1.5 py-0.5 rounded">{channel}</span>}
          {phaseUi && <span suppressHydrationWarning className={'text-[10.5px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ' + phaseUi.cls}>{phaseUi.label}</span>}
          {stay && <span className="text-[11px] text-ink/70" title={reservation?.status || ''}>{stay}{reservation?.status ? ' · ' + reservation.status : ''}</span>}
          {door && <DoorChip door={door} />}
        </div>
        <div className="flex items-center gap-2 flex-wrap gap-y-2">
          {reservation && (
            <button onClick={() => setShowRes(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 border border-brand-200 bg-brand-50 hover:bg-brand-100 min-h-[36px] px-2.5 py-1.5 rounded-lg">
              <CalendarDays size={13} /> Reservation details
            </button>
          )}
          <a href={guestyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white bg-brand-600 hover:bg-brand-700 min-h-[36px] px-2.5 py-1.5 rounded-lg">
            <ExternalLink size={13} /> Open in Guesty
          </a>
        </div>
      </div>

      {/* INQUIRIES AND BOOKING REQUESTS (2026-11-12): pre-approve, accept or decline without leaving the thread. */}
      {reservation && canReply && /^(inquiry|reserved)$/i.test(String(reservation.status || '')) ? (
        <BookingAnswer reservationId={reservation.id} status={String(reservation.status)} source={String(reservation.source || channel || '')} guest={guest} stay={stay} />
      ) : null}

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
              <Bubble m={m} guest={guest} conversationId={conversationId} onTask={m.sender === 'guest' ? taskFor : undefined} />
            </div>
          )
        })}
      </div>

      {/* EVE'S DRAFT (2026-09-21). When the guest_unanswered_1h watch (or Eve in chat) drafted a
          reply for this thread, it sits here with Send / Discard. Send is the only way it reaches
          the guest, and the person who presses it is on the receipt. */}
      <EveDraftCard conversationId={conversationId} guest={guest} guard={{ channel, checkIn, signOff: signOff || null }} onSent={(body) => pushSent('eve-', body, 'Eve (sent by you)')} />

      {/* THE REPLY BOX (D1). The footer "Reply in Guesty" link it replaces pointed at the same place
          as the header's "Open in Guesty", which stays for anything the box cannot do. */}
      {canReply ? (
        <ReplyBox conversationId={conversationId} guest={guest} channel={channel} checkIn={checkIn} signOff={signOff || null} lastGuestText={lastGuestText}
          onSent={(body, by) => pushSent('sent-', body, by)} />
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
 *
 * Memoised (2026-11-09): a long thread is hundreds of these, and typing in the reply box or a live
 * re-read that changed nothing used to redraw every one.
 */
const isAuto = (m: Msg) => m.is_automated === true || isMachineName(m.sender_name)

/** Read a fetch answer as JSON whatever came back — a gateway's HTML error page must not read as "Unexpected token <". */
async function readJson(res: Response): Promise<any> {
  try { return await res.json() } catch { return { ok: false, error: res.status >= 500 ? `The server did not answer properly (${res.status}).` : `Unexpected answer (${res.status}).` } }
}

const Bubble = memo(function Bubble({ m, guest, conversationId, onTask }: { m: Msg; guest: string; conversationId: string; onTask?: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  // RAW (Jon, 2026-10-06: "more real raw data"): the post exactly as Guesty returned it, on demand.
  const [raw, setRaw] = useState<any>(null)
  const [rawOpen, setRawOpen] = useState(false)
  // TRANSLATE (2026-11-09): the guest's words in English, under the original, on request.
  const [tr, setTr] = useState<{ text: string; language: string } | null>(null)
  const [trBusy, setTrBusy] = useState(false)
  const [trErr, setTrErr] = useState('')
  const showRaw = async () => {
    if (rawOpen) { setRawOpen(false); return }
    setRawOpen(true)
    if (raw) return
    try { const r = await fetch('/api/messages/raw?id=' + encodeURIComponent(m.id), { cache: 'no-store' }); const j = await readJson(r); setRaw(j.ok ? j.message : { error: j.error || 'not found' }) }
    catch (e: any) { setRaw({ error: String(e?.message || e) }) }
  }
  const local = /^(sent|eve)-/.test(m.id)
  const exact = m.sent_at ? new Date(m.sent_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' ET' : ''
  const g = m.sender === 'guest'
  if (m.sender === 'system') return <div className="text-center text-[11px] text-muted italic px-6">{m.sender_name && m.sender_name !== 'System' ? m.sender_name + ': ' : ''}{plainText(m.body)} · {timeOf(m.sent_at)}</div>
  const auto = !g && isAuto(m)
  const name = g ? (guest || m.sender_name || 'Guest') : auto ? 'Automated message' : (m.sender_name || 'Our team')
  const role = g ? 'Guest' : auto ? 'Guesty template' : 'Team'
  const ch = via(m.module)
  const text = plainText(m.body)
  const long = auto && text.length > 260
  const body = long && !open ? text.slice(0, 260).trimEnd() + '…' : text
  const box = g ? 'bg-sky-50 text-ink border border-sky-100' : auto ? 'bg-slate-50 text-ink/75 border border-dashed border-slate-300' : 'bg-brand-600 text-white'
  const meta = g ? 'text-sky-800/70' : auto ? 'text-slate-500' : 'text-white/75'
  const translate = async () => {
    if (trBusy) return
    if (tr) { setTr(null); return }
    setTrBusy(true); setTrErr('')
    try {
      const res = await fetch('/api/messages/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      const j = await readJson(res)
      if (!res.ok || !j?.ok) setTrErr(j?.error || 'Could not translate.')
      else setTr({ text: String(j.text || ''), language: String(j.language || 'English') })
    } catch { setTrErr('Could not reach Lighthouse to translate.') } finally { setTrBusy(false) }
  }
  return (
    <div className={`flex ${g ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${box}`}>
        <div className={`text-[11px] mb-0.5 flex items-center gap-1.5 flex-wrap ${meta}`}>
          <span className="font-bold">{name}</span>
          <span className="opacity-80">· {role}</span>
          {ch ? <span className="opacity-80">· via {ch}</span> : null}
          <span className="opacity-80" title={exact}>· {timeOf(m.sent_at)}</span>
          {local ? <span className="opacity-80" title="Sent from Lighthouse; replaced by Guesty's own copy on the next live read">· sent — waiting for Guesty&apos;s copy</span>
            : <button onClick={showRaw} className="opacity-60 hover:opacity-100 font-mono" title="Show this post exactly as Guesty returned it">{rawOpen ? 'hide raw' : 'raw'}</button>}
        </div>
        {body ? <div className="whitespace-pre-wrap leading-relaxed break-words">{body}</div> : null}
        <Attachments list={m.attachments} conversationId={conversationId} light={!g && !auto} />
        {long ? <button onClick={() => setOpen(o => !o)} className={`mt-0.5 text-[11px] font-semibold ${meta} hover:underline`}>{open ? 'Show less' : 'Show all'}</button> : null}
        {tr ? <div className="mt-1.5 pt-1.5 border-t border-sky-200 whitespace-pre-wrap leading-relaxed break-words text-ink/90"><span className="block text-[10.5px] font-bold uppercase tracking-wider text-sky-800/70">In {tr.language}</span>{tr.text}</div> : null}
        {trErr ? <div className="mt-1 text-[11.5px] text-rose-700">{trErr}</div> : null}
        {g && !local && text ? (
          <div className="mt-1 -mb-0.5 flex items-center gap-1 flex-wrap">
            {(looksForeign(text) || tr) && (
              <button onClick={translate} disabled={trBusy} className="inline-flex items-center gap-1 min-h-[28px] px-1.5 rounded-md text-[11px] font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50" title="Show this message in English — nothing is sent">
                {trBusy ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />} {tr ? 'Hide translation' : 'Translate'}
              </button>
            )}
            {onTask && (
              <button onClick={() => onTask(text)} className="inline-flex items-center gap-1 min-h-[28px] px-1.5 rounded-md text-[11px] font-semibold text-sky-800 hover:bg-sky-100" title="Start a field task for this unit with the guest's words in it — you choose the type and who before it is created">
                <ClipboardList size={11} /> Task
              </button>
            )}
          </div>
        ) : null}
        {rawOpen ? (
          <pre className="mt-1.5 max-h-72 overflow-auto rounded-lg bg-slate-900 text-slate-100 text-[10.5px] leading-snug p-2 whitespace-pre-wrap break-all">{raw ? JSON.stringify(raw, null, 2) : 'Loading…'}</pre>
        ) : null}
      </div>
    </div>
  )
})

/**
 * ANSWER AN INQUIRY OR A BOOKING REQUEST (lib/guesty-requests). Reads the booking's live status first — our copy can
 * be minutes old — and offers only what Guesty will take: pre-approve an Airbnb inquiry, accept or decline a request.
 * Every answer asks once more in the bar itself (they reach the guest and cannot be taken back). A special offer or a
 * Vrbo quote has no API, so those are a labelled link to the booking in Guesty.
 */
function BookingAnswer({ reservationId, status, source, guest, stay }: { reservationId: string; status: string; source: string; guest: string; stay: string }) {
  const [live, setLive] = useState<{ status: string; source: string; can: { preapprove: boolean; approve: boolean; decline: boolean }; inGuesty: string[]; reasons: { key: string; label: string }[] } | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [ask, setAsk] = useState<'' | 'preapprove' | 'approve' | 'decline'>('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')
  const [err, setErr] = useState('')
  const first = (guest || 'the guest').split(' ')[0]
  useEffect(() => {
    let off = false
    fetch('/api/messages/booking?reservationId=' + encodeURIComponent(reservationId), { cache: 'no-store' }).then(readJson)
      .then(j => { if (off) return; if (j?.ok) setLive(j); else setLoadErr(j?.error || 'Could not read the booking from Guesty.') })
      .catch(() => { if (!off) setLoadErr('Could not reach Lighthouse.') })
    return () => { off = true }
  }, [reservationId])
  const go = async () => {
    if (!ask || busy) return
    if (ask === 'decline' && /airbnb/i.test(live?.source || source) && !reason) { setErr('Pick a reason — Airbnb needs one to decline.'); return }
    setBusy(true); setErr('')
    try {
      const j = await readJson(await fetch('/api/messages/booking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId, action: ask, reason, message: msg }) }))
      if (!j?.ok) setErr(j?.error || 'Guesty did not take it.')
      else { setDone((ask === 'preapprove' ? 'Pre-approval sent' : ask === 'approve' ? 'Request accepted' : 'Request declined') + ' — Guesty now shows “' + (j.status || '…') + '”. The channel can take a minute to catch up.'); setAsk('') }
    } catch { setErr('Could not reach Lighthouse — nothing was sent.') } finally { setBusy(false) }
  }
  const inquiry = /^inquiry$/i.test(live?.status || status)
  const guestyLink = 'https://app.guesty.com/reservations/' + reservationId + '/summary'
  const B = 'inline-flex items-center gap-1.5 min-h-[32px] text-[12px] font-semibold px-2.5 rounded-lg disabled:opacity-50'
  return (
    <div className="px-3 sm:px-5 py-2 border-b border-amber-200 bg-amber-50/70 text-[12px]">
      <div className="flex items-center gap-2 flex-wrap">
        <b className="text-amber-900">{inquiry ? 'Inquiry' : 'Booking request'} — waiting on us</b>
        {stay ? <span className="text-amber-900/70">{stay}</span> : null}
        {!live && !loadErr ? <span className="text-muted inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> checking Guesty…</span> : null}
        {loadErr ? <span className="text-rose-700">{loadErr}</span> : null}
        {live && !done ? <span className="ml-auto flex items-center gap-1.5 flex-wrap">
          {live.can.preapprove ? <button onClick={() => { setAsk('preapprove'); setErr('') }} className={B + ' bg-emerald-600 text-white hover:bg-emerald-700'} title={'Lets ' + first + ' book these dates instantly at the listed price'}><CheckCircle2 size={13} /> Pre-approve</button> : null}
          {live.can.approve ? <button onClick={() => { setAsk('approve'); setErr('') }} className={B + ' bg-emerald-600 text-white hover:bg-emerald-700'} title={'Confirms ' + first + '’s booking'}><CheckCircle2 size={13} /> Accept</button> : null}
          {live.can.decline ? <button onClick={() => { setAsk('decline'); setErr('') }} className={B + ' border border-rose-200 bg-white text-rose-700 hover:bg-rose-50'} title="Turn the request down, with a reason"><XCircle size={13} /> Decline…</button> : null}
          {live.inGuesty.map(x => <a key={x} href={guestyLink} target="_blank" rel="noopener noreferrer" className={B + ' border border-line bg-white text-ink hover:bg-app'} title={x + ' has no API — this opens the booking in Guesty'}><ExternalLink size={12} /> {x} in Guesty</a>)}
          {!live.can.preapprove && !live.can.approve && !live.can.decline && !live.inGuesty.length ? <span className="text-muted">Guesty shows “{live.status}” — nothing to answer here.</span> : null}
        </span> : null}
      </div>
      {ask ? (
        <div className="mt-2 rounded-lg border border-amber-200 bg-white p-2.5">
          <p className="text-ink">{ask === 'preapprove' ? <>Pre-approve <b>{first}</b>? They can then book {stay || 'these dates'} instantly at the listed price.</> : ask === 'approve' ? <>Accept <b>{first}</b>’s request for {stay || 'these dates'}? The booking is confirmed on the channel.</> : <>Decline <b>{first}</b>’s request. They are told on the channel.</>}</p>
          {ask === 'decline' && live ? (<>
            <div className="mt-2 flex flex-wrap gap-1">{live.reasons.map(r => <button key={r.key} onClick={() => setReason(r.key)} className={'min-h-[30px] px-2 rounded-md border text-[11.5px] font-semibold ' + (reason === r.key ? 'bg-rose-600 text-white border-rose-600' : 'bg-white border-line text-ink hover:bg-app')}>{r.label}</button>)}</div>
            <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={2} placeholder={'A short note to ' + first + ' (optional) — e.g. “Thank you for asking — those dates don’t work for this home, but we would love to host you another time.”'} className="mt-2 w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
          </>) : null}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={go} disabled={busy} className={B + ' ' + (ask === 'decline' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700') + ' text-white'}>{busy ? <Loader2 size={12} className="animate-spin" /> : null}{ask === 'preapprove' ? 'Yes, pre-approve' : ask === 'approve' ? 'Yes, accept' : 'Decline request'}</button>
            <button onClick={() => { setAsk(''); setErr('') }} disabled={busy} className={B + ' text-muted hover:text-ink'}>Cancel</button>
          </div>
        </div>
      ) : null}
      {err ? <p className="mt-1.5 text-rose-700">{err}</p> : null}
      {done ? <p className="mt-1.5 text-emerald-800 inline-flex items-center gap-1"><CheckCircle2 size={12} /> {done}</p> : null}
    </div>
  )
}

/**
 * THE PHOTOS AND FILES ON A MESSAGE (2026-11-12). Guesty keeps them private; each tile goes through
 * /api/messages/attachment, which mints a short-lived link per view. Images show as thumbnails that open full
 * size; anything else is a labelled file chip.
 */
type Att = { key: string; name: string; image: boolean }
function readAttachments(list: any[] | null | undefined): Att[] {
  if (!Array.isArray(list)) return []
  const out: Att[] = []
  for (const a of list) {
    const key = typeof a === 'string' ? a : String(a?.attachmentURL || a?.attachmentUrl || a?.url || a?.key || a?.path || '')
    if (!key) continue
    const file = String((typeof a === 'object' && (a?.name || a?.fileName || a?.filename)) || key.split('?')[0].split('/').pop() || 'file')
    const type = String((typeof a === 'object' && (a?.contentType || a?.mimeType || a?.type)) || '')
    out.push({ key, name: decodeURIComponent(file).slice(0, 80), image: /^image\//i.test(type) || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file) })
  }
  return out
}
function Attachments({ list, conversationId, light }: { list?: any[] | null; conversationId: string; light: boolean }) {
  const atts = readAttachments(list)
  if (!atts.length) return null
  const href = (a: Att) => '/api/messages/attachment?c=' + encodeURIComponent(conversationId) + '&k=' + encodeURIComponent(a.key)
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {atts.map(a => a.image ? (
        <a key={a.key} href={href(a)} target="_blank" rel="noopener noreferrer" title={'Open ' + a.name + ' full size'} className="block rounded-lg overflow-hidden border border-black/10 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={href(a)} alt={a.name} loading="lazy" className="block h-32 w-auto max-w-[220px] object-cover" />
        </a>
      ) : (
        <a key={a.key} href={href(a)} target="_blank" rel="noopener noreferrer" title={'Open ' + a.name}
          className={'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-semibold ' + (light ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white border border-line text-ink hover:bg-app')}>
          {/\.pdf$/i.test(a.name) ? <FileText size={12} /> : <Paperclip size={12} />} {a.name}
        </a>
      ))}
    </div>
  )
}

/** What we know about the unit's door code — verified, failing, or never checked. Never the code. */
function DoorChip({ door }: { door: NonNullable<Door> }) {
  const v = door.verifiedAt ? Date.parse(door.verifiedAt) : NaN
  const f = door.failedAt ? Date.parse(door.failedAt) : NaN
  const failing = Number.isFinite(f) && (!Number.isFinite(v) || f > v)
  const label = failing ? 'Door code reported failing' : Number.isFinite(v) ? 'Door code verified ' + shortDate(door.verifiedAt) : 'Door code not verified'
  const title = [
    failing ? `Reported not working ${shortDate(door.failedAt)}${door.fails > 1 ? ' (' + door.fails + ' reports)' : ''} and not confirmed since` : '',
    door.changedAt ? 'Code last changed ' + shortDate(door.changedAt) : '',
    'The code itself is never shown here or sent from the reply box.',
  ].filter(Boolean).join(' · ')
  return (
    <span title={title} className={'inline-flex items-center gap-1 text-[10.5px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap ' + (failing ? 'bg-rose-100 text-rose-700' : Number.isFinite(v) ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
      <KeyRound size={10} /> {label}
    </span>
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

/** The rails a reply tripped, as a list a person reads before Send. */
function Warnings({ list }: { list: ReplyWarning[] }) {
  if (!list.length) return null
  return (
    <ul className="mt-2 space-y-1">
      {list.map(w => (
        <li key={w.key} className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-900">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
          <span><b>{w.label}.</b> {w.why}</span>
        </li>
      ))}
    </ul>
  )
}
const confirmWarnings = (list: ReplyWarning[], who: string) => !list.length || confirm('Before this goes to ' + who + ':\n\n' + list.map(w => '• ' + w.label + ' — ' + w.why).join('\n\n') + '\n\nSend it anyway?')

const BTN = 'inline-flex items-center justify-center gap-1.5 min-h-[36px] text-[12px] font-semibold px-3 rounded-lg disabled:opacity-50'
const draftKey = (id: string) => 'lh:inbox:draft:' + id

/**
 * THE REPLY BOX (2026-09-28 audit, D1; reworked 2026-11-09). Type, pick a saved reply, or press
 * Draft with Eve — then Send (or Ctrl/⌘+Enter). It goes out through Guesty on the thread's own
 * channel (POST /api/messages/send → guest_reply_send), and the receipt says which channel carried
 * it; a message that went out by email instead of inside the OTA thread is called out, not buried.
 * Nothing is sent without a person's Send. A send that does not go through leaves the text here.
 */
function ReplyBox({ conversationId, guest, channel, checkIn, signOff, lastGuestText, onSent }: {
  conversationId: string; guest: string; channel: string; checkIn: string | null; signOff: string | null; lastGuestText: string; onSent: (body: string, by: string) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'' | 'send' | 'draft' | 'translate'>('')
  const [err, setErr] = useState<{ msg: string; kind: 'not_sent' | 'maybe_sent' | 'other' } | null>(null)
  const [receipt, setReceipt] = useState<{ label: string; warn: boolean; title: string } | null>(null)
  // The English the translation was made from — kept so it can be put back, and so the rails read it too.
  const [english, setEnglish] = useState<{ text: string; language: string } | null>(null)
  const [saved, setSaved] = useState<SavedReply[] | null>(null)
  const [savedOpen, setSavedOpen] = useState(false)
  const [note, setNote] = useState('')
  const who = guest || 'the guest'
  const box = useRef<HTMLTextAreaElement | null>(null)
  // ONE PRESS, ONE MESSAGE. `busy` is state, and two presses in the same instant (a double click, a
  // held Ctrl+Enter) both read it as free; this is set and read at once, so the second press stops here.
  const sending = useRef(false)

  // WHAT YOU TYPED SURVIVES A LOOK AT ANOTHER THREAD. Kept per conversation for this browser tab
  // only (sessionStorage) and cleared the moment it is sent. Read after mount, so the server's HTML
  // and the first client render agree.
  useEffect(() => { try { const v = sessionStorage.getItem(draftKey(conversationId)); if (v) setText(v) } catch { /* private mode */ } }, [conversationId])
  const change = (v: string) => {
    setText(v)
    try { if (v.trim()) sessionStorage.setItem(draftKey(conversationId), v); else sessionStorage.removeItem(draftKey(conversationId)) } catch { /* private mode */ }
  }

  const today = etDay(Date.now())
  const warnings = useMemo(() => {
    const ctx = { channel, checkIn, today, signOff }
    const list = checkReply(text, ctx)
    // A translated reply is checked in its English too — the rails read English.
    if (english) for (const w of checkReply(english.text, { ...ctx, signOff: null })) if (!list.some(x => x.key === w.key)) list.push(w)
    return list
  }, [text, english, channel, checkIn, today, signOff])

  const draft = async () => {
    if (busy) return
    if (text.trim() && !confirm('Replace what you have typed with Eve’s draft?')) return
    setBusy('draft'); setErr(null); setReceipt(null); setNote('')
    try {
      const res = await fetch('/api/messages/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId }) })
      const r = await readJson(res)
      if (!r?.ok) setErr({ msg: r?.error || r?.message || 'Eve could not draft this.', kind: 'other' })
      else { change(String(r.draft || '')); setEnglish(null); setNote('Eve’s draft — read it before you send.'); box.current?.focus() }
    } catch { setErr({ msg: 'Could not reach Lighthouse for a draft. Check your connection and try again.', kind: 'other' }) } finally { setBusy('') }
  }

  const toGuestLanguage = async () => {
    const body = text.trim()
    if (busy || !body || !lastGuestText) return
    setBusy('translate'); setErr(null); setNote('')
    try {
      const res = await fetch('/api/messages/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: body, like: lastGuestText }) })
      const r = await readJson(res)
      if (!res.ok || !r?.ok) setErr({ msg: r?.error || 'Could not translate.', kind: 'other' })
      else if (/^english$/i.test(String(r.language || ''))) setNote('The guest wrote in English — nothing to translate.')
      else { setEnglish({ text: body, language: String(r.language || 'the guest’s language') }); change(String(r.text || body)) }
    } catch { setErr({ msg: 'Could not reach Lighthouse to translate.', kind: 'other' }) } finally { setBusy('') }
  }

  const send = async () => {
    const body = text.trim()
    if (busy || sending.current || !body) return
    // One press sends. It asks again only when the text trips a rail.
    if (!confirmWarnings(warnings, who)) return
    if (sending.current) return
    sending.current = true
    setBusy('send'); setErr(null); setReceipt(null); setNote('')
    try {
      const res = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId, body }) })
      const r = await readJson(res)
      if (!res.ok || !r?.ok) {
        // THE TEXT STAYS IN THE BOX. Say which kind of failure: certainly not sent, or possibly sent.
        const maybe = !!r?.unconfirmed || (res.status >= 500 && res.status !== 502) || (!!r?.duplicate && /didn't confirm/i.test(String(r?.error || '')))
        setErr({ msg: r?.error || r?.message || "Guesty didn't confirm — check the thread in Guesty before resending.", kind: maybe ? 'maybe_sent' : 'not_sent' })
        return
      }
      onSent(body, String(r.by || 'You'))
      change(''); setEnglish(null)
      const mod = String(r.module || '')
      const offThread = mod === 'email' && /airbnb|booking|vrbo|expedia/i.test(channel)
      const time = new Date(r.at || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      setReceipt({
        label: offThread ? `Sent by email, not inside the ${channel} thread · ${time} — check Guesty` : `Sent via ${moduleLabel(mod)} · ${time}`,
        warn: offThread,
        title: `Guesty module: ${mod || 'not reported'}${r.id ? ' · message ' + r.id : ''}`,
      })
    } catch {
      // The request never got an answer. It may or may not have reached Guesty.
      setErr({ msg: 'Lost the connection while sending. It may or may not have gone — check the thread in Guesty before pressing Send again. Your text is still here.', kind: 'maybe_sent' })
    } finally { sending.current = false; setBusy('') }
  }

  const openSaved = async () => {
    const next = !savedOpen
    setSavedOpen(next)
    if (!next || saved) return
    try { const r = await readJson(await fetch('/api/messages/saved', { cache: 'no-store' })); setSaved(Array.isArray(r?.replies) ? r.replies as SavedReply[] : []) }
    catch { setSaved([]) }
  }
  const pickSaved = (r: SavedReply) => {
    if (text.trim() && !confirm('Replace what you have typed with “' + r.title + '”?')) return
    change(fillSavedReply(r.body, { guest, signOff })); setEnglish(null); setSavedOpen(false); setNote(''); box.current?.focus()
  }
  const saveCurrent = async () => {
    const body = text.trim()
    if (!body) return
    const title = (prompt('Name this saved reply (the whole desk will see it):') || '').trim()
    if (!title) return
    try {
      const res = await fetch('/api/messages/saved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }) })
      const r = await readJson(res)
      if (!res.ok || !r?.ok) setErr({ msg: r?.error || 'Could not save that reply.', kind: 'other' })
      else { setSaved(r.replies as SavedReply[]); setNote('Saved as “' + title + '”.') }
    } catch { setErr({ msg: 'Could not reach Lighthouse to save that reply.', kind: 'other' }) }
  }
  const removeSaved = async (r: SavedReply) => {
    if (!confirm('Remove the saved reply “' + r.title + '” for everyone?')) return
    try {
      const j = await readJson(await fetch('/api/messages/saved?id=' + encodeURIComponent(r.id), { method: 'DELETE' }))
      if (j?.ok) setSaved(j.replies as SavedReply[])
    } catch { /* still listed; try again */ }
  }

  return (
    /* On a phone the card is capped to the screen: the box may take at most 60% of it (and scroll
       inside itself when the saved replies are open), so the last messages stay readable above it. */
    <div className="border-t border-line px-3 sm:px-5 py-3 bg-app/30 shrink-0 max-h-[60dvh] overflow-y-auto sm:max-h-none sm:overflow-visible">
      {/* 16px on a phone: anything smaller makes iOS zoom the page when the box is tapped. */}
      <textarea ref={box} id="inbox-reply-box" value={text} onChange={e => change(e.target.value)} rows={3} placeholder={'Reply to ' + who + '…'} aria-label="Reply to the guest"
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send() } }}
        className="w-full text-[16px] sm:text-sm text-ink bg-white border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
      {english ? (
        <div className="mt-1 flex items-center gap-2 flex-wrap text-[11.5px] text-muted">
          <span>Translated to {english.language} from your English.</span>
          <button onClick={() => { change(english.text); setEnglish(null) }} className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline"><Undo2 size={11} /> Put the English back</button>
        </div>
      ) : null}
      <Warnings list={warnings} />
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <button onClick={send} disabled={!!busy || !text.trim()} title={'Send this to ' + who + ' now, on the thread’s own channel (Ctrl/⌘+Enter)'}
          className={BTN + ' text-white bg-brand-600 hover:bg-brand-700'}>
          {busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send{channel ? ' on ' + channel : ''}
        </button>
        <button onClick={draft} disabled={!!busy} title="Eve reads the thread and writes a reply into the box — nothing is sent"
          className={BTN + ' text-brand-700 bg-white border border-brand-200 hover:bg-brand-50'}>
          {busy === 'draft' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Draft with Eve
        </button>
        <button onClick={openSaved} disabled={!!busy} aria-expanded={savedOpen} title="The desk’s saved replies — picking one fills the box, nothing is sent"
          className={BTN + ' text-ink bg-white border border-line hover:bg-app'}>
          <BookmarkPlus size={13} /> Saved replies
        </button>
        {lastGuestText && looksForeign(lastGuestText) && !english ? (
          <button onClick={toGuestLanguage} disabled={!!busy || !text.trim()} title="Put your reply in the language the guest wrote in — it stays in the box for you to send"
            className={BTN + ' text-ink bg-white border border-line hover:bg-app'}>
            {busy === 'translate' ? <Loader2 size={13} className="animate-spin" /> : <Languages size={13} />} Guest’s language
          </button>
        ) : null}
        {receipt ? <span className={'text-[11.5px] ' + (receipt.warn ? 'font-semibold text-amber-700' : 'text-emerald-700')} title={receipt.title}>{receipt.label}</span> : null}
        {note && !receipt ? <span className="text-[11.5px] text-muted">{note}</span> : null}
        {signOff ? <span className="text-[11px] text-muted" title="Replies on this home are written and signed as its hosts, never as Stay Hospitality">Signs as {signOff}</span> : null}
      </div>
      {savedOpen ? (
        <div className="mt-2 rounded-xl border border-line bg-white overflow-hidden">
          {saved === null ? <div className="px-3 py-2 text-[12px] text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</div> : (
            <ul className="divide-y divide-line/70 max-h-64 overflow-y-auto">
              {saved.map(r => (
                <li key={r.id} className="flex items-stretch">
                  <button onClick={() => pickSaved(r)} className="flex-1 min-w-0 text-left px-3 py-2 min-h-[40px] hover:bg-app/60">
                    <span className="block text-[12.5px] font-semibold text-ink truncate">{r.title}</span>
                    <span className="block text-[11.5px] text-muted truncate">{r.body}</span>
                  </button>
                  {!r.builtIn ? <button onClick={() => removeSaved(r)} title="Remove this saved reply for everyone" aria-label={'Remove ' + r.title} className="px-3 text-muted hover:text-rose-700"><Trash2 size={13} /></button> : null}
                </li>
              ))}
              {saved.length === 0 ? <li className="px-3 py-2 text-[12px] text-muted">No saved replies yet.</li> : null}
            </ul>
          )}
          <div className="px-3 py-2 border-t border-line bg-app/40 flex items-center gap-2 flex-wrap">
            <button onClick={saveCurrent} disabled={!text.trim()} className="text-[12px] font-semibold text-brand-700 hover:underline disabled:opacity-50 disabled:no-underline">Save what is in the box as a new reply</button>
          </div>
        </div>
      ) : null}
      {err ? (
        <div role="alert" className={'mt-2 rounded-lg border px-2.5 py-1.5 text-[12.5px] ' + (err.kind === 'maybe_sent' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-800')}>
          <b>{err.kind === 'not_sent' ? 'Not sent. ' : err.kind === 'maybe_sent' ? 'Not confirmed. ' : ''}</b>{err.msg}{err.kind !== 'other' ? ' Your message is still in the box.' : ''}
        </div>
      ) : null}
    </div>
  )
}

type EveDraft = { id: string; draft: string; why: string; by: string; createdAt: string }

function EveDraftCard({ conversationId, guest, guard, onSent }: { conversationId: string; guest: string; guard: { channel: string; checkIn: string | null; signOff: string | null }; onSent: (body: string) => void }) {
  const [draft, setDraft] = useState<EveDraft | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'' | 'send' | 'discard'>('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const acting = useRef(false)
  useEffect(() => {
    let alive = true
    fetch('/api/eve/guest-drafts?conversation=' + encodeURIComponent(conversationId)).then(r => r.json()).then(r => {
      if (!alive) return
      const d = Array.isArray(r?.drafts) && r.drafts[0] ? r.drafts[0] as EveDraft : null
      setDraft(d); setText(d ? d.draft : '')
    }).catch(() => { /* no card */ })
    return () => { alive = false }
  }, [conversationId])
  const warnings = useMemo(() => checkReply(text, { channel: guard.channel, checkIn: guard.checkIn, today: etDay(Date.now()), signOff: guard.signOff }), [text, guard.channel, guard.checkIn, guard.signOff])
  if (!draft) return done ? <div className="border-t border-line px-3 sm:px-5 py-2 bg-brand-50/40 text-[12px] text-emerald-700">{done}</div> : null
  const act = async (op: 'send' | 'discard') => {
    if (busy) return
    // Eve's draft was written without anyone watching, so sending it always asks — and lists what it tripped.
    if (op === 'send' && !(warnings.length ? confirmWarnings(warnings, guest || 'the guest') : confirm('Send this to ' + (guest || 'the guest') + ' now?'))) return
    if (acting.current) return
    acting.current = true
    setBusy(op); setErr('')
    try {
      const res = await fetch('/api/eve/guest-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id: draft.id, body: text }) })
      const r = await readJson(res)
      if (!r?.ok) { setErr((op === 'send' ? 'Not sent — ' : '') + (r?.error || 'that did not work.') + (op === 'send' ? ' The draft is still here.' : '')); return }
      if (op === 'send') { onSent(text); setDone('Sent to ' + (guest || 'the guest') + '.') } else setDone('Discarded.')
      setDraft(null)
    } catch { setErr(op === 'send' ? 'Lost the connection while sending. It may or may not have gone — check the thread in Guesty before sending again.' : 'Could not reach Lighthouse.') } finally { acting.current = false; setBusy('') }
  }
  return (
    <div className="border-t border-line px-3 sm:px-5 py-3 bg-brand-50/40">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-brand-700 mb-1.5"><Sparkles size={13} /> Eve&apos;s draft <span className="text-muted font-normal">· {draft.why}</span></div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} aria-label="Eve's draft reply"
        className="w-full text-[16px] sm:text-sm text-ink bg-white border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200" />
      <Warnings list={warnings} />
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <button onClick={() => act('send')} disabled={!!busy || !text.trim()} className={BTN + ' text-white bg-brand-600 hover:bg-brand-700'}>{busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send to guest</button>
        <button onClick={() => act('discard')} disabled={!!busy} className={BTN + ' text-muted bg-white border border-line hover:text-ink'}><X size={13} /> Discard</button>
        <span className="text-[11px] text-muted">Nothing reaches the guest until you press Send. You can edit it first.</span>
      </div>
      {err && <div role="alert" className="mt-1.5 text-[12px] text-rose-700">{err}</div>}
    </div>
  )
}
