'use client'
// PARKING — the pop-ups (Jon, 2026-10-26). A booking (new or existing), the 1-hour notice to every
// in-house guest, and the tow email. Buttons, not drop-downs; nothing here navigates.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2, Search, X, Check, AlertTriangle, Camera } from 'lucide-react'
import { Sheet } from '@/components/Sheet'
import { Tag } from '@/components/lean'
import { nightsBetween, addDays, rangesOverlap, cents, tidyPlate, carLabel, normalizePlate } from '@/lib/plate'
import type { Booking, Spot, Lot, Incident, BookingKind, Paid, BookingStatus, Stay } from '@/lib/parking-lots'

const TZ = 'America/New_York'
export const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
export const dayShort = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
export const whenET = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
export const timeET = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })

export async function lotsApi(body: Record<string, any>): Promise<any> {
  const r = await fetch('/api/lots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.ok === false) throw new Error(j?.error || j?.message || `HTTP ${r.status}`)
  return j
}

/** A row of choices as buttons — the one way a value is picked on this desk. */
export function Pick<T extends string>({ value, options, onChange, disabled, small }: { value: T | null; options: { value: T; label: ReactNode; hint?: string; off?: boolean }[]; onChange: (v: T) => void; disabled?: boolean; small?: boolean }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {options.map(o => (
        <button key={o.value} type="button" disabled={disabled || o.off} title={o.hint} onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={`${small ? 'text-[11px] px-2 py-0.5' : 'text-[12px] px-2.5 py-1'} font-semibold rounded-full border disabled:opacity-40 disabled:cursor-not-allowed ${value === o.value ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink'}`}>{o.label}</button>
      ))}
    </div>
  )
}
const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block">
    <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{label}{hint ? <span className="normal-case tracking-normal font-normal"> · {hint}</span> : null}</span>
    {children}
  </label>
)
const input = 'w-full text-[13px] bg-app border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60'

const KINDS: { value: BookingKind; label: string; hint: string }[] = [
  { value: 'guest', label: 'Guest', hint: 'Sold to a stay at the rate' },
  { value: 'staff', label: 'Staff', hint: 'One of ours — held spots, never charged' },
  { value: 'owner', label: 'Owner', hint: 'An owner visiting — not charged' },
  { value: 'vendor', label: 'Vendor', hint: 'A contractor for the day — not charged' },
  { value: 'block', label: 'Block spot', hint: 'Spot out of use (work, a hazard, an event)' },
]
const PAID: { value: Paid; label: string }[] = [{ value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }, { value: 'comped', label: 'Comped' }]
const VIA = ['guesty', 'cash', 'card', 'zelle', 'other']
const STATUSES: { value: BookingStatus; label: string; hint: string }[] = [
  { value: 'reserved', label: 'Reserved', hint: 'Spot is held, car not seen yet' },
  { value: 'parked', label: 'Parked', hint: 'The car is in the spot' },
  { value: 'left', label: 'Left', hint: 'The car is gone' },
  { value: 'no_show', label: 'No-show', hint: 'Never came — frees the spot' },
  { value: 'cancelled', label: 'Cancelled', hint: 'Frees the spot' },
]

export type BookingDraft = Omit<Partial<Booking>, 'spotId'> & { spotId?: string | null; startsOn?: string; endsOn?: string }

