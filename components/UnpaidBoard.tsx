'use client'
// UNPAID BALANCES (Jon, 2026-10-01): "an unpaid report … selectable date ranges but prioritise
// unpaid today and next 7 days … tracking it and being able to add notes."
//
// The window is a choice (Today / 7 / 14 / 30 days / custom) but the ORDER never changes: a guest
// already inside owing money, then today's arrivals, then the next seven days, then the rest. Each
// row opens to the folio figures, the contact, and the follow-up trail: a status (open → contacted
// → promised → disputed / waived) and dated, signed notes. "Paid" is never a button here — Guesty
// decides that, and a stay drops off the list the morning after the money lands.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, ExternalLink, Phone, Mail, MessageSquare, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { LeanHead, Pill, Tag, IconBtn, LeanList, LeanRow, LeanSection, LeanEmpty } from '@/components/lean'

type Note = { at: string; by: string; text: string }
type Row = {
  id: string; unit: string; building: string; guest: string; phone: string | null; email: string | null
  checkIn: string; checkOut: string; nights: number; status: string; source: string; channelPays: boolean
  total: number; paid: number; balance: number; currency: string; daysUntil: number
  bucket: 'in_house' | 'today' | 'week' | 'later'; guestyUrl: string
  tracking: { status: string; notes: Note[]; updatedAt: string | null; updatedBy: string | null }
}
type Data = { from: string; to: string; today: string; rows: Row[]; canEdit: boolean; summary: { count: number; balance: number; inHouse: number; today: number; week: number; later: number; channelPays: number; chased: number } }

