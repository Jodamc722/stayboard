// RECOVERY — the units still waiting for a good review, and who is booked there next.
//
// Moved here from the Calls desk on 2026-09-09 (Jon: "move review recovery to review section
// unless it falls into actual welcome call"). Recovery is a reputation fact — the unit's last low
// review has not been answered by a 4.5+ one — so it reads with the reviews. The Calls desk keeps
// only the arrivals inside its 72-hour window; those are marked "on the calls desk" here and link
// straight to it. Everything further out is the runway: the manager sees weeks ahead which burned
// units have guests coming, and can fix the thing the last guest wrote about before they land.
//
// THE REVIEW IS ON THE PAGE (Jon, same day: "remove the recovery tab and make sure the reviews are
// populating in"). It was behind a show/hide toggle, which made a list of 57 units read as 57 empty
// rows — and the whole point of the section is the sentence the guest wrote. So the quote is always
// rendered, and the ~1 unit in 14 whose low review is a rating with no comment says so in words
// rather than showing nothing.
//
// Server component: no state, nothing to click except the links. Rules for entering and leaving
// recovery are at the top of lib/call-desk.ts.
import { HeartHandshake, PhoneCall, Check, CalendarDays, AlertTriangle, Star } from 'lucide-react'
import type { RecoveryBoard as Board } from '@/lib/call-desk'

const shortDay = (ymd: string) => { try { return new Date(ymd + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) } catch { return ymd } }
const money = (n: number) => n ? '$' + Math.round(n).toLocaleString() : ''

export function RecoveryBoard({ board }: { board: Board }) {
  const { today, units, failed, horizonDays } = board
  const nextDay = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
  const when = (d: string) => d === today ? 'Today' : d === nextDay(today) ? 'Tomorrow' : shortDay(d)
  const withArrivals = units.filter(u => u.arrivals.length).length
  const onDesk = units.reduce((n, u) => n + u.arrivals.filter(a => a.onDesk && !a.called).length, 0)

  return (
    <section id="recovery" className="mb-5 scroll-mt-4">
      <div className="mb-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-rose-700 flex items-center gap-1.5"><HeartHandshake size={12} /> Recovery · {failed ? '—' : units.length} unit{units.length === 1 ? '' : 's'} waiting for a good review</h2>
        <p className="text-[12px] text-muted mt-0.5 max-w-3xl">A unit is in recovery from its last review of 3 stars or under until a 4.5+ review lands after it. Every arrival at one of these units gets a mandatory welcome call; the ones inside the next 72 hours are on the <a href="/welcome-calls" className="font-semibold text-brand-700 hover:underline">Calls desk</a>{onDesk ? ` (${onDesk} open there now)` : ''}. The rest, out to {horizonDays} days, are here so the fix can happen before the guest does.</p>
      </div>

      {failed ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>The review scan came back short, so recovery could not be worked out on this load — this is <b>not</b> a sign that no unit is in recovery. Reload in a minute.</span>
        </div>
      ) : units.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-sm text-muted">No units in recovery — every unit with a low review has earned a good one since.</div>
      ) : (
        <ul className="rounded-2xl border border-line bg-white divide-y divide-line overflow-hidden">
          {units.map(u => {
            const next = u.arrivals[0]
            const first = u.guest ? u.guest.split(' ')[0] : ''
            return (
              <li key={u.listingId} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink">{u.listing}</span>
                    {u.building && u.building !== u.listing && <span className="text-[11px] text-muted">{u.building}</span>}
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-600 text-white inline-flex items-center gap-0.5"><Star size={10} /> {u.rating.toFixed(1)}★</span>
                    <span className="text-[11px] text-muted">{u.openDays} {u.openDays === 1 ? 'day' : 'days'} without a good review</span>
                  </div>
                  <div className="text-[12px] shrink-0">
                    {next
                      ? <span className={`inline-flex items-center gap-1 font-semibold ${next.onDesk ? 'text-rose-700' : 'text-ink'}`}><CalendarDays size={12} /> Next arrival {when(next.check_in)}</span>
                      : <span className="text-muted">Nobody booked in {horizonDays} days</span>}
                  </div>
                </div>

                {/* WHAT THE GUEST ACTUALLY WROTE — the reason this unit is on the list. */}
                <blockquote className="mt-1.5 border-l-2 border-rose-300 pl-2.5 max-w-3xl">
                  {u.content
                    ? <p className="text-[12.5px] text-ink/80 leading-snug">{'“'}{u.content}{'”'}</p>
                    : <p className="text-[12.5px] text-muted italic leading-snug">Rated {u.rating.toFixed(1)}★ with no comment — nothing written to go on, so ask on the call what went wrong.</p>}
                  <footer className="text-[11px] text-muted mt-0.5">
                    {first || 'Guest'}{u.channel ? ` · ${u.channel}` : ''} · {shortDay(u.at)}
                    {u.reviewsSince ? ` · ${u.reviewsSince} review${u.reviewsSince === 1 ? '' : 's'} since, none 4.5+` : ' · no reviews since'}
                  </footer>
                </blockquote>

                {u.arrivals.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {u.arrivals.map(a => (
                      <li key={a.id} className={`text-[12px] rounded-lg border px-2 py-1 inline-flex items-center gap-1.5 ${a.called ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : a.onDesk ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-line bg-white text-ink'}`}>
                        <span className="font-semibold">{when(a.check_in)}</span>
                        <span>{a.guest || 'Guest'}</span>
                        {a.nights ? <span className="text-muted">· {a.nights}n</span> : null}
                        {a.value ? <span className="text-muted">· {money(a.value)}</span> : null}
                        {a.called
                          ? <span className="inline-flex items-center gap-0.5 font-semibold"><Check size={11} /> called</span>
                          : a.onDesk
                            ? <a href="/welcome-calls" className="inline-flex items-center gap-0.5 font-semibold hover:underline"><PhoneCall size={11} /> on the calls desk</a>
                            : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!failed && units.length > 0 && (
        <p className="text-[11px] text-muted mt-1.5">{withArrivals} of {units.length} unit{units.length === 1 ? '' : 's'} {withArrivals === 1 ? 'has' : 'have'} a guest booked in the next {horizonDays} days. Soonest arrival first; units with nobody booked follow, longest-waiting first.</p>
      )}
    </section>
  )
}
