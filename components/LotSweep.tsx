'use client'
// THE LOT CHECK — what the person standing in the parking lot sees on their phone (Jon, 2026-10-26:
// "a link we can share with our staff to check / scan car plates and flag unregistered cars …
// once each car is scanned, all non-cars get flagged, and it creates a guest message we can send
// to all guests, they get 1 hour or the car will be towed. It then drafts an email to our tow
// company"). "Please make this robust and easy to use."
//
// So there are exactly four things on the page, in the order they get used:
//   1. CHECK A PLATE — type it or photograph it; the answer is one line, green / amber / red.
//   2. TONIGHT — the active parking reservations (Jon, later the same day: "show active parking
//      reservations so our field team can manage and scan licence plate numbers"): every car that
//      should be in the lot tonight, with parked / left / paid / fix-the-plate, and REGISTER A CAR —
//      pick the stay, scan the plate, pick a free spot. Same engine as the office tab.
//   3. WALK THE LOT — spot by spot, three big buttons each (as expected · empty · different car).
//      Every answer is saved the moment it is tapped, so a dead battery costs one spot, not the walk.
//      Finish → every car that should not be there is a FLAG.
//   4. FLAGS — send the notice (one tap, the text is ready), draft the tow email, close it out.
// No login: the link is the key. Your name is asked once and remembered on the phone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Check, X, Camera, Flag, Mail, Truck, AlertTriangle, ChevronDown, Search, Plus, Pencil } from 'lucide-react'
import { NoticeSheet, Scanner, type ScanOutcome, type ScanRead } from '@/components/ParkingSheets'
import { Sheet } from '@/components/Sheet'
import { tidyPlate, normalizePlate, carLabel, cents, nightsBetween, addDays, rangesOverlap } from '@/lib/plate'
import type { Spot, Booking, Incident, Sweep, SweepCheck, FieldStay, BookingKind, Paid } from '@/lib/parking-lots'

type LotInfo = { id: string; name: string; building: string; rules: string | null; rateCents: number; currency: string; noticeMinutes: number; hasTow: boolean; towCompany: string | null; towPhone: string | null }
type SpotToday = Spot & { expected: Booking[]; busy?: { startsOn: string; endsOn: string }[] }
type Verdict = { plate: string; plateNorm: string; verdict: SweepCheck['verdict']; booking: Booking | null; belongsIn: Spot | null; near: { booking: Booking; spot: Spot | null }[]; note: string }
type Read = { plate: string | null; state: string | null; make: string | null; model: string | null; color: string | null; confidence: number; note: string | null }
type Photo = { base64: string; mime: string }

const TZ = 'America/New_York'
const timeET = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const dayShort = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }
const field = 'w-full rounded-2xl border border-neutral-300 px-4 py-3 text-[16px] bg-white focus:outline-none focus:ring-2 focus:ring-black/10'
const big = (tone: 'ok' | 'muted' | 'bad' | 'ink' = 'ink') => `flex-1 rounded-2xl px-3 py-3 text-[15px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-40 ${tone === 'ok' ? 'bg-emerald-600 text-white' : tone === 'bad' ? 'bg-rose-600 text-white' : tone === 'muted' ? 'bg-neutral-200 text-neutral-800' : 'bg-neutral-900 text-white'}`
const toneOf = (v: SweepCheck['verdict'] | null) => v === 'ok' || v === 'leaving_today' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : v === 'empty' ? 'border-neutral-300 bg-neutral-50 text-neutral-700' : v === 'unregistered' ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-amber-300 bg-amber-50 text-amber-900'
const VERDICT_LABEL: Record<string, string> = { ok: 'Registered — all good', leaving_today: 'Registered — leaving today', empty: 'Empty', wrong_spot: 'Wrong spot', unregistered: 'NOT registered', staff_in_sell: 'Our car in a guest spot' }
const OPEN = ['open', 'notified', 'tow_drafted']
// The second-choice buttons on a flag: same height as the main one, no colour.
const quiet = 'flex-1 rounded-2xl border border-neutral-300 bg-white px-3 py-2.5 text-[14px] font-semibold text-neutral-800 inline-flex items-center justify-center gap-1.5 disabled:opacity-40'
// A narrower field for the rows that hold three or four boxes — the big one clipped "Model" at 390px.
const fieldSm = 'w-full min-w-0 rounded-xl border border-neutral-300 px-2.5 py-3 text-[16px] bg-white focus:outline-none focus:ring-2 focus:ring-black/10'

