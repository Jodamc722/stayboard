'use client'
// BOOKING LINKS, THE TEAM'S SIDE (lib/booking; Jon, 2026-11-19: "a link where it can function like a Calendly").
//   BookingLinksAdmin   on the Owner onboarding page: each booking type with its link to copy, its hours and whose
//                       calendar it books on, and the latest bookings.
//   OwnerBookingLinks   on one owner's report: the same links with that owner's code on them, so the page knows who
//                       is booking and the booking lands on their onboarding.
import { useEffect, useState } from 'react'
import { ChevronDown, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react'

type Any = any
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const origin = () => (typeof window !== 'undefined' ? window.location.origin : '')
const lab = 'text-[10.5px] uppercase tracking-[0.16em] text-muted font-semibold'
const inp = 'mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink'
function useCopy() { const [done, setDone] = useState(''); return { done, copy: (k: string, text: string) => { navigator.clipboard.writeText(text).then(() => { setDone(k); setTimeout(() => setDone(''), 1600) }).catch(() => setDone('')) } } }

export function OwnerBookingLinks({ code }: { code: string }) {
  const [types, setTypes] = useState<Any[]>([]); const c = useCopy()
  useEffect(() => { fetch('/api/booking-links', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) setTypes((j.types || []).filter((t: Any) => t.on)) }).catch(() => {}) }, [])
  if (!types.length) return null
  return (
    <div className="oo-noprint mt-3 rounded-xl border border-line px-3 py-2 text-[12.5px] text-ink">
      <p><b>Or let the owner pick the time.</b> <span className="text-muted">Send them a booking link: they see your open times, choose one, and it goes on your calendar and their timeline.</span></p>
      <div className="mt-2 flex flex-wrap gap-2">{types.map(t => { const url = `${origin()}/book/${t.slug}?o=${code}`; return (
        <button key={t.slug} type="button" onClick={() => c.copy(t.slug, url)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold"><Copy size={13} /> {c.done === t.slug ? 'Copied' : 'Copy link: ' + t.title}</button>) })}</div>
    </div>
  )
}

export function BookingLinksAdmin({ canEdit = true }: { canEdit?: boolean }) {
  const [open, setOpen] = useState(false)
  const [types, setTypes] = useState<Any[] | null>(null); const [log, setLog] = useState<Any[]>([])
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('')
  const [cals, setCals] = useState<Record<string, string>>({})
  const c = useCopy()
  useEffect(() => { fetch('/api/booking-links', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) { setTypes(j.types || []); setLog(j.log || []); setCals(j.calendars || {}) } }).catch(() => {}) }, [])
  const down = Object.entries(cals).filter(([, e]) => e)
  if (!types) return null
  const set = (i: number, p: Any) => { setTypes(ts => (ts || []).map((t, j) => (j === i ? { ...t, ...p } : t))); setDirty(true) }
  async function save() {
    setBusy(true); setMsg('')
    const j = await fetch('/api/booking-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types }) }).then(r => r.json()).catch(() => null)
    setBusy(false)
    if (!j?.ok) { setMsg(j?.error || 'Could not save.'); return }
    setTypes(j.types); setDirty(false); setMsg('Saved.')
  }
  return (
    <section className="mb-6 rounded-2xl border border-line bg-white px-4 py-3 text-[12.5px] text-ink">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex flex-wrap items-baseline gap-x-2 text-left mr-auto min-w-0">
          <b className="text-[13px]">Booking links</b>
          <span className="text-muted">Share a link and people pick a time from your calendar. {types.filter(t => t.on).length} open{log.length ? ` · last booked ${new Date(log[0].at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span>
        </button>
        {types.filter(t => t.on).map(t => <button key={t.slug} type="button" onClick={() => c.copy(t.slug, `${origin()}/book/${t.slug}`)} title={`${origin()}/book/${t.slug}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold"><Copy size={13} /> {c.done === t.slug ? 'Copied' : t.title}</button>)}
        <button type="button" onClick={() => setOpen(o => !o)} aria-label={open ? 'Close' : 'Open'} className="rounded-lg p-1 text-muted hover:text-ink"><ChevronDown size={16} className={'transition-transform ' + (open ? '' : '-rotate-90')} /></button>
      </div>
      {down.length ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900"><b>No times can be shown yet.</b> {down.map(([h, e]) => <span key={h}>Lighthouse cannot read {h}’s calendar ({e}). They need to <a className="underline font-semibold" href={'/api/google/auth?mailbox=' + encodeURIComponent(h)}>connect Google again</a> and tick the calendar boxes. </span>)}</p> : null}
      {open ? (
        <div className="mt-3 border-t border-line pt-3 space-y-4">
          <p className="text-muted">These are the general links. For an owner already in onboarding, copy the link from their page instead: it knows who they are and puts the booking on their timeline. Times are Eastern and skip anything on the host’s Google Calendar.</p>
          {types.map((t, i) => (
            <div key={i} className="rounded-xl border border-line p-3">
              <div className="grid gap-3 sm:grid-cols-4">
                <label className="sm:col-span-2"><span className={lab}>Name</span><input disabled={!canEdit} value={t.title} onChange={e => set(i, { title: e.target.value })} className={inp} /></label>
                <label><span className={lab}>Minutes</span><input disabled={!canEdit} inputMode="numeric" value={t.minutes} onChange={e => set(i, { minutes: Number(e.target.value.replace(/\D/g, '')) || 0 })} className={inp} /></label>
                <label><span className={lab}>Where</span><select disabled={!canEdit} value={t.where} onChange={e => set(i, { where: e.target.value })} className={inp}><option value="meet">Google Meet</option><option value="phone">Phone</option><option value="in-person">In person</option></select></label>
                <label className="sm:col-span-4"><span className={lab}>What the person sees under the name</span><input disabled={!canEdit} value={t.blurb} onChange={e => set(i, { blurb: e.target.value })} className={inp} /></label>
                <label className="sm:col-span-2"><span className={lab}>Whose calendar (their Lighthouse Google login)</span><input disabled={!canEdit} type="email" value={t.host} onChange={e => set(i, { host: e.target.value })} className={inp} /></label>
                <label className="sm:col-span-2"><span className={lab}>Shown as</span><input disabled={!canEdit} value={t.hostName} onChange={e => set(i, { hostName: e.target.value })} className={inp} /></label>
                <label><span className={lab}>From</span><input disabled={!canEdit} type="time" step={1800} value={t.from} onChange={e => set(i, { from: e.target.value })} className={inp} /></label>
                <label><span className={lab}>To</span><input disabled={!canEdit} type="time" step={1800} value={t.to} onChange={e => set(i, { to: e.target.value })} className={inp} /></label>
                <label><span className={lab}>Notice, hours</span><input disabled={!canEdit} inputMode="numeric" value={t.noticeHours} onChange={e => set(i, { noticeHours: Number(e.target.value.replace(/\D/g, '')) || 0 })} className={inp} /></label>
                <label><span className={lab}>How far out, days</span><input disabled={!canEdit} inputMode="numeric" value={t.horizonDays} onChange={e => set(i, { horizonDays: Number(e.target.value.replace(/\D/g, '')) || 0 })} className={inp} /></label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className={lab + ' mr-1'}>Days</span>
                {DAYS.map((d, n) => { const on = (t.days || []).indexOf(n) >= 0; return <button key={d} type="button" disabled={!canEdit} aria-pressed={on} onClick={() => set(i, { days: on ? t.days.filter((x: number) => x !== n) : [...t.days, n].sort() })} className={'rounded-lg border px-2 py-1 font-semibold ' + (on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted')}>{d}</button> })}
                <label className="ml-2 inline-flex items-center gap-1.5"><span className="text-muted">Gap around other meetings</span><input disabled={!canEdit} inputMode="numeric" value={t.bufferMin} onChange={e => set(i, { bufferMin: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="w-14 rounded-lg border border-line px-2 py-1 text-[13px]" /> <span className="text-muted">min</span></label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 font-semibold"><input type="checkbox" disabled={!canEdit} checked={t.on} onChange={e => set(i, { on: e.target.checked })} /> Open for booking</label>
                <a href={`/book/${t.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><ExternalLink size={12} /> /book/{t.slug}</a>
                {canEdit && types.length > 1 ? <button type="button" onClick={() => { setTypes(ts => (ts || []).filter((_, j) => j !== i)); setDirty(true) }} className="ml-auto inline-flex items-center gap-1 text-muted hover:text-red-700"><Trash2 size={13} /> Remove</button> : null}
              </div>
            </div>
          ))}
          {canEdit ? <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setTypes(ts => [...(ts || []), { slug: 'meeting-' + ((ts || []).length + 1), title: 'New meeting', blurb: '', minutes: 30, where: 'meet', host: (ts || [])[0]?.host || '', hostName: (ts || [])[0]?.hostName || '', days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00', noticeHours: 24, horizonDays: 21, bufferMin: 15, on: true }]); setDirty(true) }} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold"><Plus size={13} /> Add a booking type</button>
            <button type="button" disabled={!dirty || busy} onClick={save} className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save'}</button>
            {msg ? <span>{msg}</span> : null}
          </div> : null}
          {log.length ? <div>
            <p className={lab}>Latest bookings</p>
            <ul className="mt-1 divide-y divide-line">{log.map((l, i) => <li key={i} className="flex flex-wrap items-baseline gap-x-2 py-1.5"><b>{l.name}</b><span>{new Date(l.day + 'T' + l.time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span className="text-muted">{[types.find(t => t.slug === l.slug)?.title || l.slug, l.email].join(' · ')}</span>{l.eventUrl ? <a href={l.eventUrl} target="_blank" rel="noreferrer" className="underline">calendar</a> : null}{l.code ? <a href={'/owner-onboarding/' + l.code} className="underline">onboarding</a> : null}</li>)}</ul>
          </div> : null}
        </div>
      ) : null}
    </section>
  )
}
