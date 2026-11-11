'use client'
// ONE RESERVATION IN FULL (lib/garden/res-live, live from Cloudbeds — or Guesty for a Botanica stay
// still there): confirmation and OTA number, rooms with rate plan and nightly rates, every guest,
// the folio split, payments, every note with who wrote it, vouchers and the other tags, custom
// fields, verifications and calls. Used inline (Guests) and as a drawer (Today, bookings list).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, RefreshCw, Ticket, X } from 'lucide-react'
import { Tag, type Tone } from '@/components/lean'

const usd = (v: number | null | undefined) => v == null ? '—' : '$' + (Math.round(v * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const day = (ymd: string) => ymd ? new Date(ymd.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
const when = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'); return isNaN(+d) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) }

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex gap-3 text-[12.5px] py-0.5"><span className="w-28 shrink-0 text-muted">{k}</span><span className="min-w-0 text-ink">{children}</span></div>
}
function H({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[10.5px] uppercase tracking-wider text-muted font-semibold mt-3 mb-1">{children}</h4>
}

export function ResDetail({ id, compact = false }: { id: string; compact?: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setD(null); setErr('')
    fetch('/api/garden/reservation?id=' + encodeURIComponent(id), { cache: 'no-store' }).then(r => r.json()).then(r => { if (!live) return; if (r?.ok) setD(r.res); else setErr(r?.error || 'Could not load.') }).catch(e => live && setErr(String(e)))
    return () => { live = false }
  }, [id, n])
  if (err) return <p className="text-[12.5px] text-rose-700">{err}</p>
  if (!d) return <p className="text-[12.5px] text-muted inline-flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Reading the reservation…</p>
  const m = d.money
  const nightly = d.rooms.flatMap((r: any) => r.nightly)
  return (
    <div className="text-[12.5px]">
      {d.warnings?.length ? <p className="text-[11.5px] text-amber-700 mb-1">{d.warnings.join(' · ')}</p> : null}
      <div className="flex flex-wrap gap-1 mb-1">
        {d.vouchers != null ? <Tag tone="sky"><Ticket size={11} className="inline -mt-0.5 mr-0.5" />{d.vouchers} voucher{d.vouchers === 1 ? '' : 's'}</Tag> : null}
        {d.tags.filter((t: any) => t.key !== 'vouchers').map((t: any) => <Tag key={t.key} tone={t.tone as Tone} title={t.detail || undefined}>{t.label}{t.detail ? ': ' + t.detail : ''}</Tag>)}
        {m.balance != null && m.balance <= 0 ? <Tag tone="emerald">Paid in full</Tag> : m.balance ? <Tag tone="amber">{usd(m.balance)} open</Tag> : null}
      </div>

      <H>Booking</H>
      <Row k="Confirmation"><span className="font-mono">{d.confirmation || '—'}</span>{d.otaNumber ? <span className="text-muted"> · OTA <span className="font-mono text-ink">{d.otaNumber}</span></span> : null}</Row>
      <Row k="Channel">{d.source || 'Direct'}{d.origin === 'guesty' ? <span className="text-muted"> · in Guesty</span> : null}</Row>
      <Row k="Stay">{day(d.checkIn)} → {day(d.checkOut)}{d.nights ? <span className="text-muted"> · {d.nights} nights</span> : null}</Row>
      {d.arrivalTime ? <Row k="Arriving">{d.arrivalTime}</Row> : null}
      <Row k="Booked">{when(d.bookedAt) || '—'}{d.modifiedAt ? <span className="text-muted"> · changed {when(d.modifiedAt)}</span> : null}</Row>
      {d.email || d.phone ? <Row k="Contact">{[d.phone, d.email].filter(Boolean).join(' · ')}</Row> : null}

      <H>Rooms</H>
      {d.rooms.map((r: any, i: number) => (
        <Row key={i} k={r.name || 'Unassigned'}>{r.type || '—'}{r.ratePlan ? <span className="text-muted"> · {r.ratePlan}</span> : null}{r.adults != null ? <span className="text-muted"> · {r.adults} adult{r.adults === 1 ? '' : 's'}{r.children ? ` + ${r.children} child${r.children === 1 ? '' : 'ren'}` : ''}</span> : null}</Row>
      ))}
      {!compact && nightly.length ? (
        <div className="flex flex-wrap gap-1 mt-1">{nightly.map((x: any, i: number) => <span key={i} className="rounded-md bg-app px-1.5 py-0.5 text-[11px] tabular-nums" title={day(x.date)}>{x.date.slice(5)} {usd(x.rate)}</span>)}</div>
      ) : null}

      <H>Money</H>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {[['Total', m.total], ['Room', m.roomRevenue], ['Taxes & fees', m.taxes], [d.origin === 'guesty' ? 'Cleaning' : 'Extras', m.extras], ['Paid', m.paid], ['Balance', m.balance]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg border border-line px-2 py-1"><div className={`text-[13px] font-semibold tabular-nums ${k === 'Balance' && Number(v) > 0 ? 'text-amber-700' : 'text-ink'}`}>{usd(v as any)}</div><div className="text-[10px] text-muted">{k}</div></div>
        ))}
      </div>
      {d.payments.length ? <div className="mt-1.5 space-y-0.5">{d.payments.map((p: any, i: number) => <div key={i} className="flex gap-2 text-[12px]"><span className="text-muted w-28 shrink-0 tabular-nums">{when(p.at)}</span><span className={p.kind === 'refund' ? 'text-rose-700' : 'text-ink'}>{p.kind} {usd(p.amount)}</span>{p.method ? <span className="text-muted truncate">{p.method}</span> : null}</div>)}</div> : null}
      {d.cards.length ? <p className="text-[12px] text-muted mt-1">Card{d.cards.length === 1 ? '' : 's'} on file: {d.cards.map((c: any) => c.type).join(', ')}</p> : null}

      {d.guests.length ? (<>
        <H>Guests on the booking</H>
        {d.guests.map((g: any, i: number) => (
          <Row key={i} k={g.main ? 'Main guest' : 'Guest'}>{g.name}{g.country ? <span className="text-muted"> · {g.country}</span> : null} <Tag tone={g.idOnFile ? 'emerald' : 'slate'}>{g.idOnFile ? `ID on file${g.idType ? ' · ' + g.idType : ''}` : 'no ID'}</Tag>{g.status ? <span className="text-muted"> · {g.status.replace(/_/g, ' ')}</span> : null}</Row>
        ))}
      </>) : null}

      {d.customFields.length ? (<>
        <H>Custom fields</H>
        {d.customFields.map((f: any, i: number) => <Row key={i} k={f.name}>{f.value}</Row>)}
      </>) : null}

      <H>Notes {d.notes.length ? <span className="normal-case tracking-normal">({d.notes.length})</span> : null}</H>
      {d.notes.length ? <div className="space-y-1">{d.notes.map((x: any, i: number) => (
        <div key={i} className="rounded-lg bg-app px-2 py-1.5"><p className="text-[12px] text-ink whitespace-pre-wrap">{x.text}</p>{x.by || x.at ? <p className="text-[10.5px] text-muted mt-0.5">{[x.by, when(x.at)].filter(Boolean).join(' · ')}</p> : null}</div>
      ))}</div> : <p className="text-[12px] text-muted">No notes on this reservation.</p>}

      {d.verifications.length || d.calls.length ? (<>
        <H>Desk</H>
        {d.verifications.map((v: any, i: number) => <Row key={'v' + i} k={v.kind === 'id' ? 'ID check' : v.kind === 'card' ? 'Card check' : v.kind}>{v.status}{v.note ? <span className="text-muted"> — {v.note}</span> : null}</Row>)}
        {d.calls.slice(0, compact ? 3 : 30).map((c: any, i: number) => <Row key={'c' + i} k={when(c.at)}>{c.kind.replace(/_/g, ' ')} · {c.outcome}{c.by ? <span className="text-muted"> · {c.by}</span> : null}{c.note ? <span className="text-muted"> — {c.note}</span> : null}</Row>)}
      </>) : null}

      <div className="mt-2 flex items-center gap-2 text-[10.5px] text-muted">
        <span>Read live {when(d.fetchedAt)}</span>
        <button onClick={() => setN(x => x + 1)} className="inline-flex items-center gap-1 hover:text-ink"><RefreshCw size={10} /> refresh</button>
      </div>
    </div>
  )
}

/** The same, as a right-hand drawer over the page. */
export function ResDrawer({ id, title, onClose }: { id: string | null; title?: string; onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (!id) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [id, onClose])
  if (!id || !mounted) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/20" onClick={onClose}>
      <div className="w-full max-w-lg h-full bg-white shadow-xl p-5 overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-[18px] font-semibold text-ink truncate">{title || 'Reservation'}</h2>
          <span className="flex-1" />
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-lg hover:bg-neutral-100" aria-label="Close"><X size={16} /></button>
        </div>
        <ResDetail id={id} />
      </div>
    </div>, document.body)
}