const TZ = 'America/New_York'
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const plus = (base: string, n: number) => { const d = new Date(base + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const money = (n: number, c = 'USD') => (c === 'EUR' ? '€' : c === 'GBP' ? '£' : '$') + Math.round(n).toLocaleString('en-US')
const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const first = (s: string) => String(s || '').split(/[\s@]/)[0]
const CH: Record<string, string> = { airbnb: 'Airbnb', airbnb2: 'Airbnb', vrbo: 'VRBO', homeaway: 'VRBO', booking: 'Booking', 'booking.com': 'Booking', bookingcom: 'Booking', expedia: 'Expedia', manual: 'Direct', direct: 'Direct', 'be-api': 'Website', website: 'Website', homesvillasbymarriott: 'Marriott' }
const channel = (s: string) => CH[String(s || '').toLowerCase()] || (s || '—')

const STATUS: { key: string; label: string; tone: 'slate' | 'sky' | 'amber' | 'rose' | 'emerald' | 'violet' }[] = [
  { key: 'open', label: 'Not contacted', tone: 'slate' },
  { key: 'contacted', label: 'Contacted', tone: 'sky' },
  { key: 'promised', label: 'Promised to pay', tone: 'amber' },
  { key: 'disputed', label: 'Disputed', tone: 'rose' },
  { key: 'waived', label: 'Waived', tone: 'violet' },
]
const statusOf = (k: string) => STATUS.find(s => s.key === k) || STATUS[0]

const BUCKETS: { key: Row['bucket']; title: string; hint: string; tone?: 'rose' }[] = [
  { key: 'in_house', title: 'In the unit, still owing', hint: 'The guest is inside — collect before checkout', tone: 'rose' },
  { key: 'today', title: 'Arriving today', hint: 'Collect before the door code goes out', tone: 'rose' },
  { key: 'week', title: 'Next 7 days', hint: 'Chase now so the week is clean' },
  { key: 'later', title: 'Later in the range', hint: 'On the radar' },
]

const PRESETS: { key: string; label: string; days: number | null }[] = [
  { key: 'today', label: 'Today', days: 0 }, { key: '7', label: 'Next 7 days', days: 7 }, { key: '14', label: 'Next 14', days: 14 }, { key: '30', label: 'Next 30', days: 30 }, { key: 'custom', label: 'Custom', days: null },
]

export function UnpaidBoard() {
  const today = useMemo(() => ymd(new Date()), [])
  const [preset, setPreset] = useState('7')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(plus(today, 7))
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hideChannel, setHideChannel] = useState(false)
  const [hideWaived, setHideWaived] = useState(true)

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true); setErr(null)
    try {
      const r = await fetch(`/api/unpaid?from=${f}&to=${t}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load(from, to) }, [from, to, load])

  const pick = (k: string) => {
    setPreset(k)
    const p = PRESETS.find(x => x.key === k)
    if (p && p.days != null) { setFrom(today); setTo(plus(today, p.days)) }
  }
  const patch = (id: string, tracking: Row['tracking']) => setData(d => d ? { ...d, rows: d.rows.map(r => r.id === id ? { ...r, tracking } : r) } : d)

  const rows = (data?.rows || []).filter(r => !(hideChannel && r.channelPays) && !(hideWaived && r.tracking.status === 'waived'))
  const owed = rows.reduce((a, r) => a + r.balance, 0)
  const guestOwed = rows.filter(r => !r.channelPays).reduce((a, r) => a + r.balance, 0)

  return (
    <div>
      <LeanHead title="Unpaid balances">
        <Pill tone="rose" title="Balances the guest owes in this window (channel-collected stays excluded)">{money(guestOwed)} to collect</Pill>
        <Pill title="Every open balance in the window, channel-collected included">{rows.length} stays · {money(owed)}</Pill>
        {data && <Pill tone="emerald" title="Stays someone has already contacted, or that have a note">{data.summary.chased} being chased</Pill>}
        <Link href="/reservations" className="text-[11.5px] font-semibold text-brand-700 hover:underline ml-1">All reservations →</Link>
      </LeanHead>

      {/* THE WINDOW — presets, or a custom pair of dates. */}
      <div className="mb-3 flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted mr-1">Window</span>
        {PRESETS.map(p => (
          <button key={p.key} onClick={() => pick(p.key)} aria-pressed={preset === p.key}
            className={'text-[11.5px] font-semibold px-2.5 py-1 rounded-full border ' + (preset === p.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{p.label}</button>
        ))}
        {preset === 'custom' && (
          <span className="inline-flex items-center gap-1 text-[12px]">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="text-[12px] bg-app border border-line rounded-lg px-2 py-1" />
            <span className="text-muted">→</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="text-[12px] bg-app border border-line rounded-lg px-2 py-1" />
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-3 text-[11.5px] text-muted">
          <label className="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={hideChannel} onChange={e => setHideChannel(e.target.checked)} /> hide channel-collected</label>
          <label className="inline-flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={hideWaived} onChange={e => setHideWaived(e.target.checked)} /> hide waived</label>
          <button onClick={() => load(from, to)} title="Refresh" className="text-muted hover:text-ink"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
        </span>
      </div>
      {err && <p className="mb-2 text-[12.5px] text-rose-700 inline-flex items-center gap-1"><AlertTriangle size={13} /> {err}</p>}
      {loading && !data && <LeanEmpty><Loader2 size={14} className="animate-spin inline mr-1.5" />Reading the folios…</LeanEmpty>}
      {data && rows.length === 0 && <LeanEmpty><Check size={14} className="inline mr-1 text-emerald-600" />Nothing owed in this window{hideChannel || hideWaived ? ' (with the filters on)' : ''}.</LeanEmpty>}

      {BUCKETS.map(b => {
        const list = rows.filter(r => r.bucket === b.key)
        if (!list.length) return null
        const sum = list.reduce((a, r) => a + r.balance, 0)
        return (
          <LeanSection key={b.key} title={<span title={b.hint}>{b.title}</span>} tone={b.tone}
            right={<span className="tabular-nums text-muted"><b className="text-ink">{money(sum)}</b> · {list.length} {list.length === 1 ? 'stay' : 'stays'}</span>}>
            <LeanList>
              {list.map(r => <UnpaidRow key={r.id} r={r} today={data!.today} canEdit={!!data?.canEdit} onPatch={patch} />)}
            </LeanList>
          </LeanSection>
        )
      })}
      <p className="mt-3 text-[11px] text-muted">Paid / unpaid is Guesty&apos;s folio — a stay leaves this list on the next sync after the money lands. CHANNEL PAYS means the channel collects the guest&apos;s money and settles with us; the balance there is theirs to send, not the guest&apos;s to pay. Owner and friends-&-family stays are not listed.</p>
    </div>
  )
}

function UnpaidRow({ r, today, canEdit, onPatch }: { r: Row; today: string; canEdit: boolean; onPatch: (id: string, t: Row['tracking']) => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const st = statusOf(r.tracking.status)
  const save = async (patch: { status?: string; note?: string }) => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/unpaid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationId: r.id, ...patch }) })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || `HTTP ${res.status}`)
      onPatch(r.id, j.tracking); setNote('')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  const whenTxt = r.bucket === 'in_house' ? `in house · out ${day(r.checkOut)}` : r.daysUntil === 0 ? 'arrives today' : r.daysUntil === 1 ? 'arrives tomorrow' : `arrives ${day(r.checkIn)} · in ${r.daysUntil}d`
  const lastNote = r.tracking.notes[r.tracking.notes.length - 1]
  return (
    <LeanRow
      tint={r.bucket === 'in_house' || r.bucket === 'today' ? 'rose' : undefined}
      lead={<span className={'shrink-0 inline-flex items-center justify-center rounded-lg px-2 h-8 text-[13px] font-bold tabular-nums ' + (r.channelPays ? 'bg-slate-100 text-slate-700' : 'bg-rose-600 text-white')}>{money(r.balance, r.currency)}</span>}
      name={r.guest}
      meta={<>{r.unit} · {whenTxt} · {r.nights}n</>}
      tags={<>
        <Tag>{channel(r.source)}</Tag>
        {r.channelPays && <Tag tone="slate" title="The channel collects this guest's money and settles with us">CHANNEL PAYS</Tag>}
        <Tag tone={st.tone}>{st.label}</Tag>
        {r.tracking.notes.length > 0 && <Tag tone="sky" title={lastNote ? `${first(lastNote.by)} · ${when(lastNote.at)}` : ''}><MessageSquare size={10} className="inline -mt-px mr-0.5" />{r.tracking.notes.length}</Tag>}
      </>}
      actions={<>
        {r.phone && <IconBtn title={`Call ${r.phone}`} href={`tel:${r.phone}`}><Phone size={14} /></IconBtn>}
        {r.email && <IconBtn title={`Email ${r.email}`} href={`mailto:${r.email}`}><Mail size={14} /></IconBtn>}
        <IconBtn title="Open in Lighthouse" href={`/reservations/${r.id}`}><ExternalLink size={14} /></IconBtn>
      </>}
    >
      <div className="grid sm:grid-cols-2 gap-3 text-[12.5px]">
        <div className="space-y-1">
          <div><span className="text-muted">Folio</span> · total <b>{money(r.total, r.currency)}</b> · paid <b>{money(r.paid, r.currency)}</b> · owed <b className="text-rose-700">{money(r.balance, r.currency)}</b></div>
          <div><span className="text-muted">Stay</span> · {day(r.checkIn)} → {day(r.checkOut)} · {r.nights} nights · {r.status}</div>
          <div><span className="text-muted">Guest</span> · {r.phone || 'no phone'} · {r.email || 'no email'}</div>
          <div><a href={r.guestyUrl} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold hover:underline">Open in Guesty →</a> <span className="text-muted">to take the payment or send a payment link</span></div>
        </div>
        <div className="space-y-1.5">
          {lastNote && r.tracking.updatedAt && <div className="text-[11.5px] text-muted">Last touched {when(r.tracking.updatedAt)} by {first(r.tracking.updatedBy || '')}</div>}
          <div className="flex items-center gap-1 flex-wrap">
            {STATUS.map(s => (
              <button key={s.key} disabled={!canEdit || busy} onClick={() => save({ status: s.key })} aria-pressed={r.tracking.status === s.key}
                className={'text-[11px] font-semibold px-2 py-0.5 rounded-full border disabled:opacity-50 ' + (r.tracking.status === s.key ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-line hover:text-ink')}>{s.label}</button>
            ))}
          </div>
          <div className="flex items-start gap-1.5">
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} disabled={!canEdit || busy} placeholder={canEdit ? 'Add a note — who you spoke to, what they said, when they will pay' : 'Notes need edit access on Reservations'}
              className="flex-1 text-[12px] bg-app border border-line rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-60" />
            <button disabled={!canEdit || busy || !note.trim()} onClick={() => save({ note })} className="rounded-lg bg-brand-600 text-white text-[12px] font-semibold px-3 py-2 disabled:opacity-50">{busy ? <Loader2 size={13} className="animate-spin" /> : 'Save'}</button>
          </div>
          {err && <div className="text-[11.5px] text-rose-700">{err}</div>}
          {r.tracking.notes.length > 0 && (
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {r.tracking.notes.slice().reverse().map((n, i) => (
                <li key={i} className="text-[12px] bg-app rounded-lg px-2.5 py-1.5"><span className="text-muted">{when(n.at)} · {first(n.by)}</span><br />{n.text}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </LeanRow>
  )
}
