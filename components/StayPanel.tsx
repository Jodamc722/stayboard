'use client'
// THE FULL PICTURE, ANYWHERE A BOOKING APPEARS (Jon, 2026-09-22: "every part of the app communicates
// with each other and gives us a full-picture overview").
//
// One component over /api/reservation/<id>/360 (lib/reservation-360). The Calls desk, Glitches,
// Claims, Messages, Reservations and Today in Ops all mount this rather than each assembling its own
// half of the booking. `compact` is the one-line version: the flags as tags, and "Full picture"
// opens the sections underneath.
import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, ChevronDown, ExternalLink, User, Phone, MessageSquare, AlertTriangle, Scale, Star, ClipboardList, DollarSign, StickyNote } from 'lucide-react'
import { Tag, Tip } from '@/components/lean'

type Flag = { key: string; label: string; tone: 'rose' | 'amber' | 'emerald' | 'violet' | 'slate' | 'brand'; why?: string }
type Stay = any

const cache: Record<string, { at: number; p: Promise<any> }> = {}
function load360(id: string, force = false): Promise<any> {
  const hit = cache[id]
  if (!force && hit && Date.now() - hit.at < 60_000) return hit.p
  const p = fetch('/api/reservation/' + encodeURIComponent(id) + '/360', { cache: 'no-store' }).then(r => r.json())
  cache[id] = { at: Date.now(), p }
  return p
}
export function useStay360(id: string | null | undefined) {
  const [stay, setStay] = useState<Stay | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!id) return
    let live = true
    setLoading(true); setErr('')
    load360(id).then(j => { if (!live) return; if (j?.ok) setStay(j.stay); else setErr(j?.error || 'Could not load this booking.') })
      .catch(e => live && setErr(String(e))).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [id])
  return { stay, err, loading }
}

const money = (n: any) => n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString()
const day = (v: any) => { const s = String(v || ''); if (!s) return ''; try { return new Date(s.length === 10 ? s + 'T12:00:00Z' : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: s.length === 10 ? 'UTC' : undefined }) } catch { return s.slice(0, 10) } }

export function StayFlags({ flags }: { flags: Flag[] }) {
  if (!flags?.length) return null
  return <>{flags.map(f => <Tag key={f.key} tone={f.tone} title={f.why}>{f.label}</Tag>)}</>
}

/**
 * compact: one line of tags + "Full picture" toggle.  full (default): the sections, open.
 */
