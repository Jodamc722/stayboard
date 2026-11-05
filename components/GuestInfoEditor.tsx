'use client'
// GUEST INFO — the Guesty fields Bernadette fills by hand on every listing (2026-11-05):
//   Details & Layout → Location & details: Wi-Fi name, Wi-Fi password, House manual, Trash pick-up
//   instructions, Parking instructions
//   Pricing & policies → Reservation policies → House rules → Additional house rules (the detailed rules)
// GuestInfoFields is the form (used by the building's bulk panel); GuestInfoEditor is the one-listing
// version on the unit page, prefilled live from Guesty. Both save through /api/bulk-policies.
import { useEffect, useState } from 'react'
import { Wifi, Check, Loader2, Pencil, AlertTriangle } from 'lucide-react'

export type GuestInfo = { wifiName: string; wifiPassword: string; houseManual: string; trashCollectedOn: string; parkingInstructions: string; additionalRules: string }
export const GUEST_INFO_EMPTY: GuestInfo = { wifiName: '', wifiPassword: '', houseManual: '', trashCollectedOn: '', parkingInstructions: '', additionalRules: '' }
export const GUEST_INFO_LABEL: Record<keyof GuestInfo, string> = {
  wifiName: 'Wi-Fi name', wifiPassword: 'Wi-Fi password', houseManual: 'House manual',
  trashCollectedOn: 'Trash pick-up instructions', parkingInstructions: 'Parking instructions', additionalRules: 'Additional house rules',
}
const WHERE: Record<keyof GuestInfo, string> = {
  wifiName: 'Location & details', wifiPassword: 'Location & details', houseManual: 'Location & details',
  trashCollectedOn: 'Location & details', parkingInstructions: 'Location & details', additionalRules: 'Reservation policies → House rules',
}

const field = 'w-full mt-0.5 px-2.5 py-1.5 text-[13px] rounded-lg border border-line bg-app focus:outline-none focus:ring-2 focus:ring-brand-200'

