'use client'
// THE EVIDENCE, ON SCREEN (Jon, 2026-10-24: "I want to see the photo populate"; "it should scan
// check-in form and messages"). Shared by the ID & deposits desk and the Today tile:
//   <Checklist>    To verify / Verified + ID · Selfie · Deposit, each ✓/✗ with where it came from
//   <ThreadThumbs> the photos the guest sent on the thread, as small pictures right on the row
//   <CheckDetails> the whole picture for one booking: the ID and selfie (signed, logged views), the
//                  thread photos large, the Guesty check-in form opened in place, then the booking
//                  itself (StayPanel) with a button straight to the reservation in Guesty
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, X, ExternalLink, FileText, Loader2 } from 'lucide-react'
import type { GuestCheckRow } from '@/app/api/guest-checks/route'
import { StayPanel } from '@/components/StayPanel'

const API = '/api/guest-checks'
const at = (s?: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''
const BTN = 'inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-app'

export function Checklist({ r }: { r: GuestCheckRow }) {
  const c = r.checklist
  if (!c) return null
  const item = (label: string, it: { ok: boolean; how: string }, need: boolean) => !need ? null : (
    <span title={label + ': ' + it.how} className={'inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-[3px] rounded-md ' + (it.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
      {it.ok ? <Check size={10} /> : <X size={10} />}{label}
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1">
      <span className={'text-[10.5px] font-bold px-1.5 py-[3px] rounded-md ' + (c.complete ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-900')}>{c.complete ? 'Verified' : 'To verify'}</span>
      {item('ID', c.id, r.needId)}
      {item('Selfie', c.selfie, r.needId)}
      {item(r.depositDue ? '$' + r.depositDue : 'Deposit', c.deposit, r.needDeposit)}
      {r.checkInForm?.found ? <span title={'Guesty check-in form completed' + (r.checkInForm.filename ? ' — ' + r.checkInForm.filename : '')} className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-[3px] rounded-md bg-sky-50 text-sky-700"><FileText size={10} />Form</span> : null}
    </span>
  )
}

export function ThreadThumbs({ r, onOpen, size = 44 }: { r: GuestCheckRow; onOpen: (url: string, title: string, isPdf?: boolean) => void; size?: number }) {
  const ps = (r.threadPhotos || []).filter(p => p.url)
  if (!ps.length) return null
  return (
    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
      <span className="text-[11px] text-muted">Sent on the thread:</span>
      {ps.map((p, i) => /pdf/.test(p.type)
        ? <button key={i} onClick={() => onOpen(p.url as string, r.guest + ' — file sent ' + at(p.at), true)} className={BTN}><FileText size={12} /> PDF · {at(p.at)}</button>
        : <button key={i} onClick={() => onOpen(p.url as string, r.guest + ' — photo sent ' + at(p.at))} title={'Sent ' + at(p.at)} className="rounded-lg overflow-hidden border border-line hover:ring-2 hover:ring-brand-300">
            <img src={p.url as string} alt="" style={{ width: size, height: size }} className="object-cover block" loading="lazy" />
          </button>)}
    </div>
  )
}

/** One picture from the private bucket, signed on open (the view is logged by the photo route). */
function SignedPhoto({ rid, which, label, onOpen }: { rid: string; which: 'id' | 'selfie'; label: string; onOpen: (url: string, title: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let dead = false
    fetch(API + '/photo?rid=' + encodeURIComponent(rid) + '&which=' + which, { cache: 'no-store' }).then(r => r.json())
      .then(j => { if (!dead) { if (j.ok) setUrl(j.url); else setErr(j.error || 'Not on file') } }).catch(() => { if (!dead) setErr('Could not load') })
    return () => { dead = true }
  }, [rid, which])
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{label}</figcaption>
      {url ? <button onClick={() => onOpen(url, label)} className="rounded-xl overflow-hidden border border-line hover:ring-2 hover:ring-brand-300"><img src={url} alt="" className="h-40 w-auto object-cover block" /></button>
        : err ? <span className="text-[11.5px] text-muted h-40 flex items-center">{err}</span>
        : <span className="h-40 w-32 rounded-xl bg-app flex items-center justify-center"><Loader2 size={14} className="animate-spin text-muted" /></span>}
    </figure>
  )
}

export function CheckDetails({ r, onOpen }: { r: GuestCheckRow; onOpen: (url: string, title: string, isPdf?: boolean) => void }) {
  // The form is served through Lighthouse as an inline PDF (Guesty's link is a download a frame can't show).
  const [form, setForm] = useState<{ url: string; filename: string | null } | null>(null)
  const formErr = '', formBusy = false
  const openForm = () => setForm({ url: API + '/form?rid=' + encodeURIComponent(r.reservationId) + '&t=' + Date.now(), filename: null })
  // A completed form opens by itself — it is usually where the ID and selfie are.
  useEffect(() => { if (r.checkInForm?.found) openForm() }, [r.reservationId]) // eslint-disable-line react-hooks/exhaustive-deps
  const big = (r.threadPhotos || []).filter(p => p.url && !/pdf/.test(p.type))
  const c = r.checklist
  return (
    <div className="mt-2.5 flex flex-col gap-3 rounded-xl border border-line bg-app/40 p-3">
      {c && (
        <div className="grid sm:grid-cols-3 gap-2 text-[12px]">
          {[['ID', c.id, r.needId], ['Selfie', c.selfie, r.needId], ['Deposit' + (r.depositDue ? ' $' + r.depositDue : ''), c.deposit, r.needDeposit]].filter(x => x[2]).map(([l, it]: any) => (
            <div key={l} className={'rounded-lg border px-2.5 py-1.5 ' + (it.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800')}>
              <b className="inline-flex items-center gap-1">{it.ok ? <Check size={12} /> : <X size={12} />}{l}</b> · {it.how}
            </div>
          ))}
        </div>
      )}
      {(r.hasIdPhoto || r.hasSelfie || big.length) ? (
        <div className="flex items-start gap-3 flex-wrap">
          {r.hasIdPhoto && <SignedPhoto rid={r.reservationId} which="id" label="ID (Lighthouse link)" onOpen={onOpen} />}
          {r.hasSelfie && <SignedPhoto rid={r.reservationId} which="selfie" label="Selfie (Lighthouse link)" onOpen={onOpen} />}
          {big.map((p, i) => (
            <figure key={i} className="flex flex-col gap-1">
              <figcaption className="text-[10.5px] font-bold uppercase tracking-wider text-muted">On the thread · {at(p.at)}</figcaption>
              <button onClick={() => onOpen(p.url as string, r.guest + ' — photo sent ' + at(p.at))} className="rounded-xl overflow-hidden border border-line hover:ring-2 hover:ring-brand-300"><img src={p.url as string} alt="" className="h-40 w-auto object-cover block" /></button>
            </figure>
          ))}
        </div>
      ) : <p className="text-[12px] text-muted">No ID or selfie photo has come in — not through our link, and nothing on the message thread.</p>}

      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-muted">Guesty check-in form</span>
          {r.checkInForm == null ? <span className="text-[11.5px] text-muted">not checked yet</span>
            : r.checkInForm.found ? <span className="text-[11.5px] text-emerald-700 font-semibold">completed</span>
            : <span className="text-[11.5px] text-rose-700 font-semibold">not completed · checked {at(r.checkInForm.at)}</span>}
          <button onClick={openForm} disabled={formBusy} className={BTN}>{formBusy ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} {form ? 'Reload form' : 'Open form'}</button>
          {form && <a href={form.url} target="_blank" rel="noreferrer" className={BTN}><ExternalLink size={12} /> New tab</a>}
        </div>
        {formErr && <p className="mt-1 text-[11.5px] text-muted">{formErr}</p>}
        {form && <iframe src={form.url} title="Check-in form" className="mt-2 w-full h-[520px] rounded-xl border border-line bg-white" />}
      </div>

      <StayPanel reservationId={r.reservationId} />
      <div className="flex items-center gap-2">
        <Link href={'/reservations/' + encodeURIComponent(r.reservationId)} prefetch={false} className={BTN}><ExternalLink size={12} /> Full booking page</Link>
        <a href={r.guestyUrl} target="_blank" rel="noreferrer" className={BTN}><ExternalLink size={12} /> Open in Guesty</a>
      </div>
    </div>
  )
}

/** The desk asks Guesty about the forms of the arrivals still short — once per open, up to 10. */
export function cifSweepIds(rows: GuestCheckRow[]): { id: string; checkOut: string }[] {
  return rows.filter(r => r.needId && !r.checklist?.complete && !r.checkInForm?.found).sort((a, b) => a.checkIn.localeCompare(b.checkIn)).slice(0, 10).map(r => ({ id: r.reservationId, checkOut: r.checkOut }))
}
