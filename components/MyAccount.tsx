'use client'
// MY ACCOUNT (Jon, 2026-11-20: "allow users to create own Calendly link, link their Google accounts which allows them
// to connect emails. So if Nick connects his email he can send emails from the app, he can also set up his cal
// links… Anyone should have access. When they login it should guide them to connect their accounts").
//   MyAccount       /account: my Google connection (email and calendar), then my own booking links.
//   ConnectNudge    in the Shell, on every page: one quiet line until the person has connected, or says not now.
import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, Plus, Trash2, Mail, CalendarDays, Loader2 } from 'lucide-react'

type Any = any
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const origin = () => (typeof window !== 'undefined' ? window.location.origin : '')
const lab = 'text-[10.5px] uppercase tracking-[0.16em] text-muted font-semibold'
const inp = 'mt-1 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink'
const card = 'rounded-2xl border border-line bg-white p-5'
const slugOf = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
const CONNECT = '/api/google/auth?me=1'

function useGoogle() {
  const [g, setG] = useState<Any | null>(null)
  const load = () => fetch('/api/me/google', { cache: 'no-store' }).then(r => r.json()).then(j => setG(j?.ok ? j.google : { connected: false })).catch(() => setG({ connected: false }))
  useEffect(() => {
    load()
    // the consent screen opens in another tab: look again when the person comes back to this one
    const back = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', back); window.addEventListener('focus', back)
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back) }
  }, [])
  return { g, load }
}

const NUDGE_KEY = 'lh-connect-later'
/** One line under the page header until Google is connected. "Not now" hides it for a week. */
export function ConnectNudge() {
  const { g } = useGoogle()
  const [later, setLater] = useState(true)
  useEffect(() => { try { const t = Number(localStorage.getItem(NUDGE_KEY) || 0); setLater(Date.now() - t < 7 * 86400_000) } catch { setLater(false) } }, [])
  if (!g || later) return null
  if (g.connected && g.mail && g.calendar) return null
  if (typeof window !== 'undefined' && window.location.pathname === '/account') return null
  return (
    <div className="print:hidden border-b border-line bg-[#FBF6EA] px-4 lg:px-8 py-2 text-[12.5px] text-ink flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="mr-auto min-w-0"><b>{g.connected ? 'Finish connecting your Google account.' : 'Connect your Google account.'}</b> <span className="text-muted">{g.connected ? 'Some permissions were left off, so ' + [!g.mail ? 'sending email' : '', !g.calendar ? 'your booking links' : ''].filter(Boolean).join(' and ') + ' will not work yet.' : 'Send email from Lighthouse as yourself and set up your own booking links. It takes a minute.'}</span></span>
      <a href="/account" className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-white">Connect</a>
      <button type="button" onClick={() => { try { localStorage.setItem(NUDGE_KEY, String(Date.now())) } catch { /* it just shows again */ } setLater(true) }} className="text-muted underline">Not now</button>
    </div>
  )
}

