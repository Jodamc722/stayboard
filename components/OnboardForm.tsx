'use client'
// ONBOARDING INVENTORY — the phone form behind /onboard/<code> (Jon, 2026-09-02).
//
// Three steps, one screen, built for a person standing in an empty unit with a phone:
//   1. DETAILS  the quick section — bedrooms, bathrooms, occupancy, balcony, washer/dryer, sleeper
//               sofa… Saving it GENERATES the room list (Master bedroom, Master bath, Bedroom 2…).
//   2. ROOMS    each room: rename, photograph (camera opens straight from the button), confirm the
//               pre-filled items (qty + condition), add anything the template missed, mark the room
//               done.
//   3. FINISH   one summary; reopen any time. Assigning the unit to a live Guesty listing happens
//               later, from /onboarding, and changes nothing here.
//
// Agnostic on purpose: nothing here knows or needs a Guesty listing. The code in the URL is the key.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, ChevronDown, ChevronLeft, Loader2, Minus, Plus, Pencil, Trash2, X, Image as ImageIcon, CheckCircle2, AlertTriangle, ClipboardCopy, RotateCcw } from 'lucide-react'
import { CONDITIONS, CATEGORIES, ROOM_KIND_LABEL, describeUnit, type UnitDetails, type Condition, type Category, type RoomKind } from '@/lib/onboarding'

type Unit = { id: string; code: string; name: string; building: string | null; unit_no: string | null; address: string | null; owner_name: string | null; owner_contact: string | null; details: UnitDetails; status: string; listing_id: string | null; notes: string | null; completed_at: string | null }
type Room = { id: string; key: string; name: string; kind: RoomKind; sort: number; photos: { url: string; at: string; caption?: string | null }[]; notes: string | null; checked_at: string | null }
type Item = { id: string; room_id: string; name: string; category: Category; qty: number; condition: Condition | null; brand: string | null; notes: string | null; photo_url: string | null; suggested: boolean }
type Progress = { rooms: number; roomsChecked: number; roomsPhotographed: number; items: number; confirmed: number; photos: number; pct: number }
type Data = { ok: true; unit: Unit; rooms: Room[]; items: Item[]; progress: Progress }

const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-xl font-bold text-[14px] min-h-[44px] px-4 disabled:opacity-50'
const CHIP = 'inline-flex items-center justify-center rounded-full border text-[13px] font-semibold min-h-[38px] px-3.5'
const INPUT = 'w-full rounded-xl border border-line bg-white px-3.5 py-3 text-[16px] focus:outline-none focus:border-ink'
const LABEL = 'block text-[12px] font-bold uppercase tracking-wide text-muted mb-1.5'

