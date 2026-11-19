'use client'
// THE BOOKING PAGE (Jon, 2026-11-19: "like a Calendly in my app"). Three moves, one screen: a day, a time, confirm.
// Times are Eastern and come from the host's real calendar (lib/booking), so what is shown is free. Shared with an
// owner (?o=), it already knows who they are and puts the booking on their onboarding.
import { useEffect, useMemo, useState } from 'react'
import { Check, Clock, Video, Phone, MapPin, ChevronLeft, Loader2, CalendarDays } from 'lucide-react'

type Any = any
const WHERE: Record<string, { icon: Any; text: string }> = { meet: { icon: Video, text: 'Google Meet video call' }, phone: { icon: Phone, text: 'Phone call' }, 'in-person': { icon: MapPin, text: 'In person, at the home' } }
const longDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const hm12 = (t: string) => { const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM') }

export function BookingPage({ slug, owner }: { slug: string; owner: string }) {
  const [d, setD] = useState<Any>(null); const [err, setErr] = useState('')
  const [day, setDay] = useState(''); const [time, setTime] = useState('')
  const [f, setF] = useState({ name: '', email: '', phone: '', note: '', website: '' })
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [done, setDone] = useState<Any>(null)
  const url = '/api/book/' + encodeURIComponent(slug) + (owner ? '?o=' + encodeURIComponent(owner) : '')
  const load = () => fetch(url, { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) { setD(j); if (j.owner?.name) setF(x => (x.name ? x : { ...x, name: j.owner.name })); setDay(x => (j.days.some((y: Any) => y.day === x) ? x : j.days[0]?.day || '')) } else setErr(j?.error || 'This booking link is not open.') }).catch(() => setErr('Could not load the calendar. Please try again.'))
  useEffect(() => { load() }, [url])   // eslint-disable-line react-hooks/exhaustive-deps
  const times: Any[] = useMemo(() => (d?.days || []).find((x: Any) => x.day === day)?.times || [], [d, day])
  const known = !!d?.owner?.name, knownEmail = !!d?.owner?.hasEmail

  async function book(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('')
    const r = await fetch('/api/book/' + encodeURIComponent(slug), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ day, time, ...f, o: owner }) }).then(async x => ({ status: x.status, j: await x.json().catch(() => null) })).catch(() => null)
    setBusy(false)
    if (!r?.j?.ok) { setMsg(r?.j?.error || 'That did not go through. Please try again.'); if (r?.j?.taken) { setTime(''); load() } return }
    setDone(r.j.booked)
  }

  const t = d?.type, W = t ? WHERE[t.where] || WHERE.meet : null
  return (
    <main className="min-h-screen bg-[#f6f4ef] text-[#1a1a1a]" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))', paddingRight: 'max(16px, env(safe-area-inset-right, 0px))' }}>
      <div className="mx-auto max-w-[920px] py-8 sm:py-14">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8a8478]">Stay Hospitality</p>
        {err ? <div className="mt-6 rounded-2xl border border-[#e4dfd4] bg-white p-6"><h1 className="font-serif text-[28px] leading-tight">This link is not open.</h1><p className="mt-2 text-[14px] text-[#6b665c]">{err} Reply to your Stay contact and we will set a time with you.</p></div>
        : !d ? <p className="mt-10 flex items-center gap-2 text-[14px] text-[#6b665c]"><Loader2 size={16} className="animate-spin" /> Checking the calendar…</p>
        : done ? (
          <div className="mt-6 rounded-2xl border border-[#e4dfd4] bg-white p-6 sm:p-8">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white"><Check size={20} /></span>
            <h1 className="mt-4 font-serif text-[30px] leading-tight">You’re booked.</h1>
            <p className="mt-2 text-[16px] font-semibold">{t.title}</p>
            <p className="text-[15px]">{longDay(done.day)} at {hm12(done.time)} Eastern · {done.minutes} minutes</p>
            <p className="mt-3 text-[14px] text-[#6b665c]">A calendar invitation is on its way to {done.email}. It has everything you need, and a reminder before we meet.</p>
            {done.link ? <p className="mt-3 text-[14px]">Video link: <a href={done.link} className="font-semibold underline break-all">{done.link}</a></p> : null}
            <p className="mt-4 text-[13px] text-[#6b665c]">Need a different time? Open this link again and pick one{known && slug === 'onboarding-call' ? ': it moves your booking' : ''}.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-5 md:grid-cols-[300px_1fr]">
            <aside className="min-w-0 rounded-2xl border border-[#e4dfd4] bg-white p-6 self-start">
              {t.hostName ? <p className="text-[13px] text-[#6b665c]">{t.hostName}</p> : null}
              <h1 className="mt-1 font-serif text-[28px] leading-tight">{t.title}</h1>
              <ul className="mt-4 space-y-2 text-[14px]">
                <li className="flex items-center gap-2"><Clock size={15} className="text-[#8a8478]" /> {t.minutes} minutes</li>
                {W ? <li className="flex items-center gap-2"><W.icon size={15} className="text-[#8a8478]" /> {W.text}</li> : null}
                {day && time ? <li className="flex items-start gap-2 font-semibold"><CalendarDays size={15} className="mt-0.5 text-[#8a8478]" /> {longDay(day)}, {hm12(time)} Eastern</li> : null}
              </ul>
              {t.blurb ? <p className="mt-4 text-[13.5px] leading-relaxed text-[#6b665c]">{t.blurb}</p> : null}
              {known ? <p className="mt-4 border-t border-[#eee9df] pt-3 text-[13px] text-[#6b665c]">Booking for <b className="text-[#1a1a1a]">{d.owner.name}</b>{d.owner.booked ? <>. You already have a time on {new Date(d.owner.booked).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}; picking a new one moves it.</> : null}</p> : null}
            </aside>

            <section className="min-w-0 rounded-2xl border border-[#e4dfd4] bg-white p-6">
              {!d.days.length ? <><h2 className="font-serif text-[22px]">{d.calendarDown ? 'The calendar is not answering right now.' : 'No open times in the next few weeks.'}</h2><p className="mt-2 text-[14px] text-[#6b665c]">Reply to your Stay contact and we will find a time with you.</p></>
              : !time ? <>
                <h2 className="font-serif text-[22px]">Pick a day and a time</h2>
                <p className="text-[12.5px] text-[#8a8478]">Times are Eastern (Miami).</p>
                <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Days">
                  {d.days.map((x: Any) => { const dt = new Date(x.day + 'T12:00:00Z'), on = x.day === day; return (
                    <button key={x.day} type="button" role="tab" aria-selected={on} onClick={() => setDay(x.day)} className={'shrink-0 rounded-xl border px-3 py-2 text-center ' + (on ? 'border-ink bg-ink text-white' : 'border-[#e4dfd4] bg-white hover:border-ink')}>
                      <span className="block text-[11px] uppercase tracking-wider opacity-70">{dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
                      <span className="block text-[18px] font-semibold leading-tight">{dt.getUTCDate()}</span>
                      <span className="block text-[11px] opacity-70">{dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</span>
                    </button>) })}
                </div>
                <p className="mt-4 text-[13px] font-semibold">{day ? longDay(day) : ''}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {times.map(x => <button key={x.time} type="button" onClick={() => { setTime(x.time); setMsg('') }} className="rounded-xl border border-[#e4dfd4] bg-white px-3 py-2.5 text-[14px] font-semibold hover:border-ink">{x.label}</button>)}
                </div>
                {msg ? <p className="mt-3 text-[13.5px] text-rose-700">{msg}</p> : null}
              </> : (
                <form onSubmit={book}>
                  <button type="button" onClick={() => setTime('')} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#6b665c] hover:text-[#1a1a1a]"><ChevronLeft size={15} /> Change the time</button>
                  <h2 className="mt-2 font-serif text-[22px]">{longDay(day)} at {hm12(time)}</h2>
                  <div className="mt-4 space-y-3">
                    {/* ALWAYS A PLACE FOR NAME AND EMAIL (Jon, 2026-11-19: "should be a place where they add email and name").
                        On an owner's link the name is filled in and the email on file is used unless they give another. */}
                    <label className="block text-[13px] font-semibold">Your name<input required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoComplete="name" className="mt-1 w-full rounded-xl border border-[#d9d3c6] px-3 py-2.5 text-[15px] font-normal" /></label>
                    <label className="block text-[13px] font-semibold">Email for the invitation{knownEmail ? <span className="font-normal text-[#8a8478]"> (leave blank to use the one we have for you)</span> : null}<input required={!knownEmail} type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} autoComplete="email" className="mt-1 w-full rounded-xl border border-[#d9d3c6] px-3 py-2.5 text-[15px] font-normal" /></label>
                    <label className="block text-[13px] font-semibold">Phone <span className="font-normal text-[#8a8478]">(optional)</span><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} autoComplete="tel" inputMode="tel" className="mt-1 w-full rounded-xl border border-[#d9d3c6] px-3 py-2.5 text-[15px] font-normal" /></label>
                    <label className="block text-[13px] font-semibold">Anything you would like to cover <span className="font-normal text-[#8a8478]">(optional)</span><textarea rows={3} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} className="mt-1 w-full rounded-xl border border-[#d9d3c6] px-3 py-2.5 text-[15px] font-normal" /></label>
                    {/* a field people never see: anything typed here is a machine */}
                    <input tabIndex={-1} autoComplete="off" value={f.website} onChange={e => setF({ ...f, website: e.target.value })} aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" name="website" />
                  </div>
                  {msg ? <p className="mt-3 text-[13.5px] text-rose-700">{msg}</p> : null}
                  <button type="submit" disabled={busy} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {busy ? 'Booking…' : 'Confirm this time'}</button>
                </form>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
