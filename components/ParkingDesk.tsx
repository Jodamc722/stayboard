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
//
// 2026-11-09 pass — what needs a person leads: a flagged car puts one red line at the top and opens
// the tab on Flags; each flag shows ONE next step (send notice → wait → draft tow email → mark
// towed) with the rest inside the row. Red is only for "act now"; unpaid and "not checked today"
// are amber. One request per open instead of two; every control is at least 36px tall; the calendar
// keeps its spot column in view when it scrolls sideways. Words: "guest spots" and "held spots",
// "lot check" (not sweep / walk), everywhere on this desk.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Loader2, RefreshCw, Plus, ChevronLeft, ChevronRight, Search, Flag, Mail, Truck, Check, X, Copy, AlertTriangle, Pencil, RotateCw, Car, MapPinOff } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanList, LeanRow, LeanSection, LeanEmpty, LeanTabs } from '@/components/lean'
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
  open: { label: 'Notice not sent', tone: 'rose' }, notified: { label: 'Notice sent', tone: 'amber' }, tow_drafted: { label: 'Tow email drafted', tone: 'violet' },
  towed: { label: 'Towed', tone: 'slate' }, resolved: { label: 'Resolved', tone: 'emerald' }, dismissed: { label: 'Dismissed', tone: 'slate' },
}
const INC_KIND: Record<string, string> = { unregistered: 'Not registered', wrong_spot: 'Wrong spot', staff_in_sell: 'Our car in a guest spot', blocking: 'Blocking', other: 'Other' }

