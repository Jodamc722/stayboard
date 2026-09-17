'use client'
// WHAT THE LINK HOLDER SEES. One phone-friendly page, section by section, in the order a partner
// reads: who's coming, what it's earning, how the bookings arrived, what's being cleaned, who's
// verified, what the notes say. Only sections the link enables ever arrive from the API — this
// component cannot leak what it was never sent.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Lock, CalendarDays, TrendingUp, Megaphone, Sparkles, ShieldCheck, StickyNote, Users, RefreshCw, AtSign,
  Mail, MailX, Ban, Star, Repeat, AlertTriangle, Search, Download } from 'lucide-react'
import { PlannerView, PlannerLegend, type PGroup } from './PlannerView'
import { ScheduleLaborStrip } from './ScheduleLaborStrip'
import { DayCleans } from './DayCleans'

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const GROUPS: { key: PGroup; label: string }[] = [
  { key: 'team', label: 'All team' },
  { key: 'market', label: 'By market' },
  { key: 'cleaner', label: 'By cleaner' },
]

const usd = (n: any) => n == null ? null : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function SharedView({ code }: { code: string }) {
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [pw, setPw] = useState('')
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  // THE DATES THE READER PICKS. They travel in the POST body, never the query string — a share URL
  // gets forwarded and screenshotted, and this one already carries a passcode.
  const [from, setFrom] = useState(todayET())
  const [to, setTo] = useState(addDays(todayET(), 13))
  const [group, setGroup] = useState<PGroup>('team')
  const [crew, setCrew] = useState<'inhouse' | 'vendor'>('inhouse')
  const [view, setView] = useState<'cleans' | 'calendar'>('cleans')
  // The passcode that worked and the span on screen live in refs, not in the loader's dependency
  // list: as state they re-created `load`, the mount effect re-fired, and every date change fetched
  // twice — once explicitly and once again for the new identity.
  const okRef = useRef('')
  const rangeRef = useRef({ from: todayET(), to: addDays(todayET(), 13) })
  const crewRef = useRef<'inhouse' | 'vendor'>('inhouse')

  const load = useCallback(async (passcode?: string, range?: { from: string; to: string }, nextCrew?: 'inhouse' | 'vendor') => {
    setBusy(true); setErr('')
    const pass = passcode != null ? passcode : okRef.current
    if (range) rangeRef.current = range
    if (nextCrew) crewRef.current = nextCrew
    try {
      const r = (pass || range)
        ? await fetch('/api/share/' + encodeURIComponent(code), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pw: pass, from: rangeRef.current.from, to: rangeRef.current.to, crew: crewRef.current }), cache: 'no-store' })
        : await fetch('/api/share/' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 404) throw new Error('This link is not valid or has been turned off.')
      if (j.locked) { setLocked(true); setData(j); if (j.error) setErr(j.error); setBusy(false); return }
      if (!j.ok) throw new Error(j.error || 'Could not load.')
      setLocked(false); setData(j); okRef.current = pass || ''
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy(false)
  }, [code])
  useEffect(() => { load() }, [load])

  if (!data && !err) return <div className="min-h-screen bg-neutral-50 grid place-items-center"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>
  if (err && !data) return (
    <div className="min-h-screen bg-neutral-50 grid place-items-center p-6">
      <p className="text-sm font-bold text-neutral-600">{err}</p>
    </div>
  )

  if (locked) return (
    <div className="min-h-screen bg-neutral-50 grid place-items-center p-6">
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 w-full max-w-sm text-center">
        <Lock className="w-5 h-5 text-neutral-400 mx-auto" />
        <p className="text-[15px] font-bold text-neutral-900 mt-2">{data?.label || 'Shared data'}</p>
        <p className="text-[12.5px] text-neutral-500 mt-1">This link needs a passcode.</p>
        <input value={pw} onChange={e => setPw(e.target.value)} type="password" autoFocus
          onKeyDown={e => { if (e.key === 'Enter') load(pw) }}
          className="mt-3 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-center text-[14px]" />
        {err ? <p className="text-[12px] text-rose-600 font-semibold mt-1.5">{err}</p> : null}
        <button onClick={() => load(pw)} disabled={busy || !pw}
          className="mt-3 w-full rounded-xl bg-neutral-900 text-white py-2.5 text-[13px] font-bold disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Open'}
        </button>
      </div>
    </div>
  )

  const s = data.sections || {}
  const Sec = ({ Icon, title, sub, children }: any) => (
    <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-neutral-100 flex items-center gap-2">
        <Icon className="w-3.5 h-3.5 text-neutral-400" />
        <p className="text-[13px] font-bold text-neutral-900">{title}</p>
        {sub ? <p className="text-[11px] text-neutral-400 ml-auto">{sub}</p> : null}
      </div>
      {children}
    </div>
  )

  return (
    // A share link opens on a partner's phone with no app Shell around it, so it carries its own
    // px-safe (the outer element — it has no px of its own to be replaced).
    <div className="min-h-screen bg-neutral-50 pb-16 px-safe-keep">
      <div className="bg-neutral-900 text-white px-4 py-4">
        <p className="text-[9.5px] uppercase tracking-[0.2em] text-neutral-400 font-bold">Stay Hospitality</p>
        <h1 className="text-lg font-bold leading-tight">{data.label}</h1>
        <p className="text-[11.5px] text-neutral-400 mt-0.5">
          {data.units} unit{data.units === 1 ? '' : 's'} · live as of {data.today}
        </p>
      </div>

      {/* HOW WIDE THE COLUMN IS, by what is in it. max-w-2xl is right for a partner report read on
          a phone — a dozen rows of two fields. It is wrong for a mailing list: at 672px a contact
          row had to stack the email under the name and wrap it mid-word, and the filter chips ran to
          four ragged lines. The list and the crew planner get a real table width. */}
      <div className={'px-3 pt-3 space-y-3 mx-auto ' + (s.contacts && !s.contacts.locked ? 'max-w-6xl' : s.team ? 'max-w-5xl' : 'max-w-2xl')}>
        {s.revenue ? (
          <Sec Icon={TrendingUp} title="Performance" sub={s.revenue.basis}>
            <div className="grid grid-cols-3 divide-x divide-neutral-100">
              {[['Stays', s.revenue.stays], ['Nights', s.revenue.nights], ['ADR', s.revenue.adr != null ? usd(s.revenue.adr) : '—']]
                .concat(s.revenue.revenue != null ? [['Revenue', usd(s.revenue.revenue)]] : [])
                .map(([l, v]: any) => (
                  <div key={l} className="px-3 py-3 text-center">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">{l}</p>
                    <p className="text-[17px] font-bold text-neutral-900 tabular-nums mt-0.5">{v ?? '—'}</p>
                  </div>
                ))}
            </div>
          </Sec>
        ) : null}

        {s.marketing ? (
          <Sec Icon={Megaphone} title="Where bookings came from" sub={s.marketing.basis}>
            <div className="divide-y divide-neutral-100">
              {(s.marketing.families || []).map((f: any) => (
                // A long channel name plus the count plus the money did not fit on one 375px line.
                <div key={f.label} className="px-4 py-2.5 flex items-center gap-3 gap-y-1 flex-wrap text-[13px]">
                  <span className="font-semibold text-neutral-900">{f.label}</span>
                  <span className="ml-auto tabular-nums text-neutral-600">{f.count} booking{f.count === 1 ? '' : 's'}</span>
                  {f.value != null ? <span className="tabular-nums font-bold text-neutral-900 w-20 text-right">{usd(f.value)}</span> : null}
                </div>
              ))}
              {!(s.marketing.families || []).length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">No new bookings in the window.</p> : null}
            </div>
          </Sec>
        ) : null}

        {s.reservations ? (
          <Sec Icon={CalendarDays} title="Reservations" sub={`next ${data.windowDays} days`}>
            <div className="divide-y divide-neutral-100">
              {s.reservations.map((r: any, i: number) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-2.5 text-[13px] flex-wrap">
                  <span className="font-bold text-neutral-900">{r.unit}</span>
                  {r.inHouse ? <span className="text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">In house</span> : null}
                  <span className="text-neutral-600">{r.guest}</span>
                  <span className="ml-auto text-neutral-500 tabular-nums">{r.checkIn} → {r.checkOut}{r.nights ? ` · ${r.nights}n` : ''}</span>
                  {r.value != null ? <span className="tabular-nums font-bold text-neutral-900">{usd(r.value)}</span> : null}
                </div>
              ))}
              {!s.reservations.length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">Nothing on the books in the window.</p> : null}
            </div>
          </Sec>
        ) : null}

        {s.cleaning ? (
          <Sec Icon={Sparkles} title="Cleaning & tasks" sub="next 14 days">
            <div className="divide-y divide-neutral-100">
              {s.cleaning.map((t: any, i: number) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-2.5 text-[13px] flex-wrap">
                  <span className="text-neutral-500 tabular-nums shrink-0">{t.date}</span>
                  <span className="font-bold text-neutral-900">{t.unit}</span>
                  <span className="text-neutral-600 flex-1 min-w-[120px] truncate">{t.task}{t.who?.length ? ' · ' + t.who.join(', ') : ''}</span>
                  <span className={'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ' +
                    (t.status === 'done' ? 'bg-emerald-100 text-emerald-700' : t.status === 'in progress' ? 'bg-amber-100 text-amber-800' : 'bg-neutral-100 text-neutral-500')}>{t.status}</span>
                </div>
              ))}
              {!s.cleaning.length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">Nothing scheduled.</p> : null}
            </div>
          </Sec>
        ) : null}

        {/* THE CONTACT LIST. Locked unless the link carries a passcode — the server refuses to send
            the rows without one, and this says so plainly rather than rendering an empty table. */}
        {s.contacts ? (
          <Sec Icon={AtSign} title="Contact list" sub={s.contacts.locked ? 'locked' : s.contacts.basis}>
            {s.contacts.locked ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] text-amber-900">{s.contacts.reason}</div>
            ) : (
              <ContactsTable data={s.contacts} />
            )}
          </Sec>
        ) : null}

        {s.audience ? (
          <Sec Icon={AtSign} title="Audience" sub={s.audience.basis}>
            {/* Counts and labels only — by design. The API cannot send a name, address or phone
                here, so there is nothing on this page to accidentally reveal. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-neutral-100">
              {[
                ['Contacts', s.audience.contacts],
                ['Reachable by email', s.audience.mailable],
                ['Repeat guests', s.audience.repeat],
                ['Booked direct', s.audience.everDirect],
              ].map(([l, v]: any) => (
                <div key={l} className="px-3 py-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-neutral-400">{l}</p>
                  <p className="text-[17px] font-bold text-neutral-900 tabular-nums mt-0.5">{Number(v || 0).toLocaleString()}</p>
                </div>
              ))}
            </div>
            {(s.audience.channels || []).length ? (
              <div className="border-t border-neutral-100">
                <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider font-bold text-neutral-400">Where they came from</p>
                <div className="divide-y divide-neutral-100">
                  {(s.audience.channels || []).map((c: any) => (
                    <div key={c.label} className="px-4 py-2 flex items-center gap-2 text-[13px]">
                      <span className="text-neutral-900">{c.label}</span>
                      <span className="ml-auto tabular-nums font-semibold text-neutral-900">{Number(c.count).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="px-4 py-2.5 text-[10.5px] text-neutral-400 border-t border-neutral-100">
              {Number(s.audience.relay || 0).toLocaleString()} of these gave only a channel forwarding address, which
              cannot be mailed. No names, email addresses or phone numbers are shared on this link.
            </p>
          </Sec>
        ) : null}

        {s.team ? (
          <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-neutral-100 flex items-baseline gap-2 flex-wrap">
              <Users className="w-3.5 h-3.5 text-neutral-400 self-center" />
              <p className="text-[14px] font-bold text-neutral-900">
                {s.team.dept === 'maintenance' ? 'Maintenance planner' : 'Weekly planner'}
              </p>
              <p className="text-[11px] text-neutral-400 ml-auto tabular-nums">{s.team.from} → {s.team.to}</p>
            </div>

            {/* PICK THE DATES (Jon, 2026-09-09). Reloading re-asks the server, so the labor figures
                below always belong to the span on screen rather than to whatever it opened with. */}
            <div className="px-4 py-2.5 border-b border-neutral-100 flex items-center gap-1.5 flex-wrap">
              <input type="date" value={from} max={to} aria-label="From"
                onChange={e => { const v = e.target.value; if (!v) return; const t = v > to ? addDays(v, 6) : to; setFrom(v); setTo(t); load(undefined, { from: v, to: t }) }}
                className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-[12px] text-neutral-900" />
              <span className="text-[11.5px] text-neutral-400">to</span>
              <input type="date" value={to} min={from} aria-label="To"
                onChange={e => { const v = e.target.value; if (!v) return; setTo(v); load(undefined, { from, to: v }) }}
                className="h-8 rounded-lg border border-neutral-300 bg-white px-2 text-[12px] text-neutral-900" />
              <button onClick={() => { const f = todayET(), t = addDays(f, 13); setFrom(f); setTo(t); load(undefined, { from: f, to: t }) }}
                className="h-8 px-2.5 rounded-lg border border-neutral-300 bg-white text-[12px] font-semibold text-neutral-700">Next 2 weeks</button>
              <button onClick={() => load(undefined, { from, to })} disabled={busy} aria-label="Refresh"
                className="h-8 w-8 grid place-items-center rounded-lg border border-neutral-300 bg-white text-neutral-500 disabled:opacity-40">
                <RefreshCw className={'w-3.5 h-3.5 ' + (busy ? 'animate-spin' : '')} />
              </button>
              <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden bg-white">
                {(['inhouse', 'vendor'] as const).map(k => (
                  <button key={k} onClick={() => { setCrew(k); load(undefined, undefined, k) }}
                    className={'text-[12px] font-semibold px-2.5 h-8 border-l border-neutral-200 first:border-l-0 ' + (crew === k ? 'bg-neutral-900 text-white' : 'text-neutral-500')}>
                    {k === 'inhouse' ? 'In-house' : 'Vendor'}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden bg-white ml-auto">
                <button onClick={() => setView('cleans')}
                  className={'text-[12px] font-semibold px-2.5 h-8 ' + (view === 'cleans' ? 'bg-neutral-900 text-white' : 'text-neutral-500')}>Cleans</button>
                <button onClick={() => setView('calendar')}
                  className={'text-[12px] font-semibold px-2.5 h-8 border-l border-neutral-200 ' + (view === 'calendar' ? 'bg-neutral-900 text-white' : 'text-neutral-500')}>Calendar</button>
              </div>
              {view === 'calendar' ? (
                <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden bg-white">
                  {GROUPS.map(g => (
                    <button key={g.key} onClick={() => setGroup(g.key)}
                      className={'text-[12px] font-semibold px-2.5 h-8 border-l border-neutral-200 first:border-l-0 ' + (group === g.key ? 'bg-neutral-900 text-white' : 'text-neutral-500')}>{g.label}</button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* What those cleans earn and what the crew costs — only when this link shows money. */}
            {s.teamLabor ? <div className="p-3 bg-neutral-50 border-b border-neutral-100"><ScheduleLaborStrip data={s.teamLabor} /></div> : null}
            {/* Same drawing as the staff tab — one component, so what the crew opens and what the
                office plans on can never drift. Breezeway links only on the maintenance link. */}
            <div className="p-3 bg-neutral-50 space-y-3">
              {/* THE CLEANS THEMSELVES (Jon): what is being cleaned today and who has it. */}
              {view === 'cleans' ? (
                <DayCleans
                  days={s.team.days || []}
                  blocks={s.team.markets || []}
                  dept={s.team.dept === 'maintenance' ? 'maintenance' : 'cleaning'}
                  labor={s.teamLabor || null}
                />
              ) : null}
              {crew === 'vendor' ? (
                <p className="text-[11.5px] text-neutral-500 px-1">
                  Vendor-serviced buildings — Botanica, Park Towers, Amrit, Capri, Lucerne. Their crews rarely carry a
                  Breezeway assignee, so a clean with nobody on it is filed under the vendor's name. No labor is shown:
                  this is not our payroll.
                </p>
              ) : null}
              {view === 'calendar' ? (
                <>
                  <PlannerView
                    days={s.team.days || []}
                    blocks={s.team.markets || []}
                    dept={s.team.dept === 'maintenance' ? 'maintenance' : 'cleaning'}
                    showLinks={s.team.dept === 'maintenance'}
                    group={group}
                  />
                  <div className="px-1">
                    <PlannerLegend dept={s.team.dept === 'maintenance' ? 'maintenance' : 'cleaning'} />
                  </div>
                </>
              ) : null}
            </div>
            <p className="px-4 py-2.5 text-[10.5px] text-neutral-400 border-t border-neutral-100">
              A long stay is {s.team.rules?.longStayNights}+ nights. Tap any day to see the work on it.
              This page is live — reload it and it is current.
            </p>
          </div>
        ) : null}

        {s.verification ? (
          <Sec Icon={ShieldCheck} title="Guest verification" sub="upcoming arrivals">
            <div className="divide-y divide-neutral-100">
              {s.verification.map((r: any, i: number) => (
                // Unit + full guest name + date + status badge overflowed a phone line.
                <div key={i} className="px-4 py-2.5 flex items-center gap-2.5 gap-y-1 flex-wrap text-[13px]">
                  <span className="font-bold text-neutral-900">{r.unit}</span>
                  <span className="text-neutral-600">{r.guest}</span>
                  <span className="text-neutral-500 tabular-nums">{r.checkIn}</span>
                  <span className={'ml-auto text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ' +
                    (r.verified === true ? 'bg-emerald-100 text-emerald-700' : r.verified === false ? 'bg-rose-100 text-rose-700' : 'bg-neutral-100 text-neutral-400')}>
                    {r.verified === true ? 'Verified' : r.verified === false ? 'Pending' : 'No field'}
                  </span>
                </div>
              ))}
              {!s.verification.length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">No upcoming arrivals.</p> : null}
            </div>
          </Sec>
        ) : null}

        {s.notes ? (
          <Sec Icon={StickyNote} title="Reservation notes">
            <div className="divide-y divide-neutral-100">
              {s.notes.map((n: any, i: number) => (
                <div key={i} className="px-4 py-2.5 text-[13px]">
                  <p><span className="font-bold text-neutral-900">{n.unit}</span> <span className="text-neutral-500">· {n.guest} · {n.checkIn}</span></p>
                  <p className="text-neutral-700 mt-0.5 whitespace-pre-wrap">{n.note}</p>
                </div>
              ))}
              {!s.notes.length ? <p className="px-4 py-4 text-[12.5px] text-neutral-400">No notes on current or upcoming stays.</p> : null}
            </div>
          </Sec>
        ) : null}

        <p className="text-[10.5px] text-neutral-400 text-center pt-2">
          Live data shared by Stay Hospitality. This link can be changed or turned off at any time.
        </p>
      </div>
    </div>
  )
}

/**
 * THE MAILING LIST ON A SHARED PAGE — the Contacts tab, read-only (Jon, 2026-09-17: "can we make
 * it function just like the tab please").
 *
 * The first cut here was a plain table: search, six columns, copy the emails. It showed only the
 * mailable rows, so the counts did not match the tab, and there was no way to ask the question the
 * tab is built around — which Airbnb guests can I email, who left us a low rating, who books direct.
 *
 * So this is the same screen: the four headline numbers, the same warning panel about who is off
 * limits and why, the same two filter axes (channel, then mail state), the same row. What it is NOT
 * is a seat in the app — no Mailchimp push, no blocked-channel settings, no refresh: a share link is
 * a window. Everything here runs on rows already delivered, so filtering and the CSV never go back
 * to the server.
 */
const CSEGS = [
  { key: '', label: 'Everyone' },
  { key: 'mailable', label: 'Can email' },
  { key: 'restricted', label: 'Channel blocked' },
  { key: 'relay', label: 'Relay address' },
  { key: 'noemail', label: 'No email' },
  { key: 'direct', label: 'Booked direct' },
  { key: 'repeat', label: 'Repeat' },
  { key: 'vip', label: 'VIP' },
  { key: 'unhappy', label: 'Left a low rating' },
]
// The segments where the point IS the people you cannot mail. Exporting those filtered to "mailable"
// would hand back an empty file, so the export follows what is on screen instead.
const CANNOT_SEGS = ['restricted', 'relay', 'noemail', 'unhappy']

function CStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  // min-w-0: a grid column's default minimum is max-content, so a long sub-line would otherwise
  // widen its column past its share and push the page off the right edge on a phone.
  return (
    <div className="min-w-0 rounded-xl bg-white ring-1 ring-line px-3 py-2.5">
      <p className="text-[9.5px] uppercase tracking-wider font-bold text-muted">{label}</p>
      <p className={'text-[19px] font-bold tabular-nums leading-tight mt-0.5 ' + (tone || 'text-ink')}>{value}</p>
      {sub ? <p className="text-[11px] text-muted mt-0.5 break-words">{sub}</p> : null}
    </div>
  )
}

function csvCell(v: any): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function ContactsTable({ data }: { data: any }) {
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  const [seg, setSeg] = useState('')
  const [chan, setChan] = useState('')
  const [sort, setSort] = useState('recent')
  const [copied, setCopied] = useState(false)
  const [why, setWhy] = useState(false)
  useEffect(() => { const t = setTimeout(() => setQ(typed.trim().toLowerCase()), 250); return () => clearTimeout(t) }, [typed])

  const rows: any[] = Array.isArray(data.rows) ? data.rows : []
  const s = data.summary || null
  const blocked: string[] = Array.isArray(data.restrictedChannels) ? data.restrictedChannels : []
  const money = data.showMoney === true

  const inSeg = (c: any) =>
    seg === 'mailable' ? c.mail === 'mailable'
    : seg === 'restricted' ? c.mail === 'restricted'
    : seg === 'relay' ? c.mail === 'relay'
    : seg === 'noemail' ? (c.mail === 'none' || c.mail === 'invalid')
    : seg === 'direct' ? !!c.everDirect
    : seg === 'repeat' ? c.stays >= 2
    : seg === 'vip' ? !!c.vip
    : seg === 'unhappy' ? !!c.unhappy
    : true
  const hit = (c: any) => !q || (c.name + ' ' + (c.email || '') + ' ' + (c.phone || '') + ' '
    + (c.units || []).join(' ') + ' ' + (c.tags || []).join(' ') + ' ' + (c.channel || '')).toLowerCase().includes(q)
  // SORTING (Jon, 2026-09-17: "should be able to sort, download, filter"). Newest stay first by
  // default, because the commonest read of this page is "who was here lately". Every sort is a
  // total order — ties fall back to the last stay, then the name — so the list never reshuffles
  // under the reader between two renders of the same data.
  const num = (v: any) => Number(v) || 0
  const cmp = (a: any, b: any) => {
    if (sort === 'stays') return num(b.stays) - num(a.stays) || String(b.lastStay || '').localeCompare(String(a.lastStay || ''))
    if (sort === 'nights') return num(b.nights) - num(a.nights) || String(b.lastStay || '').localeCompare(String(a.lastStay || ''))
    if (sort === 'value') return num(b.value) - num(a.value) || String(b.lastStay || '').localeCompare(String(a.lastStay || ''))
    if (sort === 'rating') return num(b.reviewAvg) - num(a.reviewAvg) || num(b.reviews) - num(a.reviews)
    if (sort === 'name') return String(a.last || a.name).localeCompare(String(b.last || b.name))
    if (sort === 'oldest') return String(a.lastStay || '').localeCompare(String(b.lastStay || ''))
    return String(b.lastStay || '').localeCompare(String(a.lastStay || ''))
  }
  const shown = rows.filter(c => inSeg(c) && (!chan || c.channel === chan) && hit(c))
    .sort((a, b) => cmp(a, b) || String(a.name || '').localeCompare(String(b.name || '')))

  // WHAT THE EXPORT CONTAINS (Jon, 2026-09-17: "make sure you can export by the filter and be able
  // to sort if you download all data by that field, needs to show on download" / "when you export it
  // should show low reviews category too").
  //
  // Three rules, and they are all about the file matching the screen:
  //   • THE FILTER TRAVELS. The CSV is the rows you are looking at — same segment, same channel,
  //     same search — not the whole list.
  //   • THE SORT TRAVELS, AND SAYS SO. Rows come out in the order on screen, the file is named for
  //     the field they were sorted by, and the first two columns are the rank and that field's
  //     value, so whoever opens it in Excel can see what it was sorted by without being told.
  //   • LOW RATINGS ARE SHOWN, NOT SILENTLY DROPPED. They used to be filtered out of the default
  //     export, which meant a file whose row count nobody could reconcile with the screen. They are
  //     in it now, with their own Category and a Left a low rating column, so the decision to leave
  //     them out of a campaign is made by the person reading the file, in front of the reason.
  const catOf = (c: any) =>
    c.mail === 'restricted' ? 'Channel blocked'
    : c.mail === 'relay' ? 'Relay address'
    : (c.mail === 'none' || c.mail === 'invalid') ? 'No email'
    : c.unhappy ? 'Can email — left a low rating'
    : 'Can email'
  const SORT_LABEL: Record<string, string> = {
    recent: 'Most recent stay', oldest: 'Longest since a stay', stays: 'Most stays',
    nights: 'Most nights', value: 'Highest value', rating: 'Best rated', name: 'Name A–Z',
  }
  const sortCol = sort === 'stays' ? ['Stays', (c: any) => c.stays]
    : sort === 'nights' ? ['Nights', (c: any) => c.nights]
    : sort === 'value' ? ['Lifetime value', (c: any) => c.value ?? '']
    : sort === 'rating' ? ['Average rating', (c: any) => c.reviewAvg ?? '']
    : sort === 'name' ? ['Name', (c: any) => (c.last || '') + ', ' + (c.first || '')]
    : ['Last stay', (c: any) => c.lastStay || '']
  // On a cannot-email segment the point IS the people you cannot write to, so the file is the whole
  // screen. Everywhere else it is the addresses that work — low ratings included and labelled.
  const exportRows = CANNOT_SEGS.indexOf(seg) >= 0 ? shown : shown.filter(c => c.mail === 'mailable')
  const copyList = shown.filter(c => c.mail === 'mailable' && !c.unhappy).map(c => c.email).filter(Boolean)
  const download = () => {
    const head = ['#', 'Sorted by: ' + String(sortCol[0]), 'Category', 'First name', 'Last name', 'Email',
      'Mailable', 'Why not', 'Left a low rating', 'Lowest rating', 'Average rating', 'Reviews left',
      'Phone', 'Last channel', 'Booked direct before', 'VIP', 'Stays', 'Nights',
      ...(money ? ['Lifetime value'] : []), 'First stay', 'Last stay', 'Next stay',
      'Last unit', 'Last building', 'All units', 'Tags']
    const val = sortCol[1] as (c: any) => any
    const body = exportRows.map((c, n) => [
      n + 1, val(c), catOf(c), c.first, c.last, c.email || '',
      c.mail === 'mailable' ? 'yes' : 'no', c.mail === 'mailable' ? '' : c.mailReason,
      c.unhappy ? 'yes' : 'no', c.reviewLow ?? '', c.reviewAvg ?? '', c.reviews,
      c.phone || '', c.channel, c.everDirect ? 'yes' : 'no', c.vip ? 'yes' : 'no', c.stays, c.nights,
      ...(money ? [c.value ?? ''] : []),
      c.firstStay, c.lastStay, c.nextStay || '', c.lastUnit, c.lastBuilding || '',
      (c.units || []).join(' | '), (c.tags || []).join(' | '),
    ])
    const text = '﻿' + [head, ...body].map(r => r.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    // The filename carries the filter and the sort, because three of these land in one downloads
    // folder within a minute and "contacts (2).csv" tells you nothing about which is which.
    a.download = ['contacts', todayET(), seg || 'all', chan ? chan.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '',
      'by-' + sort].filter(Boolean).join('-') + '.csv'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const chipOn = 'bg-ink text-white border-ink'
  const chipOff = 'bg-white text-muted border-line hover:text-ink hover:border-ink/25'

  return (
    <div className="space-y-3">
      {s ? (
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          <CStat label="Contacts" value={Number(s.contacts || 0).toLocaleString()}
            sub={Number(s.withPhone || 0).toLocaleString() + ' with a phone number'} />
          <CStat label="Will email" value={Number(s.mailableAfterUnhappy ?? s.mailable ?? 0).toLocaleString()} tone="text-emerald-700"
            sub={(s.unhappy ? Number(s.unhappy).toLocaleString() + ' more held back for a low rating' : '')
              || (s.contacts ? Math.round((s.mailable / s.contacts) * 100) + '% of the list' : '')} />
          <CStat label="Cannot email" value={Number((s.restricted || 0) + (s.relay || 0) + (s.noEmail || 0)).toLocaleString()} tone="text-amber-700"
            sub={[s.restricted ? Number(s.restricted).toLocaleString() + ' channel-blocked' : '',
                  s.relay ? Number(s.relay).toLocaleString() + ' relay' : '',
                  s.noEmail ? Number(s.noEmail).toLocaleString() + ' no address' : ''].filter(Boolean).join(' · ')} />
          <CStat label="Repeat guests" value={Number(s.repeat || 0).toLocaleString()}
            sub={Number(s.everDirect || 0).toLocaleString() + ' have booked direct'} />
        </div>
      ) : null}

      {/* WHO IS OFF LIMITS, AND WHY — one line each, not three paragraphs.
          The long version was correct and nobody read it: it filled a third of the screen above the
          thing you came for, and the same wall reappeared on every load. Each rule is now one line
          you can act on — the number, what it means, and the chip that shows you those people. The
          reasoning still exists, one click away, for the reader who wants it. */}
      {s && (s.relay > 0 || s.restricted > 0 || s.unhappy > 0) ? (
        <div className="rounded-xl bg-amber-50/70 ring-1 ring-amber-200/80 px-3.5 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <ul className="min-w-0 space-y-1.5">
              {s.unhappy > 0 ? (
                <li className="flex items-center gap-2 text-[12px] text-amber-900">
                  <Star size={13} className="text-amber-600 shrink-0" />
                  <span><b>{Number(s.unhappy).toLocaleString()}</b> left three stars or fewer — flagged in the export, never in Copy emails.</span>
                  <button onClick={() => setSeg('unhappy')} className="underline font-semibold shrink-0">Show</button>
                </li>
              ) : null}
              {s.restricted > 0 ? (
                <li className="flex items-center gap-2 text-[12px] text-amber-900">
                  <Ban size={13} className="text-amber-600 shrink-0" />
                  <span><b>{Number(s.restricted).toLocaleString()}</b> blocked by their channel ({blocked.join(', ') || 'none set'}) — real addresses we may not market to.</span>
                  <button onClick={() => setSeg('restricted')} className="underline font-semibold shrink-0">Show</button>
                </li>
              ) : null}
              {s.relay > 0 ? (
                <li className="flex items-center gap-2 text-[12px] text-amber-900">
                  <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                  <span><b>{Number(s.relay).toLocaleString()}</b> gave only a channel forwarding address — they expire and bounce.</span>
                  <button onClick={() => setSeg('relay')} className="underline font-semibold shrink-0">Show</button>
                </li>
              ) : null}
            </ul>
            <button onClick={() => setWhy(v => !v)}
              className="shrink-0 text-[11px] font-bold text-amber-800 underline underline-offset-2">
              {why ? 'Hide' : 'Why'}
            </button>
          </div>
          {why ? (
            <div className="mt-2.5 pt-2.5 border-t border-amber-200/70 space-y-1.5 text-[11.5px] text-amber-900 leading-relaxed">
              <p><b>Low ratings.</b> The test is their <b>lowest</b> rating, not their average — a guest who loved three
                stays and gave a 2 for the fourth is exactly who a cheerful come-back email lands worst with. Winning
                them back is a phone call, not a campaign.</p>
              <p><b>Channel-blocked.</b> {blocked.join(', ') || 'These channels'} forbid marketing to guests booked
                through them, and they hand over a real address — so the address alone cannot tell you. A guest who
                later books direct is yours again and comes off this list.</p>
              <p><b>Relay addresses.</b> <span className="font-mono text-[11px]">a1b2c3@guest.airbnb.com</span> and the
                like. They forward only while the booking is live, then bounce. Kept here so the desk can still look a
                guest up by the address the channel gave.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input value={typed} onChange={e => setTyped(e.target.value)}
            placeholder="Name, email, phone, unit or tag"
            name="shared-contact-lookup" autoComplete="off" spellCheck={false} autoCapitalize="none" autoCorrect="off"
            className="w-full h-9 pl-8 pr-3 rounded-xl border border-line bg-white text-base sm:text-[12.5px] focus:outline-none focus:ring-2 focus:ring-brand-200" />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort"
          className="h-9 px-2.5 rounded-xl border border-line bg-white text-[12px] font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-brand-200">
          <option value="recent">Most recent stay</option>
          <option value="oldest">Longest since a stay</option>
          <option value="stays">Most stays</option>
          <option value="nights">Most nights</option>
          {money ? <option value="value">Highest value</option> : null}
          <option value="rating">Best rated</option>
          <option value="name">Name A–Z</option>
        </select>
        <button type="button" onClick={download} disabled={!exportRows.length}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-xl bg-ink text-white text-[12px] font-bold disabled:opacity-40">
          <Download size={13} /> Export CSV
        </button>
        {/* COPY IS NOT EXPORT. A CSV gets read; a clipboard full of addresses gets pasted straight
            into a campaign tool, so this one stays strict — mailable, and never a guest who left us
            a low rating, whatever is on screen. */}
        <button type="button" title={copyList.length.toLocaleString() + ' addresses you may email'}
          onClick={() => { try { navigator.clipboard.writeText(copyList.join(', ')); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* blocked */ } }}
          disabled={!copyList.length}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-xl border border-line bg-white text-[12px] font-bold text-muted hover:text-ink disabled:opacity-40">
          {copied ? 'Copied' : 'Copy emails'}
        </button>
      </div>

      {/* Label beside the chips, not stacked over them — two stacked label rows cost 40px of
          vertical space each and pushed the list itself below the fold. */}
      <div className="flex items-baseline gap-2.5">
        <p className="shrink-0 w-[58px] text-[9.5px] uppercase tracking-wider font-bold text-faint pt-1.5">Channel</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setChan('')}
            className={'text-[12px] font-semibold px-2.5 h-8 rounded-xl border transition ' + (!chan ? chipOn : chipOff)}>
            All channels
          </button>
          {(s?.channels || []).map((c: any) => {
            const isBlocked = blocked.some(r => r.toLowerCase() === String(c.label).toLowerCase())
            return (
              <button key={c.label} onClick={() => setChan(c.label === chan ? '' : c.label)}
                title={isBlocked ? 'Blocked for marketing' : Number(c.mailable || 0).toLocaleString() + ' of these can be emailed'}
                className={'text-[12px] font-semibold px-2.5 h-8 rounded-xl border transition inline-flex items-center gap-1.5 ' + (chan === c.label ? chipOn : chipOff)}>
                {isBlocked ? <Ban size={11} className={chan === c.label ? 'text-white/70' : 'text-amber-600'} /> : null}
                {c.label}
                <span className={'tabular-nums font-bold ' + (chan === c.label ? 'text-white/70' : 'text-faint')}>
                  {Number(c.count || 0).toLocaleString()}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-baseline gap-2.5">
        <p className="shrink-0 w-[58px] text-[9.5px] uppercase tracking-wider font-bold text-faint pt-1.5">Show</p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {CSEGS.map(x => (
            <button key={x.key} onClick={() => setSeg(x.key)}
              className={'text-[12px] font-semibold px-2.5 h-8 rounded-xl border transition ' + (seg === x.key ? chipOn : chipOff)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {(data.short || []).length ? (
        <p className="text-[11.5px] text-amber-800 font-semibold">
          The {(data.short || []).join(' and ')} read came back short, so ratings or tags may be missing on some rows.
        </p>
      ) : null}

      {!shown.length ? (
        <div className="rounded-xl bg-white ring-1 ring-line p-10 text-center text-[12.5px] text-muted">Nobody matches that.</div>
      ) : (
        <>
          <p className="text-[11.5px] text-muted">
            Showing {Math.min(shown.length, 1000).toLocaleString()}
            {shown.length > 1000 ? ' of ' + shown.length.toLocaleString() + ' matches' : ''}
            {' '}· sorted by {(SORT_LABEL[sort] || 'Most recent stay').toLowerCase()}
            <span className="text-faint"> · </span>
            <span className="text-ink font-semibold">CSV: {exportRows.length.toLocaleString()} row{exportRows.length === 1 ? '' : 's'}</span>
            <span className="text-faint"> (this filter, this order)</span>
          </p>
          {s && Number(s.contacts || 0) > rows.length ? (
            <p className="text-[11px] text-amber-800 font-semibold">
              This link carries the first {rows.length.toLocaleString()} of {Number(s.contacts).toLocaleString()} contacts.
              Narrow the link's scope to see the rest.
            </p>
          ) : null}
          <div className="rounded-xl bg-white ring-1 ring-line overflow-hidden">
            <CHead money={money} />
            <div className="divide-y divide-line/70">
              {shown.slice(0, 1000).map((c, i) => <CRow key={c.key || i} c={c} money={money} />)}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function CRow({ c, money }: { c: any; money: boolean }) {
  // ONE LINE PER PERSON, COLUMNS THAT LINE UP (Jon, 2026-09-17: "clean the format and the visuals" /
  // "it does not fit the page properly").
  //
  // What was wrong: the email was allowed to wrap mid-word, so a relay address broke as
  // "…expediapartnercen / tral.com"; the "not mailable" caption wrapped to "not maila / ble"; and the
  // reason sentence was repeated in full under EVERY row, which on an Expedia-heavy page meant the
  // same forty words forty times. Three columns of real data turned into a 140px block of noise.
  //
  // Now: the address truncates with the full value in the tooltip, the mail state is a chip whose
  // tooltip carries the reason (the panel above explains each kind once, which is where an
  // explanation belongs), and the columns are fixed widths so the eye can run down them.
  const pill = c.mail === 'mailable' ? null
    : c.mail === 'restricted' ? { t: 'Blocked', cls: 'bg-amber-100 text-amber-800' }
    : c.mail === 'relay' ? { t: 'Relay', cls: 'bg-amber-100 text-amber-800' }
    : { t: 'No email', cls: 'bg-neutral-100 text-neutral-500' }
  return (
    <div className="px-3.5 py-2 flex items-center gap-3 hover:bg-neutral-50/70">
      {/* WHO — name over address. The only column allowed to take the slack. */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink leading-tight flex items-center gap-1.5 min-w-0">
          <span className="truncate">{c.first} {c.last}</span>
          {c.vip ? <span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-violet-100 text-violet-800">VIP</span> : null}
          {c.inHouse ? <span className="shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">In house</span> : null}
          {(c.tags || []).slice(0, 2).map((t: string) => (
            <span key={t} className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-app text-muted ring-1 ring-line">{t}</span>
          ))}
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 min-w-0 text-[11.5px]">
          {c.mail === 'mailable'
            ? <Mail size={11} className="text-emerald-600 shrink-0" />
            : <MailX size={11} className="text-amber-600 shrink-0" />}
          <span className={'truncate ' + (c.mail === 'mailable' ? 'text-ink' : 'text-muted')} title={c.email || ''}>
            {c.email || 'no email on file'}
          </span>
          {pill ? (
            <span title={c.mailReason} className={'shrink-0 text-[9.5px] font-bold uppercase px-1.5 py-0.5 rounded ' + pill.cls}>
              {pill.t}
            </span>
          ) : null}
        </p>
      </div>

      {/* Phone: its own column so it stops landing on a line of its own under the address. */}
      <div className="hidden lg:block shrink-0 w-[130px] text-[11.5px] text-muted tabular-nums truncate">
        {c.phone || '—'}
      </div>

      <div className="hidden sm:block shrink-0 w-[120px] min-w-0">
        <p className="text-[11.5px] text-ink font-semibold truncate" title={c.channel}>{c.channel || '—'}</p>
        {c.everDirect ? <p className="text-[10px] text-emerald-700 font-semibold">direct before</p> : null}
      </div>

      <div className="hidden md:block shrink-0 w-[150px] min-w-0">
        <p className="text-[11.5px] text-muted truncate" title={(c.units || []).join(', ')}>{c.lastUnit || '—'}</p>
        {(c.units || []).length > 1 ? <p className="text-[10px] text-faint">+{c.units.length - 1} more</p> : null}
      </div>

      <div className="shrink-0 w-[92px] text-[11.5px] leading-tight">
        <p className="text-ink font-semibold tabular-nums">{c.stays} stay{c.stays === 1 ? '' : 's'}</p>
        <p className="text-muted tabular-nums">{c.nights}n{money && c.value != null ? ' · ' + usd(c.value) : ''}</p>
      </div>

      <div className="hidden sm:flex shrink-0 w-[74px] items-center gap-1 text-[11.5px] tabular-nums">
        <Star size={10} className={c.reviews ? 'text-amber-500' : 'text-line'} />
        <span className={c.reviews ? 'text-ink' : 'text-faint'}>{c.reviews ? (c.reviewAvg ?? c.reviews) : '—'}</span>
        {c.unhappy ? <span className="text-[9px] font-bold uppercase text-amber-700">low</span> : null}
      </div>

      <div className="shrink-0 w-[78px] text-[11px] text-muted tabular-nums text-right">{c.lastStay || '—'}</div>
    </div>
  )
}

/** The column heads. Only at sm+ — on a phone each row reads as a card and a header would lie. */
function CHead({ money }: { money: boolean }) {
  const h = 'text-[9.5px] uppercase tracking-wider font-bold text-faint'
  return (
    <div className="hidden sm:flex items-center gap-3 px-3.5 py-1.5 bg-neutral-50 border-b border-line">
      <div className={'flex-1 min-w-0 ' + h}>Guest</div>
      <div className={'hidden lg:block shrink-0 w-[130px] ' + h}>Phone</div>
      <div className={'shrink-0 w-[120px] ' + h}>Channel</div>
      <div className={'hidden md:block shrink-0 w-[150px] ' + h}>Last unit</div>
      <div className={'shrink-0 w-[92px] ' + h}>{money ? 'Stays · value' : 'Stays'}</div>
      <div className={'shrink-0 w-[74px] ' + h}>Rating</div>
      <div className={'shrink-0 w-[78px] text-right ' + h}>Last stay</div>
    </div>
  )
}
