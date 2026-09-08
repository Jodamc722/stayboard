'use client'
// WHICH UNITS THE FRONT DESK COVERS (Jon, 2026-09-08: "add new Salato units to the front desk link
// and for verifications" / "make it where the shareable link is editable where we can [pick]
// listing"). Tick a listing and it appears on the board, the share link, the verification flow, the
// daily email and the vendor board — all five read the same saved set.
import { useEffect, useMemo, useState } from 'react'

type L = { id: string; name: string; building: string | null; auto: boolean; picked: boolean; excluded: boolean; on: boolean }
type Cfg = { mode: 'auto' | 'auto-plus' | 'list'; ids: string[]; exclude: string[] }

export function SalatoUnitsPicker({ onSaved }: { onSaved?: () => void }) {
  const [listings, setListings] = useState<L[]>([])
  const [cfg, setCfg] = useState<Cfg>({ mode: 'auto', ids: [], exclude: [] })
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = async () => {
    try {
      const r = await fetch('/api/salato/units', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not load units')
      setListings(j.listings); setCfg(j.cfg); setErr('')
    } catch (e: any) { setErr(String(e?.message || e)) }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // Local view of on/off so the list reacts instantly; Save writes the whole set at once.
  const [on, setOn] = useState<Record<string, boolean>>({})
  useEffect(() => { const m: Record<string, boolean> = {}; for (const l of listings) m[l.id] = l.on; setOn(m) }, [listings])

  const toggle = (l: L) => { setSaved(false); setOn(p => ({ ...p, [l.id]: !p[l.id] })) }

  const dirty = useMemo(() => listings.some(l => !!on[l.id] !== l.on), [listings, on])
  const chosen = listings.filter(l => on[l.id])

  const save = async () => {
    setSaving(true); setErr('')
    // Anything ticked that the name rule does not catch is an explicit add; anything the rule
    // catches but is unticked is an explicit hold-out. Mode stays auto-plus so a future unit
    // literally named "Salato …" still appears on its own.
    const ids = listings.filter(l => on[l.id] && !l.auto).map(l => l.id)
    const exclude = listings.filter(l => !on[l.id] && l.auto).map(l => l.id)
    try {
      const r = await fetch('/api/salato/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'auto-plus', ids, exclude }) })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save')
      setListings(j.listings); setCfg(j.cfg); setSaved(true); onSaved?.()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setSaving(false)
  }

  const n = q.trim().toLowerCase()
  const shown = listings.filter(l => {
    if (n && !(l.name.toLowerCase().includes(n) || String(l.building || '').toLowerCase().includes(n))) return false
    return showAll || n ? true : (on[l.id] || l.auto)
  })

  return (
    <div className='rounded-2xl border border-neutral-200 bg-white shadow-sm overflow-hidden'>
      <div className='px-4 py-3 border-b border-neutral-100'>
        <div className='font-semibold text-neutral-900'>Units on the front desk</div>
        <div className='text-xs text-neutral-500 mt-0.5'>{loading ? 'Loading…' : chosen.length + ' unit' + (chosen.length === 1 ? '' : 's')} · these are the units on the board, the shared link, verification and the daily email.</div>
      </div>
      <div className='px-4 py-3 border-b border-neutral-100'>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder='Search every listing…' className='w-full text-[16px] sm:text-sm border border-neutral-300 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400' />
      </div>
      {err && <div className='mx-4 my-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2'>{err}</div>}
      <div className='max-h-[22rem] overflow-y-auto divide-y divide-neutral-100'>
        {!loading && !shown.length && <div className='px-4 py-8 text-center text-sm text-neutral-400'>{n ? 'No listing matches “' + q + '”.' : 'No units yet — search above to add one.'}</div>}
        {shown.map(l => {
          const isOn = !!on[l.id]
          return (
            <button key={l.id} onClick={() => toggle(l)} className='w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-neutral-50'>
              <span className={'shrink-0 w-5 h-5 rounded-md border grid place-items-center text-[11px] font-bold ' + (isOn ? 'bg-neutral-900 border-neutral-900 text-white' : 'border-neutral-300 text-transparent')}>✓</span>
              <span className='flex-1 min-w-0'>
                <span className='block text-sm font-medium text-neutral-900 truncate'>{l.name}</span>
                <span className='block text-xs text-neutral-400 truncate'>{l.building || 'No building set'}{l.auto ? ' · matches “Salato” by name' : ''}</span>
              </span>
              {isOn && !l.auto && <span className='text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0'>Added</span>}
              {!isOn && l.auto && <span className='text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500 shrink-0'>Held out</span>}
            </button>
          )
        })}
      </div>
      <div className='px-4 py-3 border-t border-neutral-100 flex items-center gap-2 flex-wrap'>
        {!n && <button onClick={() => setShowAll(v => !v)} className='text-xs font-medium text-neutral-500 hover:text-neutral-800'>{showAll ? 'Show only Salato units' : 'Show every listing'}</button>}
        <span className='flex-1' />
        {saved && !dirty && <span className='text-xs font-semibold text-emerald-700'>Saved</span>}
        <button onClick={save} disabled={saving || !dirty} className='text-sm font-semibold px-4 py-2 rounded-xl bg-neutral-900 text-white disabled:opacity-40'>{saving ? 'Saving…' : 'Save units'}</button>
      </div>
      <div className='px-4 pb-3 text-[11px] text-neutral-400'>Saving updates the board, the shared link, verification and the daily email at once. Front-desk phones pick it up on their next refresh.</div>
    </div>
  )
}
