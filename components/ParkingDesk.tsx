'use client'
// PARKING (Jon, 2026-10-26): "a Parking management tab for Eden and other properties, we have 10
// spots, it's $30 per day, and we need to be able to track make and model and the parking spot
// they reserved, so we can enforce and tow … calendar view … 3 extra for space and for our staff,
// never sell."
//
// Four views on one lot: the CALENDAR (spots × nights — the main screen), TONIGHT (the lot as a
// list), FLAGS (the cars that should not be there and where each one is in the notice → tow
// chain) and SETTINGS (price, tow company, spots, the staff link). Held spots sit under the
// numbered ones, shaded, and the booking form will not sell them.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2, RefreshCw, Plus, ChevronLeft, ChevronRight, Search, Flag, Mail, Truck, Check, X, Copy, Link2, AlertTriangle, Pencil, RotateCw, Car, MapPinOff } from 'lucide-react'
import { LeanHead, Pill, Tag, IconBtn, LeanList, LeanRow, LeanSection, LeanEmpty, LeanTabs, Tip } from '@/components/lean'
import { BookingSheet, NoticeSheet, Pick, lotsApi, todayET, dayShort, whenET, timeET, type BookingDraft } from '@/components/ParkingSheets'
import { addDays, nightsBetween, cents, carLabel, tidyPlate } from '@/lib/plate'
import type { Booking, Spot, Lot, Incident, Sweep, IncidentStatus, LotOverview } from '@/lib/parking-lots'

type StaffLink = { code: string; hasPasscode: boolean; passcode: string | null; derived: boolean }
type Bundle = { lot: Lot; spots: Spot[]; bookings: Booking[]; incidents: Incident[]; lastSweep: Sweep | null; today: string; from: string; to: string; lots: Lot[]; overview: LotOverview[]; staffLink: StaffLink | null; can: { edit: boolean; full: boolean }; buildings: string[] }
type TabKey = 'calendar' | 'tonight' | 'flags' | 'settings'

const WINDOWS = [7, 14, 30]
const weekday = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })
const dayNum = (ymd: string) => new Date(ymd + 'T12:00:00').getDate()
const monthShort = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })
const lastName = (s: string | null) => { const p = String(s || '').trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : p[0] || '' }
const OPEN: IncidentStatus[] = ['open', 'notified', 'tow_drafted']

const INC_STATUS: Record<IncidentStatus, { label: string; tone: 'rose' | 'amber' | 'violet' | 'slate' | 'emerald' | 'sky' }> = {
  open: { label: 'Flagged', tone: 'rose' }, notified: { label: 'Notice sent', tone: 'amber' }, tow_drafted: { label: 'Tow email drafted', tone: 'violet' },
  towed: { label: 'Towed', tone: 'slate' }, resolved: { label: 'Resolved', tone: 'emerald' }, dismissed: { label: 'Dismissed', tone: 'slate' },
}
const INC_KIND: Record<string, string> = { unregistered: 'Not registered', wrong_spot: 'Wrong spot', staff_in_sell: 'Staff car in a sold spot', blocking: 'Blocking', other: 'Other' }