export function StayPanel({ reservationId, compact, hide = [] }: { reservationId: string | null | undefined; compact?: boolean; hide?: string[] }) {
  const { stay, err, loading } = useStay360(reservationId)
  const [open, setOpen] = useState(!compact)
  if (!reservationId) return null
  if (loading && !stay) return <div className="text-[12px] text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading the full picture…</div>
  if (err && !stay) return <div className="text-[12px] text-muted">Full picture unavailable — {err}</div>
  if (!stay) return null
  const s = stay
  const show = (k: string) => hide.indexOf(k) < 0
  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex items-center gap-1.5 flex-wrap px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Full picture</span>
        <StayFlags flags={s.flags} />
        {!s.flags.length && <span className="text-[12px] text-muted">Nothing flagged on this stay.</span>}
        <span className="ml-auto flex items-center gap-2">
          <Tip label="Open the booking page"><a href={'/reservations/' + s.id} className="text-[12px] font-semibold text-brand-600 hover:underline inline-flex items-center gap-1">Booking <ExternalLink size={11} /></a></Tip>
          <button onClick={() => setOpen(o => !o)} className="text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1">{open ? 'Less' : 'More'} <ChevronDown size={13} className={open ? 'rotate-180 transition' : 'transition'} /></button>
        </span>
      </div>
      {open && (
        <div className="border-t border-line grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px bg-line/60">
          {show('guest') && <Box icon={<User size={12} />} title="Guest">
            <Line><b>{s.guest.name}</b>{s.guest.vip && <Tag tone="violet">VIP</Tag>}{s.guest.tags.map((t: string) => <Tag key={t}>{t}</Tag>)}</Line>
            <Line muted>{s.guest.stays} stay{s.guest.stays === 1 ? '' : 's'} with us · {s.guest.nights} nights{s.guest.lifetimeValue != null ? ' · ' + money(s.guest.lifetimeValue) + ' lifetime' : ''}</Line>
            {s.guest.teamNotes && <Line><StickyNote size={11} className="text-muted" /> {s.guest.teamNotes}</Line>}
            {(s.guest.email || s.guest.phone) && <Line muted>{[s.guest.phone, s.guest.email].filter(Boolean).join(' · ')}</Line>}
            {s.guest.history.length > 1 && (
              <details className="text-[12px]"><summary className="cursor-pointer text-muted hover:text-ink">Other stays</summary>
                <ul className="mt-1 space-y-0.5">{s.guest.history.filter((h: any) => h.id !== s.id).slice(0, 10).map((h: any) => (
                  <li key={h.id}><a href={'/reservations/' + h.id} className="hover:underline">{h.unit}</a> <span className="text-muted">· {day(h.checkIn)}–{day(h.checkOut)}{/cancel/i.test(h.status) ? ' · cancelled' : ''}{h.value != null ? ' · ' + money(h.value) : ''}</span></li>
                ))}</ul>
              </details>
            )}
          </Box>}
          {show('stay') && <Box icon={<DollarSign size={12} />} title="Stay & money">
            <Line><b>{s.listing.unit}</b> <span className="text-muted">{day(s.dates.checkIn)} → {day(s.dates.checkOut)} · {s.dates.nights ?? '—'}n · {s.channel}</span></Line>
            <Line muted>Booked {day(s.dates.bookedAt)}{s.dates.leadDays != null ? ' · ' + s.dates.leadDays + 'd ahead' : ''} · {s.dates.phase}{s.confirmationCode ? ' · ' + s.confirmationCode : ''}</Line>
            {s.money && <Line>Total {money(s.money.total)} · paid {money(s.money.paid)}{s.money.balance ? <> · <span className="text-amber-700 font-semibold">owes {money(s.money.balance)}</span></> : ''}{s.money.refunded ? <> · <span className="text-rose-700">refunded {money(s.money.refunded)}</span></> : ''}</Line>}
            {(s.orders.count > 0 || s.notice || s.parking) && <Line muted>{[s.orders.count ? s.orders.count + ' guest order' + (s.orders.count === 1 ? '' : 's') + (s.orders.totalUsd != null ? ' ' + money(s.orders.totalUsd) : '') : '', s.notice ? (s.notice.sent ? 'building notified' : 'notice not sent') : '', s.parking ? 'parking ' + s.parking.status : ''].filter(Boolean).join(' · ')}</Line>}
          </Box>}
          {show('calls') && <Box icon={<Phone size={12} />} title="Calls">
            <Line>{s.calls.welcome ? <>Welcome: <b>{s.calls.welcome.outcome || 'open'}</b>{s.calls.welcome.by ? ' by ' + s.calls.welcome.by : ''}{s.calls.welcome.attempts ? ' · ' + s.calls.welcome.attempts + ' attempt' + (s.calls.welcome.attempts === 1 ? '' : 's') : ''}</> : <span className="text-muted">No welcome call logged</span>}</Line>
            {s.calls.postCheckout && <Line>After checkout: <b>{s.calls.postCheckout.outcome}</b>{s.calls.postCheckout.by ? ' by ' + s.calls.postCheckout.by : ''}</Line>}
            <Line muted>{s.calls.totals.calls} call{s.calls.totals.calls === 1 ? '' : 's'} ({s.calls.totals.answered} answered) · {s.calls.totals.texts} texts · {s.calls.totals.voicemails} voicemails{s.calls.lastContactAt ? ' · last ' + day(s.calls.lastContactAt) : ''}</Line>
            {s.calls.promised.length > 0 && <Line><span className="text-brand-700"><b>Promised:</b> {s.calls.promised.map((p: any) => p.item).join(' · ')}</span></Line>}
          </Box>}
          {show('messages') && <Box icon={<MessageSquare size={12} />} title="Messages">
            {s.messages.conversationId ? <>
              <Line>{s.messages.count} messages{s.messages.unread ? <> · <span className="text-amber-700 font-semibold">{s.messages.unread} unread</span></> : ''}{s.messages.awaitingReply ? <> · <span className="text-amber-700 font-semibold">awaiting our reply</span></> : ''}</Line>
              {s.messages.sentiment && <Line><span className={s.messages.sentiment.dissatisfied ? 'text-rose-700 font-semibold' : 'text-muted'}>Sentiment: {s.messages.sentiment.band || (s.messages.sentiment.score ?? '—')}</span>{s.messages.sentiment.topIssue ? <span className="text-muted"> · {s.messages.sentiment.topIssue}</span> : null}</Line>}
              <Line muted>{s.messages.firstResponseMin != null ? 'First reply ' + s.messages.firstResponseMin + ' min' : ''}{s.messages.lastMessageAt ? (s.messages.firstResponseMin != null ? ' · ' : '') + 'last ' + day(s.messages.lastMessageAt) : ''}</Line>
              <a href={'/messages/' + s.messages.conversationId} className="text-[12px] font-semibold text-brand-600 hover:underline">Open thread →</a>
            </> : <Line muted>No conversation linked.</Line>}
          </Box>}
          {show('issues') && <Box icon={<AlertTriangle size={12} />} title="Issues & claims">
            {s.glitches.length === 0 && s.claims.length === 0 && <Line muted>No issues or claims on this stay.</Line>}
            {s.glitches.map((g: any) => (
              <Line key={g.id}><Tag tone={/closed|resolved|done/i.test(g.status) ? 'slate' : 'rose'}>{g.status || 'open'}</Tag> <a href={'/glitches?q=' + encodeURIComponent(s.listing.unit)} className="hover:underline">{g.overview || 'Issue'}</a>{g.refund ? <span className="text-rose-700"> · refund {money(g.refund)}</span> : null}</Line>
            ))}
            {s.claims.map((c: any) => (
              <Line key={c.id}><Scale size={11} className="text-violet-600" /> <a href={'/claims/' + c.id} className="hover:underline">Claim · {c.stage}</a>{c.sought != null ? <span className="text-muted"> · sought {money(c.sought)}{c.paid != null ? ', paid ' + money(c.paid) : ''}</span> : null}</Line>
            ))}
          </Box>}
          {show('reviews') && <Box icon={<Star size={12} />} title="Reviews">
            {s.reviews.thisStay ? <Line>This stay: <b>{s.reviews.thisStay.rating ?? '—'}★</b> on {s.reviews.thisStay.channel}{s.reviews.thisStay.replied ? '' : <span className="text-amber-700"> · not replied</span>}</Line> : <Line muted>No review from this stay yet.</Line>}
            <Line muted>{s.listing.unit}: {s.reviews.listingAvg90 != null ? s.reviews.listingAvg90 + '★ avg' : 'no score'} over {s.reviews.listingCount90} reviews (90d)</Line>
            {s.reviews.listingLast && <Line muted>Last: {s.reviews.listingLast.rating}★ {s.reviews.listingLast.channel} {day(s.reviews.listingLast.at)}{s.reviews.listingLast.content ? ' — “' + s.reviews.listingLast.content.slice(0, 110) + (s.reviews.listingLast.content.length > 110 ? '…' : '') + '”' : ''}</Line>}
          </Box>}
          {show('tasks') && <Box icon={<ClipboardList size={12} />} title="Field work on this stay">
            {s.tasks.length === 0 ? <Line muted>No Breezeway tasks linked to this booking.</Line> : s.tasks.slice(0, 8).map((t: any) => (
              <Line key={t.id}><Tag tone={/finish|complete|done/i.test(t.status) ? 'emerald' : /progress|start/i.test(t.status) ? 'amber' : 'slate'}>{t.status || 'open'}</Tag> {t.name}<span className="text-muted">{t.scheduled ? ' · ' + day(t.scheduled) : ''}{t.assignees.length ? ' · ' + t.assignees.join(', ') : ''}</span></Line>
            ))}
          </Box>}
          {show('notes') && (s.notes || s.customFields.length > 0) && <Box icon={<StickyNote size={12} />} title="Notes & fields">
            {s.notes && <p className="text-[12px] text-ink/80 whitespace-pre-wrap max-h-28 overflow-auto">{s.notes}</p>}
            {s.customFields.slice(0, 10).map((f: any) => <Line key={f.name} muted><span className="text-ink">{f.name}:</span> {f.value}</Line>)}
          </Box>}
        </div>
      )}
    </div>
  )
}

function Box({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="bg-white px-3 py-2.5 min-w-0">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1 inline-flex items-center gap-1">{icon} {title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}
function Line({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <div className={'text-[12.5px] flex items-center gap-1 flex-wrap ' + (muted ? 'text-muted' : 'text-ink')}>{children}</div>
}