export function BookingSheet({ open, onClose, lot, spots, bookings, draft, canFull, onSaved, onDeleted }: {
  open: boolean; onClose: () => void; lot: Lot; spots: Spot[]; bookings: Booking[]
  draft: BookingDraft | null; canFull: boolean
  onSaved: (b: Booking, note: string | null) => void; onDeleted: (id: string) => void
}) {
  const existing = !!draft?.id
  const today = todayET()
  const [kind, setKind] = useState<BookingKind>('guest')
  const [stay, setStay] = useState<{ id: string | null; guest: string; unit: string; phone: string | null; listingId: string | null } | null>(null)
  const [ownName, setOwnName] = useState('')     // staff / owner / vendor: whose car, typed
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Stay[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [startsOn, setStartsOn] = useState(today)
  const [endsOn, setEndsOn] = useState(addDays(today, 1))
  const [spotId, setSpotId] = useState<string | null>(null)
  const [car, setCar] = useState({ make: '', model: '', color: '', plate: '', plateState: '' })
  const [amount, setAmount] = useState('')
  const [paid, setPaid] = useState<Paid>('unpaid')
  const [via, setVia] = useState('guesty')
  const [status, setStatus] = useState<BookingStatus>('reserved')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [amountTouched, setAmountTouched] = useState(false)
  // THE OPEN-TRANSITION RACE (first live run: clicking spot 3 opened the sheet on spot 1). In the
  // render where the sheet opens, the auto-pick effect below runs with the PREVIOUS sheet's state
  // and its setSpotId lands after the reset's. So the reset marks a run as pending — the auto-pick
  // skips exactly that stale run — and bumps `settled` so it runs again once the draft is in state.
  const [settled, setSettled] = useState(0)
  const pendingReset = useRef(false)

  // Reset from the draft every time the sheet opens.
  useEffect(() => {
    if (!open) return
    pendingReset.current = true
    const d = draft || {}
    setKind((d.kind as BookingKind) || 'guest')
    const k = (d.kind as BookingKind) || 'guest'
    setStay(k === 'guest' && (d.reservationId || d.guestName) ? { id: d.reservationId || null, guest: d.guestName || '', unit: d.unit || '', phone: d.guestPhone || null, listingId: d.listingId || null } : null)
    setOwnName(k !== 'guest' ? d.guestName || '' : '')
    setQ(''); setHits(null)
    const s0 = d.startsOn || today, e0 = d.endsOn || addDays(s0, 1)
    setStartsOn(s0); setEndsOn(e0)
    setSpotId(d.spotId || null)
    setCar({ make: d.make || '', model: d.model || '', color: d.color || '', plate: d.plate || '', plateState: d.plateState || '' })
    // The price is set HERE, not left to the suggested-amount effect: that effect only fires when
    // the nights change, and a fresh sheet with the same one night as the last one saved $0.
    setAmount(d.amountCents != null ? String(Math.round(d.amountCents) / 100) : String((nightsBetween(s0, e0) * lot.rateCents) / 100))
    setAmountTouched(d.amountCents != null)
    setSettled(t => t + 1)
    setPaid((d.paid as Paid) === 'na' || !d.paid ? 'unpaid' : (d.paid as Paid))
    setVia(d.paidVia || 'guesty')
    setStatus((d.status as BookingStatus) || 'reserved')
    setNotes(d.notes || '')
    setErr(null)
  }, [open, draft, today, lot.rateCents])

  const nights = nightsBetween(startsOn, endsOn)
  const suggested = nights * lot.rateCents
  useEffect(() => { if (!amountTouched && kind === 'guest') setAmount(String(suggested / 100)) }, [suggested, amountTouched, kind])

  // Which spots are free for every night of the run (the server checks again on save).
  const freeMap = useMemo(() => {
    const out: Record<string, Booking | null> = {}
    for (const s of spots) {
      const clash = bookings.find(b => b.spotId === s.id && b.id !== draft?.id && (b.status === 'reserved' || b.status === 'parked') && rangesOverlap(b.startsOn, b.endsOn, startsOn, endsOn))
      out[s.id] = clash || null
    }
    return out
  }, [spots, bookings, startsOn, endsOn, draft?.id])

  // Auto-pick the first free spot of the right kind when none is chosen (or the chosen one became impossible).
  useEffect(() => {
    if (!open) return
    if (pendingReset.current) { pendingReset.current = false; return }
    const ok = (s: Spot) => s.active && !freeMap[s.id] && (kind !== 'guest' || s.kind === 'sell')
    const cur = spots.find(s => s.id === spotId)
    if (cur && (ok(cur) || existing)) return
    const pref = spots.slice().sort((a, b) => (kind === 'guest' ? (a.kind === 'sell' ? 0 : 1) - (b.kind === 'sell' ? 0 : 1) : (a.kind === 'hold' ? 0 : 1) - (b.kind === 'hold' ? 0 : 1)) || a.sort - b.sort).find(ok)
    setSpotId(pref ? pref.id : null)
  }, [open, settled, kind, freeMap, spots, spotId, existing])

  const search = useCallback(async (text: string) => {
    setSearching(true)
    try {
      const r = await fetch(`/api/lots?lot=${encodeURIComponent(lot.id)}&stays=${encodeURIComponent(text)}&from=${addDays(today, -2)}&to=${addDays(today, 120)}`, { cache: 'no-store' })
      const j = await r.json()
      setHits(j?.ok ? j.stays : [])
    } catch { setHits([]) } finally { setSearching(false) }
  }, [lot.id, today])
  const timer = useRef<any>(null)
  useEffect(() => {
    if (!open || kind !== 'guest' || stay) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => search(q), q ? 300 : 0)
    return () => clearTimeout(timer.current)
  }, [q, open, kind, stay, search])

  const pickStay = (s: Stay) => {
    setStay({ id: s.id, guest: s.guest, unit: s.unit, phone: s.phone, listingId: s.listingId })
    if (!existing) { setStartsOn(s.checkIn); setEndsOn(s.checkOut) }
  }

  const save = async () => {
    setBusy(true); setErr(null)
    try {
      const plate = tidyPlate(car.plate)
      if (kind !== 'block' && !plate) throw new Error('The plate is what the lot check matches on — type it (or "none" for a car with no plate yet).')
      const own = kind === 'guest' ? stay : null
      const payload: Record<string, any> = {
        kind, spotId, startsOn, endsOn,
        reservationId: own?.id || null, listingId: own?.listingId || null, unit: own?.unit || null,
        guestName: kind === 'block' ? null : kind === 'guest' ? (own?.guest || null) : (ownName.trim() || null), guestPhone: own?.phone || null,
        plate: kind === 'block' ? null : plate, plateState: car.plateState, make: car.make, model: car.model, color: car.color,
        amountCents: kind === 'guest' ? Math.round(Number(amount || 0) * 100) : 0, paid: kind === 'guest' ? paid : 'na', paidVia: via, notes, status,
      }
      const j = existing
        ? await lotsApi({ action: 'booking.update', bookingId: draft!.id, patch: payload })
        : await lotsApi({ action: 'booking.create', lotId: lot.id, ...payload })
      onSaved(j.booking, j.guestyNote || null)
      onClose()
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!existing || !confirm('Delete this parking booking? Cancel keeps the record; delete removes it.')) return
    setBusy(true); setErr(null)
    try { await lotsApi({ action: 'booking.delete', bookingId: draft!.id }); onDeleted(draft!.id as string); onClose() } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }

  const spotBtn = (s: Spot) => {
    const clash = freeMap[s.id]
    const heldOff = kind === 'guest' && s.kind === 'hold'
    const on = spotId === s.id
    return (
      <button key={s.id} type="button" disabled={!s.active || heldOff || (!!clash && !on)} onClick={() => setSpotId(s.id)} aria-pressed={on}
        title={heldOff ? `Spot ${s.label} is held for staff — never sold` : clash ? `Taken: ${clash.guestName || clash.plate || clash.kind} ${dayShort(clash.startsOn)} → ${dayShort(clash.endsOn)}` : s.note || `Spot ${s.label} is free for these nights`}
        className={`min-w-[2.6rem] text-[12.5px] font-bold px-2 py-1.5 rounded-lg border tabular-nums disabled:opacity-35 disabled:cursor-not-allowed ${on ? 'bg-ink text-white border-ink' : s.kind === 'hold' ? 'bg-slate-100 text-slate-700 border-slate-200' : 'bg-white text-ink border-line hover:border-ink'}`}>
        {s.label}{clash && !on ? <span className="block text-[9px] font-semibold opacity-70">taken</span> : s.kind === 'hold' ? <span className="block text-[9px] font-semibold opacity-70">held</span> : null}
      </button>
    )
  }

  const name = kind === 'guest' ? (stay?.guest || 'Guest') : kind === 'block' ? 'Blocked spot' : (ownName.trim() || kind.charAt(0).toUpperCase() + kind.slice(1))
  return (
    <Sheet open={open} onClose={onClose} title={existing ? `Parking · ${name}` : 'Add parking'} wide
      subtitle={<>{lot.name} · {cents(lot.rateCents, lot.currency)} a night · held spots are never sold</>}
      footer={
        <div className="flex items-center gap-2">
          {existing && canFull && <button type="button" onClick={del} disabled={busy} className="text-[12px] font-semibold text-rose-700 hover:underline mr-auto">Delete</button>}
          {err && <span className="text-[12px] text-rose-700 inline-flex items-center gap-1 mr-auto"><AlertTriangle size={13} /> {err}</span>}
          <button type="button" onClick={onClose} className="text-[12.5px] font-semibold text-muted hover:text-ink px-3 py-2">Cancel</button>
          <button type="button" onClick={save} disabled={busy || !spotId} className="rounded-lg bg-brand-600 text-white text-[12.5px] font-semibold px-4 py-2 disabled:opacity-50 inline-flex items-center gap-1.5">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {existing ? 'Save' : 'Book the spot'}</button>
        </div>
      }>
      <div className="space-y-4">
        <Field label="Who"><Pick value={kind} options={KINDS} onChange={setKind} /></Field>

        {kind !== 'block' && kind !== 'guest' && (
          <div>
            <input value={ownName} onChange={e => setOwnName(e.target.value)} placeholder={kind === 'staff' ? 'Whose car — e.g. Guillermo' : kind === 'owner' ? 'Owner name' : 'Vendor / company'} className={input} />
            <p className="mt-1 text-[11px] text-muted">Type the name so the lot check can say whose car it is.</p>
          </div>
        )}
        {kind === 'guest' && (
          <div>
            {stay ? (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-app px-3 py-2 text-[13px]">
                <span className="font-semibold text-ink">{stay.guest}</span>
                {stay.unit && <span className="text-muted">· {stay.unit}</span>}
                {stay.phone && <span className="text-muted">· {stay.phone}</span>}
                {stay.id ? <Tag tone="emerald">Guesty stay</Tag> : <Tag>no stay attached</Tag>}
                <button type="button" onClick={() => setStay(null)} title="Pick someone else" className="ml-auto text-muted hover:text-ink"><X size={14} /></button>
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
                  <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Guest name, unit or confirmation code at ${lot.building}…`} className={input + ' pl-8'} />
                </div>
                <div className="mt-1.5 max-h-44 overflow-y-auto rounded-xl border border-line divide-y divide-line/70">
                  {searching && !hits ? <div className="px-3 py-2 text-[12px] text-muted"><Loader2 size={12} className="animate-spin inline mr-1" />Reading the stays…</div> : null}
                  {hits && hits.length === 0 && <div className="px-3 py-2 text-[12px] text-muted">No stay matches — check the spelling, or book it as Staff / Vendor with a name in the notes.</div>}
                  {(hits || []).slice(0, 40).map(s => {
                    const has = bookings.filter(b => b.reservationId === s.id && (b.status === 'reserved' || b.status === 'parked'))
                    return (
                      <button key={s.id} type="button" onClick={() => pickStay(s)} className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-app flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-ink">{s.guest}</span>
                        <span className="text-muted">{s.unit} · {dayShort(s.checkIn)} → {dayShort(s.checkOut)} · {s.nights}n</span>
                        {s.checkIn <= today && today < s.checkOut && <Tag tone="emerald">in house</Tag>}
                        {s.checkIn === today && <Tag tone="amber">arrives today</Tag>}
                        {has.length > 0 && <Tag tone="violet" title="This stay already has parking">has spot {spots.find(x => x.id === has[0].spotId)?.label}</Tag>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {kind !== 'block' && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Field label="Plate"><input value={car.plate} onChange={e => setCar({ ...car, plate: e.target.value.toUpperCase() })} placeholder="ABC 1234" className={input + ' font-mono font-bold tracking-wider uppercase'} /></Field>
            <Field label="State"><input value={car.plateState} onChange={e => setCar({ ...car, plateState: e.target.value.toUpperCase().slice(0, 3) })} placeholder="FL" className={input + ' uppercase'} /></Field>
            <Field label="Make"><input value={car.make} onChange={e => setCar({ ...car, make: e.target.value })} placeholder="Toyota" className={input} /></Field>
            <Field label="Model"><input value={car.model} onChange={e => setCar({ ...car, model: e.target.value })} placeholder="Camry" className={input} /></Field>
            <Field label="Color"><input value={car.color} onChange={e => setCar({ ...car, color: e.target.value })} placeholder="Black" className={input} /></Field>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 items-end">
          <Field label="First night"><input type="date" value={startsOn} onChange={e => { setStartsOn(e.target.value); if (e.target.value >= endsOn) setEndsOn(addDays(e.target.value, 1)) }} className={input} /></Field>
          <Field label="Leaves on"><input type="date" value={endsOn} min={addDays(startsOn, 1)} onChange={e => setEndsOn(e.target.value)} className={input} /></Field>
          <div className="text-[12.5px] text-muted pb-2">{nights} {nights === 1 ? 'night' : 'nights'}{kind === 'guest' ? ` · ${cents(suggested, lot.currency)} at the rate` : ''}</div>
        </div>

        <Field label="Spot" hint={kind === 'guest' ? 'numbered spots only — S-spots are held for staff' : 'held spots first'}>
          <div className="flex items-center gap-1.5 flex-wrap">{spots.filter(s => s.active || s.id === spotId).map(spotBtn)}</div>
          {!spotId && <p className="mt-1 text-[11.5px] text-rose-700">No spot is free for every one of those nights.</p>}
        </Field>

        {kind === 'guest' && (
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <Field label="Amount" hint="editable">
              <div className="relative"><span className="absolute left-2.5 top-1.5 text-[13px] text-muted">$</span><input inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value); setAmountTouched(true) }} className={input + ' pl-6 tabular-nums'} /></div>
            </Field>
            <Field label="Payment"><Pick value={paid} options={PAID} onChange={setPaid} /></Field>
            {paid === 'paid' && <Field label="Paid via"><Pick small value={via} options={VIA.map(v => ({ value: v, label: v === 'guesty' ? 'Guesty' : v.charAt(0).toUpperCase() + v.slice(1) }))} onChange={setVia} /></Field>}
          </div>
        )}

        {existing && <Field label="Status"><Pick value={status} options={STATUSES} onChange={setStatus} /></Field>}

        <Field label="Notes"><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything the lot check should know — trailer, second car, guest asked for the spot by the gate…" className={input} /></Field>
      </div>
    </Sheet>
  )
}

/** The 1-hour notice: read it, change it, send it to everyone in house. */
export function NoticeSheet({ open, onClose, lot, incident, publicCode, publicPass, staffName, onSent }: {
  open: boolean; onClose: () => void; lot: Pick<Lot, 'id' | 'name' | 'building' | 'noticeMinutes'>; incident: Incident | null
  /** When set, the sheet talks to the public lot route (the staff link) instead of /api/lots. */
  publicCode?: string; publicPass?: string; staffName?: string
  onSent: (inc: Incident, sent: number, failed: number) => void
}) {
  const [text, setText] = useState('')
  const [recipients, setRecipients] = useState<number | null>(null)
  const [inHouse, setInHouse] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const call = useCallback(async (body: Record<string, any>) => {
    if (publicCode) {
      const r = await fetch('/api/public/lot/' + encodeURIComponent(publicCode), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, pass: publicPass || '', name: staffName || '' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`)
      return j
    }
    return lotsApi(body)
  }, [publicCode, publicPass, staffName])
  useEffect(() => {
    if (!open || !incident) return
    setErr(null); setText(''); setRecipients(null)
    call({ action: 'incident.noticeText', incidentId: incident.id }).then(j => { setText(j.text || ''); setRecipients(j.recipients ?? 0); setInHouse(j.inHouse ?? 0) }).catch(e => setErr(e?.message || String(e)))
  }, [open, incident, call])
  const send = async () => {
    if (!incident) return
    setBusy(true); setErr(null)
    try {
      const j = await call({ action: 'incident.notify', incidentId: incident.id, text })
      onSent(j.incident, j.sent, j.failed)
      onClose()
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  if (!incident) return null
  const already = !!incident.noticeSentAt
  return (
    <Sheet open={open} onClose={onClose} title={already ? 'Send the notice again' : 'Send the 1-hour notice'}
      subtitle={<>{carLabel(incident)}{incident.plate ? ` · ${incident.plate}` : ''}{incident.spotLabel ? ` · spot ${incident.spotLabel}` : ''} — goes to every guest in house at {lot.building} through their Guesty thread</>}
      footer={
        <div className="flex items-center gap-2">
          {err && <span className="text-[12px] text-rose-700 inline-flex items-center gap-1 mr-auto"><AlertTriangle size={13} /> {err}</span>}
          <button type="button" onClick={onClose} className="text-[12.5px] font-semibold text-muted hover:text-ink px-3 py-2 ml-auto">Cancel</button>
          <button type="button" onClick={send} disabled={busy || !text.trim() || !recipients} className="rounded-lg bg-rose-600 text-white text-[12.5px] font-semibold px-4 py-2 disabled:opacity-50 inline-flex items-center gap-1.5">{busy ? <Loader2 size={13} className="animate-spin" /> : null} Send to {recipients ?? '…'} {recipients === 1 ? 'guest' : 'guests'}</button>
        </div>
      }>
      <div className="space-y-3">
        <p className="text-[12.5px] text-muted">
          {recipients == null ? 'Counting who is in house…' : <>{inHouse} {inHouse === 1 ? 'stay' : 'stays'} in house tonight, {recipients} with a message thread.{recipients < inHouse ? ' The rest have no Guesty conversation yet — call them.' : ''}</>}
          {already && <> Sent before at {whenET(incident.noticeSentAt as string)} to {incident.noticeSentN}; the deadline stays {incident.towDueAt ? timeET(incident.towDueAt) : '—'}.</>}
        </p>
        <textarea rows={9} value={text} onChange={e => setText(e.target.value)} className={input + ' leading-relaxed'} />
        <p className="text-[11.5px] text-muted">Sending starts the {lot.noticeMinutes === 60 ? 'one-hour' : lot.noticeMinutes + '-minute'} clock. When it runs out the tow email is drafted for the tow company automatically — a person still presses send on it.</p>
      </div>
    </Sheet>
  )
}

/** Read a photo file, downsize it on the phone, hand back base64 JPEG. */
export async function fileToJpegBase64(file: File, maxPx = 1280): Promise<{ base64: string; mime: string }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that photo.')); i.src = url })
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale))
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('No canvas.')
    ctx.drawImage(img, 0, 0, w, h)
    const data = c.toDataURL('image/jpeg', 0.85)
    return { base64: data.replace(/^data:[^,]+,/, ''), mime: 'image/jpeg' }
  } finally { URL.revokeObjectURL(url) }
}