export function ParkingDesk() {
  const today = useMemo(() => todayET(), [])
  const [lotId, setLotId] = useState<string>('')
  const [data, setData] = useState<Bundle | null>(null)
  const [lots, setLots] = useState<Lot[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('calendar')
  const [start, setStart] = useState(addDays(today, -1))
  const [days, setDays] = useState(14)
  const [sheet, setSheet] = useState<BookingDraft | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [notice, setNotice] = useState<Incident | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [plateQ, setPlateQ] = useState('')
  const [plateV, setPlateV] = useState<any | null>(null)
  // What the lots-only read says when there is no lot to open yet (who may make one, for which buildings).
  const [noLot, setNoLot] = useState<{ can: { edit: boolean; full: boolean }; buildings: string[] } | null>(null)
  const [overview, setOverview] = useState<LotOverview[]>([])
  const [staffLink, setStaffLink] = useState<StaffLink | null>(null)

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 6000) }
  const from = addDays(start, -1), to = addDays(start, days + 1)

  const load = useCallback(async (id: string, quiet = false) => {
    if (!quiet) setLoading(true)
    setErr(null)
    try {
      const r = await fetch(id ? `/api/lots?lot=${encodeURIComponent(id)}&from=${from}&to=${to}` : '/api/lots', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`)
      setOverview(j.overview || []); setStaffLink(j.staffLink || null)
      if (!id) {
        setLots(j.lots || [])
        const first = (j.lots || [])[0]
        if (first) setLotId(first.id); else { setData(null); setNoLot({ can: j.can || { edit: false, full: false }, buildings: j.buildings || [] }); setLoading(false) }
        return
      }
      setLots(j.lots || [])
      setData(j)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [from, to])

  // Once, on open: the lot in the URL, else the first lot. (Not re-run when the window moves —
  // that would snap the page back to the first lot.)
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    try { const q = new URLSearchParams(window.location.search).get('lot'); if (q) { setLotId(q); return } } catch {}
    load('')
  }, [load])
  useEffect(() => { if (lotId) load(lotId) }, [lotId, load])

  // "Check a plate" — the front desk's question, answered as they type.
  const plateTimer = useRef<any>(null)
  useEffect(() => {
    clearTimeout(plateTimer.current)
    if (!lotId || tidyPlate(plateQ).length < 2) { setPlateV(null); return }
    plateTimer.current = setTimeout(async () => {
      try { const r = await fetch(`/api/lots?lot=${encodeURIComponent(lotId)}&plate=${encodeURIComponent(plateQ)}`, { cache: 'no-store' }); setPlateV(await r.json()) } catch { setPlateV(null) }
    }, 350)
    return () => clearTimeout(plateTimer.current)
  }, [plateQ, lotId])

  const lot = data?.lot
  const spots = data?.spots || []
  const bookings = data?.bookings || []
  const incidents = data?.incidents || []
  const can = data?.can || noLot?.can || { edit: false, full: false }

  // Tonight's numbers for the header.
  const tonight = useMemo(() => {
    const live = bookings.filter(b => (b.status === 'reserved' || b.status === 'parked') && b.startsOn <= today && today < b.endsOn)
    const sell = spots.filter(s => s.kind === 'sell' && s.active)
    const sold = live.filter(b => b.kind === 'guest' && spots.find(s => s.id === b.spotId)?.kind === 'sell')
    const unpaid = bookings.filter(b => b.kind === 'guest' && b.paid === 'unpaid' && (b.status === 'reserved' || b.status === 'parked') && b.endsOn >= today)
    const revenue = sold.reduce((a, b) => a + (b.nights ? b.amountCents / b.nights : 0), 0)
    return { live, sell: sell.length, sold: sold.length, unpaid, revenue }
  }, [bookings, spots, today])
  const openFlags = incidents.filter(i => OPEN.indexOf(i.status) >= 0)

  const openNew = (d: BookingDraft = {}) => { setSheet(d); setSheetOpen(true) }
  const openBooking = (b: Booking) => { setSheet(b); setSheetOpen(true) }
  const onSaved = (b: Booking, note: string | null) => {
    setData(d => d ? { ...d, bookings: d.bookings.some(x => x.id === b.id) ? d.bookings.map(x => x.id === b.id ? b : x) : d.bookings.concat([b]) } : d)
    say(note === 'ok' ? `Saved — noted on the reservation in Guesty.` : note ? `Saved. Guesty note not written: ${note}` : 'Saved.')
  }
  const onDeleted = (id: string) => { setData(d => d ? { ...d, bookings: d.bookings.filter(x => x.id !== id) } : d); say('Deleted.') }
  const patchIncident = (inc: Incident) => setData(d => d ? { ...d, incidents: d.incidents.some(x => x.id === inc.id) ? d.incidents.map(x => x.id === inc.id ? { ...x, ...inc, photoUrl: inc.photoUrl ?? x.photoUrl } : x) : [inc].concat(d.incidents) } : d)

  const incAction = async (inc: Incident, body: Record<string, any>, done: string) => {
    try { const j = await lotsApi({ ...body, incidentId: inc.id }); if (j.incident) patchIncident(j.incident); say(done) } catch (e: any) { say(e?.message || String(e)) }
  }
  const draftTow = async (inc: Incident) => {
    try { const j = await lotsApi({ action: 'incident.tow', incidentId: inc.id }); if (j.incident) patchIncident(j.incident); say(`Tow email drafted to ${j.preview?.to} — open Gmail Drafts to send it.`) }
    catch (e: any) { say(e?.message || String(e)) }
  }
  const flagPlate = async () => {
    if (!lot || !plateV?.plate) return
    try {
      const j = await lotsApi({ action: 'incident.open', lotId: lot.id, plate: plateV.plate, kind: plateV.verdict === 'wrong_spot' ? 'wrong_spot' : plateV.verdict === 'staff_in_sell' ? 'staff_in_sell' : 'unregistered', bookingId: plateV.booking?.id || null })
      patchIncident(j.incident); setTab('flags'); setPlateQ(''); setPlateV(null); say('Flagged — send the notice from Flags.')
    } catch (e: any) { say(e?.message || String(e)) }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const link = lot ? `${origin}/lot/${lot.shareCode}` : ''
  const allLink = staffLink ? `${origin}/lot/${staffLink.code}` : ''
  const copy = async (s: string, m: string) => { try { await navigator.clipboard.writeText(s); say(m) } catch { say('Could not copy — select it by hand.') } }

  return (
    <div>
      <LeanHead title="Parking" sub={lot ? <>{lot.name} · {lot.rateCents > 0 ? `${cents(lot.rateCents, lot.currency)} a night` : 'included with the stay, one space per reservation'} · {tonight.sell} {lot.rateCents > 0 ? 'sellable' : 'guest'} spots{spots.some(s => s.kind === 'hold') ? ` · ${spots.filter(s => s.kind === 'hold' && s.active).length} held for staff, never sold` : ''}</> : undefined}>
        {lot && <>
          <Pill tone={tonight.sold >= tonight.sell && tonight.sell > 0 ? 'rose' : 'brand'} title="Numbered spots taken by guests tonight" onClick={() => setTab('tonight')}>{tonight.sold}/{tonight.sell} {lot.rateCents > 0 ? 'sold' : 'taken'} tonight</Pill>
          {lot.rateCents > 0 && <Pill tone="emerald" title="Tonight's parking revenue (each booking's amount spread over its nights)">{cents(tonight.revenue, lot.currency)} tonight</Pill>}
          {tonight.unpaid.length > 0 && <Pill tone="amber" title="Guest bookings still unpaid" onClick={() => setTab('tonight')}>{tonight.unpaid.length} unpaid</Pill>}
          <Pill tone={openFlags.length ? 'rose' : 'slate'} title="Cars flagged in the lot that are not closed out" onClick={() => setTab('flags')}>{openFlags.length} {openFlags.length === 1 ? 'flag' : 'flags'}</Pill>
          {can.edit && <button onClick={() => openNew()} className="rounded-lg bg-brand-600 text-white text-[12px] font-semibold px-3 py-1.5 inline-flex items-center gap-1"><Plus size={13} /> Add parking</button>}
        </>}
      </LeanHead>

      {/* EVERY LOT AT A GLANCE (Jon, 2026-10-29: "a visual of all properties … see by lot / properties"). */}
      {overview.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {overview.map(o => <LotCard key={o.lot.id} o={o} selected={o.lot.id === lotId} onPick={() => { setLotId(o.lot.id); setTab('calendar'); try { history.replaceState(null, '', `?lot=${o.lot.id}`) } catch {} }} />)}
        </div>
      )}

      {/* LOT SWITCH + CHECK A PLATE — one line. */}
      <div className="mb-3 flex items-center gap-1.5 flex-wrap">
        {lots.map(l => (
          <button key={l.id} onClick={() => { setLotId(l.id); try { history.replaceState(null, '', `?lot=${l.id}`) } catch {} }} aria-pressed={l.id === lotId}
            className={'text-[11.5px] font-semibold px-2.5 py-1 rounded-full border ' + (l.id === lotId ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{l.building}</button>
        ))}
        {can.full && <button onClick={() => setTab('settings')} title="Set up a lot for another building" className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full border border-dashed border-line text-muted hover:text-ink">+ lot</button>}
        {lot && (
          <span className="ml-auto relative">
            <Search size={13} className="absolute left-2.5 top-2 text-muted" />
            <input value={plateQ} onChange={e => setPlateQ(e.target.value.toUpperCase())} placeholder="Check a plate…" className="text-[12.5px] font-mono uppercase tracking-wider bg-white border border-line rounded-lg pl-7 pr-2 py-1 w-44 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </span>
        )}
        <button onClick={() => load(lotId, true)} title="Refresh" className="text-muted hover:text-ink"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {plateV && plateV.plateNorm && (
        <div className={`mb-3 rounded-xl border px-3 py-2 text-[12.5px] flex items-center gap-2 flex-wrap ${plateV.verdict === 'ok' || plateV.verdict === 'leaving_today' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : plateV.verdict === 'unregistered' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <span className="font-mono font-bold">{plateV.plate}</span>
          <span>{plateV.note}</span>
          {plateV.booking && <button onClick={() => openBooking(plateV.booking)} className="font-semibold underline">open booking</button>}
          {plateV.near?.length > 0 && plateV.near.map((n: any) => <button key={n.booking.id} onClick={() => openBooking(n.booking)} className="font-semibold underline">{n.booking.plate} → {n.booking.guestName || n.booking.kind}</button>)}
          {can.edit && plateV.verdict !== 'ok' && plateV.verdict !== 'leaving_today' && <button onClick={flagPlate} className="ml-auto inline-flex items-center gap-1 rounded-lg bg-rose-600 text-white px-2.5 py-1 text-[12px] font-semibold"><Flag size={12} /> Flag it</button>}
          {can.edit && plateV.verdict === 'unregistered' && <button onClick={() => openNew({ plate: plateV.plate })} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink"><Plus size={12} /> Register it</button>}
          <button onClick={() => { setPlateQ(''); setPlateV(null) }} className="text-muted hover:text-ink"><X size={13} /></button>
        </div>
      )}

      {err && <p className="mb-2 text-[12.5px] text-rose-700 inline-flex items-center gap-1"><AlertTriangle size={13} /> {err}</p>}
      {toast && <div className="fixed bottom-4 right-4 z-[60] rounded-xl bg-ink text-white text-[12.5px] px-3.5 py-2 shadow-lg max-w-sm">{toast}</div>}
      {loading && !data && <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1.5" />Reading the lot…</LeanEmpty>}
      {!loading && !lot && !err && (
        can.full
          ? <NewLot buildings={data?.buildings || noLot?.buildings || []} onMade={(l) => { setLots(x => x.concat([l])); setLotId(l.id); setTab('calendar'); say(`${l.name} is set up.`) }} />
          : <LeanEmpty>No lot yet — a manager with full access on Parking sets one up here.</LeanEmpty>
      )}

      {lot && (
        <>
          <LeanTabs<TabKey> value={tab} onChange={setTab} tabs={[
            { key: 'calendar', label: 'Calendar' },
            { key: 'tonight', label: 'Tonight', n: tonight.live.length },
            { key: 'flags', label: 'Flags', n: openFlags.length },
            { key: 'settings', label: 'Settings' },
          ]} right={tab === 'calendar' ? (
            <span className="inline-flex items-center gap-1 text-[11.5px]">
              <button onClick={() => setStart(addDays(start, -7))} title="Earlier" className="rounded-lg border border-line bg-white p-1 text-muted hover:text-ink"><ChevronLeft size={13} /></button>
              <button onClick={() => setStart(addDays(today, -1))} className="rounded-lg border border-line bg-white px-2 py-1 font-semibold text-muted hover:text-ink">Today</button>
              <button onClick={() => setStart(addDays(start, 7))} title="Later" className="rounded-lg border border-line bg-white p-1 text-muted hover:text-ink"><ChevronRight size={13} /></button>
              <input type="date" value={start} onChange={e => e.target.value && setStart(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-[11.5px]" />
              {WINDOWS.map(n => <button key={n} onClick={() => setDays(n)} aria-pressed={days === n} className={'font-semibold px-2 py-1 rounded-full border ' + (days === n ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{n}d</button>)}
            </span>
          ) : null} />

          {tab === 'calendar' && <Calendar lot={lot} spots={spots} bookings={bookings} start={start} days={days} today={today} canEdit={can.edit} onCell={(spotId, day) => openNew({ spotId, startsOn: day, endsOn: addDays(day, 1), kind: spots.find(s => s.id === spotId)?.kind === 'hold' ? 'staff' : 'guest' })} onBar={openBooking} />}
          {tab === 'tonight' && <Tonight lot={lot} spots={spots} bookings={bookings} incidents={openFlags} today={today} canEdit={can.edit} onBooking={openBooking} onNew={openNew} link={allLink || link} onCopy={copy} lastSweep={data?.lastSweep || null} />}
          {tab === 'flags' && <Flags lot={lot} incidents={incidents} spots={spots} canEdit={can.edit} onNotice={inc => setNotice(inc)} onTow={draftTow} onClose={(inc, how, res) => incAction(inc, { action: 'incident.close', how, resolution: res }, how === 'reopen' ? 'Reopened.' : how === 'towed' ? 'Marked towed.' : 'Closed.')} onRegister={inc => openNew({ plate: inc.plate || '', make: inc.make || '', model: inc.model || '', color: inc.color || '', plateState: inc.plateState || '', spotId: inc.spotId || null })} onNote={(inc, notes) => incAction(inc, { action: 'incident.note', notes }, 'Note saved.')} />}
          {tab === 'settings' && <Settings lot={lot} spots={spots} can={can} buildings={data?.buildings || []} link={link} allLink={allLink} staffLink={staffLink} onStaffLink={setStaffLink} onCopy={copy} onLot={(l) => { setData(d => d ? { ...d, lot: l } : d); setLots(ls => ls.map(x => x.id === l.id ? l : x)) }} onSpots={(ss) => setData(d => d ? { ...d, spots: ss } : d)} onMade={(l) => { setLots(x => x.concat([l])); setLotId(l.id); setTab('calendar'); say(`${l.name} is set up.`) }} say={say} />}

          <BookingSheet open={sheetOpen} onClose={() => setSheetOpen(false)} lot={lot} spots={spots} bookings={bookings} draft={sheet} canFull={can.full} onSaved={onSaved} onDeleted={onDeleted} />
          <NoticeSheet open={!!notice} onClose={() => setNotice(null)} lot={lot} incident={notice} onSent={(inc, sent, failed) => { patchIncident(inc); say(`Notice sent to ${sent} ${sent === 1 ? 'guest' : 'guests'}${failed ? `, ${failed} failed` : ''}. Tow email drafts itself at ${inc.towDueAt ? timeET(inc.towDueAt) : 'the deadline'}.`) }} />
        </>
      )}
    </div>
  )
}

// ── THE CALENDAR: spots down, nights across ─────────────────────────────────────────────────────
function Calendar({ lot, spots, bookings, start, days, today, canEdit, onCell, onBar }: {
  lot: Lot; spots: Spot[]; bookings: Booking[]; start: string; days: number; today: string; canEdit: boolean
  onCell: (spotId: string, day: string) => void; onBar: (b: Booking) => void
}) {
  const cols = useMemo(() => { const out: string[] = []; for (let i = 0; i < days; i++) out.push(addDays(start, i)); return out }, [start, days])
  const end = addDays(start, days)
  const sell = spots.filter(s => s.kind === 'sell' && s.active)
  const hold = spots.filter(s => s.kind === 'hold' && s.active)
  const colTpl = `repeat(${days}, minmax(${days > 14 ? 34 : 46}px, 1fr))`
  // Nights sold per column, for the strip under the header.
  const soldPer = cols.map(d => bookings.filter(b => b.kind === 'guest' && (b.status === 'reserved' || b.status === 'parked') && b.startsOn <= d && d < b.endsOn && sell.some(s => s.id === b.spotId)).length)

  const row = (s: Spot) => {
    const mine = bookings.filter(b => b.spotId === s.id && b.status !== 'cancelled' && b.status !== 'no_show' && b.startsOn < end && b.endsOn > start)
    return (
      <div key={s.id} className={`grid items-stretch border-t border-line/70 ${s.kind === 'hold' ? 'bg-slate-50/70' : ''}`} style={{ gridTemplateColumns: `6.5rem ${colTpl}` }}>
        <div className="px-2 py-1 flex items-center gap-1.5 min-w-0 border-r border-line/70">
          <span className="text-[12.5px] font-bold tabular-nums text-ink">{s.label}</span>
          {s.kind === 'hold' ? <Tag title={s.note || 'Held for staff — never sold'}>held</Tag> : null}
          {s.note && s.kind !== 'hold' ? <span className="text-[10.5px] text-muted truncate" title={s.note}>{s.note}</span> : null}
        </div>
        <div className="grid relative" style={{ gridTemplateColumns: colTpl, gridColumn: '2 / -1' }}>
          {cols.map((d, i) => (
            <button key={d} type="button" disabled={!canEdit} onClick={() => onCell(s.id, d)} title={canEdit ? `Book spot ${s.label} from ${dayShort(d)}` : ''}
              className={`h-9 border-l border-line/40 ${d === today ? 'bg-brand-50/60' : ''} ${canEdit ? 'hover:bg-brand-50' : ''}`} style={{ gridColumn: i + 1, gridRow: 1 }} />
          ))}
          {mine.map(b => {
            const s0 = b.startsOn < start ? 0 : nightsBetween(start, b.startsOn)
            const e0 = Math.min(days, nightsBetween(start, b.endsOn))
            if (e0 <= s0) return null
            return <Bar key={b.id} b={b} lot={lot} col={`${s0 + 1} / ${e0 + 1}`} clipL={b.startsOn < start} clipR={b.endsOn > end} onClick={() => onBar(b)} />
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="lh-hscroll overflow-x-auto rounded-2xl border border-line bg-white">
      <div className="min-w-[720px]">
        <div className="grid" style={{ gridTemplateColumns: `6.5rem ${colTpl}` }}>
          <div className="px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted border-r border-line/70">Spot</div>
          {cols.map((d, i) => (
            <div key={d} className={`px-1 py-1 text-center border-l border-line/40 ${d === today ? 'bg-brand-50/60' : ''}`}>
              <div className={`text-[10px] uppercase tracking-wide ${d === today ? 'text-brand-700 font-bold' : 'text-muted'}`}>{weekday(d)}</div>
              <div className={`text-[12.5px] font-bold tabular-nums leading-none ${d === today ? 'text-brand-700' : 'text-ink'}`}>{dayNum(d)}{(i === 0 || dayNum(d) === 1) ? <span className="text-[9px] font-semibold text-muted ml-0.5">{monthShort(d)}</span> : null}</div>
              <div className={`text-[9.5px] tabular-nums mt-0.5 ${soldPer[i] >= sell.length && sell.length ? 'text-rose-700 font-bold' : 'text-muted'}`} title="Sold / sellable that night">{soldPer[i]}/{sell.length}</div>
            </div>
          ))}
        </div>
        {sell.map(row)}
        {hold.length > 0 && (
          <div className="grid border-t border-line" style={{ gridTemplateColumns: `6.5rem ${colTpl}` }}>
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 border-r border-line/70 bg-slate-50/70" style={{ gridColumn: '1 / -1' }}>Held — staff &amp; buffer, never sold</div>
          </div>
        )}
        {hold.map(row)}
        {!spots.length && <LeanEmpty>No spots yet — add them under Settings.</LeanEmpty>}
      </div>
      <div className="px-3 py-1.5 text-[11px] text-muted flex items-center gap-3 flex-wrap border-t border-line/70">
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-200 align-middle mr-1" />paid</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-200 align-middle mr-1" />unpaid</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-200 align-middle mr-1" />comped</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-300 align-middle mr-1" />staff / owner / vendor</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm border border-dashed border-rose-400 align-middle mr-1" />blocked</span>
        <span className="ml-auto">● = car seen in the spot · click an empty night to book it · click a bar to open it</span>
      </div>
    </div>
  )
}

function Bar({ b, lot, col, clipL, clipR, onClick }: { b: Booking; lot: Lot; col: string; clipL: boolean; clipR: boolean; onClick: () => void }) {
  const tone = b.kind === 'block' ? 'bg-rose-50 text-rose-800 border-dashed border-rose-300'
    : b.kind !== 'guest' ? 'bg-slate-200 text-slate-800 border-slate-300'
      : b.paid === 'paid' ? 'bg-emerald-100 text-emerald-900 border-emerald-200'
        : b.paid === 'comped' ? 'bg-sky-100 text-sky-900 border-sky-200'
          : 'bg-amber-100 text-amber-900 border-amber-200'
  const faded = b.status === 'left' ? 'opacity-45' : ''
  const who = b.kind === 'block' ? 'Blocked' : b.kind === 'guest' ? (lastName(b.guestName) || 'Guest') : (b.guestName ? `${lastName(b.guestName)} · ${b.kind}` : b.kind)
  const title = [b.guestName || b.kind, b.unit, carLabel(b) + (b.plate ? ' · ' + b.plate : ''), `${dayShort(b.startsOn)} → ${dayShort(b.endsOn)} · ${b.nights}n`, b.kind === 'guest' ? `${cents(b.amountCents, lot.currency)} · ${b.paid}${b.paidVia ? ' via ' + b.paidVia : ''}` : '', b.status].filter(Boolean).join('\n')
  return (
    <button type="button" onClick={onClick} title={title} style={{ gridColumn: col, gridRow: 1, zIndex: 1 }}
      className={`my-1 mx-px px-1.5 text-left text-[11px] leading-tight font-semibold border rounded-md overflow-hidden whitespace-nowrap ${tone} ${faded} ${clipL ? 'rounded-l-none border-l-0' : ''} ${clipR ? 'rounded-r-none border-r-0' : ''}`}>
      {b.status === 'parked' ? <span className="mr-0.5">●</span> : null}{who}{b.plate ? <span className="font-mono font-normal opacity-80"> {b.plate}</span> : null}{b.unit && b.kind === 'guest' ? <span className="font-normal opacity-70"> · {b.unit}</span> : null}
    </button>
  )
}

// ── TONIGHT: the lot as a list ──────────────────────────────────────────────────────────────────
function Tonight({ lot, spots, bookings, incidents, today, canEdit, onBooking, onNew, link, onCopy, lastSweep }: {
  lot: Lot; spots: Spot[]; bookings: Booking[]; incidents: Incident[]; today: string; canEdit: boolean
  onBooking: (b: Booking) => void; onNew: (d: BookingDraft) => void; link: string; onCopy: (s: string, m: string) => void; lastSweep: Sweep | null
}) {
  const live = bookings.filter(b => (b.status === 'reserved' || b.status === 'parked') && b.startsOn <= today && today <= b.endsOn)
  const arriving = bookings.filter(b => (b.status === 'reserved') && b.startsOn === addDays(today, 1))
  const row = (s: Spot) => {
    const here = live.filter(b => b.spotId === s.id).sort((a, b) => (a.endsOn === today ? 1 : 0) - (b.endsOn === today ? 1 : 0))
    const b = here[0] || null
    const next = here[1] || null
    if (!b) return (
      <LeanRow key={s.id} lead={<SpotChip s={s} />} name={<span className="text-muted font-medium">free tonight</span>}
        meta={s.kind === 'hold' ? 'held for staff — never sold' : undefined}
        actions={canEdit ? <IconBtn title={`Book spot ${s.label} tonight`} onClick={() => onNew({ spotId: s.id, startsOn: today, endsOn: addDays(today, 1), kind: s.kind === 'hold' ? 'staff' : 'guest' })}><Plus size={14} /></IconBtn> : undefined} />
    )
    return (
      <LeanRow key={s.id} lead={<SpotChip s={s} />} name={<>{carLabel(b)}{b.plate ? <span className="font-mono text-[12px] text-muted font-semibold ml-1.5">{b.plate}</span> : null}</>}
        meta={<>{b.guestName || b.kind}{b.unit ? ` · ${b.unit}` : ''} · {dayShort(b.startsOn)} → {dayShort(b.endsOn)}</>}
        tags={<>
          {b.endsOn === today ? <Tag tone="amber" title="Leaves this morning — the spot is sold again from tonight">leaving today</Tag> : null}
          {b.status === 'parked' ? <Tag tone="emerald">parked</Tag> : <Tag>reserved</Tag>}
          {b.kind === 'guest' ? <Tag tone={b.paid === 'paid' ? 'emerald' : b.paid === 'comped' || b.paid === 'na' ? 'sky' : 'rose'}>{b.paid === 'paid' ? `paid ${cents(b.amountCents, lot.currency)}` : b.paid === 'comped' ? 'comped' : b.paid === 'na' ? 'included' : `${cents(b.amountCents, lot.currency)} unpaid`}</Tag> : <Tag>{b.kind}</Tag>}
          {next ? <Tag tone="violet" title={`${next.guestName || next.kind} arrives tonight`}>then {lastName(next.guestName) || next.kind}</Tag> : null}
        </>}
        actions={<IconBtn title="Open the booking" onClick={() => onBooking(b)}><Pencil size={14} /></IconBtn>} />
    )
  }
  return (
    <div>
      <div className="mb-3 rounded-2xl border border-line bg-white px-3 py-2 text-[12.5px] flex items-center gap-2 flex-wrap">
        <Link2 size={14} className="text-muted" />
        <span className="font-semibold text-ink">Staff link</span>
        <span className="text-muted">— the person in the lot opens this on their phone to check or scan plates and flag cars.</span>
        {link && <button onClick={() => onCopy(link, 'Staff link copied.')} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-app"><Copy size={12} /> Copy link</button>}
        {link && <a href={link} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-brand-700 hover:underline">Open →</a>}
        <span className="ml-auto text-[11.5px] text-muted">{lastSweep ? `Last sweep ${whenET(lastSweep.startedAt)}${lastSweep.byName ? ' by ' + lastSweep.byName : ''} · ${lastSweep.nChecked} checked, ${lastSweep.nFlagged} flagged` : 'No sweep yet'}</span>
      </div>
      {incidents.length > 0 && <p className="mb-2 text-[12px] text-rose-700 inline-flex items-center gap-1"><Flag size={12} /> {incidents.length} flagged {incidents.length === 1 ? 'car' : 'cars'} open — see Flags.</p>}
      <LeanSection title="Numbered spots" n={spots.filter(s => s.kind === 'sell' && s.active).length}><LeanList>{spots.filter(s => s.kind === 'sell' && s.active).map(row)}</LeanList></LeanSection>
      {spots.some(s => s.kind === 'hold' && s.active) && <LeanSection title="Held — staff & buffer" n={spots.filter(s => s.kind === 'hold' && s.active).length}><LeanList>{spots.filter(s => s.kind === 'hold' && s.active).map(row)}</LeanList></LeanSection>}
      {arriving.length > 0 && (
        <LeanSection title="Arriving tomorrow" n={arriving.length}>
          <LeanList>{arriving.map(b => <LeanRow key={b.id} lead={<SpotChip s={spots.find(s => s.id === b.spotId) || { label: '?', kind: 'sell' } as Spot} />} name={<>{carLabel(b)}{b.plate ? <span className="font-mono text-[12px] text-muted font-semibold ml-1.5">{b.plate}</span> : null}</>} meta={<>{b.guestName || b.kind}{b.unit ? ` · ${b.unit}` : ''} · {b.nights}n</>} tags={b.kind === 'guest' ? <Tag tone={b.paid === 'paid' ? 'emerald' : 'rose'}>{b.paid}</Tag> : <Tag>{b.kind}</Tag>} actions={<IconBtn title="Open the booking" onClick={() => onBooking(b)}><Pencil size={14} /></IconBtn>} />)}</LeanList>
        </LeanSection>
      )}
    </div>
  )
}
const SpotChip = ({ s }: { s: Spot }) => <span className={`shrink-0 inline-flex items-center justify-center rounded-lg w-9 h-8 text-[12.5px] font-bold tabular-nums ${s.kind === 'hold' ? 'bg-slate-200 text-slate-700' : 'bg-ink text-white'}`}>{s.label}</span>

// ── FLAGS: the cars that should not be there, and where each is in the chain ────────────────────
function Flags({ lot, incidents, spots, canEdit, onNotice, onTow, onClose, onRegister, onNote }: {
  lot: Lot; incidents: Incident[]; spots: Spot[]; canEdit: boolean
  onNotice: (i: Incident) => void; onTow: (i: Incident) => void; onClose: (i: Incident, how: 'towed' | 'resolved' | 'dismissed' | 'reopen', res?: string) => void; onRegister: (i: Incident) => void; onNote: (i: Incident, notes: string) => void
}) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])
  const open = incidents.filter(i => OPEN.indexOf(i.status) >= 0)
  const closed = incidents.filter(i => OPEN.indexOf(i.status) < 0)
  const row = (i: Incident) => {
    const st = INC_STATUS[i.status]
    const due = i.towDueAt ? new Date(i.towDueAt).getTime() : null
    const left = due ? Math.round((due - now) / 60000) : null
    return (
      <LeanRow key={i.id} tint={i.status === 'open' ? 'rose' : i.status === 'notified' ? 'amber' : undefined}
        lead={<span className="shrink-0 inline-flex items-center justify-center rounded-lg px-2 h-8 text-[12px] font-mono font-bold bg-ink text-white">{i.plate || '—'}</span>}
        name={carLabel(i)}
        meta={<>{i.spotLabel ? `spot ${i.spotLabel}` : 'in the lot'} · seen {whenET(i.seenAt)}{i.seenBy ? ` by ${i.seenBy}` : ''}</>}
        tags={<>
          <Tag tone={i.kind === 'unregistered' ? 'rose' : 'amber'}>{INC_KIND[i.kind] || i.kind}</Tag>
          <Tag tone={st.tone}>{st.label}</Tag>
          {i.status === 'notified' && left != null && (left > 0 ? <Tag tone="amber" title={`Deadline ${timeET(i.towDueAt as string)}`}>{left} min left</Tag> : <Tag tone="rose" title="The hour is up — the tow email drafts itself within 15 minutes, or draft it now">hour is up</Tag>)}
          {i.towDraftError && <Tag tone="rose" title={i.towDraftError}>draft failed</Tag>}
          {i.photoUrl && <Tag tone="sky">photo</Tag>}
        </>}
        actions={canEdit && OPEN.indexOf(i.status) >= 0 ? <>
          <IconBtn title={i.noticeSentAt ? 'Send the notice again' : 'Send the 1-hour notice to every guest in house'} tone={i.status === 'open' ? 'bad' : undefined} onClick={() => onNotice(i)}><Mail size={14} /></IconBtn>
          <IconBtn title={i.towDraftId ? 'Draft the tow email again' : lot.towEmail ? `Draft the tow email to ${lot.towCompany || lot.towEmail} now` : 'Add the tow company email in Settings first'} disabled={!lot.towEmail} onClick={() => onTow(i)}><Truck size={14} /></IconBtn>
          <IconBtn title="Register this car to a stay instead" onClick={() => onRegister(i)}><Car size={14} /></IconBtn>
          <IconBtn title="Towed — the car is gone, close it" onClick={() => onClose(i, 'towed')}><MapPinOff size={14} className="text-rose-700" /></IconBtn>
          <IconBtn title="Resolved — the car moved or registered" tone="ok" onClick={() => onClose(i, 'resolved', 'moved or registered')}><Check size={14} /></IconBtn>
          <IconBtn title="Dismiss — it was fine after all" onClick={() => onClose(i, 'dismissed', 'not an issue')}><X size={14} /></IconBtn>
        </> : canEdit ? <IconBtn title="Reopen" onClick={() => onClose(i, 'reopen')}><RotateCw size={14} /></IconBtn> : undefined}>
        <IncidentDetail i={i} canEdit={canEdit} onNote={onNote} />
      </LeanRow>
    )
  }
  return (
    <div>
      <p className="mb-2 text-[12px] text-muted">The chain: flag → <b>notice</b> to every guest in house (they get {lot.noticeMinutes === 60 ? 'an hour' : lot.noticeMinutes + ' minutes'}) → the <b>tow email</b> drafts itself for {lot.towCompany || 'the tow company'}{lot.towEmail ? '' : ' — add its email under Settings'} → a person sends it → <b>towed</b>.</p>
      {open.length ? <LeanSection title="Open" n={open.length} tone="rose"><LeanList>{open.map(row)}</LeanList></LeanSection> : <LeanEmpty><Check size={14} className="inline mr-1 text-emerald-600" />Nothing flagged. The staff link is where a car gets flagged; the Check-a-plate box up top works too.</LeanEmpty>}
      {closed.length > 0 && <LeanSection title="Closed" n={closed.length}><LeanList>{closed.slice(0, 30).map(row)}</LeanList></LeanSection>}
    </div>
  )
}
function IncidentDetail({ i, canEdit, onNote }: { i: Incident; canEdit: boolean; onNote: (i: Incident, notes: string) => void }) {
  const [notes, setNotes] = useState(i.notes || '')
  useEffect(() => setNotes(i.notes || ''), [i.notes])
  return (
    <div className="grid sm:grid-cols-2 gap-3 text-[12.5px]">
      <div className="space-y-1">
        {i.photoUrl && <a href={i.photoUrl} target="_blank" rel="noreferrer"><img src={i.photoUrl} alt="The car" className="rounded-lg max-h-40 border border-line" /></a>}
        <div><span className="text-muted">Seen</span> · {whenET(i.seenAt)}{i.seenBy ? ' by ' + i.seenBy : ''}{i.plateState ? ' · plate ' + i.plateState : ''}</div>
        <div><span className="text-muted">Notice</span> · {i.noticeSentAt ? `${whenET(i.noticeSentAt)} to ${i.noticeSentN} ${i.noticeSentN === 1 ? 'guest' : 'guests'} by ${i.noticeSentBy || '?'} · deadline ${i.towDueAt ? timeET(i.towDueAt) : '—'}` : 'not sent yet'}</div>
        <div><span className="text-muted">Tow email</span> · {i.towDraftedAt ? `drafted ${whenET(i.towDraftedAt)} to ${i.towTo} — in Gmail Drafts` : i.towDraftError ? <span className="text-rose-700">{i.towDraftError}</span> : 'not drafted'}</div>
        {i.towedAt && <div><span className="text-muted">Towed</span> · {whenET(i.towedAt)} by {i.towedBy}</div>}
        {i.resolvedAt && <div><span className="text-muted">{i.status === 'dismissed' ? 'Dismissed' : 'Resolved'}</span> · {whenET(i.resolvedAt)} by {i.resolvedBy}{i.resolution ? ' — ' + i.resolution : ''}</div>}
        {i.noticeLog.length > 0 && <details className="text-[11.5px]"><summary className="cursor-pointer text-muted">Who got the notice ({i.noticeLog.length})</summary><ul className="mt-1 space-y-0.5">{i.noticeLog.map((l: any, k: number) => <li key={k}>{l.ok ? '✓' : '✗'} {l.guest}{l.unit ? ' · ' + l.unit : ''}{l.error ? <span className="text-rose-700"> — {l.error}</span> : null}</li>)}</ul></details>}
      </div>
      <div className="space-y-1.5">
        {i.noticeText && <details className="text-[11.5px]"><summary className="cursor-pointer text-muted">The notice as sent</summary><pre className="mt-1 whitespace-pre-wrap font-sans bg-app rounded-lg p-2">{i.noticeText}</pre></details>}
        <div className="flex items-start gap-1.5">
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} placeholder="Notes — who you spoke to, what the owner said, the tow truck's ETA" className="flex-1 text-[12px] bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
          <button disabled={!canEdit || notes === (i.notes || '')} onClick={() => onNote(i, notes)} className="rounded-lg bg-brand-600 text-white text-[12px] font-semibold px-3 py-2 disabled:opacity-50">Save</button>
        </div>
      </div>
    </div>
  )
}

// ── SETTINGS: the lot, its spots, the staff link, a new lot ─────────────────────────────────────
function Settings({ lot, spots, can, buildings, link, allLink, staffLink, onStaffLink, onCopy, onLot, onSpots, onMade, say }: {
  lot: Lot; spots: Spot[]; can: { edit: boolean; full: boolean }; buildings: string[]; link: string; allLink: string; staffLink: StaffLink | null; onStaffLink: (s: StaffLink) => void
  onCopy: (s: string, m: string) => void; onLot: (l: Lot) => void; onSpots: (s: Spot[]) => void; onMade: (l: Lot) => void; say: (m: string) => void
}) {
  const [f, setF] = useState({ name: lot.name, rate: String(lot.rateCents / 100), noticeMinutes: String(lot.noticeMinutes), towCompany: lot.towCompany || '', towEmail: lot.towEmail || '', towPhone: lot.towPhone || '', address: lot.address || '', rules: lot.rules || '', passcode: '' })
  useEffect(() => setF({ name: lot.name, rate: String(lot.rateCents / 100), noticeMinutes: String(lot.noticeMinutes), towCompany: lot.towCompany || '', towEmail: lot.towEmail || '', towPhone: lot.towPhone || '', address: lot.address || '', rules: lot.rules || '', passcode: '' }), [lot])
  const [busy, setBusy] = useState(false)
  const inp = 'w-full text-[13px] bg-app border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60'
  const save = async () => {
    setBusy(true)
    try {
      const patch: Record<string, any> = { name: f.name, rateCents: Math.round(Number(f.rate || 0) * 100), noticeMinutes: Number(f.noticeMinutes || 60), towCompany: f.towCompany, towEmail: f.towEmail, towPhone: f.towPhone, address: f.address, rules: f.rules }
      if (f.passcode.trim()) patch.sharePasscode = f.passcode.trim()
      const j = await lotsApi({ action: 'lot.update', lotId: lot.id, patch }); onLot(j.lot); say('Lot saved.')
    } catch (e: any) { say(e?.message || String(e)) } finally { setBusy(false) }
  }
  const clearPass = async () => { try { const j = await lotsApi({ action: 'lot.update', lotId: lot.id, patch: { sharePasscode: '' } }); onLot(j.lot); say('Passcode removed.') } catch (e: any) { say(e?.message || String(e)) } }
  const regen = async () => { if (!confirm('Make a new staff link? The old one stops working.')) return; try { const j = await lotsApi({ action: 'lot.update', lotId: lot.id, patch: { regenerateCode: true } }); onLot(j.lot); say('New staff link made — send it to the team again.') } catch (e: any) { say(e?.message || String(e)) } }
  const spot = async (s: Spot, patch: Record<string, any>) => { try { const j = await lotsApi({ action: 'spot.update', spotId: s.id, patch }); onSpots(spots.map(x => x.id === s.id ? j.spot : x)) } catch (e: any) { say(e?.message || String(e)) } }
  const add = async (kind: 'sell' | 'hold') => { try { const j = await lotsApi({ action: 'spot.add', lotId: lot.id, kind }); onSpots(spots.concat([j.spot])) } catch (e: any) { say(e?.message || String(e)) } }
  const ro = !can.full
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <section className="rounded-2xl border border-line bg-white p-4 space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">The lot</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="block col-span-2"><span className="text-[11px] font-semibold text-muted">Name</span><input disabled={ro} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={inp} /></label>
          <label className="block"><span className="text-[11px] font-semibold text-muted">Rate per night ($)</span><input disabled={ro} inputMode="decimal" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value })} className={inp + ' tabular-nums'} /></label>
          <label className="block"><span className="text-[11px] font-semibold text-muted">Minutes before tow</span><input disabled={ro} inputMode="numeric" value={f.noticeMinutes} onChange={e => setF({ ...f, noticeMinutes: e.target.value })} className={inp + ' tabular-nums'} /></label>
          <label className="block col-span-2"><span className="text-[11px] font-semibold text-muted">Lot address (goes in the tow email)</span><input disabled={ro} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} className={inp} /></label>
          <label className="block"><span className="text-[11px] font-semibold text-muted">Tow company</span><input disabled={ro} value={f.towCompany} onChange={e => setF({ ...f, towCompany: e.target.value })} className={inp} /></label>
          <label className="block"><span className="text-[11px] font-semibold text-muted">Tow phone</span><input disabled={ro} value={f.towPhone} onChange={e => setF({ ...f, towPhone: e.target.value })} className={inp} /></label>
          <label className="block col-span-2"><span className="text-[11px] font-semibold text-muted">Tow email — the draft goes here</span><input disabled={ro} type="email" value={f.towEmail} onChange={e => setF({ ...f, towEmail: e.target.value })} placeholder="dispatch@towcompany.com" className={inp} /></label>
          <label className="block col-span-2"><span className="text-[11px] font-semibold text-muted">Lot rules (quoted in the notice and the tow email)</span><textarea disabled={ro} rows={3} value={f.rules} onChange={e => setF({ ...f, rules: e.target.value })} className={inp} /></label>
        </div>
        {!ro && <button onClick={save} disabled={busy} className="rounded-lg bg-brand-600 text-white text-[12.5px] font-semibold px-4 py-2 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin inline" /> : 'Save'}</button>}
        {ro && <p className="text-[11.5px] text-muted">Full access on Parking changes these.</p>}
      </section>

      <section className="rounded-2xl border border-line bg-white p-4 space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">Staff link — every lot</h3>
        <p className="text-[12.5px] text-muted">The one link to share: it opens with a property picker, then the lot. No login — the link is the key{staffLink?.hasPasscode ? ', plus the passcode' : ''}.</p>
        {staffLink && <StaffLinkCard link={allLink} staffLink={staffLink} ro={ro} onChange={onStaffLink} onCopy={onCopy} say={say} />}
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted pt-2">This lot's own link</h3>
        <p className="text-[12.5px] text-muted">Opens {lot.building} only — for a person who should never see the other lots.</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <code className="text-[12px] bg-app rounded-lg px-2 py-1 break-all">{link}</code>
          <button onClick={() => onCopy(link, 'Staff link copied.')} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-app"><Copy size={12} /> Copy</button>
          <a href={link} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-brand-700 hover:underline">Open →</a>
        </div>
        {!ro && <div className="flex items-center gap-1.5 flex-wrap">
          <input value={f.passcode} onChange={e => setF({ ...f, passcode: e.target.value })} placeholder={lot.hasPasscode ? 'Change the passcode…' : 'Add a passcode (optional)'} className={inp + ' max-w-[14rem]'} />
          <button onClick={save} disabled={busy || !f.passcode.trim()} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-50">Set</button>
          {lot.hasPasscode && <button onClick={clearPass} className="text-[12px] font-semibold text-muted hover:text-ink">Remove passcode</button>}
          <button onClick={regen} className="ml-auto text-[12px] font-semibold text-rose-700 hover:underline">New link</button>
        </div>}

        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted pt-2">Spots</h3>
        <ul className="divide-y divide-line/70 rounded-xl border border-line">
          {spots.map(s => (
            <li key={s.id} className={`flex items-center gap-2 px-2.5 py-1.5 text-[12.5px] ${s.active ? '' : 'opacity-50'}`}>
              <input disabled={ro} defaultValue={s.label} onBlur={e => e.target.value.trim() && e.target.value.trim() !== s.label && spot(s, { label: e.target.value.trim() })} className="w-14 font-bold tabular-nums bg-app border border-line rounded-lg px-2 py-1 text-[12.5px]" />
              <Pick small value={s.kind} disabled={ro} options={[{ value: 'sell', label: 'Sold' }, { value: 'hold', label: 'Held', hint: 'Staff & buffer — never sold' }]} onChange={(k) => spot(s, { kind: k })} />
              <input disabled={ro} defaultValue={s.note || ''} placeholder="note" onBlur={e => (e.target.value.trim() || '') !== (s.note || '') && spot(s, { note: e.target.value })} className="flex-1 min-w-0 bg-app border border-line rounded-lg px-2 py-1 text-[12px]" />
              {!ro && <button onClick={() => spot(s, { active: !s.active })} title={s.active ? 'Switch the spot off (hidden from the calendar)' : 'Switch it back on'} className="text-[11px] font-semibold text-muted hover:text-ink">{s.active ? 'off' : 'on'}</button>}
            </li>
          ))}
        </ul>
        {!ro && <div className="flex items-center gap-1.5"><button onClick={() => add('sell')} className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app">+ sold spot</button><button onClick={() => add('hold')} className="rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-app">+ held spot</button></div>}
      </section>

      {can.full && <NewLot buildings={buildings} onMade={onMade} />}
    </div>
  )
}

function NewLot({ buildings, onMade }: { buildings: string[]; onMade: (l: Lot) => void }) {
  const [b, setB] = useState<string | null>(null)
  const [sell, setSell] = useState('10')
  const [hold, setHold] = useState('3')
  const [rate, setRate] = useState('30')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inp = 'w-full text-[13px] bg-app border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200 tabular-nums'
  const make = async () => {
    if (!b) return
    setBusy(true); setErr(null)
    try { const j = await lotsApi({ action: 'lot.create', building: b, sell: Number(sell), hold: Number(hold), rateCents: Math.round(Number(rate || 0) * 100) }); onMade(j.lot) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  return (
    <section className="rounded-2xl border border-dashed border-line bg-white p-4 space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">New lot</h3>
      <div className="flex items-center gap-1 flex-wrap">{buildings.map(x => <button key={x} onClick={() => setB(x)} aria-pressed={b === x} className={'text-[11.5px] font-semibold px-2.5 py-1 rounded-full border ' + (b === x ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{x}</button>)}{!buildings.length && <span className="text-[12px] text-muted">Every known building already has a lot.</span>}</div>
      <div className="grid grid-cols-3 gap-2 max-w-md">
        <label className="block"><span className="text-[11px] font-semibold text-muted">Sold spots</span><input inputMode="numeric" value={sell} onChange={e => setSell(e.target.value)} className={inp} /></label>
        <label className="block"><span className="text-[11px] font-semibold text-muted">Held (never sold)</span><input inputMode="numeric" value={hold} onChange={e => setHold(e.target.value)} className={inp} /></label>
        <label className="block"><span className="text-[11px] font-semibold text-muted">$ per night</span><input inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} className={inp} /></label>
      </div>
      {err && <p className="text-[12px] text-rose-700">{err}</p>}
      <button onClick={make} disabled={!b || busy} className="rounded-lg bg-brand-600 text-white text-[12.5px] font-semibold px-4 py-2 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin inline" /> : `Set up ${b || 'the lot'}`}</button>
    </section>
  )
}


// ── EVERY LOT AT A GLANCE: one card per property, the spots drawn as a map ──────────────────────
function LotCard({ o, selected, onPick }: { o: LotOverview; selected: boolean; onPick: () => void }) {
  const sq = (s: LotOverview['spots'][number]) => {
    const b = s.tonight
    const cls = s.flagged ? 'bg-rose-500 text-white ring-2 ring-rose-300'
      : !b ? (s.kind === 'hold' ? 'bg-slate-100 text-slate-500 border border-dashed border-slate-300' : 'bg-white text-ink border border-line')
        : b.kind === 'block' ? 'bg-rose-50 text-rose-700 border border-dashed border-rose-300'
          : b.kind !== 'guest' ? 'bg-slate-300 text-slate-800'
            : b.paid === 'paid' ? 'bg-emerald-500 text-white' : b.paid === 'unpaid' ? 'bg-amber-400 text-amber-950' : 'bg-sky-400 text-white'
    const title = s.flagged ? `Spot ${s.label} — flagged` : b ? `Spot ${s.label} — ${b.guestName || b.kind}${b.unit ? ' · ' + b.unit : ''}${b.plate ? ' · ' + b.plate : ''}` : `Spot ${s.label} — free tonight${s.kind === 'hold' ? ' (held)' : ''}`
    return <span key={s.id} title={title} className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-[10.5px] font-bold tabular-nums ${cls}`}>{s.label}</span>
  }
  return (
    <button type="button" onClick={onPick} aria-pressed={selected} className={`text-left rounded-2xl border bg-white px-3 py-2.5 transition ${selected ? 'border-ink ring-2 ring-ink/10' : 'border-line hover:border-ink/40'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13.5px] font-bold text-ink">{o.lot.building}</span>
        <span className="text-[12px] text-muted">{o.lot.rateCents > 0 ? `${cents(o.lot.rateCents, o.lot.currency)}/night` : 'included'}</span>
        <span className={`ml-auto text-[12px] font-semibold tabular-nums ${o.sold >= o.sellable && o.sellable ? 'text-rose-700' : 'text-ink'}`}>{o.sold}/{o.sellable} tonight</span>
        {o.unpaid > 0 && <Tag tone="amber">{o.unpaid} unpaid</Tag>}
        {o.flags > 0 && <Tag tone="rose">{o.flags} {o.flags === 1 ? 'flag' : 'flags'}</Tag>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">{o.spots.map(sq)}</div>
    </button>
  )
}

function StaffLinkCard({ link, staffLink, ro, onChange, onCopy, say }: { link: string; staffLink: StaffLink; ro: boolean; onChange: (s: StaffLink) => void; onCopy: (s: string, m: string) => void; say: (m: string) => void }) {
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const inp = 'text-[13px] bg-app border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60'
  const save = async (patch: Record<string, any>, done: string) => {
    setBusy(true)
    try { const j = await lotsApi({ action: 'staff.update', ...patch }); onChange(j.staffLink); setPass(''); say(done) } catch (e: any) { say(e?.message || String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <code className="text-[12px] bg-app rounded-lg px-2 py-1 break-all">{link}</code>
        <button onClick={() => onCopy(link, 'Staff link copied.')} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11.5px] font-semibold text-ink hover:bg-app"><Copy size={12} /> Copy</button>
        <a href={link} target="_blank" rel="noreferrer" className="text-[11.5px] font-semibold text-brand-700 hover:underline">Open →</a>
        {staffLink.hasPasscode && staffLink.passcode && <Tag tone="violet" title="The passcode the team types">passcode {staffLink.passcode}</Tag>}
      </div>
      {!ro && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input value={pass} onChange={e => setPass(e.target.value)} placeholder={staffLink.hasPasscode ? 'Change the passcode…' : 'Add a passcode (optional)'} className={inp + ' max-w-[14rem]'} />
          <button onClick={() => save({ passcode: pass.trim() }, 'Passcode set.')} disabled={busy || !pass.trim()} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-50">Set</button>
          {staffLink.hasPasscode && <button onClick={() => save({ passcode: '' }, 'Passcode removed.')} disabled={busy} className="text-[12px] font-semibold text-muted hover:text-ink">Remove passcode</button>}
          <button onClick={() => { if (confirm('Make a new link for every lot? The old one stops working.')) save({ regenerate: true }, 'New staff link made — send it to the team again.') }} disabled={busy} className="ml-auto text-[12px] font-semibold text-rose-700 hover:underline">New link</button>
        </div>
      )}
    </div>
  )
}
