'use client'
// THE GUEST DIRECTORY. A person, not a reservation, is the row: stays, nights, lifetime value,
// last/next stay, the units they know. Tap a row and the profile opens in place — history on one
// side, OUR knowledge (VIP / tags / notes) editable on the other. "Add guest" mints a profile
// before the first booking exists, because the whole point of a profile is knowing something
// about a person Guesty doesn't.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Search, Star, Plus, Check, X, Phone, Mail, ChevronDown } from 'lucide-react'

type Guest = {
  key: string; name: string; email: string | null; phone: string | null
  stays: number; nights: number; value: number
  firstStay: string; lastStay: string; nextStay: string | null; inHouse: boolean
  units: string[]
  history: { unit: string; checkIn: string; checkOut: string; nights: number; value: number; source: string }[]
  profile: { vip: boolean; tags: string[]; notes: string } | null
}

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export function GuestsDirectory() {
  const [data, setData] = useState<{ guests: Guest[]; totals: any } | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [openKey, setOpenKey] = useState('')
  const [adding, setAdding] = useState(false)
  const [shown, setShown] = useState(50)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/guests', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.message || j?.error || 'Could not load guests.')
      setData({ guests: j.guests || [], totals: j.totals || {} })
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const list = useMemo(() => {
    if (!data) return []
    const n = q.trim().toLowerCase()
    if (!n) return data.guests
    return data.guests.filter(g =>
      (g.name + ' ' + (g.email || '') + ' ' + (g.phone || '') + ' ' + g.units.join(' ') + ' ' + (g.profile?.tags || []).join(' ')).toLowerCase().includes(n))
  }, [data, q])

  if (err) return <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div>
  if (!data) return <div className="rounded-2xl border border-line bg-white p-10 text-center text-sm text-muted"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading every guest…</div>

  const t = data.totals || {}
  return (
    <div className="space-y-3">
      {/* the numbers that describe the guest book */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[['Guests', t.guests], ['Repeat guests', t.repeat], ['VIP', t.vip], ['In house now', t.inHouse]].map(([l, v]: any) => (
          <div key={l} className="rounded-2xl border border-line bg-white px-4 py-3">
            <p className="text-[10.5px] uppercase tracking-wider font-bold text-muted">{l}</p>
            <p className="text-xl font-bold text-ink tabular-nums">{v ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => { setQ(e.target.value); setShown(50) }} placeholder="Search name, email, phone, unit, tag…"
            className="w-full rounded-xl border border-line bg-white pl-9 pr-3 py-2.5 text-[13px]" />
        </div>
        <button onClick={() => setAdding(a => !a)}
          className="rounded-xl bg-ink text-white px-3.5 py-2.5 text-[13px] font-bold inline-flex items-center gap-1.5 shrink-0">
          <Plus size={14} /> Add guest
        </button>
      </div>

      {adding ? <ProfileEditor guest={null} onDone={() => { setAdding(false); load() }} onCancel={() => setAdding(false)} /> : null}

      <div className="rounded-2xl border border-line bg-white overflow-hidden shadow-soft divide-y divide-line">
        {list.slice(0, shown).map(g => (
          <div key={g.key}>
            <button onClick={() => setOpenKey(openKey === g.key ? '' : g.key)} className="w-full px-4 py-3 text-left hover:bg-app/40">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-[13.5px] font-bold text-ink">{g.name}</span>
                {g.profile?.vip ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 inline-flex items-center gap-0.5"><Star size={9} /> VIP</span> : null}
                {g.inHouse ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">In house</span> : null}
                {(g.profile?.tags || []).slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-app text-muted">{tag}</span>
                ))}
                <div className="flex-1" />
                <span className="text-[12.5px] text-muted tabular-nums">
                  {g.stays} stay{g.stays === 1 ? '' : 's'} · {g.nights}n · <span className="font-bold text-ink">{usd(g.value)}</span>
                </span>
                <ChevronDown size={14} className={'text-muted transition-transform ' + (openKey === g.key ? 'rotate-180' : '')} />
              </div>
              <p className="text-[11.5px] text-muted mt-0.5">
                {g.nextStay ? <span className="text-emerald-700 font-semibold">Returns {g.nextStay} · </span> : null}
                {g.lastStay ? 'Last stay ' + g.lastStay + ' · ' : ''}
                {g.units.slice(0, 4).join(', ')}{g.units.length > 4 ? ` +${g.units.length - 4}` : ''}
              </p>
            </button>
            {openKey === g.key ? (
              <div className="border-t border-line bg-app/30 px-4 py-3 grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">Stays</p>
                  <div className="space-y-1">
                    {g.history.map((h, i) => (
                      <p key={i} className="text-[12.5px] text-ink flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{h.unit}</span>
                        <span className="text-muted tabular-nums">{h.checkIn} → {h.checkOut} · {h.nights}n</span>
                        <span className="ml-auto tabular-nums font-semibold">{h.value ? usd(h.value) : '—'}</span>
                      </p>
                    ))}
                    {!g.history.length ? <p className="text-[12.5px] text-muted">No reservations yet — profile only.</p> : null}
                  </div>
                  <p className="text-[12px] text-muted mt-2 flex items-center gap-3 flex-wrap">
                    {g.email ? <span className="inline-flex items-center gap-1"><Mail size={11} /> {g.email}</span> : null}
                    {g.phone ? <span className="inline-flex items-center gap-1"><Phone size={11} /> {g.phone}</span> : null}
                  </p>
                </div>
                <ProfileEditor guest={g} onDone={load} onCancel={() => setOpenKey('')} inline />
              </div>
            ) : null}
          </div>
        ))}
        {!list.length ? <p className="px-4 py-8 text-center text-[12.5px] text-muted">Nobody matches.</p> : null}
        {list.length > shown ? (
          <button onClick={() => setShown(s => s + 100)} className="w-full px-4 py-2.5 text-[12.5px] font-semibold text-brand-700 hover:bg-app/40">
            Show more — {list.length - shown} left
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** The OUR-side of a guest: VIP, tags, notes — saved to guest_profiles. Doubles as "Add guest". */
function ProfileEditor({ guest, onDone, onCancel, inline }: { guest: Guest | null; onDone: () => void; onCancel: () => void; inline?: boolean }) {
  const [name, setName] = useState(guest?.name || '')
  const [email, setEmail] = useState(guest?.email || '')
  const [phone, setPhone] = useState(guest?.phone || '')
  const [vip, setVip] = useState(!!guest?.profile?.vip)
  const [tags, setTags] = useState((guest?.profile?.tags || []).join(', '))
  const [notes, setNotes] = useState(guest?.profile?.notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/guests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestKey: guest?.key, name, email, phone, vip, notes,
          tags: tags.split(',').map(s => s.trim()).filter(Boolean),
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'Could not save.')
      onDone()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }

  return (
    <div className={inline ? '' : 'rounded-2xl border border-ink/20 bg-white p-4 shadow-soft'}>
      <p className="text-[11px] uppercase tracking-wider font-bold text-muted mb-1.5">{guest ? 'Profile' : 'New guest profile'}</p>
      {!guest ? (
        <div className="grid sm:grid-cols-3 gap-2 mb-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone" className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
        </div>
      ) : null}
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <label className="flex items-center gap-1.5 cursor-pointer text-[12.5px] font-bold text-ink">
          <input type="checkbox" checked={vip} onChange={e => setVip(e.target.checked)} />
          <Star size={12} className="text-amber-500" /> VIP — auto-inspection before every arrival
        </label>
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags, comma separated — e.g. long-stay, corporate"
          className="flex-1 min-w-[200px] rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
        placeholder="What the team should know — preferences, history, how they like the AC…"
        className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
      {err ? <p className="text-[12px] text-rose-600 font-semibold mt-1">{err}</p> : null}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={save} disabled={busy}
          className="rounded-lg bg-ink text-white px-3 py-1.5 text-[12px] font-bold disabled:opacity-40 inline-flex items-center gap-1">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
        </button>
        <button onClick={onCancel} className="text-[12px] font-semibold text-muted inline-flex items-center gap-1"><X size={12} /> Close</button>
      </div>
    </div>
  )
}