// ── THE SCANNER (Jon, 2026-10-26: "scanner type mode, should be quick and be able to scan multiple
// and show yes confirmed, read not read, try again") ────────────────────────────────────────────
// A live camera that stays open. Tap Scan: the frame goes to the model, the answer comes back as one
// strip — green "ABC 1234 · Registered, spot 3", red "NOT registered", amber "Looks like ABC 1234?
// Yes / Retake" when the read is unsure, grey "Couldn't read — try again" — and the camera is ready
// for the next car. `scan` is what each frame means on the page that opened the scanner: a plate
// check (multi: scan car after car, flag the strangers) or a plate to fill into a form (single: the
// first confirmed read is handed back). No permission or no camera → the phone's camera app instead.
export type ScanRead = { plate: string | null; state: string | null; make: string | null; model: string | null; color: string | null; confidence: number; note: string | null }
export type ScanOutcome = {
  read: ScanRead | null
  /** What to show under the plate: the verdict line, with a tone. Absent in single mode. */
  verdict?: { tone: 'ok' | 'bad' | 'warn'; title: string; note?: string } | null
  /** An action offered on the strip (multi mode): "Flag this car", "Register it". */
  actions?: { label: string; tone: 'bad' | 'muted'; run: () => Promise<string> }[]
}
export function Scanner({ open, onClose, title, mode, scan, onPick }: {
  open: boolean; onClose: () => void; title: string
  /** multi: keep scanning, list the results. single: hand back the first confirmed read and close. */
  mode: 'multi' | 'single'
  /** Reads (and, in multi mode, judges) one frame. `plate` set = the person typed or confirmed it. */
  scan: (photo: { base64: string; mime: string } | null, plate?: string) => Promise<ScanOutcome>
  onPick?: (read: ScanRead, photo: { base64: string; mime: string } | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cam, setCam] = useState<'starting' | 'on' | 'off'>('starting')
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState('')
  type ScanItem = { id: number; photo: { base64: string; mime: string } | null; out: ScanOutcome; status: 'ok' | 'unsure' | 'unreadable'; done?: string }
  const [results, setResults] = useState<ScanItem[]>([])
  const [flash, setFlash] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    let alive = true
    setCam('starting'); setResults([]); setTyped('')
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera api')
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => null) }
        setCam('on')
      } catch { if (alive) setCam('off') }
    })()
    return () => { alive = false; streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }, [open])

  const snap = (): { base64: string; mime: string } | null => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale)
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, c.width, c.height)
    return { base64: c.toDataURL('image/jpeg', 0.85).replace(/^data:[^,]+,/, ''), mime: 'image/jpeg' }
  }
  const run = async (photo: { base64: string; mime: string } | null, plate?: string) => {
    setBusy(true); setFlash(true); setTimeout(() => setFlash(false), 120)
    try {
      const out = await scan(photo, plate)
      const status: 'ok' | 'unsure' | 'unreadable' = !out.read?.plate ? 'unreadable' : (out.read.confidence < 0.7 && !plate) ? 'unsure' : 'ok'
      if (mode === 'single' && status === 'ok' && out.read) { onPick?.(out.read, photo); onClose(); return }
      const item: ScanItem = { id: ++seq.current, photo, out, status }
      setResults(r => [item].concat(r).slice(0, 30))
    } catch (e: any) {
      const item: ScanItem = { id: ++seq.current, photo, out: { read: null, verdict: { tone: 'warn', title: 'Could not scan', note: e?.message || String(e) } }, status: 'unreadable' }
      setResults(r => [item].concat(r).slice(0, 30))
    } finally { setBusy(false) }
  }
  const confirm = (item: ScanItem) => { if (item.out.read?.plate) run(item.photo, item.out.read.plate) }
  const act = async (item: ScanItem, a: NonNullable<ScanOutcome['actions']>[number]) => {
    try { const done = await a.run(); setResults(r => r.map(x => x.id === item.id ? { ...x, done } : x)) } catch (e: any) { setResults(r => r.map(x => x.id === item.id ? { ...x, done: e?.message || String(e) } : x)) }
  }
  if (!open) return null
  const toneCls = (t: 'ok' | 'bad' | 'warn' | 'grey') => t === 'ok' ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : t === 'bad' ? 'border-rose-400 bg-rose-50 text-rose-900' : t === 'warn' ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-neutral-300 bg-neutral-100 text-neutral-700'
  const scanned = results.filter(r => r.status === 'ok').length
  return (
    <div className="fixed inset-0 z-[80] bg-black text-white flex flex-col">
      <div className="flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold truncate">{title}</div>
          <div className="text-[12px] text-white/70">{mode === 'multi' ? `${scanned} scanned` : 'Point at the plate and tap Scan'}</div>
        </div>
        <button onClick={onClose} aria-label="Close the scanner" className="rounded-full bg-white/15 p-2"><X size={18} /></button>
      </div>
      <div className="relative bg-black" style={{ height: '42vh' }}>
        {cam !== 'off' && <video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover" />}
        {cam === 'starting' && <div className="absolute inset-0 flex items-center justify-center text-[14px] text-white/80"><Loader2 size={16} className="animate-spin mr-2" /> Starting the camera…</div>}
        {cam === 'off' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-[14px] text-white/80">
            <span>The camera could not be opened here — allow camera access for this site, or use the phone's camera app:</span>
            <CameraButton onPhoto={p => run(p)} busy={busy} label={busy ? 'Reading…' : 'Take a photo'} />
          </div>
        )}
        {cam === 'on' && <div className="pointer-events-none absolute inset-x-[12%] top-[28%] bottom-[28%] rounded-xl border-2 border-white/70" />}
        {flash && <div className="absolute inset-0 bg-white/80" />}
      </div>
      <div className="px-4 py-3 flex items-center gap-2">
        {cam === 'on' && <button onClick={() => { const p = snap(); if (p) run(p) }} disabled={busy} className="flex-1 rounded-2xl bg-white text-black py-4 text-[17px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60">{busy ? <><Loader2 size={18} className="animate-spin" /> Reading…</> : <><Camera size={18} /> Scan</>}</button>}
        <form onSubmit={e => { e.preventDefault(); if (normalizePlate(typed)) { run(null, typed); setTyped('') } }} className="flex items-center gap-1">
          <input value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} placeholder="or type it" autoCapitalize="characters" autoCorrect="off" className="w-32 rounded-xl bg-white/10 border border-white/20 px-3 py-3 text-[15px] font-mono font-bold tracking-wider uppercase placeholder:text-white/40 placeholder:font-sans placeholder:tracking-normal focus:outline-none" />
          <button type="submit" disabled={busy || !normalizePlate(typed)} className="rounded-xl bg-white/15 px-3 py-3 text-[14px] font-bold disabled:opacity-40">Go</button>
        </form>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2">
        {results.length === 0 && <p className="text-[13px] text-white/60 text-center pt-2">{mode === 'multi' ? 'Each scan shows up here: confirmed, not registered, or try again.' : 'The first clear read fills the form.'}</p>}
        {results.map(item => {
          const r = item.out.read
          const v = item.out.verdict
          const tone: 'ok' | 'bad' | 'warn' | 'grey' = item.status === 'unreadable' ? 'grey' : item.status === 'unsure' ? 'warn' : (v?.tone || 'ok')
          return (
            <div key={item.id} className={`rounded-2xl border-2 px-3 py-2.5 ${toneCls(tone)}`}>
              {item.status === 'unreadable' && <div className="text-[15px] font-bold">Couldn't read a plate — try again<span className="block text-[12.5px] font-normal mt-0.5">{item.out.read?.note || item.out.verdict?.note || 'Get closer, straight on, plate inside the frame.'}</span></div>}
              {item.status === 'unsure' && r && (
                <div>
                  <div className="text-[15px] font-bold">Looks like <span className="font-mono">{r.plate}</span> — not sure{r.note ? <span className="block text-[12.5px] font-normal mt-0.5">{r.note}</span> : null}</div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => confirm(item)} disabled={busy} className="flex-1 rounded-xl bg-neutral-900 text-white py-2.5 text-[14px] font-bold disabled:opacity-50"><Check size={15} className="inline -mt-0.5 mr-1" />Yes, that's it</button>
                    <button onClick={() => setResults(rs => rs.filter(x => x.id !== item.id))} className="flex-1 rounded-xl bg-white text-neutral-900 border border-neutral-300 py-2.5 text-[14px] font-bold">Retake</button>
                  </div>
                </div>
              )}
              {item.status === 'ok' && r && (
                <div>
                  <div className="text-[17px] font-bold"><span className="font-mono">{r.plate}</span>{(r.make || r.model || r.color) && <span className="text-[13px] font-semibold opacity-80"> · {[r.color, r.make, r.model].filter(Boolean).join(' ')}</span>}</div>
                  {v && <div className="text-[14px] font-bold mt-0.5">{v.tone === 'ok' ? '✓ ' : v.tone === 'bad' ? '✗ ' : '⚠ '}{v.title}{v.note ? <span className="block text-[12.5px] font-normal">{v.note}</span> : null}</div>}
                  {item.done ? <div className="mt-1.5 text-[13px] font-semibold">{item.done}</div> : item.out.actions && item.out.actions.length > 0 && (
                    <div className="mt-2 flex gap-2">{item.out.actions.map(a => <button key={a.label} onClick={() => act(item, a)} className={`flex-1 rounded-xl py-2.5 text-[14px] font-bold ${a.tone === 'bad' ? 'bg-rose-600 text-white' : 'bg-white text-neutral-900 border border-neutral-300'}`}>{a.label}</button>)}</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CameraButton({ onPhoto, busy, label = 'Scan plate' }: { onPhoto: (p: { base64: string; mime: string }) => void; busy?: boolean; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={async e => {
        const f = e.target.files && e.target.files[0]
        e.target.value = ''
        if (!f) return
        try { onPhoto(await fileToJpegBase64(f)) } catch { /* the caller shows its own error */ }
      }} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-ink hover:bg-app disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />} {label}
      </button>
    </>
  )
}
