'use client'
// THE LOT CHECK — what the person standing in the parking lot sees on their phone (Jon, 2026-10-26:
// "a link we can share with our staff to check / scan car plates and flag unregistered cars …
// once each car is scanned, all non-cars get flagged, and it creates a guest message we can send
// to all guests, they get 1 hour or the car will be towed. It then drafts an email to our tow
// company"). "Please make this robust and easy to use."
//
// So there are exactly three things on the page, in the order they get used:
//   1. CHECK A PLATE — type it or photograph it; the answer is one line, green / amber / red.
//   2. WALK THE LOT — spot by spot, three big buttons each (as expected · empty · different car).
//      Every answer is saved the moment it is tapped, so a dead battery costs one spot, not the walk.
//      Finish → every car that should not be there is a FLAG.
//   3. FLAGS — send the notice (one tap, the text is ready), draft the tow email, close it out.
// No login: the link is the key. Your name is asked once and remembered on the phone.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Check, X, Camera, Flag, Mail, Truck, AlertTriangle, ChevronDown, Search } from 'lucide-react'
import { NoticeSheet, CameraButton } from '@/components/ParkingSheets'
import { tidyPlate, normalizePlate, carLabel, cents } from '@/lib/plate'
import type { Spot, Booking, Incident, Sweep, SweepCheck } from '@/lib/parking-lots'

type LotInfo = { id: string; name: string; building: string; rules: string | null; rateCents: number; currency: string; noticeMinutes: number; hasTow: boolean; towCompany: string | null; towPhone: string | null }
type SpotToday = Spot & { expected: Booking[] }
type Verdict = { plate: string; plateNorm: string; verdict: SweepCheck['verdict']; booking: Booking | null; belongsIn: Spot | null; near: { booking: Booking; spot: Spot | null }[]; note: string }
type Read = { plate: string | null; state: string | null; make: string | null; model: string | null; color: string | null; confidence: number; note: string | null }
type Photo = { base64: string; mime: string }