export function LotSweep({ code }: { code: string }) {
  const [pass, setPass] = useState('')
  const [needsPass, setNeedsPass] = useState(false)
  const [label, setLabel] = useState('Parking')
  const [lot, setLot] = useState<LotInfo | null>(null)
  // ONE LINK, EVERY LOT (Jon, 2026-10-29): the all-lots link answers with the properties; the phone
  // picks one and remembers it. A lot's own link skips the picker.
  const [all, setAll] = useState(false)
  const [lotsAvail, setLotsAvail] = useState<LotInfo[]>([])
  const [lotId, setLotId] = useState<string>(() => { try { return localStorage.getItem('lot-pick-' + code) || '' } catch { return '' } })
  const [date, setDate] = useState('')
  const [spots, setSpots] = useState<SpotToday[]>([])
  const [arriving, setArriving] = useState<Booking[]>([])
  const [stays, setStays] = useState<FieldStay[]>([])
  const [register, setRegister] = useState<{ open: boolean; draft: Partial<Booking> & { spotId?: string | null } } | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [sweep, setSweep] = useState<Sweep | null>(null)
  const [name, setName] = useState('')
  const [editName, setEditName] = useState(false)
  const [flagBusy, setFlagBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [notice, setNotice] = useState<Incident | null>(null)
  // IDENTIFY THE CAR (Jon, 2026-11-06): every car that comes back NOT registered asks the person in
  // the lot for its colour, make and model before they move on — prefilled from the camera read,
  // all three required. Flags wait here in order; the sheet sits above the scanner.
  const [idQueue, setIdQueue] = useState<Incident[]>([])
  const needsId = (i: Incident) => ![i.color, i.make, i.model].every(v => String(v || '').trim())
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])
  useEffect(() => { try { setName(localStorage.getItem('lot-staff-name') || '') } catch {} }, [])
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 5000) }

  const post = useCallback(async (body: Record<string, any>) => {
    const r = await fetch('/api/public/lot/' + encodeURIComponent(code), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, pass, name, lotId: lotId || undefined }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`)
    return j
  }, [code, pass, name, lotId])

  const load = useCallback(async (p: string, quiet = false, pick?: string) => {
    if (!quiet) setLoading(true)
    setErr('')
    const want = pick ?? lotId
    try {
      // The passcode rides in a header, never in the address (addresses end up in server logs).
      const j = await fetch('/api/public/lot/' + encodeURIComponent(code) + (want ? '?lot=' + encodeURIComponent(want) : ''), { cache: 'no-store', headers: p ? { 'x-lot-pass': p } : undefined }).then(r => r.json())
      if (j?.needsPasscode) {
        // A wrong passcode used to bring the box back with no word of why.
        setNeedsPass(true); setLabel(j.label || 'Parking'); setErr(j.error || ''); setLoading(false)
        if (j.error) { try { localStorage.removeItem('lot-pass-' + code) } catch {} }
        return
      }
      if (!j?.ok) { setErr(j?.error || 'Could not open this lot.'); setLoading(false); return }
      setNeedsPass(false); setAll(!!j.all); setLotsAvail(j.lots || [])
      // Remembered on this phone, like the name — the team was typing it on every open.
      if (p) { try { localStorage.setItem('lot-pass-' + code, p) } catch {} }
      if (!j.lot) {
        // The all-lots link with no property picked yet: one lot → take it; several → ask.
        const only = (j.lots || []).length === 1 ? j.lots[0].id : ''
        if (only) { setLotId(only); try { localStorage.setItem('lot-pick-' + code, only) } catch {}; return load(p, quiet, only) }
        setLot(null); setLoading(false); return
      }
      setLot(j.lot); setDate(j.date); setSpots(j.spots || []); setArriving(j.arriving || []); setStays(j.stays || []); setIncidents(j.incidents || []); setSweep(j.sweep || null)
    } catch { setErr('No connection — check signal and try again.') } finally { setLoading(false) }
  }, [code, lotId])
  // Once, on open. A lot switch calls load itself with the passcode in hand — re-running this effect
  // would knock a passcoded link back to the passcode screen.
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    let saved = ''
    try { saved = localStorage.getItem('lot-pass-' + code) || '' } catch {}
    if (saved) setPass(saved)
    load(saved)
  }, [load, code])
  const pickLot = (id: string) => { setLotId(id); try { localStorage.setItem('lot-pick-' + code, id) } catch {}; setLot(null); load(pass, false, id) }

  const patchIncident = (inc: Incident) => setIncidents(list => list.some(x => x.id === inc.id) ? list.map(x => x.id === inc.id ? { ...x, ...inc, photoUrl: inc.photoUrl ?? x.photoUrl } : x) : [inc].concat(list))
  const saveName = (v: string) => { setName(v); try { localStorage.setItem('lot-staff-name', v) } catch {} }
  // One booking changed (parked, left, paid, plate fixed): put it in place here instead of reading
  // the whole lot again — that reload was most of the wait after every tap.
  const applyBooking = (b: Booking) => setSpots(list => list.map(s => {
    const rest = s.expected.filter(x => x.id !== b.id)
    const here = b.spotId === s.id && (b.status === 'reserved' || b.status === 'parked') && b.startsOn <= date && date <= b.endsOn
    if (!here) return rest.length === s.expected.length ? s : { ...s, expected: rest }
    return { ...s, expected: rest.concat([b]).sort((x, y) => (x.endsOn === date ? 1 : 0) - (y.endsOn === date ? 1 : 0)) }
  }))
  const flagAct = async (i: Incident, body: Record<string, any>, done: string) => {
    setFlagBusy(i.id)
    try { const j = await post({ ...body, incidentId: i.id }); if (j.incident) patchIncident(j.incident); say(done) } catch (e: any) { say(e?.message || String(e)) } finally { setFlagBusy(null) }
  }

  if (needsPass) return (
    <Frame title={label}>
      <p className="text-[15px] text-neutral-700 mb-3">This lot link has a passcode.</p>
      <input autoFocus type="password" autoCapitalize="none" autoCorrect="off" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(pass)} placeholder="Passcode" className={field} />
      <button onClick={() => load(pass)} className={big() + ' w-full mt-3'}>Open</button>
      {err && <p className="mt-2 text-[13px] text-rose-700">{err}</p>}
    </Frame>
  )
  if (loading && !lot) return <Frame title="Parking"><p className="text-neutral-600 text-[15px]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Opening the lot…</p></Frame>
  if (!lot && all && lotsAvail.length > 0) return (
    <Frame title="Parking" sub="Which property are you at?">
      <div className="grid gap-2">
        {lotsAvail.map(l => <button key={l.id} onClick={() => pickLot(l.id)} className="rounded-2xl bg-neutral-900 text-white px-4 py-4 text-left"><span className="block text-[18px] font-bold" style={serif}>{l.building}</span><span className="block text-[13px] text-white/70">{l.name} · {l.rateCents > 0 ? cents(l.rateCents, l.currency) + ' a night' : 'parking included'}</span></button>)}
      </div>
      {err && <p className="mt-3 text-[13px] text-rose-700">{err}</p>}
    </Frame>
  )
  if (!lot) return <Frame title="Parking"><p className="text-[15px] text-rose-700">{err || 'This lot link is not valid.'}</p></Frame>

  const open = incidents.filter(i => OPEN.indexOf(i.status) >= 0)
  // FLAGS LEAD THE PAGE WHEN THERE ARE ANY (2026-11-09 audit: they sat under the whole walk, so a car
  // past its deadline was four screens down). Each flag has ONE main button — the next step for that
  // car — and the other choices sit quietly under it. Red is only for "a person has to act now".
  const flagCard = (i: Incident) => {
    const left = i.towDueAt ? Math.round((new Date(i.towDueAt).getTime() - now) / 60000) : null
    const hourUp = i.status === 'notified' && left != null && left <= 0
    const waiting = i.status === 'notified' && !hourUp
    const busy = flagBusy === i.id
    const notice = () => setNotice(i)
    const tow = () => flagAct(i, { action: 'incident.tow' }, 'Tow email drafted — the office sends it.')
    const moved = () => flagAct(i, { action: 'incident.close', how: 'resolved', resolution: 'moved or registered' }, 'Closed — car moved or registered.')
    const towed = () => flagAct(i, { action: 'incident.close', how: 'towed' }, 'Marked towed.')
    const next: 'notice' | 'moved' | 'tow' | 'towed' = i.status === 'open' ? 'notice' : waiting ? 'moved' : i.status === 'tow_drafted' || !lot.hasTow ? 'towed' : 'tow'
    return (
      <div key={i.id} className={`rounded-2xl border p-3 ${i.status === 'open' || hourUp ? 'border-rose-300 bg-rose-50' : 'border-amber-200 bg-amber-50/60'}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-[17px]">{i.plate || 'no plate'}</span>
          <span className="text-[14px] text-neutral-800">{carLabel(i)}</span>
          {i.spotLabel && <span className="text-[13px] text-neutral-500">spot {i.spotLabel}</span>}
        </div>
        <div className="mt-1 text-[13px] text-neutral-700">
          {i.status === 'open' && 'Notice not sent yet.'}
          {waiting && `Notice sent ${i.noticeSentAt ? timeET(i.noticeSentAt) : ''} to ${i.noticeSentN} ${i.noticeSentN === 1 ? 'guest' : 'guests'} · ${left} min left (until ${timeET(i.towDueAt as string)}).`}
          {i.status === 'notified' && left == null && 'Notice sent.'}
          {hourUp && (lot.hasTow ? `Time is up (deadline ${timeET(i.towDueAt as string)}). Draft the tow email — the office sends it.` : `Time is up (deadline ${timeET(i.towDueAt as string)}). No tow company email is on file — tell the office.`)}
          {i.status === 'tow_drafted' && `Tow email drafted ${i.towDraftedAt ? timeET(i.towDraftedAt) : ''} — waiting for the office to send it.`}
        </div>
        {i.photoUrl && <img src={i.photoUrl} alt="" className="mt-2 rounded-xl max-h-36 border border-neutral-200" />}
        {needsId(i) && <button onClick={() => setIdQueue(q => q.some(x => x.id === i.id) ? q : [i].concat(q))} className="mt-2 w-full rounded-2xl border border-neutral-400 bg-white px-3 py-2.5 text-[14px] font-bold text-neutral-900">Add the colour, make and model</button>}
        <div className="mt-2 flex">
          {next === 'notice' && <button onClick={notice} disabled={busy} className={big('bad')}><Mail size={15} /> Send notice</button>}
          {next === 'moved' && <button onClick={moved} disabled={busy} className={big('ok')}><Check size={15} /> Car moved or registered</button>}
          {next === 'tow' && <button onClick={tow} disabled={busy} className={big('bad')}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Truck size={15} />} Draft tow email</button>}
          {next === 'towed' && <button onClick={towed} disabled={busy} className={big('ink')}><Truck size={15} /> Car was towed</button>}
        </div>
        <div className="mt-2 flex gap-2 flex-wrap">
          {next !== 'notice' && <button onClick={notice} disabled={busy} className={quiet}>Notice again</button>}
          {next !== 'moved' && <button onClick={moved} disabled={busy} className={quiet}>Car moved</button>}
          {next !== 'tow' && lot.hasTow && i.status !== 'open' && <button onClick={tow} disabled={busy} className={quiet}>{i.towDraftedAt ? 'Tow email again' : 'Tow email'}</button>}
          {next !== 'towed' && i.status !== 'open' && <button onClick={towed} disabled={busy} className={quiet}>Towed</button>}
        </div>
      </div>
    )
  }
  const flagsSection = (
    <section className="mb-6">
      <h2 style={serif} className="text-[22px] text-neutral-900 mb-1">Flags <span className="text-neutral-400">{open.length}</span></h2>
      {open.length === 0
        ? <p className="rounded-2xl border border-dashed border-neutral-300 px-4 py-4 text-[14px] text-neutral-500 text-center">Nothing flagged right now.</p>
        : <p className="text-[13px] text-neutral-500 mb-3">Each car gets {lot.noticeMinutes === 60 ? 'one hour' : lot.noticeMinutes + ' minutes'} from the notice. Then the tow email is drafted{lot.towCompany ? ' for ' + lot.towCompany : ''} — the office sends it.</p>}
      <div className="space-y-2">{open.map(flagCard)}</div>
    </section>
  )
  return (
    <Frame title={lot.name} sub={<>{new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {lot.rateCents > 0 ? `${cents(lot.rateCents, lot.currency)} a night` : 'parking included'} · {spots.filter(s => s.kind === 'sell').length} guest spots{spots.some(s => s.kind === 'hold') ? `, ${spots.filter(s => s.kind === 'hold').length} held` : ''}</>}>
      {toast && <div className="fixed bottom-4 left-4 right-4 z-[95] rounded-2xl bg-neutral-900 text-white text-[14px] px-4 py-3 shadow-lg">{toast}</div>}
      {err && <p className="mb-3 text-[13px] text-rose-700 inline-flex items-center gap-1"><AlertTriangle size={14} /> {err}</p>}

      {/* THE PROPERTY — one tap to switch lots on the all-lots link. */}
      {all && lotsAvail.length > 1 && (
        <div className="mb-4 flex gap-1.5 flex-wrap">
          {lotsAvail.map(l => <button key={l.id} onClick={() => l.id !== lot.id && pickLot(l.id)} aria-pressed={l.id === lot.id} className={`rounded-full px-4 py-2 text-[14px] font-bold border ${l.id === lot.id ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-700 border-neutral-300'}`}>{l.building}</button>)}
        </div>
      )}

      {/* YOUR NAME — asked once, then one quiet line. Every flag and every notice says who stood in the lot. */}
      {name.trim() && !editName ? (
        <p className="mb-4 text-[13px] text-neutral-500">Checking as <b className="text-neutral-800">{name.trim()}</b><button type="button" onClick={() => setEditName(true)} className="ml-2 py-2 px-1 font-semibold underline">change</button></p>
      ) : (
        <label className="block mb-4">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">Your name</span>
          <input value={name} autoFocus={editName} onFocus={() => setEditName(true)} onBlur={() => setEditName(false)} onChange={e => saveName(e.target.value)} placeholder="So the record says who checked" className={field + ' mt-1'} />
        </label>
      )}

      {open.length > 0 && flagsSection}

      <CheckPlate spots={spots} post={post} onFlagged={(inc, photoError) => { patchIncident(inc); setIdQueue(q => q.some(x => x.id === inc.id) ? q : q.concat(inc)); say(photoError ? `Flagged, but the photo was not saved (${photoError}).` : 'Flagged — now identify the car.') }}
        onRegister={(plate, read) => setRegister({ open: true, draft: { plate, make: read?.make || null, model: read?.model || null, color: read?.color || null, plateState: read?.state || null } })} />

      <Tonight lot={lot} spots={spots} arriving={arriving} date={date} post={post}
        onBooking={applyBooking}
        onRegister={() => setRegister({ open: true, draft: {} })}
        say={say} />

      <Walk spots={spots} date={date} sweep={sweep} setSweep={setSweep} post={post} onFinished={(sw, made) => { setSweep(sw); made.forEach(patchIncident); setIdQueue(q => q.concat(made.filter(m => !q.some(x => x.id === m.id)))); say(made.length ? `${made.length} ${made.length === 1 ? 'car' : 'cars'} flagged — send the notice at the top of the page.` : 'Lot check done — every car is where it should be.'); if (made.length) { try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch {} } }} />

      {open.length === 0 && <div className="mt-6">{flagsSection}</div>}

      {lot.rules && <details className="mt-6 text-[13px] text-neutral-600"><summary className="cursor-pointer font-semibold py-2">Lot rules</summary><p className="mt-1">{lot.rules}</p></details>}
      <p className="mt-6 text-[12px] text-neutral-400">Lighthouse · the office sees everything you do here on the Parking tab.</p>

      {idQueue[0] && <IdentifyCar inc={idQueue[0]} left={idQueue.length} post={post}
        onSaved={inc => { patchIncident(inc); setIdQueue(q => q.slice(1)); say('Car saved.') }}
        onLater={() => setIdQueue(q => q.slice(1))} />}

      <NoticeSheet open={!!notice} onClose={() => setNotice(null)} lot={lot} incident={notice} publicCode={code} publicPass={pass} staffName={name}
        onSent={(inc, sent, failed, warning) => { patchIncident(inc); if (!warning) load(pass, true); say(warning || `Notice sent to ${sent} ${sent === 1 ? 'guest' : 'guests'}${failed ? `, ${failed} failed` : ''}. The clock runs until ${inc.towDueAt ? timeET(inc.towDueAt) : 'the deadline'}.`) }} />
      <RegisterSheet open={!!register?.open} onClose={() => setRegister(null)} lot={lot} spots={spots} stays={stays} date={date} post={post} draft={register?.draft || {}}
        onSaved={(b, note) => { load(pass, true); say(`Registered on spot ${spots.find(s => s.id === b.spotId)?.label || '?'}.${note === 'ok' ? ' Noted on the reservation in Guesty.' : ''}`) }} />
    </Frame>
  )
}

