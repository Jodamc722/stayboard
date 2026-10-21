'use client'
// THE GUEST DIRECTORY. A person, not a reservation, is the row: stays, nights, lifetime value,
// last/next stay, the units they know. Tap a row and the profile opens in place — history on one
// side, OUR knowledge (VIP / tags / notes) editable on the other. "Add guest" mints a profile
// before the first booking exists, because the whole point of a profile is knowing something
// about a person Guesty doesn't.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Search, Star, Plus, Check, X, Phone, Mail, Ban } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanList, LeanRow, LeanEmpty } from '@/components/lean'

type Guest = {
  key: string; name: string; email: string | null; phone: string | null
  stays: number; nights: number; value: number
  firstStay: string; lastStay: string; nextStay: string | null; inHouse: boolean
  units: string[]
  history: { unit: string; checkIn: string; checkOut: string; nights: number; value: number; source: string }[]
  profile: { vip: boolean; tags: string[]; notes: string } | null
}

// BANNED (2026-10-21) is the tag "Banned" on the profile; a booking by that person rings the ops bell (lib/banned-guests).
const isBan = (t: string) => /^\s*banned\s*$/i.test(t)
const bannedOf = (g: Guest | null) => !!g?.profile?.tags?.some(isBan)

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export function GuestsDirectory() {
  const [data, setData] = useState<{ guests: Guest[]; totals: any } | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [openKey, setOpenKey] = useState('')
  const [adding, setAdding] = useState(false)
  const [shown, setShown] = useState(50)

  // The search box asks the server (2026-09-03): the API used to hand over its top 2,000 guests
  // and the browser searched only those. Debounced so typing a name is one request, not eight.
  const [serverQ, setServerQ] = useState('')
  useEffect(() => { const t = setTimeout(() => setServerQ(q.trim()), 300); return () => clearTimeout(t) }, [q])
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/guests' + (serverQ ? '?q=' + encodeURIComponent(serverQ) : ''), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.message || j?.error || 'Could not load guests.')
      setData({ guests: j.guests || [], totals: j.totals || {} })
    } catch (e: any) { setErr(String(e?.message || e)) }
  }, [serverQ])
  useEffect(() => { load() }, [load])

  const list = useMemo(() => {
    if (!data) return []
    const n = q.trim().toLowerCase()
    if (!n) return data.guests
    return data.guests.filter(g =>
      (g.name + ' ' + (g.email || '') + ' ' + (g.phone || '') + ' ' + g.units.join(' ') + ' ' + (g.profile?.tags || []).join(' ')).toLowerCase().includes(n))
  }, [data, q])

  const t = data?.totals || {}
  const head = (
    <LeanHead title="Guests">
      <Pill title="Everyone who stayed in the last two years, plus profiles added by hand">{t.guests ?? 0} guests</Pill>
      <Pill title="Guests with more than one stay">{t.repeat ?? 0} repeat</Pill>
      <Pill tone="amber" title="VIP guests get an automatic pre-arrival inspection">{t.vip ?? 0} VIP</Pill>
      <Pill tone="emerald" title="Staying with us right now">{t.inHouse ?? 0} in house</Pill>
      {t.banned ? <Pill tone="rose" title="Marked Banned — a new booking by them notifies the ops team. Search 'banned' to list them." onClick={() => { setQ('banned'); setShown(50) }}>{t.banned} banned</Pill> : null}
    </LeanHead>
  )
  if (err) return <div>{head}<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-700">{err}</div></div>
  if (!data) return <div>{head}<LeanEmpty><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading every guest…</LeanEmpty></div>

  return (
    <div className="space-y-3">
      {head}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e => { setQ(e.target.value); setShown(50) }} placeholder="Search name, email, phone, unit, tag…"
            className="w-full rounded-lg border border-line bg-white pl-8 pr-3 py-1.5 text-[12.5px]" />
        </div>
        <button onClick={() => setAdding(a => !a)} title="Create a profile before the first booking exists"
          className="rounded-lg bg-ink text-white px-2.5 py-1.5 text-[12px] font-bold inline-flex items-center gap-1 shrink-0">
          <Plus size={13} /> Add guest
        </button>
      </div>

      {adding ? <ProfileEditor guest={null} onDone={() => { setAdding(false); load() }} onCancel={() => setAdding(false)} /> : null}

      {!list.length ? <LeanEmpty>Nobody matches.</LeanEmpty> : (
        <LeanList>
          {list.slice(0, shown).map(g => {
            const units = g.units.slice(0, 2).join(', ') + (g.units.length > 2 ? ` +${g.units.length - 2}` : '')
            return (
              <LeanRow key={g.key} open={openKey === g.key} onToggle={() => setOpenKey(openKey === g.key ? '' : g.key)}
                name={g.name}
                meta={[units, g.lastStay ? 'last ' + g.lastStay : ''].filter(Boolean).join(' · ')}
                tags={<>
                  {bannedOf(g) ? <Tag tone="rose" title={g.profile?.notes || 'Banned — a new booking notifies the ops team'}>⛔ Banned</Tag> : null}
                  {g.profile?.vip ? <Tag tone="amber" title="Auto-inspection before every arrival">VIP</Tag> : null}
                  {g.inHouse ? <Tag tone="emerald">In house</Tag> : null}
                  {g.nextStay ? <Tag tone="emerald" title="Next arrival">Returns {g.nextStay}</Tag> : null}
                  <Tag title={`${g.stays} stay${g.stays === 1 ? '' : 's'}, ${g.nights} nights`}>{g.stays}× · {g.nights}n</Tag>
                  <Tag tone="brand" title="Lifetime value">{usd(g.value)}</Tag>
                  {(g.profile?.tags || []).filter(tag => !isBan(tag)).slice(0, 3).map(tag => <Tag key={tag}>{tag}</Tag>)}
                </>}>
                <div className="grid md:grid-cols-2 gap-4 pt-1">
                  <div>
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
                      {g.email ? <a href={'mailto:' + g.email} className="inline-flex items-center gap-1 hover:text-ink"><Mail size={11} /> {g.email}</a> : null}
                      {g.phone ? <a href={'tel:' + g.phone} className="inline-flex items-center gap-1 hover:text-ink"><Phone size={11} /> {g.phone}</a> : null}
                    </p>
                  </div>
                  <ProfileEditor guest={g} onDone={load} onCancel={() => setOpenKey('')} inline />
                </div>
              </LeanRow>
            )
          })}
          {list.length > shown ? (
            <li>
              <button onClick={() => setShown(s => s + 100)} className="w-full px-4 py-2 text-[12.5px] font-semibold text-brand-700 hover:bg-app/40">
                Show more — {list.length - shown} left
              </button>
            </li>
          ) : null}
        </LeanList>
      )}
    </div>
  )
}