export function OnboardForm({ code }: { code: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [roomOpen, setRoomOpen] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const load = async () => {
    try {
      const r = await fetch('/api/onboard?code=' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not open this link')
      setData(j); setErr('')
      if (!j.rooms.length) setDetailsOpen(true)
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (body: Record<string, any>) => {
    const r = await fetch('/api/onboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, ...body }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save')
    return j
  }

  if (loading) return <Frame><div className="py-16 text-center text-muted text-[14px]"><Loader2 className="animate-spin inline mr-2" size={16} />Opening…</div></Frame>
  if (err || !data) return <Frame><div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-[14px] text-rose-800 flex items-start gap-2"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><div>{err || 'Link not found.'}<div className="text-[12px] mt-1 text-rose-700/80">Ask whoever sent this link to check it in Lighthouse → Onboarding.</div></div></div></Frame>

  const { unit, rooms, items, progress } = data
  const done = unit.status === 'complete' || unit.status === 'linked'
  const room = roomOpen ? rooms.find(r => r.id === roomOpen) || null : null

  if (room) return (
    <Frame>
      <RoomView code={code} unit={unit} room={room} items={items.filter(i => i.room_id === room.id)} onBack={() => setRoomOpen(null)} act={act} reload={load} />
    </Frame>
  )

  return (
    <Frame>
      {/* ── header ── */}
      <div className="mb-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted font-semibold">Onboarding inventory</div>
        <h1 className="text-[24px] font-bold text-ink leading-tight mt-0.5">{unit.name}</h1>
        <div className="text-[13px] text-muted mt-0.5">{[unit.building, unit.unit_no && '#' + unit.unit_no, describeUnit(unit.details || {})].filter(Boolean).join(' · ') || 'Fill in the details below to get started'}</div>
        {rooms.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[12px] text-muted mb-1">
              <span><b className="text-ink">{progress.confirmed}</b> of {progress.items} items confirmed · <b className="text-ink">{progress.roomsPhotographed}</b>/{progress.rooms} rooms photographed</span>
              <span className="font-bold text-ink">{progress.pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-app overflow-hidden"><div className={'h-full ' + (progress.pct === 100 ? 'bg-emerald-500' : 'bg-brand-600')} style={{ width: Math.max(2, progress.pct) + '%' }} /></div>
          </div>
        )}
        {done && <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-900 flex items-center gap-2"><CheckCircle2 size={15} className="text-emerald-600" /> Inventory finished{unit.completed_at ? ' ' + new Date(unit.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}{unit.listing_id ? ' · assigned to a live listing' : ''}.</div>}
      </div>

      {/* ── 1. details ── */}
      <section className="rounded-2xl border border-line bg-white overflow-hidden mb-3">
        <button onClick={() => setDetailsOpen(o => !o)} className="w-full px-4 py-3 flex items-center gap-2 text-left">
          <span className="w-7 h-7 rounded-full bg-ink text-white grid place-items-center text-[12px] font-bold">1</span>
          <span className="font-bold text-ink text-[15px]">Unit details</span>
          <span className="text-[12px] text-muted ml-1 truncate">{rooms.length ? describeUnit(unit.details || {}) : 'start here'}</span>
          <ChevronDown size={16} className={'ml-auto text-muted transition-transform ' + (detailsOpen ? 'rotate-180' : '')} />
        </button>
        {detailsOpen && <DetailsForm unit={unit} hasRooms={rooms.length > 0} onSaved={async () => { setDetailsOpen(false); await load() }} act={act} />}
      </section>

      {/* ── 2. rooms ── */}
      <section className="rounded-2xl border border-line bg-white overflow-hidden mb-3">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-line">
          <span className={'w-7 h-7 rounded-full grid place-items-center text-[12px] font-bold ' + (rooms.length ? 'bg-ink text-white' : 'bg-app text-muted')}>2</span>
          <span className="font-bold text-ink text-[15px]">Rooms</span>
          <span className="text-[12px] text-muted">{rooms.length ? rooms.length + ' rooms · tap one to photograph and confirm its items' : 'generated from the details above'}</span>
        </div>
        {rooms.length === 0 && <div className="px-4 py-6 text-[13.5px] text-muted text-center">Save the unit details and the room list appears here — Master bedroom, Master bath, Bedroom 2, Kitchen, Balcony… each pre-filled with what it should hold.</div>}
        <div className="divide-y divide-line">
          {rooms.map(r => {
            const its = items.filter(i => i.room_id === r.id)
            const conf = its.filter(i => i.condition).length
            const bad = its.filter(i => i.condition === 'worn' || i.condition === 'missing').length
            const photos = Array.isArray(r.photos) ? r.photos.length : 0
            return (
              <button key={r.id} onClick={() => setRoomOpen(r.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-app">
                <span className={'w-12 h-12 rounded-xl shrink-0 grid place-items-center overflow-hidden ' + (photos ? '' : 'bg-app text-muted')}>
                  {photos ? <img src={r.photos[0].url} alt="" className="w-12 h-12 object-cover" /> : <Camera size={18} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold text-ink truncate">{r.name}</span>
                  <span className="block text-[12px] text-muted">{ROOM_KIND_LABEL[r.kind]} · {conf}/{its.length} items{bad ? ' · ' + bad + ' worn/missing' : ''}{photos ? ' · ' + photos + ' photo' + (photos === 1 ? '' : 's') : ' · no photo yet'}</span>
                </span>
                {r.checked_at ? <CheckCircle2 size={20} className="text-emerald-600 shrink-0" /> : <span className="w-5 h-5 rounded-full border-2 border-line shrink-0" />}
              </button>
            )
          })}
        </div>
        {rooms.length > 0 && <AddRoom act={act} reload={load} />}
      </section>

      {/* ── 3. finish ── */}
      {rooms.length > 0 && (
        <section className="rounded-2xl border border-line bg-white px-4 py-3 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <span className={'w-7 h-7 rounded-full grid place-items-center text-[12px] font-bold ' + (done ? 'bg-emerald-600 text-white' : 'bg-app text-muted')}>3</span>
            <span className="font-bold text-ink text-[15px]">Finish</span>
          </div>
          <Summary unit={unit} rooms={rooms} items={items} progress={progress} />
          <div className="flex gap-2 mt-3 flex-wrap">
            {!done
              ? <button onClick={async () => { try { await act({ action: 'complete' }); await load() } catch (e: any) { alert(String(e?.message || e)) } }} className={BTN + ' bg-ink text-white flex-1'} disabled={progress.items > 0 && progress.confirmed === 0}><Check size={16} /> Finish inventory</button>
              : <button onClick={async () => { try { await act({ action: 'reopen' }); await load() } catch (e: any) { alert(String(e?.message || e)) } }} className={BTN + ' border border-line bg-white text-ink'}><RotateCcw size={15} /> Reopen</button>}
            <CopySummary unit={unit} rooms={rooms} items={items} />
          </div>
          {progress.confirmed < progress.items && !done && <p className="text-[12px] text-muted mt-2">{progress.items - progress.confirmed} item{progress.items - progress.confirmed === 1 ? '' : 's'} not confirmed yet — you can finish anyway and come back.</p>}
        </section>
      )}
    </Frame>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-app text-ink">
      <div className="max-w-xl mx-auto px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <div className="flex items-center gap-2 mb-3 text-[12px] text-muted"><span className="w-6 h-6 rounded-md bg-brand-600 text-white grid place-items-center font-bold text-[11px]">L</span> LIGHTHOUSE · Stay Hospitality</div>
        {children}
      </div>
    </div>
  )
}

// ── 1. DETAILS ──────────────────────────────────────────────────────────────────────────────────
function DetailsForm({ unit, hasRooms, onSaved, act }: { unit: Unit; hasRooms: boolean; onSaved: () => Promise<void>; act: (b: any) => Promise<any> }) {
  const d0 = unit.details || {}
  const [name, setName] = useState(unit.name || '')
  const [building, setBuilding] = useState(unit.building || '')
  const [unitNo, setUnitNo] = useState(unit.unit_no || '')
  const [address, setAddress] = useState(unit.address || '')
  const [ownerName, setOwnerName] = useState(unit.owner_name || '')
  const [ownerContact, setOwnerContact] = useState(unit.owner_contact || '')
  const [d, setD] = useState<UnitDetails>({ bedrooms: d0.bedrooms ?? 1, bathrooms: d0.bathrooms ?? 1, occupancy: d0.occupancy ?? 4, balconies: d0.balconies ?? 0, washerDryer: d0.washerDryer ?? 'in_unit', sleeperSofa: d0.sleeperSofa ?? 0, kitchen: d0.kitchen ?? 'full', parking: d0.parking ?? 'none', floor: d0.floor ?? '', sqft: d0.sqft, kingBeds: d0.kingBeds, pool: !!d0.pool, gym: !!d0.gym, notes: d0.notes ?? '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof UnitDetails, v: any) => setD(x => ({ ...x, [k]: v }))
  const save = async () => {
    setBusy(true); setErr('')
    try { await act({ action: 'saveDetails', name, building, unitNo, address, ownerName, ownerContact, details: d }); await onSaved() } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }
  return (
    <div className="px-4 pb-4 border-t border-line pt-3 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><label className={LABEL}>Unit name</label><input value={name} onChange={e => setName(e.target.value)} className={INPUT} placeholder="e.g. Elser 3707" /></div>
        <div><label className={LABEL}>Building</label><input value={building} onChange={e => setBuilding(e.target.value)} className={INPUT} placeholder="Elser" /></div>
        <div><label className={LABEL}>Unit #</label><input value={unitNo} onChange={e => setUnitNo(e.target.value)} className={INPUT} placeholder="3707" /></div>
        <div className="col-span-2"><label className={LABEL}>Address</label><input value={address} onChange={e => setAddress(e.target.value)} className={INPUT} placeholder="Street, city" /></div>
        <div><label className={LABEL}>Owner</label><input value={ownerName} onChange={e => setOwnerName(e.target.value)} className={INPUT} placeholder="Name" /></div>
        <div><label className={LABEL}>Owner contact</label><input value={ownerContact} onChange={e => setOwnerContact(e.target.value)} className={INPUT} placeholder="Phone or email" /></div>
      </div>

      <div className="rounded-xl bg-app/70 p-3 space-y-3">
        <div className="text-[12px] font-bold uppercase tracking-wide text-muted">Quick section — this generates the rooms</div>
        <Stepper label="Bedrooms" value={d.bedrooms ?? 0} min={0} max={8} onChange={v => set('bedrooms', v)} render={v => v === 0 ? 'Studio' : String(v)} />
        <Choice label="Bathrooms" value={String(d.bathrooms ?? 1)} options={['1', '1.5', '2', '2.5', '3', '3.5', '4'].map(v => ({ v, l: v }))} onChange={v => set('bathrooms', Number(v))} />
        <Stepper label="Occupancy (max guests)" value={d.occupancy ?? 4} min={1} max={20} onChange={v => set('occupancy', v)} />
        <Choice label="Balcony / terrace" value={String(d.balconies ?? 0)} options={[{ v: '0', l: 'None' }, { v: '1', l: '1' }, { v: '2', l: '2' }]} onChange={v => set('balconies', Number(v))} />
        <Choice label="Washer / dryer" value={d.washerDryer ?? 'in_unit'} options={[{ v: 'in_unit', l: 'In unit' }, { v: 'shared', l: 'Shared' }, { v: 'none', l: 'None' }]} onChange={v => set('washerDryer', v as any)} />
        <Choice label="Sleeper sofa" value={String(d.sleeperSofa ?? 0)} options={[{ v: '0', l: 'None' }, { v: '1', l: '1' }, { v: '2', l: '2' }]} onChange={v => set('sleeperSofa', Number(v))} />
        <Choice label="Kitchen" value={d.kitchen ?? 'full'} options={[{ v: 'full', l: 'Full' }, { v: 'kitchenette', l: 'Kitchenette' }, { v: 'none', l: 'None' }]} onChange={v => set('kitchen', v as any)} />
        <Choice label="Parking" value={d.parking ?? 'none'} options={[{ v: 'none', l: 'None' }, { v: 'assigned', l: 'Assigned' }, { v: 'garage', l: 'Garage' }, { v: 'street', l: 'Street' }]} onChange={v => set('parking', v as any)} />
        <div className="grid grid-cols-2 gap-3">
          <div><label className={LABEL}>Floor</label><input value={d.floor || ''} onChange={e => set('floor', e.target.value)} className={INPUT} placeholder="12" /></div>
          <div><label className={LABEL}>Sq ft</label><input inputMode="numeric" value={d.sqft ?? ''} onChange={e => set('sqft', e.target.value ? Number(e.target.value) : undefined)} className={INPUT} placeholder="850" /></div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Toggle label="Pool access" on={!!d.pool} onChange={v => set('pool', v)} />
          <Toggle label="Gym access" on={!!d.gym} onChange={v => set('gym', v)} />
        </div>
        <div><label className={LABEL}>Notes</label><textarea value={d.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className={INPUT} placeholder="Access, quirks, anything the team should know" /></div>
      </div>
      {err && <p className="text-[13px] text-rose-600 font-semibold">{err}</p>}
      <button onClick={save} disabled={busy || !name.trim()} className={BTN + ' bg-ink text-white w-full'}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {hasRooms ? 'Save details (adds any new rooms)' : 'Save & generate rooms'}</button>
      {hasRooms && <p className="text-[12px] text-muted">Changing counts adds the rooms now expected; it never removes or renames rooms you have already filled in.</p>}
    </div>
  )
}

function Stepper({ label, value, min, max, onChange, render }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; render?: (v: number) => string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[14px] font-semibold text-ink flex-1">{label}</span>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="w-11 h-11 rounded-xl border border-line bg-white grid place-items-center active:bg-app" aria-label={'Fewer ' + label}><Minus size={16} /></button>
      <span className="w-16 text-center text-[16px] font-bold tabular-nums">{render ? render(value) : value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} className="w-11 h-11 rounded-xl border border-line bg-white grid place-items-center active:bg-app" aria-label={'More ' + label}><Plus size={16} /></button>
    </div>
  )
}
function Choice({ label, value, options, onChange }: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-[14px] font-semibold text-ink mb-1.5">{label}</div>
      <div className="flex gap-1.5 flex-wrap">{options.map(o => <button type="button" key={o.v} onClick={() => onChange(o.v)} className={CHIP + ' ' + (value === o.v ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line')}>{o.l}</button>)}</div>
    </div>
  )
}
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" onClick={() => onChange(!on)} className={CHIP + ' ' + (on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line')}>{on ? <Check size={14} className="mr-1" /> : null}{label}</button>
}

function AddRoom({ act, reload }: { act: (b: any) => Promise<any>; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<RoomKind>('other')
  const [busy, setBusy] = useState(false)
  if (!open) return <div className="px-4 py-3 border-t border-line"><button onClick={() => setOpen(true)} className="text-[14px] font-bold text-brand-700 inline-flex items-center gap-1.5 min-h-[40px]"><Plus size={16} /> Add a room</button></div>
  return (
    <div className="px-4 py-3 border-t border-line space-y-2">
      <input value={name} onChange={e => setName(e.target.value)} className={INPUT} placeholder="Room name (Den, Office, Storage…)" autoFocus />
      <div className="flex gap-1.5 flex-wrap">{(Object.keys(ROOM_KIND_LABEL) as RoomKind[]).map(k => <button key={k} type="button" onClick={() => setKind(k)} className={CHIP + ' ' + (kind === k ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line')}>{ROOM_KIND_LABEL[k]}</button>)}</div>
      <div className="flex gap-2">
        <button onClick={async () => { setBusy(true); try { await act({ action: 'addRoom', name, kind }); setName(''); setOpen(false); await reload() } catch (e: any) { alert(String(e?.message || e)) } setBusy(false) }} disabled={busy || !name.trim()} className={BTN + ' bg-ink text-white flex-1'}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add room</button>
        <button onClick={() => setOpen(false)} className={BTN + ' border border-line bg-white text-ink'}>Cancel</button>
      </div>
    </div>
  )
}

// ── 2. ROOM VIEW ────────────────────────────────────────────────────────────────────────────────
function RoomView({ code, unit, room, items, onBack, act, reload }: { code: string; unit: Unit; room: Room; items: Item[]; onBack: () => void; act: (b: any) => Promise<any>; reload: () => Promise<void> }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(room.name)
  const [uploading, setUploading] = useState(0)
  const [err, setErr] = useState('')
  const [notes, setNotes] = useState(room.notes || '')
  const [addOpen, setAddOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const photos = Array.isArray(room.photos) ? room.photos : []
  const confirmed = items.filter(i => i.condition).length

  const upload = async (files: FileList | null, itemId?: string) => {
    if (!files || !files.length) return
    setErr(''); setUploading(files.length)
    for (const f of Array.from(files)) {
      try {
        const fd = new FormData(); fd.append('code', code); fd.append('roomId', room.id); if (itemId) fd.append('itemId', itemId); fd.append('file', f)
        const r = await fetch('/api/onboard/photo', { method: 'POST', body: fd })
        const j = await r.json().catch(() => ({}))
        if (!r.ok || !j.ok) throw new Error(j.error || 'Upload failed')
      } catch (e: any) { setErr(String(e?.message || e)) }
      setUploading(n => n - 1)
    }
    await reload()
  }
  const wrap = async (fn: () => Promise<any>) => { setErr(''); try { await fn(); await reload() } catch (e: any) { setErr(String(e?.message || e)) } }
  const markAllGood = () => wrap(async () => { for (const i of items.filter(x => !x.condition)) await act({ action: 'updateItem', itemId: i.id, condition: 'good' }) })

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onBack} className="w-11 h-11 rounded-xl border border-line bg-white grid place-items-center" aria-label="Back to rooms"><ChevronLeft size={18} /></button>
        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} className={INPUT} autoFocus />
              <button onClick={() => wrap(async () => { await act({ action: 'renameRoom', roomId: room.id, name }); setRenaming(false) })} className={BTN + ' bg-ink text-white'}><Check size={16} /></button>
            </div>
          ) : (
            <button onClick={() => setRenaming(true)} className="text-left flex items-center gap-2 min-h-[44px]">
              <span className="text-[22px] font-bold text-ink leading-tight">{room.name}</span><Pencil size={14} className="text-muted" />
            </button>
          )}
          <div className="text-[12px] text-muted">{unit.name} · {ROOM_KIND_LABEL[room.kind]} · {confirmed}/{items.length} items confirmed</div>
        </div>
      </div>

      {/* photos */}
      <section className="rounded-2xl border border-line bg-white p-3 mb-3">
        <div className="flex items-center gap-2 mb-2">
          <ImageIcon size={15} className="text-muted" /><span className="font-bold text-[14px] text-ink">Room photos</span><span className="text-[12px] text-muted">{photos.length ? photos.length : 'none yet'}</span>
          <span className="ml-auto flex gap-1.5">
            <button onClick={() => fileRef.current?.click()} className={BTN + ' bg-ink text-white min-h-[40px] px-3 text-[13px]'} disabled={uploading > 0}>{uploading ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />} {uploading ? 'Uploading ' + uploading : 'Take photo'}</button>
          </span>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={e => { upload(e.target.files); e.target.value = '' }} />
        </div>
        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={p.url + i} className="relative aspect-square rounded-xl overflow-hidden bg-app">
                <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.caption || room.name} className="w-full h-full object-cover" /></a>
                <button onClick={() => wrap(() => act({ action: 'removePhoto', roomId: room.id, url: p.url }))} className="absolute top-1 right-1 w-8 h-8 rounded-full bg-black/60 text-white grid place-items-center" aria-label="Remove photo"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {!photos.length && <p className="text-[12.5px] text-muted">Take a wide shot from the door, then one of anything worn or missing. Several at once is fine.</p>}
      </section>

      {/* items */}
      <section className="rounded-2xl border border-line bg-white overflow-hidden mb-3">
        <div className="px-3 py-2.5 flex items-center gap-2 border-b border-line">
          <span className="font-bold text-[14px] text-ink">Inventory</span>
          <span className="text-[12px] text-muted">qty in the room · tap a condition to confirm</span>
          {items.some(i => !i.condition) && <button onClick={markAllGood} className="ml-auto text-[12px] font-bold text-brand-700 min-h-[36px] px-2">All unconfirmed → Good</button>}
        </div>
        <div className="divide-y divide-line">
          {items.map(i => <ItemRow key={i.id} item={i} code={code} act={act} reload={reload} onPhoto={files => upload(files, i.id)} />)}
        </div>
        {addOpen
          ? <AddItem roomId={room.id} act={act} onDone={async () => { setAddOpen(false); await reload() }} onCancel={() => setAddOpen(false)} />
          : <div className="px-3 py-2.5 border-t border-line"><button onClick={() => setAddOpen(true)} className="text-[14px] font-bold text-brand-700 inline-flex items-center gap-1.5 min-h-[40px]"><Plus size={16} /> Add item or furniture</button></div>}
      </section>

      <section className="rounded-2xl border border-line bg-white p-3 mb-3">
        <label className={LABEL}>Room notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => { if (notes !== (room.notes || '')) wrap(() => act({ action: 'roomNotes', roomId: room.id, notes })) }} rows={2} className={INPUT} placeholder="Damage, smells, anything a photo does not show" />
      </section>

      {err && <p className="text-[13px] text-rose-600 font-semibold mb-2">{err}</p>}
      <div className="flex gap-2 mb-6">
        <button onClick={() => wrap(() => act({ action: 'checkRoom', roomId: room.id, checked: !room.checked_at }))} className={BTN + ' flex-1 ' + (room.checked_at ? 'border border-emerald-300 bg-emerald-50 text-emerald-800' : 'bg-ink text-white')}>{room.checked_at ? <><CheckCircle2 size={16} /> Room done — tap to reopen</> : <><Check size={16} /> Mark room done</>}</button>
        <button onClick={() => { if (confirm('Remove "' + room.name + '" and its ' + items.length + ' items?')) wrap(async () => { await act({ action: 'removeRoom', roomId: room.id }); onBack() }) }} className={BTN + ' border border-line bg-white text-muted'} aria-label="Remove room"><Trash2 size={16} /></button>
      </div>
      <button onClick={onBack} className={BTN + ' w-full border border-line bg-white text-ink mb-4'}><ChevronLeft size={16} /> Back to rooms</button>
    </div>
  )
}

function ItemRow({ item: i, code, act, reload, onPhoto }: { item: Item; code: string; act: (b: any) => Promise<any>; reload: () => Promise<void>; onPhoto: (f: FileList | null) => void }) {
  const [more, setMore] = useState(false)
  const [brand, setBrand] = useState(i.brand || '')
  const [notes, setNotes] = useState(i.notes || '')
  const [qty, setQty] = useState(i.qty)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => setQty(i.qty), [i.qty])
  const save = async (patch: any) => { try { await act({ action: 'updateItem', itemId: i.id, ...patch }); await reload() } catch (e: any) { alert(String(e?.message || e)) } }
  const bump = (d: number) => { const v = Math.max(0, qty + d); setQty(v); save({ qty: v, ...(v === 0 && !i.condition ? { condition: 'missing' } : {}) }) }
  return (
    <div className={'px-3 py-2.5 ' + (i.condition ? '' : 'bg-amber-50/30')}>
      <div className="flex items-center gap-2">
        <button onClick={() => setMore(m => !m)} className="flex-1 min-w-0 text-left">
          <span className="block text-[14.5px] font-semibold text-ink leading-tight truncate">{i.name}{i.brand && i.brand !== 'size' && i.brand !== 'model' ? <span className="text-muted font-normal"> · {i.brand}</span> : null}</span>
          <span className="block text-[11.5px] text-muted">{CATEGORIES.find(c => c.key === i.category)?.label || i.category}{i.suggested && !i.condition ? ' · expected — confirm' : ''}{i.photo_url ? ' · photo' : ''}</span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => bump(-1)} className="w-9 h-9 rounded-lg border border-line bg-white grid place-items-center" aria-label="One fewer"><Minus size={14} /></button>
          <span className="w-8 text-center text-[15px] font-bold tabular-nums">{qty}</span>
          <button onClick={() => bump(1)} className="w-9 h-9 rounded-lg border border-line bg-white grid place-items-center" aria-label="One more"><Plus size={14} /></button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {CONDITIONS.map(c => (
          <button key={c.key} onClick={() => save({ condition: i.condition === c.key ? null : c.key })} className={'rounded-full border text-[12px] font-semibold min-h-[34px] px-3 ' + (i.condition === c.key ? c.cls : 'bg-white text-ink/70 border-line')}>{c.label}</button>
        ))}
        <button onClick={() => fileRef.current?.click()} className={'ml-auto w-9 h-9 rounded-lg border grid place-items-center ' + (i.photo_url ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-line bg-white text-muted')} aria-label="Photo of this item"><Camera size={15} /></button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { onPhoto(e.target.files); e.target.value = '' }} />
      </div>
      {more && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input value={brand} onChange={e => setBrand(e.target.value)} onBlur={() => brand !== (i.brand || '') && save({ brand })} className={INPUT} placeholder="Brand / model / size" />
          <input value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => notes !== (i.notes || '') && save({ notes })} className={INPUT} placeholder="Notes" />
          {i.photo_url && <a href={i.photo_url} target="_blank" rel="noreferrer" className="col-span-2"><img src={i.photo_url} alt={i.name} className="h-28 rounded-xl object-cover" /></a>}
          <button onClick={() => { if (confirm('Remove "' + i.name + '"?')) act({ action: 'removeItem', itemId: i.id }).then(reload).catch((e: any) => alert(String(e?.message || e))) }} className="col-span-2 text-[13px] font-semibold text-rose-700 inline-flex items-center gap-1 min-h-[36px]"><Trash2 size={14} /> Remove item</button>
        </div>
      )}
    </div>
  )
}

function AddItem({ roomId, act, onDone, onCancel }: { roomId: string; act: (b: any) => Promise<any>; onDone: () => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('furniture')
  const [qty, setQty] = useState(1)
  const [condition, setCondition] = useState<Condition>('good')
  const [busy, setBusy] = useState(false)
  return (
    <div className="px-3 py-3 border-t border-line space-y-2">
      <input value={name} onChange={e => setName(e.target.value)} className={INPUT} placeholder="What is it? (Bar cart, Peloton, Extra lamp…)" autoFocus />
      <div className="flex gap-1.5 flex-wrap">{CATEGORIES.map(c => <button key={c.key} type="button" onClick={() => setCategory(c.key)} className={CHIP + ' min-h-[34px] text-[12px] ' + (category === c.key ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line')}>{c.label}</button>)}</div>
      <div className="flex items-center gap-2 flex-wrap">
        <Stepper label="Qty" value={qty} min={0} max={99} onChange={setQty} />
      </div>
      <div className="flex gap-1.5 flex-wrap">{CONDITIONS.map(c => <button key={c.key} type="button" onClick={() => setCondition(c.key)} className={'rounded-full border text-[12px] font-semibold min-h-[34px] px-3 ' + (condition === c.key ? c.cls : 'bg-white text-ink/70 border-line')}>{c.label}</button>)}</div>
      <div className="flex gap-2">
        <button onClick={async () => { setBusy(true); try { await act({ action: 'addItem', roomId, name, category, qty, condition }); await onDone() } catch (e: any) { alert(String(e?.message || e)) } setBusy(false) }} disabled={busy || !name.trim()} className={BTN + ' bg-ink text-white flex-1'}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add</button>
        <button onClick={onCancel} className={BTN + ' border border-line bg-white text-ink'}>Cancel</button>
      </div>
    </div>
  )
}

// ── 3. SUMMARY ──────────────────────────────────────────────────────────────────────────────────
function summarize(unit: Unit, rooms: Room[], items: Item[]) {
  const byRoom = rooms.map(r => {
    const its = items.filter(i => i.room_id === r.id)
    const flagged = its.filter(i => i.condition === 'worn' || i.condition === 'missing')
    return { r, its, flagged, photos: Array.isArray(r.photos) ? r.photos.length : 0 }
  })
  const flagged = byRoom.flatMap(x => x.flagged.map(i => ({ room: x.r.name, i })))
  return { byRoom, flagged, totalQty: items.reduce((a, i) => a + (i.qty || 0), 0) }
}
function Summary({ unit, rooms, items, progress }: { unit: Unit; rooms: Room[]; items: Item[]; progress: Progress }) {
  const s = useMemo(() => summarize(unit, rooms, items), [unit, rooms, items])
  return (
    <div className="text-[13px] text-ink/85 space-y-1.5">
      <div><b>{rooms.length}</b> rooms · <b>{items.length}</b> line items · <b>{s.totalQty}</b> pieces · <b>{progress.photos}</b> photos</div>
      {s.flagged.length > 0 ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
          <div className="font-bold text-rose-800 mb-1">{s.flagged.length} worn or missing</div>
          <ul className="space-y-0.5">{s.flagged.slice(0, 12).map(({ room, i }) => <li key={i.id} className="text-rose-900">{room} — {i.name}{i.qty ? ' ×' + i.qty : ''} · <span className="uppercase text-[11px] font-bold">{i.condition}</span>{i.notes ? ' · ' + i.notes : ''}</li>)}{s.flagged.length > 12 && <li className="text-rose-800/70">+{s.flagged.length - 12} more</li>}</ul>
        </div>
      ) : <div className="text-emerald-800">Nothing flagged worn or missing.</div>}
    </div>
  )
}
function CopySummary({ unit, rooms, items }: { unit: Unit; rooms: Room[]; items: Item[] }) {
  const [ok, setOk] = useState(false)
  const copy = async () => {
    const s = summarize(unit, rooms, items)
    const lines = [unit.name + (unit.building ? ' · ' + unit.building : '') + (unit.unit_no ? ' #' + unit.unit_no : ''), describeUnit(unit.details || {}), '']
    for (const x of s.byRoom) {
      lines.push(x.r.name.toUpperCase() + ' (' + x.photos + ' photo' + (x.photos === 1 ? '' : 's') + ')')
      for (const i of x.its) lines.push('  ' + (i.qty || 0) + '× ' + i.name + (i.brand && i.brand !== 'size' && i.brand !== 'model' ? ' — ' + i.brand : '') + (i.condition ? ' [' + i.condition + ']' : ' [unconfirmed]') + (i.notes ? ' · ' + i.notes : ''))
      if (x.r.notes) lines.push('  Notes: ' + x.r.notes)
      lines.push('')
    }
    if (s.flagged.length) { lines.push('WORN / MISSING'); for (const { room, i } of s.flagged) lines.push('  ' + room + ' — ' + i.name + ' [' + i.condition + ']') }
    try { await navigator.clipboard.writeText(lines.join('\n')); setOk(true); setTimeout(() => setOk(false), 2000) } catch {}
  }
  return <button onClick={copy} className={BTN + ' border border-line bg-white text-ink'}>{ok ? <><Check size={16} className="text-emerald-600" /> Copied</> : <><ClipboardCopy size={16} /> Copy summary</>}</button>
}