// ── 2. TONIGHT — the active parking reservations, and Register a car ────────────────────────────
function Tonight({ lot, spots, arriving, date, post, onBooking, onRegister, say }: {
  lot: LotInfo; spots: SpotToday[]; arriving: Booking[]; date: string; post: (b: Record<string, any>) => Promise<any>
  onBooking: (b: Booking) => void; onRegister: () => void; say: (m: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; plate: string; make: string; model: string; color: string } | null>(null)
  const rows = spots.filter(s => s.expected.length > 0)
  const free = spots.filter(s => s.expected.length === 0)
  const patch = async (b: Booking, p: Record<string, any>, done: string) => {
    setBusy(b.id)
    try { const j = await post({ action: 'booking.update', bookingId: b.id, patch: p }); if (j.booking) onBooking(j.booking as Booking); say(done); setEdit(null) } catch (e: any) { say(e?.message || String(e)) } finally { setBusy(null) }
  }
  const row = (s: SpotToday, b: Booking, extra?: string) => {
    const isOpen = openId === b.id
    const paidTag = b.kind === 'guest' ? (b.paid === 'paid' ? `paid ${cents(b.amountCents, lot.currency)}` : b.paid === 'comped' ? 'comped' : b.paid === 'na' ? 'included' : `${cents(b.amountCents, lot.currency)} unpaid`) : b.kind
    return (
      <div key={b.id} className={`rounded-2xl border bg-white ${b.status === 'parked' ? 'border-emerald-300' : 'border-neutral-300'}`}>
        <button type="button" onClick={() => setOpenId(isOpen ? null : b.id)} className="w-full text-left px-3 py-2.5 flex items-start gap-3">
          <span className={`shrink-0 inline-flex items-center justify-center rounded-xl w-11 h-11 text-[17px] font-bold tabular-nums ${s.kind === 'hold' ? 'bg-neutral-300 text-neutral-800' : 'bg-neutral-900 text-white'}`}>{s.label}</span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-bold"><span className="font-mono">{b.plate || 'no plate'}</span> <span className="font-semibold text-neutral-700">{carLabel(b)}</span></span>
            <span className="block text-[13px] text-neutral-600 truncate">{b.guestName || b.kind}{b.unit ? ' · ' + b.unit : ''} · {dayShort(b.startsOn)} → {dayShort(b.endsOn)}{extra ? ' · ' + extra : ''}</span>
            <span className="block mt-1 text-[12px] font-semibold">
              <span className={`inline-block rounded-md px-1.5 py-0.5 mr-1 ${b.status === 'parked' ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-100 text-neutral-700'}`}>{b.status === 'parked' ? 'parked' : 'reserved'}</span>
              <span className={`inline-block rounded-md px-1.5 py-0.5 mr-1 ${b.kind !== 'guest' ? 'bg-neutral-100 text-neutral-700' : b.paid === 'paid' ? 'bg-emerald-100 text-emerald-800' : b.paid === 'comped' || b.paid === 'na' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}`}>{paidTag}</span>
              {b.endsOn === date && <span className="inline-block rounded-md px-1.5 py-0.5 bg-amber-100 text-amber-800">leaving today</span>}
            </span>
          </span>
          <ChevronDown size={16} className={`shrink-0 mt-3 text-neutral-400 transition ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
          <div className="px-3 pb-3 space-y-2">
            <div className="flex gap-2">
              {b.status !== 'parked' && <button disabled={busy === b.id} onClick={() => patch(b, { status: 'parked' }, 'Marked parked.')} className={big('ok')}><Check size={15} /> Car is here</button>}
              <button disabled={busy === b.id} onClick={() => patch(b, { status: 'left' }, 'Marked left — the spot is free.')} className={big('muted')}>Car left</button>
            </div>
            {b.kind === 'guest' && b.paid !== 'paid' && b.paid !== 'na' && (
              <div className="flex gap-2">
                <button disabled={busy === b.id} onClick={() => patch(b, { paid: 'paid', paidVia: 'cash' }, 'Paid in cash.')} className={big('ink')}>Paid cash</button>
                <button disabled={busy === b.id} onClick={() => patch(b, { paid: 'paid', paidVia: 'card' }, 'Paid by card.')} className={big('ink')}>Paid card</button>
                <button disabled={busy === b.id} onClick={() => patch(b, { paid: 'paid', paidVia: 'guesty' }, 'Paid through Guesty.')} className={big('ink')}>In Guesty</button>
              </div>
            )}
            {edit?.id === b.id ? (
              <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-2.5 space-y-2">
                <input value={edit.plate} onChange={e => setEdit({ ...edit, plate: e.target.value.toUpperCase() })} placeholder="PLATE" autoCapitalize="characters" className={field + ' font-mono font-bold tracking-widest uppercase'} />
                <div className="grid grid-cols-3 gap-2">
                  <input value={edit.color} onChange={e => setEdit({ ...edit, color: e.target.value })} placeholder="Colour" className={fieldSm} />
                  <input value={edit.make} onChange={e => setEdit({ ...edit, make: e.target.value })} placeholder="Make" className={fieldSm} />
                  <input value={edit.model} onChange={e => setEdit({ ...edit, model: e.target.value })} placeholder="Model" className={fieldSm} />
                </div>
                <div className="flex gap-2">
                  <button disabled={busy === b.id || !normalizePlate(edit.plate)} onClick={() => patch(b, { plate: edit.plate, make: edit.make, model: edit.model, color: edit.color }, 'Car updated.')} className={big()}><Check size={15} /> Save</button>
                  <button onClick={() => setEdit(null)} className={big('muted') + ' flex-none px-4'}><X size={15} /></button>
                </div>
              </div>
            ) : (
              <button onClick={() => setEdit({ id: b.id, plate: b.plate || '', make: b.make || '', model: b.model || '', color: b.color || '' })} className="text-[13px] font-semibold text-neutral-600 inline-flex items-center gap-1 py-2"><Pencil size={13} /> Fix the plate or car</button>
            )}
          </div>
        )}
      </div>
    )
  }
  return (
    <section className="mb-6">
      <div className="flex items-end justify-between gap-2 mb-2">
        <h2 style={serif} className="text-[22px] text-neutral-900">Tonight <span className="text-neutral-400">{rows.reduce((a, s) => a + s.expected.length, 0)}</span></h2>
        <button onClick={onRegister} className="rounded-2xl bg-neutral-900 text-white px-3.5 py-2 text-[14px] font-bold inline-flex items-center gap-1"><Plus size={15} /> Register a car</button>
      </div>
      {rows.length === 0 && <p className="rounded-2xl border border-dashed border-neutral-300 px-4 py-4 text-[14px] text-neutral-500 text-center">No car is registered for tonight yet.</p>}
      <div className="space-y-2">
        {rows.map(s => s.expected.map((b, i) => row(s, b, i > 0 ? 'arrives tonight' : undefined)))}
      </div>
      {free.length > 0 && <p className="mt-2 text-[13px] text-neutral-500"><b className="text-neutral-700">Free tonight:</b> {free.map(s => s.label).join(', ')}</p>}
      {arriving.length > 0 && (
        <details className="mt-3 text-[13px] text-neutral-600">
          <summary className="cursor-pointer font-semibold">Arriving tomorrow ({arriving.length})</summary>
          <ul className="mt-1 space-y-1">
            {arriving.map(b => <li key={b.id}><span className="font-mono font-bold">{b.plate || '—'}</span> {carLabel(b)} · {b.guestName || b.kind}{b.unit ? ' · ' + b.unit : ''} · spot {spots.find(s => s.id === b.spotId)?.label || '?'} · {b.nights}n</li>)}
          </ul>
        </details>
      )}
    </section>
  )
}

// ── REGISTER A CAR — the stay, the plate (scanned or typed), a free spot ────────────────────────
function RegisterSheet({ open, onClose, lot, spots, stays, date, post, draft, onSaved }: {
  open: boolean; onClose: () => void; lot: LotInfo; spots: SpotToday[]; stays: FieldStay[]; date: string
  post: (b: Record<string, any>) => Promise<any>; draft: Partial<Booking> & { spotId?: string | null }; onSaved: (b: Booking, note: string | null) => void
}) {
  const [kind, setKind] = useState<BookingKind>('guest')
  const [stay, setStay] = useState<FieldStay | null>(null)
  const [own, setOwn] = useState('')
  const [q, setQ] = useState('')
  const [car, setCar] = useState({ plate: '', plateState: '', make: '', model: '', color: '' })
  const [startsOn, setStartsOn] = useState(date)
  const [endsOn, setEndsOn] = useState(addDays(date, 1))
  const [spotId, setSpotId] = useState<string | null>(null)
  const [paid, setPaid] = useState<Paid>('unpaid')
  const [via, setVia] = useState('cash')
  const [parkedNow, setParkedNow] = useState(true)
  const [busy, setBusy] = useState<'save' | 'scan' | null>(null)
  const [err, setErr] = useState('')
  const [read, setRead] = useState<Read | null>(null)
  useEffect(() => {
    if (!open) return
    setKind('guest'); setStay(null); setOwn(''); setQ(''); setErr(''); setRead(null); setPaid('unpaid'); setVia('cash'); setParkedNow(true)
    setCar({ plate: draft.plate || '', plateState: draft.plateState || '', make: draft.make || '', model: draft.model || '', color: draft.color || '' })
    setStartsOn(date); setEndsOn(addDays(date, 1)); setSpotId(draft.spotId || null)
  }, [open, draft, date])
  // Which spots are free for the whole run (the server checks again on save).
  const taken = useMemo(() => {
    const out: Record<string, boolean> = {}
    // `busy` is every live booking on the spot for the week ahead; `expected` (today only) is the
    // fallback, and it let a spot booked from tomorrow look free until the save was refused.
    for (const s of spots) {
      const nights: { startsOn: string; endsOn: string }[] = s.busy || s.expected.filter(b => b.status === 'reserved' || b.status === 'parked')
      out[s.id] = nights.some(b => rangesOverlap(b.startsOn, b.endsOn, startsOn, endsOn))
    }
    return out
  }, [spots, startsOn, endsOn])
  useEffect(() => {
    if (!open) return
    const ok = (s: SpotToday) => s.active && !taken[s.id] && (kind !== 'guest' || s.kind === 'sell')
    const cur = spots.find(s => s.id === spotId)
    if (cur && ok(cur)) return
    const pref = spots.slice().sort((a, b) => (kind === 'guest' ? (a.kind === 'sell' ? 0 : 1) - (b.kind === 'sell' ? 0 : 1) : (a.kind === 'hold' ? 0 : 1) - (b.kind === 'hold' ? 0 : 1)) || a.sort - b.sort).find(ok)
    setSpotId(pref ? pref.id : null)
  }, [open, kind, taken, spots, spotId])
  const nights = nightsBetween(startsOn, endsOn)
  const pickStay = (s: FieldStay) => { setStay(s); setStartsOn(s.checkIn <= date ? date : s.checkIn); setEndsOn(s.checkOut > date ? s.checkOut : addDays(date, 1)) }
  const [scanning, setScanning] = useState(false)
  const readFrame = async (ph: Photo | null, typed?: string): Promise<ScanOutcome> => {
    if (typed) return { read: { plate: typed, state: null, make: null, model: null, color: null, confidence: 1, note: null } }
    if (!ph) return { read: null }
    const j = await post({ action: 'plate.read', photo: ph.base64, photoMime: ph.mime })
    return { read: j.read || null }
  }
  const useRead = (rd: ScanRead) => { setRead(rd); setCar(c => ({ ...c, plate: rd.plate || c.plate, plateState: rd.state || c.plateState, make: rd.make || c.make, model: rd.model || c.model, color: rd.color || c.color })) }
  const save = async () => {
    setBusy('save'); setErr('')
    try {
      if (!normalizePlate(car.plate)) throw new Error('Type or scan the plate first.')
      if (kind === 'guest' && !stay) throw new Error('Pick the stay this car belongs to.')
      if (!spotId) throw new Error('No spot is free for those nights.')
      const j = await post({
        action: 'booking.create', kind, spotId, startsOn, endsOn,
        reservationId: stay?.id || null, unit: stay?.unit || null, guestName: kind === 'guest' ? stay?.guest || null : (own.trim() || null),
        plate: car.plate, plateState: car.plateState, make: car.make, model: car.model, color: car.color,
        paid: kind === 'guest' ? paid : 'na', paidVia: via, status: parkedNow ? 'parked' : 'reserved',
      })
      onSaved(j.booking, j.guestyNote || null); onClose()
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const needle = q.trim().toLowerCase()
  const list = stays.filter(s => !needle || (s.guest + ' ' + s.unit).toLowerCase().indexOf(needle) >= 0)
  const pill = (on: boolean) => `rounded-full border px-3 py-1.5 text-[13px] font-semibold ${on ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white text-neutral-700 border-neutral-300'}`
  return (
    <Sheet open={open} onClose={onClose} title="Register a car" subtitle={`${lot.name} · ${lot.rateCents > 0 ? cents(lot.rateCents, lot.currency) + ' a night' : 'parking included, one space per reservation'}`}
      footer={<div className="flex items-center gap-2">
        {err && <span className="text-[12.5px] text-rose-700 mr-auto">{err}</span>}
        <button onClick={onClose} className="text-[13px] font-semibold text-neutral-600 px-3 py-2 ml-auto">Cancel</button>
        <button onClick={save} disabled={busy != null} className="rounded-xl bg-neutral-900 text-white text-[14px] font-bold px-4 py-2.5 disabled:opacity-50 inline-flex items-center gap-1.5">{busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Register</button>
      </div>}>
      <div className="space-y-4">
        <div className="flex gap-1.5 flex-wrap">
          {(['guest', 'staff', 'vendor'] as BookingKind[]).map(k => <button key={k} onClick={() => { setKind(k); setSpotId(null) }} className={pill(kind === k)}>{k === 'guest' ? 'Guest' : k === 'staff' ? 'Staff' : 'Vendor'}</button>)}
        </div>
        {kind === 'guest' ? (
          stay ? (
            <div className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-[14px]">
              <span className="font-bold">{stay.guest}</span><span className="text-neutral-600">· {stay.unit} · {dayShort(stay.checkIn)} → {dayShort(stay.checkOut)}</span>
              <button onClick={() => setStay(null)} className="ml-auto text-neutral-500"><X size={16} /></button>
            </div>
          ) : (
            <div>
              <div className="relative"><Search size={15} className="absolute left-3.5 top-4 text-neutral-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Guest or unit…" className={field + ' pl-10'} /></div>
              <div className="mt-1.5 max-h-52 overflow-y-auto rounded-xl border border-neutral-300 divide-y divide-neutral-200 bg-white">
                {list.length === 0 && <div className="px-3 py-2 text-[13px] text-neutral-500">No stay matches.</div>}
                {list.slice(0, 40).map(s => (
                  <button key={s.id} onClick={() => pickStay(s)} className="w-full text-left px-3 py-2 text-[14px] flex items-center gap-2 flex-wrap">
                    <span className="font-bold">{s.guest}</span><span className="text-neutral-600">{s.unit} · {dayShort(s.checkIn)} → {dayShort(s.checkOut)}</span>
                    {s.inHouse && <span className="text-[11px] font-bold rounded-md bg-emerald-100 text-emerald-800 px-1.5 py-0.5">in house</span>}
                    {s.arrivesToday && <span className="text-[11px] font-bold rounded-md bg-amber-100 text-amber-800 px-1.5 py-0.5">arrives today</span>}
                    {s.hasSpot && <span className="text-[11px] font-bold rounded-md bg-violet-100 text-violet-800 px-1.5 py-0.5">has spot {s.hasSpot}</span>}
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          <input value={own} onChange={e => setOwn(e.target.value)} placeholder={kind === 'staff' ? 'Whose car' : 'Vendor / company'} className={field} />
        )}
        <div className="space-y-2">
          <div className="flex gap-2">
            <input value={car.plate} onChange={e => setCar({ ...car, plate: e.target.value.toUpperCase() })} placeholder="PLATE" autoCapitalize="characters" autoCorrect="off" className={field + ' font-mono font-bold tracking-widest uppercase'} />
            <button type="button" onClick={() => setScanning(true)} className="inline-flex items-center gap-1.5 rounded-2xl bg-neutral-900 text-white px-4 text-[14px] font-bold"><Camera size={16} /> Scan</button>
            <Scanner open={scanning} onClose={() => setScanning(false)} mode="single" title="Scan the plate" scan={readFrame} onPick={rd => useRead(rd)} />
          </div>
          {read && <p className="text-[12.5px] text-neutral-500">Camera read <b className="font-mono">{read.plate || '?'}</b>{read.confidence < 0.7 ? ' — not sure, check it against the car' : ''}{read.note ? ` · ${read.note}` : ''}</p>}
          <div className="grid grid-cols-2 gap-2">
            <input value={car.color} onChange={e => setCar({ ...car, color: e.target.value })} placeholder="Colour" className={fieldSm} />
            <input value={car.make} onChange={e => setCar({ ...car, make: e.target.value })} placeholder="Make" className={fieldSm} />
            <input value={car.model} onChange={e => setCar({ ...car, model: e.target.value })} placeholder="Model" className={fieldSm} />
            <input value={car.plateState} onChange={e => setCar({ ...car, plateState: e.target.value.toUpperCase().slice(0, 3) })} placeholder="State (FL)" className={fieldSm + ' uppercase placeholder:normal-case'} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 items-end">
          <label className="block"><span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">First night</span><input type="date" value={startsOn} onChange={e => { setStartsOn(e.target.value); if (e.target.value >= endsOn) setEndsOn(addDays(e.target.value, 1)) }} className={field + ' mt-1'} /></label>
          <label className="block"><span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">Leaves on</span><input type="date" value={endsOn} min={addDays(startsOn, 1)} onChange={e => setEndsOn(e.target.value)} className={field + ' mt-1'} /></label>
        </div>
        <div>
          <span className="block text-[12px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Spot · {nights} {nights === 1 ? 'night' : 'nights'}{kind === 'guest' && lot.rateCents > 0 ? ` · ${cents(nights * lot.rateCents, lot.currency)}` : ''}</span>
          <div className="grid grid-cols-5 gap-1.5">
            {spots.map(s => {
              const off = !s.active || taken[s.id] || (kind === 'guest' && s.kind === 'hold')
              return <button key={s.id} disabled={off && spotId !== s.id} onClick={() => setSpotId(s.id)} className={`rounded-xl py-2.5 text-[15px] font-bold disabled:opacity-30 ${spotId === s.id ? 'bg-neutral-900 text-white' : s.kind === 'hold' ? 'bg-neutral-200' : 'bg-neutral-100'}`}>{s.label}{taken[s.id] ? <span className="block text-[10px] font-semibold">taken</span> : s.kind === 'hold' ? <span className="block text-[10px] font-semibold">held</span> : null}</button>
            })}
          </div>
          {!spotId && <p className="mt-1 text-[12.5px] text-rose-700">No spot is free for those nights.</p>}
        </div>
        {kind === 'guest' && lot.rateCents > 0 && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <button onClick={() => setPaid('unpaid')} className={pill(paid === 'unpaid')}>Unpaid</button>
            <button onClick={() => { setPaid('paid'); setVia('cash') }} className={pill(paid === 'paid' && via === 'cash')}>Paid cash</button>
            <button onClick={() => { setPaid('paid'); setVia('card') }} className={pill(paid === 'paid' && via === 'card')}>Paid card</button>
            <button onClick={() => { setPaid('paid'); setVia('guesty') }} className={pill(paid === 'paid' && via === 'guesty')}>Paid in Guesty</button>
            <button onClick={() => setPaid('comped')} className={pill(paid === 'comped')}>Comped</button>
          </div>
        )}
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={parkedNow} onChange={e => setParkedNow(e.target.checked)} className="w-5 h-5" /> The car is in the spot now</label>
      </div>
    </Sheet>
  )
}

function Frame({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#F6F4EF] text-neutral-900">
      <div className="max-w-md mx-auto px-4 pt-5 pb-16">
        <h1 style={serif} className="text-[28px] leading-tight">{title}</h1>
        {sub && <p className="text-[13px] text-neutral-500 mt-0.5 mb-4">{sub}</p>}
        {children}
      </div>
    </main>
  )
}

// ── 1. CHECK A PLATE ────────────────────────────────────────────────────────────────────────────
const verdictLine = (v: Verdict): NonNullable<ScanOutcome['verdict']> => {
  const who = v.booking ? `${v.booking.guestName || v.booking.kind}${v.booking.unit ? ' · ' + v.booking.unit : ''}` : ''
  if (v.verdict === 'ok' || v.verdict === 'leaving_today') return { tone: 'ok', title: `Confirmed — spot ${v.belongsIn?.label || '?'}${v.verdict === 'leaving_today' ? ', leaving today' : ''}`, note: who }
  if (v.verdict === 'wrong_spot') return { tone: 'warn', title: `Wrong spot — belongs in ${v.belongsIn?.label || '?'}`, note: who }
  if (v.verdict === 'staff_in_sell') return { tone: 'warn', title: `Our car in a guest spot — belongs in ${v.belongsIn?.label || '?'}`, note: who }
  return { tone: 'bad', title: 'NOT registered', note: v.near.length ? `Close to ${v.near.map(n => n.booking.plate).join(', ')} — check the plate` : undefined }
}

function CheckPlate({ spots, post, onFlagged, onRegister }: { spots: SpotToday[]; post: (b: Record<string, any>) => Promise<any>; onFlagged: (i: Incident, photoError?: string | null) => void; onRegister: (plate: string, read: Read | null) => void }) {
  const [plate, setPlate] = useState('')
  const [v, setV] = useState<Verdict | null>(null)
  const [spotId, setSpotId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'check' | 'flag' | null>(null)
  const [err, setErr] = useState('')
  const check = async (p = plate) => {
    if (!normalizePlate(p)) return
    setBusy('check'); setErr('')
    try { const j = await post({ action: 'plate.judge', plate: p, spotId }); setV(j) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const [scanning, setScanning] = useState(false)
  const flagVerdict = async (verdict: Verdict, rd: Read | null, ph: Photo | null) => {
    const sp = spots.find(s => s.id === spotId)
    const j = await post({ action: 'incident.open', plate: verdict.plate, kind: verdict.verdict === 'wrong_spot' ? 'wrong_spot' : verdict.verdict === 'staff_in_sell' ? 'staff_in_sell' : 'unregistered', bookingId: verdict.booking?.id || null, spotId, spotLabel: sp?.label || null, make: rd?.make || verdict.booking?.make || null, model: rd?.model || verdict.booking?.model || null, color: rd?.color || verdict.booking?.color || null, plateState: rd?.state || null, photo: ph?.base64, photoMime: ph?.mime })
    onFlagged(j.incident, j.photoError || null)
    return j.incident as Incident
  }
  // THE SCANNER'S VERDICT STRIP: what one frame means here. Green = registered (where), amber = wrong
  // spot, red = not registered with Flag / Register on the strip, so the next car is one tap away.
  const scanFrame = async (ph: Photo | null, typed?: string): Promise<ScanOutcome> => {
    let rd: ScanRead | null = null
    let verdict: Verdict | null = null
    if (typed) { verdict = await post({ action: 'plate.judge', plate: typed, spotId }); rd = { plate: verdict?.plate || typed, state: null, make: null, model: null, color: null, confidence: 1, note: null } }
    else if (ph) { const j = await post({ action: 'plate.read', photo: ph.base64, photoMime: ph.mime, spotId }); rd = j.read || null; verdict = j.judged || null }
    if (!rd?.plate) return { read: rd }
    if (!verdict || rd.confidence < 0.7) return { read: rd, verdict: verdict ? verdictLine(verdict) : null }
    const bad = verdict.verdict !== 'ok' && verdict.verdict !== 'leaving_today' && verdict.verdict !== 'empty'
    const v2 = verdict
    return {
      read: rd, verdict: verdictLine(v2),
      actions: bad ? [
        { label: 'Flag this car', tone: 'bad', run: async () => { await flagVerdict(v2, rd, ph); return 'Flagged — the notice is at the top of the page.' } },
        ...(v2.verdict === 'unregistered' ? [{ label: 'Register it', tone: 'muted' as const, run: async () => { onRegister(v2.plate, rd); setScanning(false); return 'Opening the form…' } }] : []),
      ] : undefined,
    }
  }
  const flag = async () => {
    if (!v) return
    setBusy('flag'); setErr('')
    try { await flagVerdict(v, null, null); setV(null); setPlate('') } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const bad = v && v.verdict !== 'ok' && v.verdict !== 'leaving_today' && v.verdict !== 'empty'
  return (
    <section className="mb-6">
      <h2 style={serif} className="text-[22px] text-neutral-900 mb-2">Check a plate</h2>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-4 text-neutral-400" />
          <input value={plate} onChange={e => { setPlate(e.target.value.toUpperCase()); setV(null) }} onKeyDown={e => e.key === 'Enter' && check()} placeholder="PLATE" autoCapitalize="characters" autoCorrect="off" className={field + ' pl-10 font-mono font-bold tracking-widest uppercase'} />
        </div>
        <button onClick={() => check()} disabled={busy != null || !normalizePlate(plate)} className="rounded-2xl bg-neutral-900 text-white px-4 font-bold text-[15px] disabled:opacity-40">{busy === 'check' ? <Loader2 size={16} className="animate-spin" /> : 'Check'}</button>
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setScanning(true)} className="inline-flex items-center gap-1.5 rounded-2xl bg-neutral-900 text-white px-4 py-2.5 text-[14px] font-bold"><Camera size={16} /> Scan plates</button>
        <SpotPick spots={spots} value={spotId} onChange={setSpotId} />
      </div>
      <Scanner open={scanning} onClose={() => setScanning(false)} mode="multi" title={`Scan plates${spots.find(s => s.id === spotId) ? ' · spot ' + spots.find(s => s.id === spotId)!.label : ''}`} scan={scanFrame} />
      {err && <p className="mt-2 text-[13px] text-rose-700">{err}</p>}
      {v && (
        <div className={`mt-3 rounded-2xl border-2 p-3 ${toneOf(v.verdict)}`}>
          <div className="text-[17px] font-bold">{VERDICT_LABEL[v.verdict] || v.verdict}</div>
          <div className="text-[14px] mt-0.5">{v.note}</div>
          {v.booking && <div className="text-[13px] mt-1 opacity-80">{carLabel(v.booking)} · {v.booking.guestName || v.booking.kind}{v.booking.unit ? ' · ' + v.booking.unit : ''} · spot {v.belongsIn?.label || '?'} · through {new Date(v.booking.endsOn + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>}
          {v.near.length > 0 && <div className="text-[13px] mt-1">Did you mean {v.near.map(n => <button key={n.booking.id} onClick={() => { setPlate(n.booking.plate || ''); check(n.booking.plate || '') }} className="font-mono font-bold underline mr-2">{n.booking.plate}</button>)}?</div>}
          {bad && (
            <div className="flex gap-2 mt-3">
              <button onClick={flag} disabled={busy != null} className={big('bad')}>{busy === 'flag' ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />} Flag this car</button>
              {v.verdict === 'unregistered' && <button onClick={() => { onRegister(v.plate, null); setV(null); setPlate('') }} disabled={busy != null} className={big('muted')}><Plus size={16} /> Register it</button>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function SpotPick({ spots, value, onChange }: { spots: SpotToday[]; value: string | null; onChange: (v: string | null) => void }) {
  const [openPick, setOpenPick] = useState(false)
  const cur = spots.find(s => s.id === value)
  return (
    <span className="relative">
      <button type="button" onClick={() => setOpenPick(o => !o)} className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[12.5px] font-semibold">{cur ? `In spot ${cur.label}` : 'Which spot? (optional)'} <ChevronDown size={13} /></button>
      {openPick && (
        <span className="absolute z-20 left-0 top-full mt-1 bg-white border border-neutral-300 rounded-xl p-2 shadow-lg grid grid-cols-5 gap-1 w-64">
          <button type="button" onClick={() => { onChange(null); setOpenPick(false) }} className="col-span-5 text-[12px] font-semibold text-neutral-500 py-1">No spot / outside the lines</button>
          {spots.map(s => <button key={s.id} type="button" onClick={() => { onChange(s.id); setOpenPick(false) }} className={`rounded-lg py-2 text-[13px] font-bold ${value === s.id ? 'bg-neutral-900 text-white' : s.kind === 'hold' ? 'bg-neutral-200' : 'bg-neutral-100'}`}>{s.label}</button>)}
        </span>
      )}
    </span>
  )
}

// ── 2. WALK THE LOT ─────────────────────────────────────────────────────────────────────────────
function Walk({ spots, date, sweep, setSweep, post, onFinished }: { spots: SpotToday[]; date: string; sweep: Sweep | null; setSweep: (s: Sweep | null) => void; post: (b: Record<string, any>) => Promise<any>; onFinished: (s: Sweep, made: Incident[]) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [other, setOther] = useState<string | null>(null)      // the spot whose "different car" form is open
  const [plate, setPlate] = useState('')
  const [read, setRead] = useState<Read | null>(null)
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [extra, setExtra] = useState(false)
  const active = sweep && !sweep.finishedAt ? sweep : null
  const done = useMemo(() => { const m: Record<string, SweepCheck> = {}; for (const c of active?.checks || []) if (c.spotId) m[c.spotId] = c; return m }, [active])
  const extras = (active?.checks || []).filter(c => c.result === 'extra')
  const n = Object.keys(done).length
  const start = async () => {
    setBusy('start'); setErr('')
    try { const j = await post({ action: 'sweep.start', sweepId: sweep?.id }); setSweep(j.sweep) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const send = async (s: SpotToday | null, result: SweepCheck['result'], p?: string) => {
    if (!active) return
    setBusy(s ? s.id : 'extra'); setErr('')
    try {
      const j = await post({ action: 'sweep.check', sweepId: active.id, spotId: s?.id || null, label: s?.label || null, result, plate: p, make: read?.make, model: read?.model, color: read?.color, photo: photo?.base64, photoMime: photo?.mime })
      setSweep(j.sweep); setOther(null); setPlate(''); setRead(null); setPhoto(null); setExtra(false)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const [scanFor, setScanFor] = useState<string | null | false>(false)     // false = closed; null = a car outside any spot
  const readFrame = async (ph: Photo | null, typed?: string): Promise<ScanOutcome> => {
    if (typed) return { read: { plate: typed, state: null, make: null, model: null, color: null, confidence: 1, note: null } }
    if (!ph) return { read: null }
    const j = await post({ action: 'plate.read', photo: ph.base64, photoMime: ph.mime, spotId: scanFor || null })
    return { read: j.read || null }
  }
  const finish = async () => {
    if (!active) return
    const missing = spots.length - n
    if (missing > 0 && !confirm(`${missing} ${missing === 1 ? 'spot' : 'spots'} not checked yet — finish anyway?`)) return
    setBusy('finish'); setErr('')
    try { const j = await post({ action: 'sweep.finish', sweepId: active.id }); onFinished(j.sweep, j.incidents || []) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const otherForm = (s: SpotToday | null) => (
    <div className="mt-2 rounded-xl bg-white border border-neutral-300 p-2.5 space-y-2">
      <input value={plate} onChange={e => setPlate(e.target.value.toUpperCase())} placeholder="PLATE of the car here" autoCapitalize="characters" autoCorrect="off" className={field + ' font-mono font-bold tracking-widest uppercase'} />
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" onClick={() => setScanFor(s ? s.id : null)} className="inline-flex items-center gap-1.5 rounded-xl bg-neutral-900 text-white px-3 py-2 text-[13px] font-bold"><Camera size={15} /> Scan</button>
        {read && <span className="text-[12px] text-neutral-500">read <b className="font-mono">{read.plate || '?'}</b>{read.make || read.model ? ` · ${[read.color, read.make, read.model].filter(Boolean).join(' ')}` : ''}{read.confidence < 0.7 ? ' — not sure' : ''}</span>}
      </div>
      <div className="flex gap-2">
        <button onClick={() => send(s, s ? 'other' : 'extra', plate)} disabled={busy != null || !normalizePlate(plate)} className={big()}>{busy === (s ? s.id : 'extra') ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save</button>
        <button onClick={() => { setOther(null); setExtra(false); setPlate(''); setRead(null); setPhoto(null) }} className={big('muted') + ' flex-none px-4'}><X size={16} /></button>
      </div>
    </div>
  )
  return (
    <section className="mb-2">
      <div className="flex items-end justify-between gap-2 mb-2">
        <h2 style={serif} className="text-[22px] text-neutral-900">Walk the lot</h2>
        {active && <span className="text-[13px] text-neutral-500 tabular-nums">{n} / {spots.length} checked{extras.length ? ` · ${extras.length} outside the lines` : ''}</span>}
      </div>
      {!active && (
        <div className="rounded-2xl border border-neutral-300 bg-white p-3">
          <p className="text-[14px] text-neutral-700">Go spot by spot. Each one has three answers; every answer is saved as you tap it.{sweep?.finishedAt ? ` Last walk today: ${sweep.nChecked} checked, ${sweep.nFlagged} flagged${sweep.byName ? ' by ' + sweep.byName : ''}.` : ''}</p>
          <button onClick={start} disabled={busy === 'start'} className={big() + ' w-full mt-3'}>{busy === 'start' ? <Loader2 size={16} className="animate-spin" /> : null} {sweep?.finishedAt ? 'Walk it again' : 'Start the walk'}</button>
        </div>
      )}
      {err && <p className="my-2 text-[13px] text-rose-700">{err}</p>}
      {active && (
        <div className="space-y-2">
          {spots.map(s => {
            const exp = s.expected[0] || null
            const c = done[s.id]
            const isOther = other === s.id
            return (
              <div key={s.id} className={`rounded-2xl border-2 p-3 ${c ? toneOf(c.verdict) : 'border-neutral-300 bg-white'}`}>
                <div className="flex items-start gap-3">
                  <span className={`shrink-0 inline-flex items-center justify-center rounded-xl w-11 h-11 text-[17px] font-bold tabular-nums ${s.kind === 'hold' ? 'bg-neutral-300 text-neutral-800' : 'bg-neutral-900 text-white'}`}>{s.label}</span>
                  <div className="flex-1 min-w-0">
                    {exp ? <>
                      <div className="text-[15px] font-bold"><span className="font-mono">{exp.plate || 'no plate on file'}</span> <span className="font-semibold text-neutral-700">{carLabel(exp)}</span></div>
                      <div className="text-[13px] text-neutral-600">{exp.guestName || exp.kind}{exp.unit ? ' · ' + exp.unit : ''}{exp.endsOn === date ? ' · leaving today' : ''}{s.expected[1] ? ` · then ${s.expected[1].guestName || s.expected[1].kind} tonight` : ''}</div>
                    </> : <div className="text-[15px] font-semibold text-neutral-500">Should be empty{s.kind === 'hold' ? ' (held — staff only)' : ''}</div>}
                    {c && <div className="text-[13px] font-bold mt-1">{VERDICT_LABEL[c.verdict] || c.verdict}{c.result === 'other' && c.plate ? ` · ${c.plate}` : ''}{c.belongsIn && c.verdict !== 'ok' && c.verdict !== 'leaving_today' ? ` — belongs in ${c.belongsIn}` : ''}</div>}
                  </div>
                </div>
                {!isOther && (
                  <div className="mt-2 flex gap-2">
                    {exp && <button onClick={() => send(s, 'match')} disabled={busy != null} className={big(c?.result === 'match' ? 'ok' : 'muted')}>{busy === s.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} As expected</button>}
                    <button onClick={() => send(s, 'empty')} disabled={busy != null} className={big(c?.result === 'empty' ? 'ok' : 'muted')}>Empty</button>
                    <button onClick={() => { setOther(s.id); setExtra(false); setPlate(''); setRead(null); setPhoto(null) }} disabled={busy != null} className={big(c?.result === 'other' ? 'bad' : 'muted')}><Camera size={15} /> {exp ? 'Different car' : 'A car is here'}</button>
                  </div>
                )}
                {isOther && otherForm(s)}
              </div>
            )
          })}
          {extras.map((c, i) => (
            <div key={i} className={`rounded-2xl border-2 p-3 ${toneOf(c.verdict)}`}>
              <div className="text-[15px] font-bold"><span className="font-mono">{c.plate}</span> <span className="font-semibold">{carLabel(c)}</span> <span className="text-[13px] font-semibold text-neutral-600">· outside the lines</span></div>
              <div className="text-[13px] font-bold mt-0.5">{VERDICT_LABEL[c.verdict] || c.verdict}{c.belongsIn ? ` — belongs in ${c.belongsIn}` : ''}</div>
            </div>
          ))}
          {!extra ? <button onClick={() => { setExtra(true); setOther(null); setPlate(''); setRead(null); setPhoto(null) }} className="w-full rounded-2xl border-2 border-dashed border-neutral-300 px-3 py-3 text-[14px] font-semibold text-neutral-600">+ A car outside any spot (blocking, double-parked)</button> : otherForm(null)}
          <button onClick={finish} disabled={busy != null} className={big(n >= spots.length ? 'ok' : 'ink') + ' w-full mt-1'}>{busy === 'finish' ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />} Finish the walk — flag what should not be here</button>
        </div>
      )}
      <Scanner open={scanFor !== false} onClose={() => setScanFor(false)} mode="single" title={scanFor ? `Spot ${spots.find(s => s.id === scanFor)?.label || ''} — scan the plate` : 'Scan the plate'} scan={readFrame}
        onPick={(rd, ph) => { setPlate(rd.plate || ''); setRead(rd); setPhoto(ph); setErr('') }} />
    </section>
  )
}

// ── IDENTIFY THE CAR ─────────────────────────────────────────────────────────────────────────────
// Not registered → who is it? Colour, make and model, all three, before the next car. The notice to
// the guests and the tow email both name the car, so a blank here is a blank there.
function IdentifyCar({ inc, left, post, onSaved, onLater }: { inc: Incident; left: number; post: (b: Record<string, any>) => Promise<any>; onSaved: (i: Incident) => void; onLater: () => void }) {
  const [car, setCar] = useState({ color: inc.color || '', make: inc.make || '', model: inc.model || '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setCar({ color: inc.color || '', make: inc.make || '', model: inc.model || '' }); setErr('') }, [inc.id])
  const ok = car.color.trim() && car.make.trim() && car.model.trim()
  const save = async () => {
    if (!ok) { setErr('Colour, make and model are all needed.'); return }
    setBusy(true); setErr('')
    try { const j = await post({ action: 'incident.car', incidentId: inc.id, ...car }); onSaved(j.incident) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[90] bg-black/50 flex items-end sm:items-center justify-center p-3">
      <div className="w-full max-w-md rounded-3xl bg-white p-4 shadow-2xl">
        <div className="text-[12px] font-bold uppercase tracking-wider text-rose-700">Not registered{left > 1 ? ` · ${left} cars to identify` : ''}</div>
        <div className="mt-1 text-[20px] font-bold" style={serif}>Identify the car <span className="font-mono">{inc.plate || ''}</span></div>
        <p className="text-[13px] text-neutral-500 mb-3">{inc.spotLabel ? 'Spot ' + inc.spotLabel + ' · ' : ''}Look at the car — the notice to the guests names it.</p>
        {inc.photoUrl && <img src={inc.photoUrl} alt="" className="mb-3 rounded-xl max-h-40 w-full object-cover border border-neutral-200" />}
        <div className="space-y-2">
          <input autoFocus value={car.color} onChange={e => setCar({ ...car, color: e.target.value })} placeholder="Colour (e.g. black)" className={field} />
          <input value={car.make} onChange={e => setCar({ ...car, make: e.target.value })} placeholder="Make (e.g. Toyota)" className={field} />
          <input value={car.model} onChange={e => setCar({ ...car, model: e.target.value })} placeholder="Model (e.g. Highlander)" className={field} />
        </div>
        {err && <p className="mt-2 text-[13px] text-rose-700">{err}</p>}
        <div className="mt-3 flex gap-2">
          <button onClick={save} disabled={busy || !ok} className={big('bad')}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save the car</button>
          <button onClick={onLater} disabled={busy} className={big('muted')}>Later</button>
        </div>
      </div>
    </div>
  )
}