export function GuestInfoFields({ value, onChange, placeholders, hint }: { value: GuestInfo; onChange: (v: GuestInfo) => void; placeholders?: Partial<GuestInfo>; hint?: string }) {
  const set = (k: keyof GuestInfo) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  const ph = (k: keyof GuestInfo, d: string) => placeholders?.[k] || d
  return (
    <div className="space-y-2">
      {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[11px] text-muted">{GUEST_INFO_LABEL.wifiName}
          <input value={value.wifiName} onChange={set('wifiName')} placeholder={ph('wifiName', 'e.g. StayGuest_2023')} autoComplete="off" className={field} />
        </label>
        <label className="text-[11px] text-muted">{GUEST_INFO_LABEL.wifiPassword}
          <input value={value.wifiPassword} onChange={set('wifiPassword')} placeholder={ph('wifiPassword', 'e.g. welcome2023')} autoComplete="off" className={field} />
        </label>
      </div>
      <label className="block text-[11px] text-muted">{GUEST_INFO_LABEL.houseManual}
        <textarea value={value.houseManual} onChange={set('houseManual')} rows={3} placeholder={ph('houseManual', 'How things work: AC, TV, appliances, lockbox, check-out steps…')} className={field} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[11px] text-muted">{GUEST_INFO_LABEL.trashCollectedOn}
          <textarea value={value.trashCollectedOn} onChange={set('trashCollectedOn')} rows={2} placeholder={ph('trashCollectedOn', 'e.g. Chute at the end of each hallway; recycling in the garage')} className={field} />
        </label>
        <label className="text-[11px] text-muted">{GUEST_INFO_LABEL.parkingInstructions}
          <textarea value={value.parkingInstructions} onChange={set('parkingInstructions')} rows={2} placeholder={ph('parkingInstructions', 'e.g. One assigned spot, $30/night, book before arrival')} className={field} />
        </label>
      </div>
      <label className="block text-[11px] text-muted">{GUEST_INFO_LABEL.additionalRules} <span className="text-muted/70">— the detailed rules (Reservation policies → House rules)</span>
        <textarea value={value.additionalRules} onChange={set('additionalRules')} rows={3} placeholder={ph('additionalRules', 'No parties or events. Quiet hours 10pm–8am. No smoking indoors…')} className={field} />
      </label>
    </div>
  )
}

/** Only the fields that were typed — blank = leave Guesty as it is. */
export function guestInfoPolicy(v: GuestInfo, base?: GuestInfo): Partial<GuestInfo> {
  const out: Partial<GuestInfo> = {}
  for (const k of Object.keys(GUEST_INFO_EMPTY) as (keyof GuestInfo)[]) {
    const now = String(v[k] || '').trim()
    if (base) { if (now !== String(base[k] || '').trim()) out[k] = now || '__clear__' }
    else if (now) out[k] = now
  }
  return out
}

export function GuestInfoEditor({ listingId }: { listingId: string }) {
  const [cur, setCur] = useState<GuestInfo | null>(null)
  const [val, setVal] = useState<GuestInfo>(GUEST_INFO_EMPTY)
  const [loadErr, setLoadErr] = useState('')
  const [hrErr, setHrErr] = useState('')
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => {
    setLoadErr('')
    fetch('/api/bulk-policies?probe=guestinfo&listingId=' + encodeURIComponent(listingId), { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (j.error) { setLoadErr(j.error); return }
      const g: GuestInfo = { ...GUEST_INFO_EMPTY }
      for (const k of Object.keys(g) as (keyof GuestInfo)[]) g[k] = String(j[k] || '')
      setCur(g); setVal(g); setHrErr(j.houseRulesError || '')
    }).catch(e => setLoadErr(String(e?.message || e)))
  }
  useEffect(load, [listingId])

  async function save() {
    if (!cur) return
    const policy = guestInfoPolicy(val, cur)
    if (!Object.keys(policy).length) { setEdit(false); return }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/bulk-policies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingIds: [listingId], policy }) })
      const j = await r.json().catch(() => ({}))
      const res = Array.isArray(j?.results) ? j.results[0] : null
      if (!r.ok || j?.error || (res && res.ok === false)) throw new Error(j?.error || res?.error || 'Guesty did not take it')
      setCur(val); setEdit(false); setMsg({ ok: true, text: 'Saved to Guesty.' })
    } catch (e: any) { setMsg({ ok: false, text: String(e?.message || e) }) } finally { setBusy(false) }
  }

  const keys = Object.keys(GUEST_INFO_EMPTY) as (keyof GuestInfo)[]
  const missing = cur ? keys.filter(k => !cur[k].trim()) : []
  return (
    <div id="guest-info" className="rounded-2xl border border-line bg-white overflow-hidden scroll-mt-20">
      <div className="px-3 py-2 bg-app border-b border-line flex items-center gap-2">
        <Wifi size={12} className="text-muted" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted flex-1">Guest info · Wi-Fi, manual, trash, parking, house rules</span>
        {cur && !edit ? <button onClick={() => { setEdit(true); setMsg(null) }} className="text-[11.5px] font-semibold inline-flex items-center gap-1 text-brand-700 hover:text-brand-800"><Pencil size={11} /> Edit</button> : null}
        {edit ? <span className="inline-flex items-center gap-2">
          <button onClick={save} disabled={busy} className="text-[11.5px] font-semibold rounded-md bg-brand-600 text-white px-2 py-0.5 disabled:opacity-50 inline-flex items-center gap-1">{busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save to Guesty</button>
          <button onClick={() => { setEdit(false); if (cur) setVal(cur) }} className="text-[11.5px] text-muted">Cancel</button>
        </span> : null}
      </div>
      <div className="p-3 text-[12.5px]">
        {!cur && !loadErr ? <p className="text-muted inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Reading Guesty…</p> : null}
        {loadErr ? <p className="text-rose-700">Could not read Guesty: {loadErr} <button onClick={load} className="underline ml-1">Retry</button></p> : null}
        {cur && edit ? <GuestInfoFields value={val} onChange={setVal} hint="Clearing a box clears it on Guesty." /> : null}
        {cur && !edit ? (
          <dl className="divide-y divide-line -my-1">
            {keys.map(k => (
              <div key={k} className="flex gap-2 py-1.5">
                <dt className="text-muted w-40 shrink-0">{GUEST_INFO_LABEL[k]}<span className="block text-[10px] text-muted/70">{WHERE[k]}</span></dt>
                <dd className={'flex-1 whitespace-pre-wrap break-words ' + (cur[k].trim() ? 'text-ink' : 'text-rose-700 font-semibold')}>
                  {cur[k].trim() ? (cur[k].length > 400 ? cur[k].slice(0, 400) + '…' : cur[k]) : 'Missing'}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {cur && !edit && missing.length ? <p className="mt-2 text-[11.5px] text-amber-800">{missing.length} missing — Edit to fill {missing.length === 1 ? 'it' : 'them'}.</p> : null}
        {hrErr ? <p className="mt-2 text-[11.5px] text-amber-800 inline-flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5" /> Additional house rules could not be read: {hrErr}</p> : null}
        {msg ? <p className={'mt-2 text-[11.5px] ' + (msg.ok ? 'text-emerald-700' : 'text-rose-700')}>{msg.text}</p> : null}
      </div>
    </div>
  )
}