/** The OUR-side of a guest: VIP, tags, notes — saved to guest_profiles. Doubles as "Add guest". */
function ProfileEditor({ guest, onDone, onCancel, inline }: { guest: Guest | null; onDone: () => void; onCancel: () => void; inline?: boolean }) {
  const [name, setName] = useState(guest?.name || '')
  const [email, setEmail] = useState(guest?.email || '')
  const [phone, setPhone] = useState(guest?.phone || '')
  const [vip, setVip] = useState(!!guest?.profile?.vip)
  const [tags, setTags] = useState((guest?.profile?.tags || []).filter(t => !isBan(t)).join(', '))
  const [banned, setBanned] = useState(bannedOf(guest))
  const [msg, setMsg] = useState('')
  const [notes, setNotes] = useState(guest?.profile?.notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    setBusy(true); setErr(''); setMsg('')
    // A ban without a reason is a mystery to the next person who reads it — ask for one.
    if (banned && !notes.trim()) { setErr('Add the reason for the ban in the notes, so whoever gets the alert knows why.'); setBusy(false); return }
    if (banned && !guest && !email.trim() && !phone.trim()) { setErr('Add an email or phone — a name alone can only flag a possible match.'); setBusy(false); return }
    try {
      const r = await fetch('/api/guests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestKey: guest?.key, name, email, phone, vip, notes,
          tags: [...(banned ? ['Banned'] : []), ...tags.split(',').map(s => s.trim()).filter(t => t && !isBan(t))],
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j?.message || j?.error || 'Could not save.')
      const n = j?.bannedCheck?.notified || 0
      if (n) setMsg(`Saved — ${n} upcoming booking${n === 1 ? '' : 's'} by this guest found; the ops team has been notified.`)
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
          <Star size={12} className="text-amber-500" /> VIP <span className="font-normal text-muted">(auto-inspection)</span>
        </label>
        <label className={`flex items-center gap-1.5 cursor-pointer text-[12.5px] font-bold ${banned ? 'text-rose-700' : 'text-ink'}`}
          title="A new booking by this guest (same Guesty id, email or phone — or the same name, as a possible match) notifies the ops team in the app">
          <input type="checkbox" checked={banned} onChange={e => setBanned(e.target.checked)} />
          <Ban size={12} className="text-rose-600" /> Banned <span className="font-normal text-muted">(alert on any booking)</span>
        </label>
        <input value={tags} onChange={e => setTags(e.target.value)} placeholder="Tags, comma separated — e.g. long-stay, corporate"
          className="flex-1 min-w-[200px] rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
      </div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
        placeholder={banned ? 'Why they are banned — this goes in the alert' : 'What the team should know — preferences, history, how they like the AC…'}
        className="w-full rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]" />
      {err ? <p className="text-[12px] text-rose-600 font-semibold mt-1">{err}</p> : null}
      {msg ? <p className="text-[12px] text-rose-700 font-semibold mt-1">{msg}</p> : null}
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