export function MyAccount() {
  const { g } = useGoogle()
  const [me, setMe] = useState(''); const [name, setName] = useState('')
  const [types, setTypes] = useState<Any[] | null>(null); const [log, setLog] = useState<Any[]>([])
  const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [done, setDone] = useState('')
  useEffect(() => {
    fetch('/api/me/booking-links', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.ok) { setMe(j.me); setTypes(j.types || []); setLog(j.log || []) } else setTypes([]) }).catch(() => setTypes([]))
    fetch('/api/access/me', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j?.profile?.name) setName(String(j.profile.name)) }).catch(() => {})
  }, [])
  const set = (i: number, p: Any) => { setTypes(ts => (ts || []).map((t, j) => (j === i ? { ...t, ...p } : t))); setDirty(true); setMsg('') }
  const copy = (k: string, text: string) => navigator.clipboard.writeText(text).then(() => { setDone(k); setTimeout(() => setDone(''), 1600) }).catch(() => setDone(''))
  const handle = slugOf((name || me.split('@')[0] || 'me').split(' ')[0])
  const add = () => { setTypes(ts => { const n = (ts || []).length; return [...(ts || []), { slug: handle + (n ? '-meeting-' + (n + 1) : '-call'), title: n ? 'Meeting' : 'Call with ' + (name.split(' ')[0] || 'me'), blurb: '', minutes: 30, where: 'meet', hostName: name, days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00', noticeHours: 24, horizonDays: 21, bufferMin: 15, on: true, fresh: true }] }); setDirty(true); setMsg('') }
  async function save() {
    setBusy(true); setMsg('')
    const j = await fetch('/api/me/booking-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ types: (types || []).map(t => ({ ...t, slug: slugOf(t.slug), hostName: t.hostName || name })) }) }).then(r => r.json()).catch(() => null)
    setBusy(false)
    if (!j?.ok) { setMsg(j?.error || 'Could not save.'); return }
    setTypes(j.types); setDirty(false); setMsg('Saved.')
  }
  const Row = ({ ok, icon, title, yes, no }: { ok: boolean; icon: React.ReactNode; title: string; yes: string; no: string }) => (
    <div className="flex items-start gap-3 py-2.5">
      <span className={'mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ' + (ok ? 'bg-emerald-50 text-emerald-700' : 'bg-app text-muted')}>{ok ? <Check size={14} /> : icon}</span>
      <div className="min-w-0"><p className="text-[13.5px] font-semibold text-ink">{title}</p><p className="text-[12.5px] text-muted">{ok ? yes : no}</p></div>
    </div>
  )
  const ready = !!g?.connected && g.mail && g.calendar
  return (
    <div className="max-w-[900px]">
      <header className="pb-5 mb-6 border-b border-line">
        <p className="text-[11px] uppercase tracking-[0.24em] text-muted font-semibold">My account</p>
        <h1 className="font-serif text-[40px] leading-none text-ink mt-1">Your Google account and booking links</h1>
        <p className="text-[13.5px] text-muted mt-2 max-w-[70ch]">Connect the Google account you sign in with. Then Lighthouse can send email as you, from your own mailbox, and people can book time on your calendar from a link you share.</p>
      </header>

      <section className={card + ' mb-6'}>
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h2 className="font-serif text-[24px] leading-none text-ink mr-auto">1. Connect Google</h2>
          {!g ? <Loader2 size={15} className="animate-spin text-muted" /> : <a href={CONNECT} target="_blank" rel="noreferrer" className={'inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold ' + (ready ? 'border border-line bg-white text-ink' : 'bg-ink text-white')}>{ready ? 'Connect again' : g.connected ? 'Connect again and tick every box' : 'Connect my Google account'} <ExternalLink size={13} /></a>}
        </div>
        <p className="text-[12.5px] text-muted">{me ? <>Sign in to Google as <b className="text-ink">{me}</b>. </> : null}Google will list what Lighthouse may do. Leave every box ticked, or email and booking links will not work.</p>
        {g ? <div className="mt-3 divide-y divide-line border-t border-line">
          <Row ok={!!g.connected && g.mail} icon={<Mail size={14} />} title="Email" yes={'Lighthouse can send email as ' + (g.email || me) + '. Emails written from you in the app (for example an owner’s introductory email) leave from your mailbox, even when a teammate presses Send, and land in your Sent folder.'} no={g.connected ? 'Connected, but the email permission was left off. Connect again and tick the Gmail boxes.' : 'Not connected yet.'} />
          <Row ok={!!g.connected && g.calendar} icon={<CalendarDays size={14} />} title="Calendar" yes="Your booking links offer only the times your Google Calendar shows as free, and bookings go straight onto it." no={g.connected ? 'Connected, but the calendar permission was left off. Connect again and tick the Calendar boxes.' : 'Not connected yet.'} />
        </div> : null}
        {g?.error ? <p className="mt-2 text-[12.5px] text-red-700">{g.error}</p> : null}
        <p className="mt-3 text-[11.5px] text-muted">Lighthouse can send and draft email and manage calendar events. It cannot read your inbox. To disconnect, remove Lighthouse under Third-party access in your Google account.</p>
      </section>

      <section className={card}>
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h2 className="font-serif text-[24px] leading-none text-ink mr-auto">2. Your booking links</h2>
          <button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-[13px] font-semibold text-ink"><Plus size={14} /> New booking link</button>
        </div>
        <p className="text-[12.5px] text-muted">Share a link and the person picks a time. They see only your free times (Eastern), get a Google invitation, and it goes on your calendar.</p>
        {g && !(g.connected && g.calendar) && (types || []).length ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"><b>No times can be shown yet.</b> Connect Google above so Lighthouse can read your calendar.</p> : null}
        {!types ? <p className="py-8 text-center text-muted"><Loader2 size={15} className="inline animate-spin" /></p> : !types.length ? <p className="mt-4 rounded-xl bg-app px-4 py-5 text-[13px] text-muted">You have no booking links yet. Press “New booking link” to make your first, for example a 30-minute call.</p> : (
          <div className="mt-4 space-y-4 text-[12.5px] text-ink">
            {types.map((t, i) => { const url = `${origin()}/book/${slugOf(t.slug)}`; return (
              <div key={i} className="rounded-xl border border-line p-3">
                {!t.fresh ? <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-app px-3 py-2">
                  <span className="mr-auto min-w-0 truncate font-semibold">{url}</span>
                  <button type="button" onClick={() => copy(t.slug, url)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold"><Copy size={13} /> {done === t.slug ? 'Copied' : 'Copy link'}</button>
                  <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1.5 font-semibold"><ExternalLink size={13} /> Open</a>
                </div> : null}
                <div className="grid gap-3 sm:grid-cols-4">
                  <label className="sm:col-span-2"><span className={lab}>Name</span><input value={t.title} onChange={e => set(i, { title: e.target.value })} className={inp} /></label>
                  <label><span className={lab}>Minutes</span><input inputMode="numeric" value={t.minutes} onChange={e => set(i, { minutes: Number(e.target.value.replace(/\D/g, '')) || 0 })} className={inp} /></label>
                  <label><span className={lab}>Where</span><select value={t.where} onChange={e => set(i, { where: e.target.value })} className={inp}><option value="meet">Google Meet</option><option value="phone">Phone</option><option value="in-person">In person</option></select></label>
                  <label className="sm:col-span-2"><span className={lab}>Link name</span><input value={t.slug} onChange={e => set(i, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-') })} className={inp} /><span className="block text-[11.5px] text-muted mt-1">{origin()}/book/{slugOf(t.slug) || '…'}</span></label>
                  <label className="sm:col-span-2"><span className={lab}>Your name, as shown</span><input value={t.hostName} onChange={e => set(i, { hostName: e.target.value })} className={inp} /></label>
                  <label className="sm:col-span-4"><span className={lab}>What the person sees under the name</span><input value={t.blurb} onChange={e => set(i, { blurb: e.target.value })} placeholder="e.g. A quick call to talk through your property." className={inp} /></label>
                  <label><span className={lab}>From</span><input type="time" step={1800} value={t.from} onChange={e => set(i, { from: e.target.value })} className={inp} /></label>
                  <label><span className={lab}>To</span><input type="time" step={1800} value={t.to} onChange={e => set(i, { to: e.target.value })} className={inp} /></label>
                  <label><span className={lab}>Notice, hours</span><input inputMode="numeric" value={t.noticeHours} onChange={e => set(i, { noticeHours: Number(e.target.value.replace(/\D/g, '')) || 0 })} className={inp} /></label>
                  <label><span className={lab}>How far out, days</span><input inputMode="numeric" value={t.horizonDays} onChange={e => set(i, { horizonDays: Number(e.target.value.replace(/\D/g, '')) || 0 })} className={inp} /></label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className={lab + ' mr-1'}>Days</span>
                  {DAYS.map((d, n) => { const on = (t.days || []).indexOf(n) >= 0; return <button key={d} type="button" aria-pressed={on} onClick={() => set(i, { days: on ? t.days.filter((x: number) => x !== n) : [...t.days, n].sort() })} className={'rounded-lg border px-2 py-1 font-semibold ' + (on ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted')}>{d}</button> })}
                  <label className="ml-2 inline-flex items-center gap-1.5"><span className="text-muted">Gap around other meetings</span><input inputMode="numeric" value={t.bufferMin} onChange={e => set(i, { bufferMin: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="w-14 rounded-lg border border-line px-2 py-1 text-[13px]" /> <span className="text-muted">min</span></label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 font-semibold"><input type="checkbox" checked={t.on} onChange={e => set(i, { on: e.target.checked })} /> Open for booking</label>
                  <button type="button" onClick={() => { setTypes(ts => (ts || []).filter((_, j) => j !== i)); setDirty(true); setMsg('') }} className="ml-auto inline-flex items-center gap-1 text-muted hover:text-red-700"><Trash2 size={13} /> Remove</button>
                </div>
              </div>) })}
          </div>
        )}
        {types && (types.length || dirty) ? <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" disabled={!dirty || busy} onClick={save} className="rounded-xl bg-ink px-4 py-2.5 text-[13.5px] font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save my links'}</button>
          {msg ? <span className={'text-[13px] ' + (msg === 'Saved.' ? 'text-emerald-700' : 'text-red-700')}>{msg}</span> : dirty ? <span className="text-[12.5px] text-muted">Not saved yet.</span> : null}
        </div> : null}
        {log.length ? <div className="mt-5 border-t border-line pt-4 text-[12.5px] text-ink">
          <p className={lab}>Latest bookings</p>
          <ul className="mt-1 divide-y divide-line">{log.map((l, i) => <li key={i} className="flex flex-wrap items-baseline gap-x-2 py-1.5"><b>{l.name}</b><span>{new Date(l.day + 'T' + l.time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span className="text-muted">{[(types || []).find(t => t.slug === l.slug)?.title || l.slug, l.email].join(' · ')}</span>{l.eventUrl ? <a href={l.eventUrl} target="_blank" rel="noreferrer" className="underline">calendar</a> : null}</li>)}</ul>
        </div> : null}
      </section>
    </div>
  )
}
