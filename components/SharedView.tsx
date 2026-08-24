'use client'
// WHAT THE LINK HOLDER SEES. One phone-friendly page, section by section, in the order a partner
// reads: who's coming, what it's earning, how the bookings arrived, what's being cleaned, who's
// verified, what the notes say. Only sections the link enables ever arrive from the API — this
// component cannot leak what it was never sent.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock, CalendarDays, TrendingUp, Megaphone, Sparkles, ShieldCheck, StickyNote, Users } from 'lucide-react'

// Same tag tones as the in-app planner, so a crew member sees the same colours in both places.
const TAG_DOT: Record<string, string> = {
  amber: 'bg-amber-500', violet: 'bg-violet-500', emerald: 'bg-emerald-500', sky: 'bg-sky-500',
}

const usd = (n: any) => n == null ? null : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

export function SharedView({ code }: { code: string }) {
  const [data, setData] = useState<any | null>(null)
  const [err, setErr] = useState('')
  const [pw, setPw] = useState('')
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (passcode?: string) => {
    setBusy(true); setErr('')
    try {
      const r = passcode
        ? await fetch('/api/share/' + encodeURIComponent(code), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pw: passcode }), cache: 'no-store' })
        : await fetch('/api/share/' + encodeURIComponent(code), { cache: 'no-store' })
      const j = await r.json()
      if (r.status === 404) throw new Error('This link is not valid or has been turned off.')
      if (j.locked) { setLocked(true); setData(j); if (j.error) setErr(j.error); setBusy(false); return }
      if (!j.ok) throw new Error(j.error || 'Could not load.')
      setLocked(false); setData(j)
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

      <div className="px-3 pt-3 space-y-3 max-w-2xl mx-auto">
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

        {s.team ? (
          <Sec Icon={Users} title="Weekly planner" sub={s.team.from + ' → ' + s.team.to}>
            {(s.team.markets || []).map((m: any) => (
              <div key={m.market} className="border-b border-neutral-100 last:border-b-0">
                <div className="px-4 py-2 flex items-center gap-2 flex-wrap bg-neutral-50">
                  <p className="text-[12.5px] font-bold text-neutral-900">{m.market}</p>
                  <p className="text-[11px] text-neutral-500">{(m.people || []).length} on · {m.cleans} cleans</p>
                </div>
                {!(m.people || []).length ? (
                  <p className="px-4 py-3 text-[12.5px] text-neutral-400">Nobody assigned in this window.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 bg-white text-left px-3 py-1.5 min-w-[130px]">
                            <span className="text-[9.5px] uppercase tracking-wider font-bold text-neutral-400">Who</span>
                          </th>
                          {(s.team.days || []).map((d: any) => (
                            <th key={d.date} className={'px-1 py-1.5 text-center min-w-[42px] ' + (d.weekend ? 'bg-neutral-50' : '')}>
                              <span className="block text-[9.5px] font-bold uppercase text-neutral-400">{d.dow}</span>
                              <span className="block text-[10.5px] tabular-nums text-neutral-500">{String(d.date).slice(8)}</span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(m.people || []).map((p: any) => (
                          <tr key={p.name}>
                            <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-t border-neutral-100">
                              <p className="text-[12.5px] font-semibold text-neutral-900 leading-tight">{p.name}</p>
                              <p className="text-[10px] text-neutral-400">{p.dept} · {p.daysWorked}d</p>
                            </td>
                            {(s.team.days || []).map((d: any) => {
                              const jobs = (p.byDay || {})[d.date] || []
                              const cleans = jobs.filter((j: any) => j.isClean).length
                              const seen: Record<string, boolean> = {}
                              const dots = jobs.reduce((a: any[], j: any) => a.concat(j.tags || []), [])
                                .filter((t: any) => (seen[t.key] ? false : (seen[t.key] = true)))
                              return (
                                <td key={d.date} className={'px-1 py-1.5 text-center align-top border-t border-neutral-100 ' + (d.weekend ? 'bg-neutral-50' : '')}>
                                  {jobs.length ? (
                                    <div title={jobs.map((j: any) => j.unit + ' — ' + j.task).join('\n')}
                                      className={'rounded-md py-0.5 ' + (cleans ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500')}>
                                      <span className="block text-[11.5px] font-bold tabular-nums leading-none">{jobs.length}</span>
                                      {dots.length ? (
                                        <span className="flex justify-center gap-0.5 mt-0.5">
                                          {dots.slice(0, 3).map((t: any) => <span key={t.key} title={t.label} className={'w-1 h-1 rounded-full ' + (TAG_DOT[t.tone] || 'bg-neutral-300')} />)}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : <span className="text-[10px] text-neutral-300">·</span>}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
            <p className="px-4 py-2 text-[10.5px] text-neutral-400">
              A long stay is {s.team.rules?.longStayNights}+ nights. Dots mark a day carrying a tag —
              hover a cell for the units.
            </p>
          </Sec>
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