export function ParkingDesk() {
  const today = useMemo(() => todayET(), [])
  const [lotId, setLotId] = useState<string>('')
  const [data, setData] = useState<Bundle | null>(null)
  const [lots, setLots] = useState<Lot[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('calendar')
  const [start, setStart] = useState(addDays(today, -1))
  // A phone shows a week (it nearly fits); a desk shows two. Nothing drawn before the first read
  // depends on this, so the server and the browser can disagree about it safely.
  const [days, setDays] = useState<number>(() => (typeof window !== 'undefined' && window.innerWidth < 640 ? 7 : 14))
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
  // THE READ ALWAYS COVERS TODAY. The header, the Tonight tab and the unpaid count are worked out
  // from the same bookings as the calendar, so paging the calendar three weeks ahead used to turn
  // the header into "0 sold tonight" and empty the Tonight tab.
  const calFrom = addDays(start, -1), calTo = addDays(start, days + 1)
  const from = calFrom < addDays(today, -1) ? calFrom : addDays(today, -1)
  const to = calTo > addDays(today, 2) ? calTo : addDays(today, 2)

  // ONE REQUEST PER OPEN (it was two, each reading every lot). `auto` lets the server pick the first
  // lot and answer with its bundle; `seq` drops an answer that a newer read has overtaken; `loadedKey`
  // stops the lot-change effect from fetching what this call just fetched.
  const seq = useRef(0)
  const loadedKey = useRef('')
  const tabPicked = useRef(false)
  const load = useCallback(async (id: string, quiet = false) => {
    const mine = ++seq.current
    if (!quiet) setLoading(true)
    setErr(null)
    try {
      const r = await fetch(`/api/lots?lot=${encodeURIComponent(id || 'auto')}&from=${from}&to=${to}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || j.message || `HTTP ${r.status}`)
      if (mine !== seq.current) return
      setOverview(j.overview || []); setStaffLink(j.staffLink || null); setLots(j.lots || [])
      if (!j.lot) { setData(null); setNoLot({ can: j.can || { edit: false, full: false }, buildings: j.buildings || [] }); return }
      loadedKey.current = `${j.lot.id}|${from}|${to}`
      setData(j as Bundle)
      if (j.lot.id !== id) setLotId(j.lot.id)
      // WHERE THE TAB OPENS, once: on the flags when a car is flagged (that is today's decision),
      // on Tonight on a phone (the calendar is a desk tool), on the calendar otherwise.
      if (!tabPicked.current) {
        tabPicked.current = true
        const flagged = ((j.incidents || []) as Incident[]).some(i => OPEN.indexOf(i.status) >= 0)
        if (flagged) setTab('flags')
        else if (typeof window !== 'undefined' && window.innerWidth < 640) setTab('tonight')
      }
    } catch (e: any) { if (mine === seq.current) setErr(e?.message || String(e)) } finally { if (mine === seq.current) setLoading(false) }
  }, [from, to])

  // Once, on open: the lot (and tab) in the URL, else the first lot.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    let q = '', t = ''
    try { const sp = new URLSearchParams(window.location.search); q = sp.get('lot') || ''; t = sp.get('tab') || '' } catch {}
    if (t === 'calendar' || t === 'tonight' || t === 'flags' || t === 'settings') { setTab(t); tabPicked.current = true }
    if (q) { setLotId(q); return }
    load('')
  }, [load])
  useEffect(() => { if (lotId && loadedKey.current !== `${lotId}|${from}|${to}`) load(lotId) }, [lotId, load, from, to])

  // "Check a plate" — the front desk's question, answered as they type. Only the latest answer counts.
  const plateTimer = useRef<any>(null)
  const plateSeq = useRef(0)
  useEffect(() => {
    clearTimeout(plateTimer.current)
    const mine = ++plateSeq.current
    if (!lotId || tidyPlate(plateQ).length < 3) { setPlateV(null); return }
    plateTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/lots?lot=${encodeURIComponent(lotId)}&plate=${encodeURIComponent(plateQ)}`, { cache: 'no-store' })
        const j = await r.json()
        if (mine === plateSeq.current) setPlateV(j && j.ok ? j : null)
      } catch { if (mine === plateSeq.current) setPlateV(null) }
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
  const checkedToday = !!data?.lastSweep && data.lastSweep.sweepDate === today
  // What the flagged cars are waiting for, in the order a person would act.
  const flagLine = (() => {
    const nowMs = Date.now()
    const due = openFlags.filter(i => i.status === 'notified' && i.towDueAt && new Date(i.towDueAt).getTime() <= nowMs).length
    const need = openFlags.filter(i => i.status === 'open').length
    const drafted = openFlags.filter(i => i.status === 'tow_drafted').length
    const waiting = openFlags.length - due - need - drafted
    return [due ? `${due} past the deadline` : '', need ? `${need} waiting for the notice` : '', drafted ? `${drafted} tow email ready to send` : '', waiting ? `${waiting} on the clock` : ''].filter(Boolean).join(' · ')
  })()

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
      patchIncident(j.incident); setTab('flags'); setPlateQ(''); setPlateV(null); say('Flagged — send the notice from here.')
    } catch (e: any) { say(e?.message || String(e)) }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const link = lot ? `${origin}/lot/${lot.shareCode}` : ''
  const allLink = staffLink ? `${origin}/lot/${staffLink.code}` : ''
  const copy = async (s: string, m: string) => { try { await navigator.clipboard.writeText(s); say(m) } catch { say('Could not copy — select it by hand.') } }
  const pickLot = (id: string) => { setLotId(id); try { history.replaceState(null, '', `?lot=${id}`) } catch {} }
  const ctl = 'inline-flex items-center justify-center h-9 rounded-lg border border-line bg-white text-muted hover:text-ink'
  const holdN = spots.filter(s => s.kind === 'hold' && s.active).length

  return (
    <div>
      <LeanHead title="Parking" sub={lot ? <>{lot.name} · {lot.rateCents > 0 ? `${cents(lot.rateCents, lot.currency)} a night` : 'included with the stay'} · {tonight.sell} guest spots{holdN ? ` · ${holdN} held, never sold` : ''}</> : undefined}>
        {lot && <>
          <Pill tone="brand" title={`Guest spots taken tonight${lot.rateCents > 0 ? ` · ${cents(tonight.revenue, lot.currency)} for tonight (each booking spread over its nights)` : ''}`} onClick={() => setTab('tonight')}>{tonight.sold}/{tonight.sell} {tonight.sold >= tonight.sell && tonight.sell > 0 ? 'full tonight' : 'taken tonight'}</Pill>
          {tonight.unpaid.length > 0 && <Pill tone="amber" title="Guest bookings still unpaid" onClick={() => setTab('tonight')}>{tonight.unpaid.length} unpaid</Pill>}
          {!checkedToday && tonight.live.length > 0 && <Pill tone="amber" title="Nobody has checked this lot today — the staff link is on the Tonight tab" onClick={() => setTab('tonight')}>not checked today</Pill>}
          {can.edit && <button onClick={() => openNew()} className="h-9 rounded-lg bg-brand-600 text-white text-[12.5px] font-semibold px-3 inline-flex items-center gap-1"><Plus size={14} /> Add parking</button>}
        </>}
      </LeanHead>

      {/* WHAT NEEDS A PERSON, FIRST. One red line, only when a car is flagged, and it opens the flags. */}
      {lot && openFlags.length > 0 && tab !== 'flags' && (
        <button type="button" onClick={() => setTab('flags')} className="mb-3 w-full text-left rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-900 flex items-center gap-x-2 gap-y-0.5 flex-wrap">
          <Flag size={14} className="shrink-0" />
          <span className="font-semibold">{openFlags.length} {openFlags.length === 1 ? 'car' : 'cars'} flagged at {lot.building}</span>
          {flagLine && <span>{flagLine}</span>}
          <span className="ml-auto font-semibold underline">Open flags</span>
        </button>
      )}

      {/* EVERY LOT AT A GLANCE (Jon, 2026-10-29: "a visual of all properties … see by lot / properties").
          The cards ARE the lot switch — the row of name buttons under them said the same thing twice. */}
      {overview.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {overview.map(o => <LotCard key={o.lot.id} o={o} selected={o.lot.id === lotId} onPick={() => pickLot(o.lot.id)} />)}
        </div>
      )}

      {/* CHECK A PLATE — one line (plus the lot names only when the cards could not be read). */}
      <div className="mb-3 flex items-center gap-1.5 flex-wrap">
        {overview.length === 0 && lots.map(l => (
          <button key={l.id} onClick={() => pickLot(l.id)} aria-pressed={l.id === lotId}
            className={'h-9 text-[12px] font-semibold px-3 rounded-full border ' + (l.id === lotId ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{l.building}</button>
        ))}
        {can.full && lot && <button onClick={() => setTab('settings')} title="Set up a lot for another building (at the bottom of Settings)" className="h-9 text-[12px] font-semibold px-3 rounded-full border border-dashed border-line text-muted hover:text-ink">+ lot</button>}
        {lot && (
          <span className="relative flex-1 min-w-[9rem] sm:flex-none sm:w-56 sm:ml-auto">
            <Search size={14} className="absolute left-2.5 top-[11px] text-muted" />
            <input value={plateQ} onChange={e => setPlateQ(e.target.value.toUpperCase())} placeholder="Check a plate…" autoCapitalize="characters" autoCorrect="off" className="h-9 w-full text-[13px] font-mono uppercase tracking-wider bg-white border border-line rounded-lg pl-8 pr-2 focus:outline-none focus:ring-2 focus:ring-brand-200 placeholder:font-sans placeholder:normal-case placeholder:tracking-normal" />
          </span>
        )}
        <button onClick={() => load(lotId, true)} title="Refresh" aria-label="Refresh" className={ctl + ' w-9 ' + (lot ? '' : 'ml-auto')}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>
      {plateV && plateV.plateNorm && (
        <div className={`mb-3 rounded-xl border px-3 py-2 text-[12.5px] flex items-center gap-2 flex-wrap ${plateV.verdict === 'ok' || plateV.verdict === 'leaving_today' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <span className="font-mono font-bold">{plateV.plate}</span>
          <span>{plateV.note}</span>
          {plateV.booking && <button onClick={() => openBooking(plateV.booking)} className="font-semibold underline py-1.5">open booking</button>}
          {plateV.near?.length > 0 && plateV.near.map((n: any) => <button key={n.booking.id} onClick={() => openBooking(n.booking)} className="font-semibold underline py-1.5">{n.booking.plate} → {n.booking.guestName || n.booking.kind}</button>)}
          <span className="ml-auto flex items-center gap-1.5">
            {can.edit && plateV.verdict === 'unregistered' && <button onClick={() => openNew({ plate: plateV.plate })} className="h-9 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-ink"><Plus size={13} /> Register it</button>}
            {can.edit && plateV.verdict !== 'ok' && plateV.verdict !== 'leaving_today' && <button onClick={flagPlate} className="h-9 inline-flex items-center gap-1 rounded-lg bg-rose-600 text-white px-3 text-[12.5px] font-semibold"><Flag size={13} /> Flag it</button>}
            <button onClick={() => { setPlateQ(''); setPlateV(null) }} title="Clear" aria-label="Clear" className="h-9 w-9 inline-flex items-center justify-center text-muted hover:text-ink"><X size={14} /></button>
          </span>
        </div>
      )}

      {err && <p className="mb-2 text-[12.5px] text-rose-700 inline-flex items-center gap-1"><AlertTriangle size={13} /> {err}</p>}
      {toast && <div className="fixed bottom-4 left-4 right-4 sm:left-auto z-[60] rounded-xl bg-ink text-white text-[12.5px] px-3.5 py-2 shadow-lg sm:max-w-sm">{toast}</div>}
      {loading && !data && <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1.5" />Reading the lot…</LeanEmpty>}
      {!loading && !lot && !err && (
        can.full
          ? <NewLot buildings={data?.buildings || noLot?.buildings || []} onMade={(l) => { setLots(x => x.concat([l])); pickLot(l.id); setTab('calendar'); say(`${l.name} is set up.`) }} />
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
            <span className="inline-flex items-center gap-1 text-[12px] flex-wrap">
              <button onClick={() => setStart(addDays(start, -7))} title="A week earlier" aria-label="A week earlier" className={ctl + ' w-9'}><ChevronLeft size={15} /></button>
              <button onClick={() => setStart(addDays(today, -1))} className={ctl + ' px-3 font-semibold'}>Today</button>
              <button onClick={() => setStart(addDays(start, 7))} title="A week later" aria-label="A week later" className={ctl + ' w-9'}><ChevronRight size={15} /></button>
              <input type="date" value={start} onChange={e => e.target.value && setStart(e.target.value)} aria-label="First day shown" className="h-9 rounded-lg border border-line bg-white px-2 text-[12px]" />
              {WINDOWS.map(n => <button key={n} onClick={() => setDays(n)} aria-pressed={days === n} className={'h-9 font-semibold px-2.5 rounded-lg border ' + (days === n ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{n}d</button>)}
            </span>
          ) : null} />

          {tab === 'calendar' && <Calendar lot={lot} spots={spots} bookings={bookings} start={start} days={days} today={today} canEdit={can.edit} onCell={(spotId, day) => openNew({ spotId, startsOn: day, endsOn: addDays(day, 1), kind: spots.find(s => s.id === spotId)?.kind === 'hold' ? 'staff' : 'guest' })} onBar={openBooking} />}
          {tab === 'tonight' && <Tonight lot={lot} spots={spots} bookings={bookings} today={today} canEdit={can.edit} onBooking={openBooking} onNew={openNew} link={allLink || link} onCopy={copy} lastSweep={data?.lastSweep || null} />}
          {tab === 'flags' && <Flags lot={lot} incidents={incidents} canEdit={can.edit} canFull={can.full} onSettings={() => setTab('settings')} onNotice={inc => setNotice(inc)} onTow={draftTow} onClose={(inc, how, res) => incAction(inc, { action: 'incident.close', how, resolution: res }, how === 'reopen' ? 'Reopened.' : how === 'towed' ? 'Marked towed.' : 'Closed.')} onRegister={inc => openNew({ plate: inc.plate || '', make: inc.make || '', model: inc.model || '', color: inc.color || '', plateState: inc.plateState || '', spotId: inc.spotId || null })} onNote={(inc, notes) => incAction(inc, { action: 'incident.note', notes }, 'Note saved.')} />}
          {tab === 'settings' && <Settings lot={lot} spots={spots} can={can} buildings={data?.buildings || []} link={link} allLink={allLink} staffLink={staffLink} onStaffLink={setStaffLink} onCopy={copy} onLot={(l) => { setData(d => d ? { ...d, lot: l } : d); setLots(ls => ls.map(x => x.id === l.id ? l : x)) }} onSpots={(ss) => setData(d => d ? { ...d, spots: ss } : d)} onMade={(l) => { setLots(x => x.concat([l])); pickLot(l.id); setTab('calendar'); say(`${l.name} is set up.`) }} say={say} />}

          <BookingSheet open={sheetOpen} onClose={() => setSheetOpen(false)} lot={lot} spots={spots} bookings={bookings} draft={sheet} canFull={can.full} onSaved={onSaved} onDeleted={onDeleted} />
          <NoticeSheet open={!!notice} onClose={() => setNotice(null)} lot={lot} incident={notice} onSent={(inc, sent, failed, warning) => {
            patchIncident(inc)
            // The other cars in the same notice changed too — read them back rather than guess.
            if (!warning) load(lot.id, true)
            say(warning || `Notice sent to ${sent} ${sent === 1 ? 'guest' : 'guests'}${failed ? `, ${failed} failed` : ''}. Tow email drafts itself at ${inc.towDueAt ? timeET(inc.towDueAt) : 'the deadline'}.`)
          }} />
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
  const colMin = days > 14 ? 34 : 46
  const colTpl = `repeat(${days}, minmax(${colMin}px, 1fr))`
  // Only as wide as its days need (a week nearly fits a phone); the spot column stays put when it scrolls.
  const minWidth = 88 + days * colMin
  const spotCol = '5.5rem'
  // Nights sold per column, for the strip under the header.
  const soldPer = cols.map(d => bookings.filter(b => b.kind === 'guest' && (b.status === 'reserved' || b.status === 'parked') && b.startsOn <= d && d < b.endsOn && sell.some(s => s.id === b.spotId)).length)

  const row = (s: Spot) => {
    const mine = bookings.filter(b => b.spotId === s.id && b.status !== 'cancelled' && b.status !== 'no_show' && b.startsOn < end && b.endsOn > start)
    return (
      <div key={s.id} className={`grid items-stretch border-t border-line/70 ${s.kind === 'hold' ? 'bg-slate-50/70' : ''}`} style={{ gridTemplateColumns: `${spotCol} ${colTpl}` }}>
        <div className={`sticky left-0 z-[3] px-2 py-1 flex items-center gap-1.5 min-w-0 border-r border-line/70 ${s.kind === 'hold' ? 'bg-slate-50' : 'bg-white'}`}>
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
      <div style={{ minWidth }}>
        <div className="grid" style={{ gridTemplateColumns: `${spotCol} ${colTpl}` }}>
          <div className="sticky left-0 z-[3] bg-white px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted border-r border-line/70">Spot</div>
          {cols.map((d, i) => (
            <div key={d} className={`px-1 py-1 text-center border-l border-line/40 ${d === today ? 'bg-brand-50/60' : ''}`}>
              <div className={`text-[10px] uppercase tracking-wide ${d === today ? 'text-brand-700 font-bold' : 'text-muted'}`}>{weekday(d)}</div>
              <div className={`text-[12.5px] font-bold tabular-nums leading-none ${d === today ? 'text-brand-700' : 'text-ink'}`}>{dayNum(d)}{(i === 0 || dayNum(d) === 1) ? <span className="text-[9px] font-semibold text-muted ml-0.5">{monthShort(d)}</span> : null}</div>
              <div className={`text-[9.5px] tabular-nums mt-0.5 ${soldPer[i] >= sell.length && sell.length ? 'text-ink font-bold' : 'text-muted'}`} title="Guest spots taken that night">{soldPer[i]}/{sell.length}</div>
            </div>
          ))}
        </div>
        {sell.map(row)}
        {hold.length > 0 && (
          <div className="border-t border-line bg-slate-50/70">
            <div className="sticky left-0 inline-block px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600">Held spots — staff &amp; buffer, never sold</div>
          </div>
        )}
        {hold.map(row)}
        {!spots.length && <LeanEmpty>No spots yet — add them under Settings.</LeanEmpty>}
      </div>
      <div className="px-3 py-1.5 text-[11px] text-muted flex items-center gap-3 flex-wrap border-t border-line/70">
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-200 align-middle mr-1" />paid</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-200 align-middle mr-1" />unpaid</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-200 align-middle mr-1" />comped / included</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-300 align-middle mr-1" />staff / owner / vendor</span>
        <span><i className="inline-block w-2.5 h-2.5 rounded-sm border border-dashed border-slate-400 align-middle mr-1" />blocked</span>
        <span className="sm:ml-auto">● car seen in the spot · tap an empty night to book it</span>
      </div>
    </div>
  )
}

function Bar({ b, lot, col, clipL, clipR, onClick }: { b: Booking; lot: Lot; col: string; clipL: boolean; clipR: boolean; onClick: () => void }) {
  const tone = b.kind === 'block' ? 'bg-slate-50 text-slate-700 border-dashed border-slate-400'
    : b.kind !== 'guest' ? 'bg-slate-200 text-slate-800 border-slate-300'
      : b.paid === 'paid' ? 'bg-emerald-100 text-emerald-900 border-emerald-200'
        : b.paid === 'comped' || b.paid === 'na' ? 'bg-sky-100 text-sky-900 border-sky-200'
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
function Tonight({ lot, spots, bookings, today, canEdit, onBooking, onNew, link, onCopy, lastSweep }: {
  lot: Lot; spots: Spot[]; bookings: Booking[]; today: string; canEdit: boolean
  onBooking: (b: Booking) => void; onNew: (d: BookingDraft) => void; link: string; onCopy: (s: string, m: string) => void; lastSweep: Sweep | null
}) {
  const live = bookings.filter(b => (b.status === 'reserved' || b.status === 'parked') && b.startsOn <= today && today <= b.endsOn)
  const arriving = bookings.filter(b => (b.status === 'reserved') && b.startsOn === addDays(today, 1))
  const sell = spots.filter(s => s.kind === 'sell' && s.active)
  const hold = spots.filter(s => s.kind === 'hold' && s.active)
  // Money is amber, never red: an unpaid spot is a to-do, not an emergency.
  const paidTag = (b: Booking) => b.kind !== 'guest' ? <Tag>{b.kind}</Tag>
    : <Tag tone={b.paid === 'paid' ? 'emerald' : b.paid === 'comped' || b.paid === 'na' ? 'sky' : 'amber'}>{b.paid === 'paid' ? `paid ${cents(b.amountCents, lot.currency)}` : b.paid === 'comped' ? 'comped' : b.paid === 'na' ? 'included' : `${cents(b.amountCents, lot.currency)} unpaid`}</Tag>
  const row = (s: Spot) => {
    const here = live.filter(b => b.spotId === s.id).sort((a, b) => (a.endsOn === today ? 1 : 0) - (b.endsOn === today ? 1 : 0))
    const b = here[0] || null
    const next = here[1] || null
    if (!b) return (
      <LeanRow key={s.id} lead={<SpotChip s={s} />} name={<span className="text-muted font-medium">free tonight</span>}
        meta={s.kind === 'hold' ? 'held — never sold' : undefined}
        actions={canEdit ? <button type="button" onClick={() => onNew({ spotId: s.id, startsOn: today, endsOn: addDays(today, 1), kind: s.kind === 'hold' ? 'staff' : 'guest' })} className="h-9 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-ink hover:bg-app"><Plus size={13} /> Book</button> : undefined} />
    )
    return (
      <LeanRow key={s.id} lead={<SpotChip s={s} />} name={<>{b.plate ? <span className="font-mono mr-1.5">{b.plate}</span> : null}<span className="font-medium">{carLabel(b)}</span></>}
        meta={<>{b.guestName || b.kind}{b.unit ? ` · ${b.unit}` : ''} · {dayShort(b.startsOn)} → {dayShort(b.endsOn)}</>}
        tags={<>
          {b.endsOn === today ? <Tag tone="amber" title="Leaves this morning — the spot is free again from tonight">leaving today</Tag> : null}
          {b.status === 'parked' ? <Tag tone="emerald" title="The car has been seen in the spot">parked</Tag> : null}
          {paidTag(b)}
          {next ? <Tag tone="violet" title={`${next.guestName || next.kind} arrives tonight`}>then {lastName(next.guestName) || next.kind}</Tag> : null}
        </>}
        actions={<button type="button" onClick={() => onBooking(b)} className="h-9 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-ink hover:bg-app"><Pencil size={13} /> Open</button>} />
    )
  }
  return (
    <div>
      <div className="mb-3 rounded-2xl border border-line bg-white px-3 py-2 text-[12.5px] flex items-center gap-x-2 gap-y-1 flex-wrap">
        <span className="text-muted">{lastSweep ? <>Last lot check {whenET(lastSweep.startedAt)}{lastSweep.byName ? ' by ' + lastSweep.byName : ''} · {lastSweep.nChecked} checked{lastSweep.nFlagged ? `, ${lastSweep.nFlagged} flagged` : ''}{lastSweep.finishedAt ? '' : ' · still going'}</> : 'No lot check yet.'}</span>
        {link && <span className="ml-auto flex items-center gap-1.5">
          <button onClick={() => onCopy(link, 'Staff link copied.')} title="The link the person in the lot opens on their phone to check plates and flag cars" className="h-9 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-ink hover:bg-app"><Copy size={13} /> Copy staff link</button>
          <a href={link} target="_blank" rel="noreferrer" className="h-9 inline-flex items-center px-2 text-[12.5px] font-semibold text-brand-700 hover:underline">Open</a>
        </span>}
      </div>
      <LeanSection title="Guest spots" n={sell.length}><LeanList>{sell.map(row)}</LeanList></LeanSection>
      {hold.length > 0 && <LeanSection title="Held spots — staff & buffer" n={hold.length}><LeanList>{hold.map(row)}</LeanList></LeanSection>}
      {arriving.length > 0 && (
        <LeanSection title="Arriving tomorrow" n={arriving.length}>
          <LeanList>{arriving.map(b => <LeanRow key={b.id} lead={<SpotChip s={spots.find(s => s.id === b.spotId) || { label: '?', kind: 'sell' } as Spot} />} name={<>{b.plate ? <span className="font-mono mr-1.5">{b.plate}</span> : null}<span className="font-medium">{carLabel(b)}</span></>} meta={<>{b.guestName || b.kind}{b.unit ? ` · ${b.unit}` : ''} · {b.nights}n</>} tags={paidTag(b)} actions={<button type="button" onClick={() => onBooking(b)} className="h-9 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-ink hover:bg-app"><Pencil size={13} /> Open</button>} />)}</LeanList>
        </LeanSection>
      )}
    </div>
  )
}
const SpotChip = ({ s }: { s: Spot }) => <span className={`shrink-0 inline-flex items-center justify-center rounded-lg w-9 h-9 text-[12.5px] font-bold tabular-nums ${s.kind === 'hold' ? 'bg-slate-200 text-slate-700' : 'bg-ink text-white'}`}>{s.label}</span>

// ── FLAGS: the cars that should not be there, and the ONE next step for each ────────────────────
// A flag moves along a chain: notice to every guest in house → the wait → tow email drafted → towed.
// Each row leads with the step that is due now and nothing else; every other choice is inside the
// row. Red means a person has to act now (send the notice, the deadline has passed). A car that is
// simply on the clock is not red.
function Flags({ lot, incidents, canEdit, canFull, onSettings, onNotice, onTow, onClose, onRegister, onNote }: {
  lot: Lot; incidents: Incident[]; canEdit: boolean; canFull: boolean; onSettings: () => void
  onNotice: (i: Incident) => void; onTow: (i: Incident) => void; onClose: (i: Incident, how: 'towed' | 'resolved' | 'dismissed' | 'reopen', res?: string) => void; onRegister: (i: Incident) => void; onNote: (i: Incident, notes: string) => void
}) {
  const [now, setNow] = useState(Date.now())
  const [showClosed, setShowClosed] = useState(false)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])
  const minsLeft = (i: Incident) => (i.towDueAt ? Math.round((new Date(i.towDueAt).getTime() - now) / 60000) : null)
  const isDue = (i: Incident) => { const m = minsLeft(i); return i.status === 'notified' && m != null && m <= 0 }
  // Most urgent first: past the deadline, then waiting for a notice, then a tow email to send, then on the clock.
  const rank = (i: Incident) => (isDue(i) ? 0 : i.status === 'open' ? 1 : i.status === 'tow_drafted' ? 2 : 3)
  const open = incidents.filter(i => OPEN.indexOf(i.status) >= 0).slice().sort((a, b) => rank(a) - rank(b) || (a.seenAt < b.seenAt ? -1 : 1))
  const closed = incidents.filter(i => OPEN.indexOf(i.status) < 0)
  const go = 'shrink-0 h-9 inline-flex items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold whitespace-nowrap'
  const more = 'h-9 inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-ink hover:bg-app disabled:opacity-40'
  const row = (i: Incident) => {
    const st = INC_STATUS[i.status]
    const left = minsLeft(i)
    const due = isDue(i)
    const waiting = i.status === 'notified' && !due
    const live = OPEN.indexOf(i.status) >= 0
    let lead: ReactNode = undefined
    if (live && canEdit) {
      if (i.status === 'open') lead = <button type="button" onClick={() => onNotice(i)} title="Read and send the notice to every guest in house" className={go + ' bg-rose-600 text-white'}><Mail size={14} /> Send notice</button>
      else if (due && lot.towEmail) lead = <button type="button" onClick={() => onTow(i)} title={`Draft the tow email to ${lot.towCompany || lot.towEmail} — a person still sends it from Gmail`} className={go + ' bg-rose-600 text-white'}><Truck size={14} /> Draft tow email</button>
      else if (due) lead = <button type="button" onClick={() => onClose(i, 'towed')} title="No tow company email is on file — arrange the tow by phone, then close this" className={go + ' bg-ink text-white'}><Truck size={14} /> Mark towed</button>
      else if (i.status === 'tow_drafted') lead = <button type="button" onClick={() => onClose(i, 'towed')} title="Send the email from Gmail Drafts; when the car is gone, close this" className={go + ' bg-ink text-white'}><Truck size={14} /> Mark towed</button>
      else lead = <span title={i.towDueAt ? `Deadline ${timeET(i.towDueAt)}` : undefined} className={go + ' bg-amber-100 text-amber-800 tabular-nums'}>{left != null ? `${left} min left` : 'Notice sent'}</span>
    }
    return (
      <LeanRow key={i.id} tint={i.status === 'open' || due ? 'rose' : undefined}
        lead={lead}
        name={<><span className="font-mono mr-1.5">{i.plate || 'no plate'}</span><span className="font-medium">{carLabel(i)}</span></>}
        meta={<>{i.spotLabel ? `spot ${i.spotLabel}` : 'in the lot'} · seen {whenET(i.seenAt)}</>}
        tags={<>
          {i.kind !== 'unregistered' ? <Tag tone="amber">{INC_KIND[i.kind] || i.kind}</Tag> : null}
          {due ? <Tag tone="rose" title={i.towDueAt ? `Deadline was ${timeET(i.towDueAt)}` : undefined}>past the deadline</Tag> : null}
          {waiting && i.noticeSentAt ? <Tag title={`To ${i.noticeSentN} ${i.noticeSentN === 1 ? 'guest' : 'guests'}`}>notice sent {timeET(i.noticeSentAt)}</Tag> : null}
          {i.status === 'tow_drafted' ? <Tag tone="violet" title={i.towTo ? `Drafted to ${i.towTo}` : undefined}>send it from Gmail Drafts</Tag> : null}
          {!live ? <Tag tone={st.tone}>{st.label}</Tag> : null}
          {i.towDraftError ? <Tag tone="rose" title={i.towDraftError}>tow draft failed</Tag> : null}
        </>}
        actions={!live && canEdit ? <button type="button" onClick={() => onClose(i, 'reopen')} className={more}><RotateCw size={13} /> Reopen</button> : undefined}>
        <IncidentDetail i={i} canEdit={canEdit} onNote={onNote}>
          {live && canEdit ? <>
            <button type="button" onClick={() => onRegister(i)} title="It belongs to a guest — book it a spot instead" className={more}><Car size={13} /> Register this car</button>
            <button type="button" onClick={() => onClose(i, 'resolved', 'moved or registered')} className={more}><Check size={13} /> Car moved</button>
            {i.status !== 'open' ? <button type="button" onClick={() => onNotice(i)} className={more}><Mail size={13} /> Notice again</button> : null}
            {i.status !== 'open' && lot.towEmail && !(due && !i.towDraftId) ? <button type="button" onClick={() => onTow(i)} className={more}><Truck size={13} /> {i.towDraftId ? 'Draft tow email again' : 'Draft tow email now'}</button> : null}
            {i.status !== 'tow_drafted' && !(due && !lot.towEmail) ? <button type="button" onClick={() => onClose(i, 'towed')} className={more}><MapPinOff size={13} /> Towed</button> : null}
            <button type="button" onClick={() => onClose(i, 'dismissed', 'not an issue')} className={more}><X size={13} /> Not an issue</button>
          </> : null}
        </IncidentDetail>
      </LeanRow>
    )
  }
  return (
    <div>
      {!lot.towEmail && (
        <p className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 flex items-center gap-2 flex-wrap">
          <span>No tow company email is on file for {lot.building}, so the tow email cannot be drafted when a deadline passes.</span>
          {canFull ? <button type="button" onClick={onSettings} className="ml-auto font-semibold underline py-1.5">Add it in Settings</button> : null}
        </p>
      )}
      {open.length
        ? <LeanSection title="Open" n={open.length} right={<span title={`Flag → notice to every guest in house → ${lot.noticeMinutes === 60 ? '1 hour' : lot.noticeMinutes + ' minutes'} → tow email drafted for ${lot.towCompany || 'the tow company'} → a person sends it → towed`}>guests get {lot.noticeMinutes === 60 ? '1 hour' : lot.noticeMinutes + ' min'} after the notice</span>}><LeanList>{open.map(row)}</LeanList></LeanSection>
        : <LeanEmpty><Check size={14} className="inline mr-1 text-emerald-600" />No car is flagged. Cars get flagged from the staff link, or from Check a plate above.</LeanEmpty>}
      {closed.length > 0 && (
        <div className="mt-3">
          <button type="button" onClick={() => setShowClosed(v => !v)} aria-expanded={showClosed} className="h-9 px-1 text-[12px] font-semibold text-muted hover:text-ink">{showClosed ? 'Hide' : 'Show'} {closed.length} closed</button>
          {showClosed && <LeanList>{closed.slice(0, 30).map(row)}</LeanList>}
        </div>
      )}
    </div>
  )
}
function IncidentDetail({ i, canEdit, onNote, children }: { i: Incident; canEdit: boolean; onNote: (i: Incident, notes: string) => void; children?: ReactNode }) {
  const [notes, setNotes] = useState(i.notes || '')
  useEffect(() => setNotes(i.notes || ''), [i.notes])
  return (
    <div className="space-y-3">
      {children ? <div className="flex items-center gap-1.5 flex-wrap">{children}</div> : null}
      <div className="grid sm:grid-cols-2 gap-3 text-[12.5px]">
        <div className="space-y-1">
          {i.photoUrl && <a href={i.photoUrl} target="_blank" rel="noreferrer"><img src={i.photoUrl} alt="The car" className="rounded-lg max-h-40 border border-line" /></a>}
          <div><span className="text-muted">Seen</span> · {whenET(i.seenAt)}{i.seenBy ? ' by ' + i.seenBy : ''}{i.plateState ? ' · plate ' + i.plateState : ''}</div>
          <div><span className="text-muted">Notice</span> · {i.noticeSentAt ? `${whenET(i.noticeSentAt)} to ${i.noticeSentN} ${i.noticeSentN === 1 ? 'guest' : 'guests'} by ${i.noticeSentBy || '?'} · deadline ${i.towDueAt ? timeET(i.towDueAt) : '—'}` : 'not sent yet'}</div>
          <div><span className="text-muted">Tow email</span> · {i.towDraftedAt ? `drafted ${whenET(i.towDraftedAt)} to ${i.towTo} — in Gmail Drafts` : i.towDraftError ? <span className="text-rose-700">{i.towDraftError}</span> : 'not drafted'}</div>
          {i.towedAt && <div><span className="text-muted">Towed</span> · {whenET(i.towedAt)} by {i.towedBy}</div>}
          {i.resolvedAt && <div><span className="text-muted">{i.status === 'dismissed' ? 'Dismissed' : 'Resolved'}</span> · {whenET(i.resolvedAt)} by {i.resolvedBy}{i.resolution ? ' — ' + i.resolution : ''}</div>}
          {i.noticeLog.length > 0 && <details className="text-[11.5px]"><summary className="cursor-pointer text-muted py-1.5">Who got the notice ({i.noticeLog.length})</summary><ul className="mt-1 space-y-0.5">{i.noticeLog.map((l: any, k: number) => <li key={k}>{l.ok ? '✓' : '✗'} {l.guest}{l.unit ? ' · ' + l.unit : ''}{l.error ? <span className="text-rose-700"> — {l.error}</span> : null}</li>)}</ul></details>}
        </div>
        <div className="space-y-1.5">
          {i.noticeText && <details className="text-[11.5px]"><summary className="cursor-pointer text-muted py-1.5">The notice as sent</summary><pre className="mt-1 whitespace-pre-wrap font-sans bg-app rounded-lg p-2">{i.noticeText}</pre></details>}
          <div className="flex items-start gap-1.5">
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} disabled={!canEdit} placeholder="Notes — who you spoke to, what the owner said, the tow truck's ETA" className="flex-1 min-w-0 text-[12.5px] bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
            <button disabled={!canEdit || notes === (i.notes || '')} onClick={() => onNote(i, notes)} className="h-9 rounded-lg bg-brand-600 text-white text-[12.5px] font-semibold px-3 disabled:opacity-50">Save</button>
          </div>
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
  const inp = 'w-full min-h-[36px] text-[13px] bg-app border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60'
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
          <label className="block"><span className="text-[11px] font-semibold text-muted">Minutes after the notice</span><input disabled={ro} inputMode="numeric" value={f.noticeMinutes} onChange={e => setF({ ...f, noticeMinutes: e.target.value })} className={inp + ' tabular-nums'} /></label>
          <label className="block col-span-2"><span className="text-[11px] font-semibold text-muted">Lot address (goes in the tow email)</span><input disabled={ro} value={f.address} onChange={e => setF({ ...f, address: e.target.value })} className={inp} /></label>
          <label className="block"><span className="text-[11px] font-semibold text-muted">Tow company</span><input disabled={ro} value={f.towCompany} onChange={e => setF({ ...f, towCompany: e.target.value })} className={inp} /></label>
          <label className="block"><span className="text-[11px] font-semibold text-muted">Tow phone</span><input disabled={ro} value={f.towPhone} onChange={e => setF({ ...f, towPhone: e.target.value })} className={inp} /></label>
          <label className="block col-span-2"><span className="text-[11px] font-semibold text-muted">Tow email — the draft goes here</span><input disabled={ro} type="email" value={f.towEmail} onChange={e => setF({ ...f, towEmail: e.target.value })} placeholder="dispatch@towcompany.com" className={inp} /></label>
          <label className="block col-span-2"><span className="text-[11px] font-semibold text-muted">Lot rules (quoted in the tow email)</span><textarea disabled={ro} rows={3} value={f.rules} onChange={e => setF({ ...f, rules: e.target.value })} className={inp} /></label>
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
          <button onClick={() => onCopy(link, 'Staff link copied.')} className="h-9 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-ink hover:bg-app"><Copy size={13} /> Copy</button>
          <a href={link} target="_blank" rel="noreferrer" className="h-9 inline-flex items-center px-1 text-[12px] font-semibold text-brand-700 hover:underline">Open</a>
        </div>
        {!ro && <div className="flex items-center gap-1.5 flex-wrap">
          <input value={f.passcode} onChange={e => setF({ ...f, passcode: e.target.value })} placeholder={lot.hasPasscode ? 'Change the passcode…' : 'Add a passcode (optional)'} className={inp + ' max-w-[14rem]'} />
          <button onClick={save} disabled={busy || !f.passcode.trim()} className="h-9 rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-ink disabled:opacity-50">Set</button>
          {lot.hasPasscode && <button onClick={clearPass} className="h-9 px-1 text-[12px] font-semibold text-muted hover:text-ink">Remove passcode</button>}
          <button onClick={regen} title="Makes a new link — the old one stops working" className="ml-auto h-9 px-1 text-[12px] font-semibold text-muted hover:text-rose-700 hover:underline">New link</button>
        </div>}

        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted pt-2">Spots</h3>
        <ul className="divide-y divide-line/70 rounded-xl border border-line">
          {spots.map(s => (
            <li key={s.id} className={`flex items-center gap-2 flex-wrap px-2.5 py-1.5 text-[12.5px] ${s.active ? '' : 'opacity-50'}`}>
              <input disabled={ro} defaultValue={s.label} onBlur={e => e.target.value.trim() && e.target.value.trim() !== s.label && spot(s, { label: e.target.value.trim() })} aria-label="Spot label" className="w-14 h-9 font-bold tabular-nums bg-app border border-line rounded-lg px-2 text-[12.5px]" />
              <Pick small value={s.kind} disabled={ro} options={[{ value: 'sell', label: 'Guest', hint: 'A guest spot — sold at the rate (or included)' }, { value: 'hold', label: 'Held', hint: 'Staff & buffer — never sold' }]} onChange={(k) => spot(s, { kind: k })} />
              <input disabled={ro} defaultValue={s.note || ''} placeholder="note" onBlur={e => (e.target.value.trim() || '') !== (s.note || '') && spot(s, { note: e.target.value })} aria-label="Note on the spot" className="flex-1 min-w-[6rem] h-9 bg-app border border-line rounded-lg px-2 text-[12px]" />
              {!ro && <button onClick={() => spot(s, { active: !s.active })} title={s.active ? 'Switch the spot off (hidden from the calendar)' : 'Switch it back on'} className="h-9 px-2 text-[11.5px] font-semibold text-muted hover:text-ink">{s.active ? 'Switch off' : 'Switch on'}</button>}
            </li>
          ))}
        </ul>
        {!ro && <div className="flex items-center gap-1.5"><button onClick={() => add('sell')} className="h-9 rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-ink hover:bg-app">+ guest spot</button><button onClick={() => add('hold')} className="h-9 rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-ink hover:bg-app">+ held spot</button></div>}
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
      <div className="flex items-center gap-1 flex-wrap">{buildings.map(x => <button key={x} onClick={() => setB(x)} aria-pressed={b === x} className={'h-9 text-[12px] font-semibold px-3 rounded-full border ' + (b === x ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{x}</button>)}{!buildings.length && <span className="text-[12px] text-muted">Every known building already has a lot.</span>}</div>
      <div className="grid grid-cols-3 gap-2 max-w-md">
        <label className="block"><span className="text-[11px] font-semibold text-muted">Guest spots</span><input inputMode="numeric" value={sell} onChange={e => setSell(e.target.value)} className={inp} /></label>
        <label className="block"><span className="text-[11px] font-semibold text-muted">Held (never sold)</span><input inputMode="numeric" value={hold} onChange={e => setHold(e.target.value)} className={inp} /></label>
        <label className="block"><span className="text-[11px] font-semibold text-muted">$ per night</span><input inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} className={inp} /></label>
      </div>
      {err && <p className="text-[12px] text-rose-700">{err}</p>}
      <button onClick={make} disabled={!b || busy} className="h-9 rounded-lg bg-brand-600 text-white text-[12.5px] font-semibold px-4 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin inline" /> : `Set up ${b || 'the lot'}`}</button>
    </section>
  )
}


// ── EVERY LOT AT A GLANCE: one card per property, the spots drawn as a map ──────────────────────
function LotCard({ o, selected, onPick }: { o: LotOverview; selected: boolean; onPick: () => void }) {
  const sq = (s: LotOverview['spots'][number]) => {
    const b = s.tonight
    const cls = s.flagged ? 'bg-rose-500 text-white ring-2 ring-rose-300'
      : !b ? (s.kind === 'hold' ? 'bg-slate-100 text-slate-500 border border-dashed border-slate-300' : 'bg-white text-ink border border-line')
        : b.kind === 'block' ? 'bg-slate-50 text-slate-600 border border-dashed border-slate-400'
          : b.kind !== 'guest' ? 'bg-slate-300 text-slate-800'
            : b.paid === 'paid' ? 'bg-emerald-500 text-white' : b.paid === 'unpaid' ? 'bg-amber-400 text-amber-950' : 'bg-sky-400 text-white'
    const title = s.flagged ? `Spot ${s.label} — a flagged car is here` : b ? `Spot ${s.label} — ${b.guestName || b.kind}${b.unit ? ' · ' + b.unit : ''}${b.plate ? ' · ' + b.plate : ''}` : `Spot ${s.label} — free tonight${s.kind === 'hold' ? ' (held)' : ''}`
    return <span key={s.id} title={title} className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-[10.5px] font-bold tabular-nums ${cls}`}>{s.label}</span>
  }
  return (
    <button type="button" onClick={onPick} aria-pressed={selected} className={`text-left rounded-2xl border bg-white px-3 py-2.5 transition ${selected ? 'border-ink ring-2 ring-ink/10' : 'border-line hover:border-ink/40'}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13.5px] font-bold text-ink">{o.lot.building}</span>
        <span className="text-[12px] text-muted">{o.lot.rateCents > 0 ? `${cents(o.lot.rateCents, o.lot.currency)}/night` : 'included'}</span>
        <span className="ml-auto text-[12px] font-semibold tabular-nums text-ink">{o.sold}/{o.sellable} {o.sold >= o.sellable && o.sellable ? 'full' : 'tonight'}</span>
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
        <button onClick={() => onCopy(link, 'Staff link copied.')} className="h-9 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-ink hover:bg-app"><Copy size={13} /> Copy</button>
        <a href={link} target="_blank" rel="noreferrer" className="h-9 inline-flex items-center px-1 text-[12px] font-semibold text-brand-700 hover:underline">Open</a>
        {staffLink.hasPasscode && staffLink.passcode && <Tag tone="violet" title="The passcode the team types">passcode {staffLink.passcode}</Tag>}
      </div>
      {!ro && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input value={pass} onChange={e => setPass(e.target.value)} placeholder={staffLink.hasPasscode ? 'Change the passcode…' : 'Add a passcode (optional)'} className={inp + ' max-w-[14rem]'} />
          <button onClick={() => save({ passcode: pass.trim() }, 'Passcode set.')} disabled={busy || !pass.trim()} className="h-9 rounded-lg border border-line bg-white px-3 text-[12px] font-semibold text-ink disabled:opacity-50">Set</button>
          {staffLink.hasPasscode && <button onClick={() => save({ passcode: '' }, 'Passcode removed.')} disabled={busy} className="h-9 px-1 text-[12px] font-semibold text-muted hover:text-ink">Remove passcode</button>}
          <button onClick={() => { if (confirm('Make a new link for every lot? The old one stops working.')) save({ regenerate: true }, 'New staff link made — send it to the team again.') }} disabled={busy} title="Makes a new link — the old one stops working" className="ml-auto h-9 px-1 text-[12px] font-semibold text-muted hover:text-rose-700 hover:underline">New link</button>
        </div>
      )}
    </div>
  )
}