const TZ = 'America/New_York'
const timeET = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const serif: React.CSSProperties = { fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'New York',Georgia,ui-serif,serif", letterSpacing: '-0.01em' }
const field = 'w-full rounded-2xl border border-neutral-300 px-4 py-3 text-[16px] bg-white focus:outline-none focus:ring-2 focus:ring-black/10'
const big = (tone: 'ok' | 'muted' | 'bad' | 'ink' = 'ink') => `flex-1 rounded-2xl px-3 py-3 text-[15px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-40 ${tone === 'ok' ? 'bg-emerald-600 text-white' : tone === 'bad' ? 'bg-rose-600 text-white' : tone === 'muted' ? 'bg-neutral-200 text-neutral-800' : 'bg-neutral-900 text-white'}`
const toneOf = (v: SweepCheck['verdict'] | null) => v === 'ok' || v === 'leaving_today' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : v === 'empty' ? 'border-neutral-300 bg-neutral-50 text-neutral-700' : v === 'unregistered' ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-amber-300 bg-amber-50 text-amber-900'
const VERDICT_LABEL: Record<string, string> = { ok: 'Registered — all good', leaving_today: 'Registered — leaving today', empty: 'Empty', wrong_spot: 'Wrong spot', unregistered: 'NOT registered', staff_in_sell: 'Staff car in a sold spot' }
const OPEN = ['open', 'notified', 'tow_drafted']

export function LotSweep({ code }: { code: string }) {
  const [pass, setPass] = useState('')
  const [needsPass, setNeedsPass] = useState(false)
  const [label, setLabel] = useState('Parking')
  const [lot, setLot] = useState<LotInfo | null>(null)
  const [date, setDate] = useState('')
  const [spots, setSpots] = useState<SpotToday[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [sweep, setSweep] = useState<Sweep | null>(null)
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [notice, setNotice] = useState<Incident | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])
  useEffect(() => { try { setName(localStorage.getItem('lot-staff-name') || '') } catch {} }, [])
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 5000) }

  const post = useCallback(async (body: Record<string, any>) => {
    const r = await fetch('/api/public/lot/' + encodeURIComponent(code), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, pass, name }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`)
    return j
  }, [code, pass, name])

  const load = useCallback(async (p: string, quiet = false) => {
    if (!quiet) setLoading(true)
    setErr('')
    try {
      const j = await fetch('/api/public/lot/' + encodeURIComponent(code) + (p ? '?pass=' + encodeURIComponent(p) : ''), { cache: 'no-store' }).then(r => r.json())
      if (j?.needsPasscode) { setNeedsPass(true); setLabel(j.label || 'Parking'); setLoading(false); return }
      if (!j?.ok) { setErr(j?.error || 'Could not open this lot.'); setLoading(false); return }
      setNeedsPass(false); setLot(j.lot); setDate(j.date); setSpots(j.spots || []); setIncidents(j.incidents || []); setSweep(j.sweep || null)
    } catch { setErr('No connection — check signal and try again.') } finally { setLoading(false) }
  }, [code])
  useEffect(() => { load('') }, [load])

  const patchIncident = (inc: Incident) => setIncidents(list => list.some(x => x.id === inc.id) ? list.map(x => x.id === inc.id ? { ...x, ...inc, photoUrl: inc.photoUrl ?? x.photoUrl } : x) : [inc].concat(list))
  const saveName = (v: string) => { setName(v); try { localStorage.setItem('lot-staff-name', v) } catch {} }

  if (needsPass) return (
    <Frame title={label}>
      <p className="text-[15px] text-neutral-700 mb-3">This lot link has a passcode.</p>
      <input autoFocus type="password" inputMode="numeric" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(pass)} placeholder="Passcode" className={field} />
      <button onClick={() => load(pass)} className={big() + ' w-full mt-3'}>Open</button>
      {err && <p className="mt-2 text-[13px] text-rose-700">{err}</p>}
    </Frame>
  )
  if (loading && !lot) return <Frame title="Parking"><p className="text-neutral-600 text-[15px]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Opening the lot…</p></Frame>
  if (!lot) return <Frame title="Parking"><p className="text-[15px] text-rose-700">{err || 'This lot link is not valid.'}</p></Frame>

  const open = incidents.filter(i => OPEN.indexOf(i.status) >= 0)
  return (
    <Frame title={lot.name} sub={<>{new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {cents(lot.rateCents, lot.currency)} a night · {spots.filter(s => s.kind === 'sell').length} sold spots, {spots.filter(s => s.kind === 'hold').length} held</>}>
      {toast && <div className="fixed bottom-4 left-4 right-4 z-[60] rounded-2xl bg-neutral-900 text-white text-[14px] px-4 py-3 shadow-lg">{toast}</div>}
      {err && <p className="mb-3 text-[13px] text-rose-700 inline-flex items-center gap-1"><AlertTriangle size={14} /> {err}</p>}

      {/* YOUR NAME — once. Every flag and every notice says who stood in the lot. */}
      <label className="block mb-4">
        <span className="text-[12px] font-semibold uppercase tracking-wider text-neutral-500">Your name</span>
        <input value={name} onChange={e => saveName(e.target.value)} placeholder="So the record says who checked" className={field + ' mt-1'} />
      </label>

      <CheckPlate spots={spots} post={post} onFlagged={inc => { patchIncident(inc); say('Flagged. Send the notice below when you are ready.') }} />

      <Walk spots={spots} date={date} sweep={sweep} setSweep={setSweep} post={post} onFinished={(sw, made) => { setSweep(sw); made.forEach(patchIncident); say(made.length ? `${made.length} ${made.length === 1 ? 'car' : 'cars'} flagged — send the notice below.` : 'Sweep done — every car is where it should be.') }} />

      <section className="mt-6">
        <h2 style={serif} className="text-[22px] text-neutral-900 mb-1">Flags <span className="text-neutral-400">{open.length}</span></h2>
        <p className="text-[13px] text-neutral-500 mb-3">Each car gets {lot.noticeMinutes === 60 ? 'one hour' : lot.noticeMinutes + ' minutes'} from the notice. Then the tow email is drafted{lot.towCompany ? ' for ' + lot.towCompany : ''} — the office sends it.</p>
        {open.length === 0 && <p className="rounded-2xl border border-dashed border-neutral-300 px-4 py-4 text-[14px] text-neutral-500 text-center">Nothing flagged right now.</p>}
        <div className="space-y-2">
          {open.map(i => {
            const left = i.towDueAt ? Math.round((new Date(i.towDueAt).getTime() - now) / 60000) : null
            return (
              <div key={i.id} className={`rounded-2xl border p-3 ${i.status === 'open' ? 'border-rose-300 bg-rose-50' : 'border-amber-300 bg-amber-50'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-[17px]">{i.plate || '—'}</span>
                  <span className="text-[14px] text-neutral-800">{carLabel(i)}</span>
                  {i.spotLabel && <span className="text-[13px] text-neutral-500">spot {i.spotLabel}</span>}
                </div>
                <div className="mt-1 text-[13px] text-neutral-700">
                  {i.status === 'open' && 'Flagged — notice not sent yet.'}
                  {i.status === 'notified' && left != null && (left > 0 ? `Notice sent ${timeET(i.noticeSentAt as string)} to ${i.noticeSentN} guests · ${left} min left (until ${timeET(i.towDueAt as string)}).` : `The hour is up (deadline ${timeET(i.towDueAt as string)}) — the tow email drafts itself; the office sends it.`)}
                  {i.status === 'tow_drafted' && `Tow email drafted ${i.towDraftedAt ? timeET(i.towDraftedAt) : ''} — waiting for the office to send it.`}
                </div>
                {i.photoUrl && <img src={i.photoUrl} alt="" className="mt-2 rounded-xl max-h-36 border border-neutral-200" />}
                <div className="mt-2 flex gap-2">
                  <button onClick={() => setNotice(i)} className={big(i.status === 'open' ? 'bad' : 'muted')}><Mail size={15} /> {i.noticeSentAt ? 'Notice again' : 'Send notice'}</button>
                  {lot.hasTow && <button onClick={async () => { try { const j = await post({ action: 'incident.tow', incidentId: i.id }); patchIncident(j.incident); say('Tow email drafted — the office sends it.') } catch (e: any) { say(e?.message || String(e)) } }} className={big('muted')}><Truck size={15} /> Tow email</button>}
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={async () => { try { const j = await post({ action: 'incident.close', incidentId: i.id, how: 'resolved', resolution: 'moved or registered' }); patchIncident(j.incident); say('Closed — car moved or registered.') } catch (e: any) { say(e?.message || String(e)) } }} className={big('ok')}><Check size={15} /> It moved</button>
                  <button onClick={async () => { try { const j = await post({ action: 'incident.close', incidentId: i.id, how: 'towed' }); patchIncident(j.incident); say('Marked towed.') } catch (e: any) { say(e?.message || String(e)) } }} className={big('muted')}><Truck size={15} /> Towed</button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {lot.rules && <details className="mt-6 text-[13px] text-neutral-600"><summary className="cursor-pointer font-semibold">Lot rules</summary><p className="mt-1">{lot.rules}</p></details>}
      <p className="mt-6 text-[12px] text-neutral-400">Lighthouse · the office sees everything you do here on the Parking tab.</p>

      <NoticeSheet open={!!notice} onClose={() => setNotice(null)} lot={lot} incident={notice} publicCode={code} publicPass={pass} staffName={name}
        onSent={(inc, sent, failed) => { patchIncident(inc); say(`Notice sent to ${sent} ${sent === 1 ? 'guest' : 'guests'}${failed ? `, ${failed} failed` : ''}. The clock runs until ${inc.towDueAt ? timeET(inc.towDueAt) : 'the deadline'}.`) }} />
    </Frame>
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
function CheckPlate({ spots, post, onFlagged }: { spots: SpotToday[]; post: (b: Record<string, any>) => Promise<any>; onFlagged: (i: Incident) => void }) {
  const [plate, setPlate] = useState('')
  const [v, setV] = useState<Verdict | null>(null)
  const [read, setRead] = useState<Read | null>(null)
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [spotId, setSpotId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'check' | 'scan' | 'flag' | null>(null)
  const [err, setErr] = useState('')
  const check = async (p = plate) => {
    if (!normalizePlate(p)) return
    setBusy('check'); setErr('')
    try { const j = await post({ action: 'plate.judge', plate: p, spotId }); setV(j) } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const scan = async (ph: Photo) => {
    setBusy('scan'); setErr(''); setPhoto(ph); setRead(null)
    try {
      const j = await post({ action: 'plate.read', photo: ph.base64, photoMime: ph.mime, spotId })
      setRead(j.read)
      if (j.read?.plate) { setPlate(j.read.plate); if (j.judged) setV(j.judged) } else setErr('Could not read a plate in that photo — type it.')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
  }
  const flag = async () => {
    if (!v) return
    setBusy('flag'); setErr('')
    try {
      const sp = spots.find(s => s.id === spotId)
      const j = await post({ action: 'incident.open', plate: v.plate, kind: v.verdict === 'wrong_spot' ? 'wrong_spot' : v.verdict === 'staff_in_sell' ? 'staff_in_sell' : 'unregistered', bookingId: v.booking?.id || null, spotId, spotLabel: sp?.label || null, make: read?.make || v.booking?.make || null, model: read?.model || v.booking?.model || null, color: read?.color || v.booking?.color || null, plateState: read?.state || null, photo: photo?.base64, photoMime: photo?.mime })
      onFlagged(j.incident); setV(null); setPlate(''); setRead(null); setPhoto(null)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
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
        <CameraButton onPhoto={scan} busy={busy === 'scan'} label={busy === 'scan' ? 'Reading…' : 'Scan with camera'} />
        <SpotPick spots={spots} value={spotId} onChange={setSpotId} />
      </div>
      {read && <p className="mt-1.5 text-[12.5px] text-neutral-500">Camera read <b className="font-mono">{read.plate || '?'}</b>{read.make || read.model ? ` · ${[read.color, read.make, read.model].filter(Boolean).join(' ')}` : ''}{read.confidence < 0.7 ? ' — not sure, check the plate against the car' : ''}{read.note ? ` · ${read.note}` : ''}</p>}
      {err && <p className="mt-2 text-[13px] text-rose-700">{err}</p>}
      {v && (
        <div className={`mt-3 rounded-2xl border-2 p-3 ${toneOf(v.verdict)}`}>
          <div className="text-[17px] font-bold">{VERDICT_LABEL[v.verdict] || v.verdict}</div>
          <div className="text-[14px] mt-0.5">{v.note}</div>
          {v.booking && <div className="text-[13px] mt-1 opacity-80">{carLabel(v.booking)} · {v.booking.guestName || v.booking.kind}{v.booking.unit ? ' · ' + v.booking.unit : ''} · spot {v.belongsIn?.label || '?'} · through {new Date(v.booking.endsOn + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>}
          {v.near.length > 0 && <div className="text-[13px] mt-1">Did you mean {v.near.map(n => <button key={n.booking.id} onClick={() => { setPlate(n.booking.plate || ''); check(n.booking.plate || '') }} className="font-mono font-bold underline mr-2">{n.booking.plate}</button>)}?</div>}
          {bad && <button onClick={flag} disabled={busy != null} className={big('bad') + ' w-full mt-3'}>{busy === 'flag' ? <Loader2 size={16} className="animate-spin" /> : <Flag size={16} />} Flag this car</button>}
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
  const scan = async (ph: Photo, spotId: string | null) => {
    setBusy('scan'); setErr(''); setPhoto(ph); setRead(null)
    try { const j = await post({ action: 'plate.read', photo: ph.base64, photoMime: ph.mime, spotId }); setRead(j.read); if (j.read?.plate) setPlate(j.read.plate); else setErr('Could not read a plate in that photo — type it.') }
    catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(null) }
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
        <CameraButton onPhoto={ph => scan(ph, s?.id || null)} busy={busy === 'scan'} label={busy === 'scan' ? 'Reading…' : 'Scan'} />
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
    </section>
  )
}
